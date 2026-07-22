import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getPendingImports, approveImports, rejectImports, getDuplicateMap, getSuppliers, updateImportRow,
  type ImportRow, type Accessory, type Supplier } from "@/lib/store";
import { useRequireRole } from "@/lib/auth";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";

const PAGE_SIZES = [100, 250, 500];

export default function ImportReviewPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [dupMap, setDupMap] = useState<Map<string, Accessory[]>>(new Map());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // For duplicate rows the admin resolves: id → "new" (overwrite existing) or "old" (keep existing)
  const [resolutions, setResolutions] = useState<Record<string, "new" | "old">>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(100);
  const [detailRow, setDetailRow] = useState<ImportRow | null>(null);   // full-detail modal
  const [compareRow, setCompareRow] = useState<ImportRow | null>(null); // duplicate compare modal
  const [editRow, setEditRow] = useState<ImportRow | null>(null);       // manual-fix modal
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [completion, setCompletion] = useState<null | { added: number; overwritten: number; failed: number; errors: string[] }>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { authed } = useRequireRole("acc");

  const load = () => {
    setLoading(true);
    Promise.all([getPendingImports(), getDuplicateMap(), getSuppliers()])
      .then(([imports, dmap, sups]) => {
        setRows(imports); setDupMap(dmap); setSuppliers(sups);
        setSelected(new Set()); setResolutions({});
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (authed) load(); }, [authed]);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const keyOf = (r: { type: string; acc_code: string; color: string; size: string }) =>
    `${r.type}|${r.acc_code}|${r.color}|${r.size}`;
  const matchesFor = (r: ImportRow) => dupMap.get(keyOf(r)) ?? [];
  const dupCount = (r: ImportRow) => matchesFor(r).length;
  const isDup = (r: ImportRow) => dupCount(r) > 0;
  const isMultiDup = (r: ImportRow) => dupCount(r) > 1;
  const isValid = (r: ImportRow) => r.type.trim() !== "" && r.unit.trim() !== "";
  const supName = (id: string | null) => suppliers.find((s) => s.id === id)?.supplier_name ?? "—";

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.type.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) ||
      r.acc_code.toLowerCase().includes(q) || r.supplier_name.toLowerCase().includes(q);
  });

  const pg = usePagination(filtered, `${search}|${pageSize}`, pageSize);
  const pageRows = pg.pageItems;

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const setRes = (id: string, val: "new" | "old") => setResolutions((p) => ({ ...p, [id]: val }));

  // Select-all skips duplicates entirely (only non-duplicate valid rows)
  const pageSelectableIds = pageRows.filter((r) => isValid(r) && !isDup(r)).map((r) => r.id);
  const allPageSelected = pageSelectableIds.length > 0 && pageSelectableIds.every((id) => selected.has(id));
  const togglePageAll = () => {
    const next = new Set(selected);
    if (allPageSelected) pageSelectableIds.forEach((id) => next.delete(id));
    else pageSelectableIds.forEach((id) => next.add(id));
    setSelected(next);
  };

  // What will happen on approve:
  //  - selected non-duplicates → insert new
  //  - duplicates resolved "new" (single match only) → overwrite that match
  //  - duplicates resolved "old" or unresolved → skipped
  const buildApprovalList = () => {
    const list: (ImportRow & { overwriteId?: string })[] = [];
    for (const r of rows) {
      if (!isValid(r)) continue;
      if (isDup(r)) {
        if (resolutions[r.id] === "new" && !isMultiDup(r)) {
          list.push({ ...r, overwriteId: matchesFor(r)[0].id });
        }
        // "old" or unresolved or multi-match → skip
      } else if (selected.has(r.id)) {
        list.push(r);
      }
    }
    return list;
  };

  const overwriteCount = rows.filter((r) => isValid(r) && isDup(r) && resolutions[r.id] === "new" && !isMultiDup(r)).length;
  const newCount = rows.filter((r) => isValid(r) && !isDup(r) && selected.has(r.id)).length;

  const doApprove = async () => {
    const list = buildApprovalList();
    if (list.length === 0) { showToast("ไม่มีรายการที่จะอนุมัติ", "error"); return; }
    const plannedAdded = list.filter((x) => !x.overwriteId).length;
    const plannedOverwritten = list.filter((x) => x.overwriteId).length;
    setSaving(true);
    setConfirmOverwrite(false);
    setProgress({ done: 0, total: list.length });
    try {
      const { approved, errors } = await approveImports(list, (done, total) => setProgress({ done, total }));
      const failed = list.length - approved;
      setCompletion({
        added: plannedAdded,
        overwritten: plannedOverwritten,
        failed,
        errors: errors.slice(0, 10),
      });
      load();
    } catch (e: any) {
      showToast("เกิดข้อผิดพลาด: " + (e.message ?? ""), "error");
    } finally { setSaving(false); setProgress(null); }
  };

  const handleApproveClick = () => {
    if (buildApprovalList().length === 0) { showToast("ไม่มีรายการที่จะอนุมัติ", "error"); return; }
    // Require confirmation if any overwrite is involved
    if (overwriteCount > 0) setConfirmOverwrite(true);
    else doApprove();
  };

  // Manual edit of a staged row before it's written to the database.
  const normName = (s: string) => String(s ?? "").trim().replace(/\s+/g, " ");
  const openEdit = (r: ImportRow) => {
    // Snap the incoming supplier name to an existing supplier's exact name if it
    // matches (whitespace-insensitive), so the dropdown shows it selected.
    const matchedSup = suppliers.find((s) => normName(s.supplier_name) === normName(r.supplier_name));
    setEditForm({
      type: r.type, acc_code: r.acc_code, description: r.description,
      row: r.row, color: r.color, size: r.size,
      quantity: r.quantity, min_quantity: r.min_quantity,
      unit: r.unit, unit_cost: r.unit_cost,
      supplier_name: matchedSup ? matchedSup.supplier_name : r.supplier_name,
    });
    setEditRow(r);
  };
  const ef = (k: string, v: any) => setEditForm((p) => ({ ...p, [k]: v }));

  const saveEdit = async () => {
    if (!editRow) return;
    if (!String(editForm.type).trim() || !String(editForm.unit).trim()) {
      showToast("ต้องระบุประเภทและหน่วย", "error"); return;
    }
    setSaving(true);
    try {
      const patch = {
        type: String(editForm.type).trim(), acc_code: String(editForm.acc_code).trim(),
        description: String(editForm.description).trim(),
        row: editForm.row === "" || editForm.row === null ? null : parseInt(String(editForm.row)) || null,
        color: String(editForm.color).trim(), size: String(editForm.size).trim(),
        quantity: Number(editForm.quantity) || 0, min_quantity: Number(editForm.min_quantity) || 0,
        unit: String(editForm.unit).trim(), unit_cost: Number(editForm.unit_cost) || 0,
        supplier_name: String(editForm.supplier_name).trim(),
      };
      const updated = await updateImportRow(editRow.id, patch);
      setRows((prev) => prev.map((r) => (r.id === editRow.id ? { ...r, ...updated } : r)));
      setEditRow(null);
      showToast("บันทึกการแก้ไขแล้ว ✓", "success");
    } catch (e: any) {
      showToast("เกิดข้อผิดพลาด: " + (e.message ?? ""), "error");
    } finally { setSaving(false); }
  };

  const handleReject = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setSaving(true);
    try {
      await rejectImports(ids);
      showToast(`ปฏิเสธ ${ids.length} รายการแล้ว`, "success");
      load();
    } catch (e: any) {
      showToast("เกิดข้อผิดพลาด: " + (e.message ?? ""), "error");
    } finally { setSaving(false); }
  };

  if (!authed) return null;
  const actionCount = newCount + overwriteCount;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <SearchInput value={search} onChange={setSearch} placeholder="ค้นหา…" style={{ flex: "1 1 220px" }} />
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ width: "auto" }}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} ต่อหน้า</option>)}
        </select>
        <button onClick={() => router.push("/import")}>+ นำเข้าไฟล์ใหม่</button>
        {actionCount > 0 && (
          <button className="primary" onClick={handleApproveClick} disabled={saving}>
            {saving ? "กำลังดำเนินการ…" : `อนุมัติ ${actionCount} รายการ`}
          </button>
        )}
        {selected.size > 0 && (
          <button className="danger" onClick={handleReject} disabled={saving}>ปฏิเสธ {selected.size}</button>
        )}
        <span style={{ alignSelf: "center", fontSize: 15, color: "var(--text3)" }}>รอตรวจสอบ {filtered.length} รายการ</span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text3)" }}>กำลังโหลด…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text3)" }}>ไม่มีรายการรอตรวจสอบ</div>
        ) : (
          <div style={{ height: "62vh", overflowY: "auto", overflowX: "auto" }}>
            <table style={{ tableLayout: "fixed", minWidth: 1180 }}>
              <colgroup>
                <col style={{ width: "44px" }} /><col style={{ width: "12%" }} /><col style={{ width: "8%" }} />
                <col style={{ width: "15%" }} /><col style={{ width: "9%" }} /><col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} /><col style={{ width: "14%" }} /><col style={{ width: "9%" }} />
                <col style={{ width: "170px" }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ textAlign: "center", background: "var(--bg2)" }}>
                    <input type="checkbox" checked={allPageSelected} onChange={togglePageAll} style={{ width: "auto", cursor: "pointer" }} title="เลือกทั้งหมด (ข้ามรายการซ้ำ)" />
                  </th>
                  <th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ประเภท</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>รหัส</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>รายละเอียด</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สี/ขนาด</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สต็อค</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>หน่วย</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ซัพพลายเออร์</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สถานะ</th><th style={{ background: "var(--bg2)" }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const valid = isValid(r);
                  const dup = isDup(r);
                  const multi = isMultiDup(r);
                  const checked = selected.has(r.id);
                  const res = resolutions[r.id];
                  return (
                    <tr key={r.id}
                      style={{ opacity: valid ? 1 : 0.5, background: (checked || res === "new") ? "var(--bg4)" : undefined }}>
                      <td style={{ textAlign: "center" }}>
                        {!dup && (
                          <input type="checkbox" checked={checked} disabled={!valid}
                            onChange={() => toggle(r.id)} style={{ width: "auto", cursor: valid ? "pointer" : "not-allowed" }} />
                        )}
                      </td>
                      <td style={{ fontWeight: 500, wordBreak: "break-word", cursor: "pointer" }} onClick={() => setDetailRow(r)}>
                        {r.type || <span style={{ color: "var(--red)" }}>ไม่มีประเภท</span>}
                      </td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text2)" }}>{r.acc_code || "—"}</td>
                      <td style={{ wordBreak: "break-word", cursor: "pointer" }} onClick={() => setDetailRow(r)}>{r.description || "—"}</td>
                      <td style={{ fontSize: 14, color: "var(--text2)" }}>{[r.color, r.size].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{Number(r.quantity).toLocaleString()}</td>
                      <td style={{ color: r.unit ? "var(--text2)" : "var(--red)" }}>{r.unit || "ไม่มีหน่วย"}</td>
                      <td style={{ fontSize: 14, color: "var(--text2)", wordBreak: "break-word" }}>{r.supplier_name || "—"}</td>
                      <td>
                        {!valid ? <span className="badge badge-out">ข้อมูลไม่ครบ</span>
                          : dup ? <span className="badge badge-low">อาจซ้ำ{multi ? ` (${dupCount(r)})` : ""}</span>
                          : <span style={{ fontSize: 14, color: "var(--green)" }}>✓ ใหม่</span>}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          <button className="ghost" style={{ padding: "3px 6px", fontSize: 13, whiteSpace: "nowrap" }} onClick={() => openEdit(r)}>แก้ไข</button>
                        {valid && dup && (
                          <>
                            <button className="ghost" style={{ padding: "3px 6px", fontSize: 13, whiteSpace: "nowrap" }} onClick={() => setCompareRow(r)}>เทียบ</button>
                            {multi ? (
                              <span style={{ fontSize: 12, color: "var(--text3)", alignSelf: "center" }}>ซ้ำหลายรายการ</span>
                            ) : (
                              <>
                                <button style={{ padding: "3px 6px", fontSize: 13, whiteSpace: "nowrap",
                                  ...(res === "new" ? { background: "var(--accent)", color: "#0f0f0f", borderColor: "var(--accent)" } : {}) }}
                                  onClick={() => setRes(r.id, "new")}>ทับใหม่</button>
                                <button style={{ padding: "3px 6px", fontSize: 13, whiteSpace: "nowrap",
                                  ...(res === "old" ? { borderColor: "var(--text2)", color: "var(--text)" } : {}) }}
                                  onClick={() => setRes(r.id, "old")}>คงเดิม</button>
                              </>
                            )}
                          </>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar {...pg} />
      </div>

      <p style={{ marginTop: 12, fontSize: 14, color: "var(--text3)" }}>
        "เลือกทั้งหมด" จะเลือกเฉพาะรายการใหม่ (ข้ามรายการซ้ำ) · รายการซ้ำเลือก "ทับใหม่" เพื่อเขียนทับข้อมูลเดิม หรือ "คงเดิม" เพื่อข้าม ·
        รายการที่ซ้ำหลายรายการต้องจัดการเองในหน้าจัดการ · กด "เทียบ" เพื่อดูความต่าง · คลิกแถวเพื่อดูข้อมูลทั้งหมด
      </p>

      {/* Full detail modal */}
      {detailRow && (
        <div className="modal-overlay" onClick={() => setDetailRow(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ fontWeight: 500, fontSize: 16 }}>{detailRow.type}</div>
                <div style={{ fontSize: 14, color: "var(--text2)" }}>{detailRow.description}</div>
              </div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setDetailRow(null)}>✕</button>
            </div>
            <div className="modal-body">
              {[
                ["รหัสสินค้า", detailRow.acc_code],
                ["รายละเอียด", detailRow.description],
                ["สี", detailRow.color], ["ขนาด", detailRow.size],
                ["แถว", detailRow.row != null ? String(detailRow.row) : ""],
                ["สต็อค", `${Number(detailRow.quantity).toLocaleString()} ${detailRow.unit}`],
                ["สต็อคขั้นต่ำ", String(detailRow.min_quantity)],
                ["ราคาซื้อ", `฿${Number(detailRow.unit_cost).toFixed(2)}`],
                ["— ซัพพลายเออร์ —", ""],
                ["ชื่อบริษัท", detailRow.supplier_name],
                ["ผู้ติดต่อ", detailRow.contact_person],
                ["เบอร์ติดต่อ", detailRow.contact_number],
                ["อีเมล", detailRow.contact_email],
                ["ที่อยู่", detailRow.address],
                ["จังหวัด", detailRow.city], ["ประเทศ", detailRow.country],
                ["รหัสไปรษณีย์", detailRow.postal_code],
                ["ระยะเวลาส่ง", detailRow.lead_time],
                ["เทอมจ่ายเงิน", detailRow.payment_term],
                ["เลขผู้เสียภาษี", detailRow.tax_id],
              ].map(([label, val], i) => (
                label.startsWith("—") ? (
                  <div key={i} style={{ padding: "10px 0 4px", fontSize: 13, color: "var(--accent)", fontWeight: 500 }}>{label}</div>
                ) : (
                  <div key={i} style={{ display: "flex", padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ width: 130, color: "var(--text3)", fontSize: 14, flexShrink: 0 }}>{label}</span>
                    <span style={{ color: "var(--text)", wordBreak: "break-word" }}>{val || "—"}</span>
                  </div>
                )
              ))}
            </div>
            <div className="modal-footer">
              <button className="primary" onClick={() => setDetailRow(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* Compare modal */}
      {compareRow && (() => {
        const matches = matchesFor(compareRow);
        const fields: [string, (a: Accessory) => string, string][] = [
          ["ประเภท", (a) => a.type, compareRow.type],
          ["รหัสสินค้า", (a) => a.acc_code, compareRow.acc_code],
          ["รายละเอียด", (a) => a.description, compareRow.description],
          ["สี", (a) => a.color, compareRow.color],
          ["ขนาด", (a) => a.size, compareRow.size],
          ["หน่วย", (a) => a.unit, compareRow.unit],
          ["ราคาซื้อ", (a) => `฿${Number(a.unit_cost).toFixed(2)}`, compareRow.unit_cost ? `฿${compareRow.unit_cost.toFixed(2)}` : "—"],
          ["สต็อค", (a) => String(a.quantity), String(compareRow.quantity)],
          ["ขั้นต่ำ", (a) => String(a.min_quantity), String(compareRow.min_quantity)],
          ["ซัพพลายเออร์", (a) => supName(a.supplier_id), compareRow.supplier_name || "—"],
        ];
        return (
          <div className="modal-overlay" onClick={() => setCompareRow(null)}>
            <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div style={{ fontWeight: 500 }}>เปรียบเทียบ · {matches.length} รายการที่ตรงกัน</div>
                <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setCompareRow(null)}>✕</button>
              </div>
              <div className="modal-body">
                {matches.map((m, idx) => (
                  <div key={m.id} style={{ marginBottom: idx < matches.length - 1 ? 20 : 0 }}>
                    {matches.length > 1 && <div style={{ fontSize: 14, color: "var(--text3)", marginBottom: 6 }}>รายการที่มีอยู่ #{idx + 1}</div>}
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: "1px", background: "var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
                      <div style={{ background: "var(--bg3)", padding: "8px 10px", fontSize: 13, color: "var(--text3)" }}></div>
                      <div style={{ background: "var(--bg3)", padding: "8px 10px", fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>นำเข้า (ใหม่)</div>
                      <div style={{ background: "var(--bg3)", padding: "8px 10px", fontSize: 13, fontWeight: 500, color: "var(--text2)" }}>มีอยู่แล้ว</div>
                      {fields.map(([label, getExisting, importVal], fi) => {
                        const existingVal = getExisting(m);
                        const differs = (existingVal || "—") !== (importVal || "—");
                        return (
                          <div key={fi} style={{ display: "contents" }}>
                            <div style={{ background: "var(--bg2)", padding: "7px 10px", fontSize: 13, color: "var(--text3)" }}>{label}</div>
                            <div style={{ background: "var(--bg2)", padding: "7px 10px", fontSize: 14, color: differs ? "var(--accent)" : "var(--text)" }}>{importVal || "—"}</div>
                            <div style={{ background: "var(--bg2)", padding: "7px 10px", fontSize: 14, color: differs ? "var(--text2)" : "var(--text)" }}>{existingVal || "—"}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="modal-footer">
                <button className="primary" onClick={() => setCompareRow(null)}>ปิด</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Manual edit of a staged row (fix data before it is written to the DB) */}
      {editRow && (
        /* No close-on-overlay-click: this form holds typed-in data, and an accidental
           click outside used to discard it. Close via ✕ or ยกเลิก only. */
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <div style={{ fontWeight: 500 }}>แก้ไขรายการนำเข้า</div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setEditRow(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">ประเภท <span style={{ color: "var(--red)" }}>*</span></label>
                  <input value={editForm.type} onChange={(e) => ef("type", e.target.value)} />
                </div>
                <div>
                  <label className="form-label">รหัสสินค้า</label>
                  <input value={editForm.acc_code} onChange={(e) => ef("acc_code", e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">รายละเอียด</label>
                <input value={editForm.description} onChange={(e) => ef("description", e.target.value)} />
              </div>
              <div className="form-row form-grid form-grid-3">
                <div>
                  <label className="form-label">สี</label>
                  <input value={editForm.color} onChange={(e) => ef("color", e.target.value)} />
                </div>
                <div>
                  <label className="form-label">ขนาด</label>
                  <input value={editForm.size} onChange={(e) => ef("size", e.target.value)} />
                </div>
                <div>
                  <label className="form-label">แถว (ด้าย)</label>
                  <input type="number" value={editForm.row ?? ""} onChange={(e) => ef("row", e.target.value)} placeholder="—" />
                </div>
              </div>
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">หน่วย <span style={{ color: "var(--red)" }}>*</span></label>
                  <input value={editForm.unit} onChange={(e) => ef("unit", e.target.value)} placeholder="เช่น เส้น" />
                </div>
                <div>
                  <label className="form-label">ราคาซื้อ (฿)</label>
                  <input type="number" step="0.0001" value={editForm.unit_cost} onChange={(e) => ef("unit_cost", e.target.value)} />
                </div>
              </div>
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">สต็อค</label>
                  <input type="number" value={editForm.quantity} onChange={(e) => ef("quantity", e.target.value)} />
                </div>
                <div>
                  <label className="form-label">ขั้นต่ำ</label>
                  <input type="number" value={editForm.min_quantity} onChange={(e) => ef("min_quantity", e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">ซัพพลายเออร์</label>
                <select value={editForm.supplier_name || ""} onChange={(e) => ef("supplier_name", e.target.value)}>
                  <option value="">— ไม่ระบุ —</option>
                  {editForm.supplier_name && !suppliers.some((s) => s.supplier_name === editForm.supplier_name) && (
                    <option value={editForm.supplier_name}>{editForm.supplier_name} — ไม่ตรงกับรายชื่อ</option>
                  )}
                  {suppliers.map((s) => <option key={s.id} value={s.supplier_name}>{s.supplier_name}</option>)}
                </select>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                  เลือกจากรายชื่อที่มีอยู่ หรือเว้นว่างหากไม่มีที่ตรง — ระบบไม่สร้างซัพพลายเออร์ใหม่
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setEditRow(null)}>ยกเลิก</button>
              <button className="primary" onClick={saveEdit} disabled={saving}>
                {saving ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overwrite confirmation */}
      {confirmOverwrite && (
        <div className="modal-overlay" onClick={() => setConfirmOverwrite(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500, color: "var(--accent)" }}>ยืนยันการเขียนทับข้อมูล</div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setConfirmOverwrite(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: "var(--text2)" }}>
                จะเพิ่มรายการใหม่ <strong style={{ color: "var(--text)" }}>{newCount}</strong> รายการ
                และ <strong style={{ color: "var(--accent)" }}>เขียนทับข้อมูลเดิม {overwriteCount}</strong> รายการ
              </p>
              <p style={{ fontSize: 14, color: "var(--text3)", marginTop: 8 }}>
                การเขียนทับจะแทนที่ข้อมูลทั้งหมดของรายการเดิม รวมถึงระดับสต็อก และไม่สามารถย้อนกลับได้
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setConfirmOverwrite(false)}>ยกเลิก</button>
              <button className="primary" onClick={doApprove} disabled={saving}>
                {saving ? "กำลังดำเนินการ…" : "ยืนยัน"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Completion — confirms what was written into the system */}
      {completion && (
        <div className="modal-overlay" onClick={() => setCompletion(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500, color: completion.failed > 0 ? "var(--accent)" : "var(--green)" }}>
                {completion.failed > 0 ? "ดำเนินการเสร็จ (มีข้อผิดพลาดบางส่วน)" : "บันทึกเข้าระบบเรียบร้อย ✓"}
              </div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setCompletion(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg3)", borderRadius: "var(--r)" }}>
                  <span style={{ color: "var(--text2)" }}>เพิ่มรายการใหม่</span>
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 500, color: "var(--green)" }}>{completion.added}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg3)", borderRadius: "var(--r)" }}>
                  <span style={{ color: "var(--text2)" }}>เขียนทับข้อมูลเดิม</span>
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 500, color: "var(--accent)" }}>{completion.overwritten}</span>
                </div>
                {completion.failed > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--red2)", borderRadius: "var(--r)" }}>
                    <span style={{ color: "var(--text)" }}>ไม่สำเร็จ</span>
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 500, color: "var(--red)" }}>{completion.failed}</span>
                  </div>
                )}
              </div>
              {completion.errors.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 6 }}>รายละเอียดข้อผิดพลาด:</div>
                  <div style={{ maxHeight: 140, overflowY: "auto", fontSize: 13, color: "var(--text2)" }}>
                    {completion.errors.map((er, i) => (
                      <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid var(--border)" }}>{er}</div>
                    ))}
                  </div>
                </div>
              )}
              <p style={{ fontSize: 14, color: "var(--text3)", marginTop: 12 }}>
                รายการที่บันทึกแล้วจะปรากฏในหน้าสต็อคทันที
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setCompletion(null)}>ปิด</button>
              <button className="primary" onClick={() => router.push("/stock")}>ไปที่หน้าสต็อค</button>
            </div>
          </div>
        </div>
      )}

      {/* Write progress — approval writes rows one at a time, so this tracks it live */}
      {progress && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500, color: "var(--accent)" }}>กำลังบันทึกเข้าระบบ…</div>
            </div>
            <div className="modal-body">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--text2)", marginBottom: 8 }}>
                <span>บันทึกแล้ว</span>
                <span style={{ fontFamily: "var(--mono)" }}>
                  {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
                  {progress.total > 0 && <span style={{ color: "var(--text3)" }}> ({Math.round((progress.done / progress.total) * 100)}%)</span>}
                </span>
              </div>
              <div style={{ height: 10, background: "var(--bg3)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                  background: "var(--accent)", transition: "width 0.15s ease" }} />
              </div>
              <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 10 }}>กรุณาอย่าปิดหน้านี้จนกว่าจะเสร็จ</p>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
