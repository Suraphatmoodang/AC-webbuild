import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getPendingImports, approveImports, rejectImports, getDuplicateMap, getSuppliers,
  type ImportRow, type Accessory, type Supplier } from "@/lib/store";
import { usePagination, PaginationBar, PAGE_SIZE } from "@/lib/pagination";

export default function ImportReviewPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [dupMap, setDupMap] = useState<Map<string, Accessory[]>>(new Map());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [compareRow, setCompareRow] = useState<ImportRow | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("manage_auth") !== "1") router.replace("/login");
    else setAuthed(true);
  }, [router]);

  const load = () => {
    setLoading(true);
    Promise.all([getPendingImports(), getDuplicateMap(), getSuppliers()])
      .then(([imports, dmap, sups]) => {
        setRows(imports); setDupMap(dmap); setSuppliers(sups);
        setSelected(new Set());
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
  const isDup = (r: ImportRow) => matchesFor(r).length > 0;
  const isValid = (r: ImportRow) => r.type.trim() !== "" && r.unit.trim() !== "";
  const supName = (id: string | null) => suppliers.find((s) => s.id === id)?.supplier_name ?? "—";

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.type.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) ||
      r.acc_code.toLowerCase().includes(q) || r.supplier_name.toLowerCase().includes(q);
  });

  // Pagination via shared hook
  const pg = usePagination(filtered, search);
  const pageRows = pg.pageItems;

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  // Select-all scoped to the current page's valid rows
  const pageSelectableIds = pageRows.filter(isValid).map((r) => r.id);
  const allPageSelected = pageSelectableIds.length > 0 && pageSelectableIds.every((id) => selected.has(id));
  const togglePageAll = () => {
    const next = new Set(selected);
    if (allPageSelected) pageSelectableIds.forEach((id) => next.delete(id));
    else pageSelectableIds.forEach((id) => next.add(id));
    setSelected(next);
  };

  const handleApprove = async () => {
    const toApprove = rows.filter((r) => selected.has(r.id) && isValid(r));
    if (toApprove.length === 0) return;
    setSaving(true);
    try {
      const { approved, errors } = await approveImports(toApprove);
      if (errors.length > 0) showToast(`อนุมัติ ${approved} รายการ — มีข้อผิดพลาด ${errors.length} รายการ`, "error");
      else showToast(`อนุมัติ ${approved} รายการเข้าสู่ระบบแล้ว ✓`, "success");
      load();
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
  const selectedCount = selected.size;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="ค้นหา…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 220px" }} />
        <button onClick={() => router.push("/import")}>+ นำเข้าไฟล์ใหม่</button>
        {selectedCount > 0 && (
          <>
            <button className="primary" onClick={handleApprove} disabled={saving}>
              {saving ? "กำลังดำเนินการ…" : `อนุมัติ ${selectedCount} รายการ`}
            </button>
            <button className="danger" onClick={handleReject} disabled={saving}>ปฏิเสธ {selectedCount}</button>
          </>
        )}
        <span style={{ alignSelf: "center", fontSize: 15, color: "var(--text3)" }}>
          รอตรวจสอบ {filtered.length} รายการ
        </span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text3)" }}>กำลังโหลด…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text3)" }}>ไม่มีรายการรอตรวจสอบ</div>
        ) : (
          <div style={{ height: "62vh", overflowY: "auto", overflowX: "auto" }}>
            <table style={{ tableLayout: "fixed", minWidth: 1150 }}>
              <colgroup>
                <col style={{ width: "44px" }} /><col style={{ width: "13%" }} /><col style={{ width: "8%" }} />
                <col style={{ width: "16%" }} /><col style={{ width: "10%" }} /><col style={{ width: "6%" }} />
                <col style={{ width: "7%" }} /><col style={{ width: "16%" }} /><col style={{ width: "9%" }} />
                <col style={{ width: "90px" }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ textAlign: "center", background: "var(--bg2)" }}>
                    <input type="checkbox" checked={allPageSelected} onChange={togglePageAll} style={{ width: "auto", cursor: "pointer" }} />
                  </th>
                  <th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ประเภท</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>รหัส</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>รายละเอียด</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สี/ขนาด</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>หน่วย</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ราคา</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ซัพพลายเออร์</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สถานะ</th><th style={{ background: "var(--bg2)" }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const valid = isValid(r);
                  const dup = isDup(r);
                  const checked = selected.has(r.id);
                  return (
                    <tr key={r.id}
                      style={{ cursor: valid ? "pointer" : "default", opacity: valid ? 1 : 0.5,
                        background: checked ? "var(--bg4)" : undefined }}
                      onClick={() => valid && toggle(r.id)}>
                      <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={checked} disabled={!valid}
                          onChange={() => toggle(r.id)} style={{ width: "auto", cursor: valid ? "pointer" : "not-allowed" }} />
                      </td>
                      <td style={{ fontWeight: 500, wordBreak: "break-word" }}>{r.type || <span style={{ color: "var(--red)" }}>ไม่มีประเภท</span>}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text2)" }}>{r.acc_code || "—"}</td>
                      <td style={{ wordBreak: "break-word" }}>{r.description || "—"}</td>
                      <td style={{ fontSize: 14, color: "var(--text2)" }}>{[r.color, r.size].filter(Boolean).join(" / ") || "—"}</td>
                      <td style={{ color: r.unit ? "var(--text2)" : "var(--red)" }}>{r.unit || "ไม่มีหน่วย"}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.unit_cost ? `฿${r.unit_cost.toFixed(2)}` : "—"}</td>
                      <td style={{ fontSize: 14, color: "var(--text2)", wordBreak: "break-word" }}>{r.supplier_name || "—"}</td>
                      <td>
                        {!valid ? <span className="badge badge-out">ข้อมูลไม่ครบ</span>
                          : dup ? <span className="badge badge-low">อาจซ้ำ</span>
                          : <span style={{ fontSize: 14, color: "var(--green)" }}>✓ พร้อม</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {dup && (
                          <button className="ghost" style={{ padding: "4px 8px", fontSize: 14, whiteSpace: "nowrap" }}
                            onClick={() => setCompareRow(r)}>เทียบ</button>
                        )}
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
        เลือกได้ทีละหน้า (สูงสุด {PAGE_SIZE} รายการต่อหน้า) · กด "เทียบ" เพื่อเปรียบเทียบกับรายการที่มีอยู่ ·
        ซัพพลายเออร์ที่ตรงกับรายชื่อจะถูกเชื่อมโยงให้ · ที่ไม่ตรงจะเว้นว่างไว้เพื่อกำหนดภายหลัง
      </p>

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
          ["ซัพพลายเออร์", (a) => supName(a.supplier_id), compareRow.supplier_name || "—"],
        ];
        return (
          <div className="modal-overlay" onClick={() => setCompareRow(null)}>
            <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div style={{ fontWeight: 500 }}>เปรียบเทียบรายการซ้ำ · {matches.length} รายการที่ตรงกัน</div>
                <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setCompareRow(null)}>✕</button>
              </div>
              <div className="modal-body">
                {matches.map((m, idx) => (
                  <div key={m.id} style={{ marginBottom: idx < matches.length - 1 ? 20 : 0 }}>
                    {matches.length > 1 && (
                      <div style={{ fontSize: 14, color: "var(--text3)", marginBottom: 6 }}>รายการที่มีอยู่ #{idx + 1}</div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: "1px", background: "var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
                      <div style={{ background: "var(--bg3)", padding: "8px 10px", fontSize: 13, color: "var(--text3)" }}></div>
                      <div style={{ background: "var(--bg3)", padding: "8px 10px", fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>นำเข้า (ใหม่)</div>
                      <div style={{ background: "var(--bg3)", padding: "8px 10px", fontSize: 13, fontWeight: 500, color: "var(--text2)" }}>มีอยู่แล้ว</div>
                      {fields.map(([label, getExisting, importVal]) => {
                        const existingVal = getExisting(m);
                        const differs = (existingVal || "—") !== (importVal || "—");
                        return (
                          <>
                            <div style={{ background: "var(--bg2)", padding: "7px 10px", fontSize: 13, color: "var(--text3)" }}>{label}</div>
                            <div style={{ background: "var(--bg2)", padding: "7px 10px", fontSize: 14, color: differs ? "var(--accent)" : "var(--text)" }}>{importVal || "—"}</div>
                            <div style={{ background: "var(--bg2)", padding: "7px 10px", fontSize: 14, color: differs ? "var(--text2)" : "var(--text)" }}>{existingVal || "—"}</div>
                          </>
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

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
