import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import * as XLSX from "xlsx";
import { buildAccessoryMatchIndex, matchKeyForRow, applyStockUpdates, getSuppliers,
  type Accessory, type Supplier, type UpdatableField } from "@/lib/store";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";

// Header-name → field mapping (same sheet layout as the importer)
const HEADER_MAP: Record<string, string[]> = {
  type: ["ชนิดอุปกรณ์"], acc_code: ["รหัสสินค้า"], description: ["รายละเอียด"],
  color: ["สี"], size: ["ขนาด"], quantity: ["สต็อคคงเหลือ", "สต็อค"],
  unit: ["หน่วย"], unit_cost: ["ราคาซื้อ"], min_quantity: ["ขั้นต่ำ"],
  supplier_name: ["ชื่อบริษัทซัพ", "ชื่อบริษัทซัพพลายเออร์", "ซัพพลายเออร์"],
};
const normHeader = (v: any) => String(v ?? "").trim().replace(/\s+/g, " ");
const str = (v: any) => (v === undefined || v === null ? "" : String(v).trim());
const num = (v: any) => { const n = parseFloat(String(v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };

// Columns the user can choose to update (the "mode")
const UPDATE_COLUMNS: { field: UpdatableField; label: string; sheetKey: string }[] = [
  { field: "quantity",     label: "สต็อคคงเหลือ", sheetKey: "quantity" },
  { field: "min_quantity", label: "ขั้นต่ำ",       sheetKey: "min_quantity" },
  { field: "unit_cost",    label: "ราคาซื้อ",      sheetKey: "unit_cost" },
  { field: "description",  label: "รายละเอียด",    sheetKey: "description" },
  { field: "supplier",     label: "ซัพพลายเออร์",  sheetKey: "supplier_name" },
];

type Row = {
  type: string; acc_code: string; description: string; color: string; size: string;
  quantity: number; unit_cost: number; min_quantity: number; supplier_name: string;
  _match: "one" | "multi" | "none";
  _matchId?: string;
  _matchCount: number;
};

export default function StockUpdatePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [sheetCols, setSheetCols] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Set<UpdatableField>>(new Set());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [fileName, setFileName] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set()); // by row index
  const [hideUnmatched, setHideUnmatched] = useState(false);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<null | { updated: number; failed: number }>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("manage_auth") !== "1") { router.replace("/login"); return; }
    setAuthed(true);
    getSuppliers().then(setSuppliers);
  }, [router]);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const raw: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
      if (raw.length < 2) { showToast("ไฟล์ว่างเปล่า", "error"); return; }

      // Resolve columns by header
      const headers = raw[0].map(normHeader);
      const colIdx: Record<string, number> = {};
      const present = new Set<string>();
      for (const [field, labels] of Object.entries(HEADER_MAP)) {
        const idx = headers.findIndex((h) => labels.some((l) => normHeader(l) === h));
        colIdx[field] = idx;
        if (idx >= 0) present.add(field);
      }
      setSheetCols(present);

      const g = (r: any[], f: string) => { const i = colIdx[f]; return i >= 0 ? r[i] : undefined; };

      // Build match index over existing accessories
      const index = await buildAccessoryMatchIndex();

      const parsed: Row[] = raw.slice(1)
        .filter((r) => str(g(r, "type")) || str(g(r, "description")))
        .map((r) => {
          const base = {
            type: str(g(r, "type")), acc_code: str(g(r, "acc_code")), description: str(g(r, "description")),
            color: str(g(r, "color")), size: str(g(r, "size")),
            quantity: num(g(r, "quantity")), unit_cost: num(g(r, "unit_cost")),
            min_quantity: num(g(r, "min_quantity")), supplier_name: str(g(r, "supplier_name")),
          };
          const key = matchKeyForRow(base);
          const matches = index.get(key) ?? [];
          const _match = matches.length === 0 ? "none" : matches.length === 1 ? "one" : "multi";
          return { ...base, _match, _matchId: matches.length === 1 ? matches[0].id : undefined, _matchCount: matches.length };
        });
      setRows(parsed);
      // default mode: whatever updatable columns exist in the sheet, minus nothing preselected
      setMode(new Set());
      setSelected(new Set());
      const counts = { one: 0, multi: 0, none: 0 } as Record<string, number>;
      parsed.forEach((p) => counts[p._match]++);
      showToast(`อ่านไฟล์: ตรงกัน ${counts.one} · ซ้ำ ${counts.multi} · ไม่พบ ${counts.none}`, "success");
    } catch (err: any) {
      showToast("อ่านไฟล์ไม่สำเร็จ: " + (err.message ?? ""), "error");
      setRows([]);
    }
  };

  const toggleMode = (f: UpdatableField) => {
    const next = new Set(mode);
    next.has(f) ? next.delete(f) : next.add(f);
    setMode(next);
  };

  // Visible rows (search + optional hide-unmatched)
  const visible = rows.map((r, i) => ({ r, i })).filter(({ r }) => {
    if (hideUnmatched && r._match !== "one") return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return r.type.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) ||
      r.acc_code.toLowerCase().includes(q);
  });

  const pg = usePagination(visible, `${search}|${hideUnmatched}`, 250);

  // Only single-match rows are selectable
  const selectableOnPage = pg.pageItems.filter(({ r }) => r._match === "one").map(({ i }) => i);
  const allSel = selectableOnPage.length > 0 && selectableOnPage.every((i) => selected.has(i));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSel) selectableOnPage.forEach((i) => next.delete(i));
    else selectableOnPage.forEach((i) => next.add(i));
    setSelected(next);
  };
  const toggleRow = (i: number) => {
    const next = new Set(selected);
    next.has(i) ? next.delete(i) : next.add(i);
    setSelected(next);
  };

  const deleteUnmatched = () => {
    setRows((prev) => prev.filter((r) => r._match === "one"));
    setSelected(new Set());
    showToast("ลบรายการที่ไม่ตรงออกแล้ว", "success");
  };

  const supplierIdFor = (name: string): string | null => {
    const norm = (s: string) => s.trim().replace(/\s+/g, " ");
    return suppliers.find((s) => norm(s.supplier_name) === norm(name))?.id ?? null;
  };

  const doApply = async () => {
    const fields = Array.from(mode);
    if (fields.length === 0) { showToast("กรุณาเลือกคอลัมน์ที่จะอัปเดต", "error"); return; }
    const chosen = Array.from(selected).map((i) => rows[i]).filter((r) => r && r._match === "one" && r._matchId);
    if (chosen.length === 0) { showToast("ไม่มีรายการที่เลือก", "error"); return; }

    setSaving(true);
    try {
      // need current unit cost of each matched accessory for price fallback
      const index = await buildAccessoryMatchIndex();
      const byId = new Map<string, Accessory>();
      Array.from(index.values()).forEach((arr) => arr.forEach((a) => byId.set(a.id, a)));

      const updates = chosen.map((r) => ({
        accessory_id: r._matchId!,
        quantity: r.quantity,
        min_quantity: r.min_quantity,
        unit_cost: r.unit_cost,
        description: r.description,
        // Only carry a supplier_id when the sheet name actually matches an
        // existing supplier. No match → undefined so the store LEAVES the
        // item's current supplier untouched (never silently clears it).
        supplier_id: supplierIdFor(r.supplier_name) ?? undefined,
        current_unit_cost: Number(byId.get(r._matchId!)?.unit_cost ?? 0),
        sheet_has_price: sheetCols.has("unit_cost"),
      }));

      const { updated, errors } = await applyStockUpdates(updates, fields);
      setConfirm(false);
      setResult({ updated, failed: errors.length });
      // Remove applied rows from the list
      const appliedIds = new Set(chosen.map((r) => r._matchId));
      setRows((prev) => prev.filter((r) => !appliedIds.has(r._matchId)));
      setSelected(new Set());
    } catch (e: any) {
      showToast("เกิดข้อผิดพลาด: " + (e.message ?? ""), "error");
    } finally { setSaving(false); }
  };

  if (!authed) return null;

  const counts = { one: 0, multi: 0, none: 0 } as Record<string, number>;
  rows.forEach((r) => counts[r._match]++);
  const stockInMode = mode.has("quantity");

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>อัปเดตข้อมูลจาก Excel</h2>
        <p style={{ color: "var(--text2)", fontSize: 15 }}>
          จับคู่กับรายการที่มีอยู่แล้วอัปเดตเฉพาะคอลัมน์ที่เลือก — ไม่สร้างรายการใหม่
        </p>
      </div>

      {/* Upload */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
            <span style={{ display: "inline-block", padding: "10px 20px", background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: "var(--r)", cursor: "pointer", fontSize: 16 }}>
              เลือกไฟล์ Excel…
            </span>
          </label>
          {fileName && <span style={{ color: "var(--text2)", fontSize: 15 }}>{fileName}</span>}
        </div>
        {rows.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 14, color: "var(--text2)" }}>
            ตรงกัน <strong style={{ color: "var(--green)" }}>{counts.one}</strong> ·
            ซ้ำหลายรายการ <strong style={{ color: "var(--accent)" }}>{counts.multi}</strong> ·
            ไม่พบ <strong style={{ color: "var(--red)" }}>{counts.none}</strong>
          </div>
        )}
      </div>

      {/* Column-picker mode */}
      {rows.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 10 }}>เลือกคอลัมน์ที่จะอัปเดต (โหมด)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {UPDATE_COLUMNS.map((c) => {
              const inSheet = sheetCols.has(c.sheetKey);
              const on = mode.has(c.field);
              return (
                <button key={c.field} disabled={!inSheet} onClick={() => toggleMode(c.field)}
                  style={{ fontSize: 14, padding: "8px 14px", opacity: inSheet ? 1 : 0.4,
                    ...(on ? { background: "var(--accent)", color: "#0f0f0f", borderColor: "var(--accent)" } : {}) }}
                  title={inSheet ? "" : "ไม่มีคอลัมน์นี้ในไฟล์"}>
                  {c.label}{!inSheet && " (ไม่มีในไฟล์)"}
                </button>
              );
            })}
          </div>
          {stockInMode && (
            <div style={{ marginTop: 10, fontSize: 13, color: "var(--accent)" }}>
              ⚠ การอัปเดตสต็อคจะลบล็อตเดิมทั้งหมดและสร้างล็อตใหม่ (ราคาจากไฟล์ หรือราคาปัจจุบันหากไม่มี)
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      {rows.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <SearchInput value={search} onChange={setSearch} placeholder="ค้นหา…" style={{ flex: "1 1 200px" }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--text2)", cursor: "pointer" }}>
            <input type="checkbox" checked={hideUnmatched} onChange={(e) => setHideUnmatched(e.target.checked)} style={{ width: "auto" }} />
            ซ่อนที่ไม่ตรง
          </label>
          {(counts.multi > 0 || counts.none > 0) && (
            <button onClick={deleteUnmatched}>ลบรายการที่ไม่ตรงออก ({counts.multi + counts.none})</button>
          )}
          {selected.size > 0 && mode.size > 0 && (
            <button className="primary" onClick={() => setConfirm(true)}>
              อัปเดต {selected.size} รายการ
            </button>
          )}
          <span style={{ alignSelf: "center", fontSize: 14, color: "var(--text3)" }}>เลือก {selected.size}</span>
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ height: "58vh", overflowY: "auto", overflowX: "auto" }}>
            <table style={{ tableLayout: "fixed", minWidth: 1000 }}>
              <colgroup>
                <col style={{ width: "44px" }} /><col style={{ width: "13%" }} /><col style={{ width: "9%" }} />
                <col style={{ width: "20%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} />
                <col style={{ width: "9%" }} /><col style={{ width: "14%" }} /><col style={{ width: "10%" }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ textAlign: "center", background: "var(--bg2)" }}>
                    <input type="checkbox" checked={allSel} onChange={toggleAll} style={{ width: "auto", cursor: "pointer" }} />
                  </th>
                  <th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ประเภท</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>รหัส</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>รายละเอียด</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สี</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สต็อค</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ขั้นต่ำ</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ราคา</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สถานะจับคู่</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map(({ r, i }) => {
                  const sel = selected.has(i);
                  const canSelect = r._match === "one";
                  return (
                    <tr key={i} style={{ opacity: canSelect ? 1 : 0.55, background: sel ? "var(--bg4)" : undefined }}>
                      <td style={{ textAlign: "center" }}>
                        {canSelect && <input type="checkbox" checked={sel} onChange={() => toggleRow(i)} style={{ width: "auto", cursor: "pointer" }} />}
                      </td>
                      <td style={{ fontWeight: 500, wordBreak: "break-word" }}>{r.type}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text2)" }}>{r.acc_code || "—"}</td>
                      <td style={{ wordBreak: "break-word" }}>{r.description || "—"}</td>
                      <td style={{ fontSize: 14, color: "var(--text2)" }}>{r.color || "—"}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.quantity.toLocaleString()}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.min_quantity.toLocaleString()}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.unit_cost ? `฿${r.unit_cost.toFixed(2)}` : "—"}</td>
                      <td>
                        {r._match === "one" ? <span style={{ fontSize: 14, color: "var(--green)" }}>✓ ตรงกัน</span>
                          : r._match === "multi" ? <span className="badge badge-low">ซ้ำ {r._matchCount}</span>
                          : <span className="badge badge-out">ไม่พบ</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationBar {...pg} />
        </div>
      )}

      <p style={{ marginTop: 12, fontSize: 14, color: "var(--text3)" }}>
        เลือกได้เฉพาะรายการที่ "ตรงกัน" · รายการ "ซ้ำ" หรือ "ไม่พบ" ต้องแก้ในหน้าจัดการ ·
        จับคู่ด้วย ประเภท+รหัส+รายละเอียด+สี+ขนาด (หากมีรหัส) หรือ ประเภท+รายละเอียด+สี+ขนาด (หากไม่มีรหัส)
      </p>

      {/* Confirmation */}
      {confirm && (
        <div className="modal-overlay" onClick={() => setConfirm(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500, color: "var(--accent)" }}>ยืนยันการอัปเดต</div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: "var(--text2)" }}>
                จะอัปเดต <strong style={{ color: "var(--text)" }}>{selected.size} รายการ</strong> ในคอลัมน์:
                {" "}<strong style={{ color: "var(--accent)" }}>{Array.from(mode).map((f) => UPDATE_COLUMNS.find((c) => c.field === f)?.label).join(", ")}</strong>
              </p>
              {stockInMode && (
                <p style={{ fontSize: 14, color: "var(--red)", marginTop: 10, padding: "8px 12px", background: "var(--red2)", borderRadius: "var(--r)" }}>
                  ⚠ การอัปเดตสต็อคจะ<strong>ลบล็อตเดิมทั้งหมด</strong>ของรายการที่เลือก และสร้างล็อตใหม่ — ไม่สามารถย้อนกลับได้
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setConfirm(false)}>ยกเลิก</button>
              <button className="primary" onClick={doApply} disabled={saving}>
                {saving ? "กำลังอัปเดต…" : "ยืนยันการอัปเดต"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="modal-overlay" onClick={() => setResult(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500, color: result.failed > 0 ? "var(--accent)" : "var(--green)" }}>
                {result.failed > 0 ? "อัปเดตเสร็จ (มีข้อผิดพลาดบางส่วน)" : "อัปเดตเรียบร้อย ✓"}
              </div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setResult(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg3)", borderRadius: "var(--r)", marginBottom: 6 }}>
                <span style={{ color: "var(--text2)" }}>อัปเดตสำเร็จ</span>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 500, color: "var(--green)" }}>{result.updated}</span>
              </div>
              {result.failed > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--red2)", borderRadius: "var(--r)" }}>
                  <span style={{ color: "var(--text)" }}>ไม่สำเร็จ</span>
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 500, color: "var(--red)" }}>{result.failed}</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setResult(null)}>ปิด</button>
              <button className="primary" onClick={() => router.push("/")}>ไปที่หน้าสต็อค</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
