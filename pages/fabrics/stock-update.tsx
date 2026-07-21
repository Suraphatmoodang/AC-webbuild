import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useRequireRole } from "@/lib/auth";
import * as XLSX from "xlsx";
import { buildFabricMatchIndex, fabricMatchKeyForRow, applyFabricUpdates, getSuppliers,
  type Fabric, type Supplier, type FabricUpdatableField } from "@/lib/fabric-store";
import { parseFabricSheet, type FabricSheetRow } from "@/lib/fabric-sheet";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";

// Columns the user can choose to update (the "mode"). `sheetKey` is the parsed-row
// field that must be present in the file for the column to be selectable.
const UPDATE_COLUMNS: { field: FabricUpdatableField; label: string; sheetKey: string }[] = [
  { field: "quantity",     label: "สต็อคคงเหลือ", sheetKey: "quantity" },
  { field: "min_quantity", label: "ขั้นต่ำ",       sheetKey: "min_quantity" },
  { field: "unit_cost",    label: "ราคาต่อหน่วย",  sheetKey: "unit_cost" },
  { field: "unit",         label: "หน่วย",         sheetKey: "unit" },
  { field: "cost_unit",    label: "หน่วยราคา",     sheetKey: "cost_unit" },
  { field: "composition",  label: "เส้นใย",        sheetKey: "composition" },
  { field: "construction", label: "โครงสร้าง",     sheetKey: "construction" },
  { field: "weight",       label: "น้ำหนัก",       sheetKey: "weight" },
  { field: "width",        label: "หน้าผ้า",       sheetKey: "width" },
  { field: "row_label",    label: "แถว",           sheetKey: "row_label" },
  { field: "supplier",     label: "ซัพพลายเออร์",  sheetKey: "supplier_name" },
];

type Row = FabricSheetRow & {
  _match: "one" | "multi" | "none";
  _matchId?: string;
  _matched?: Fabric;   // the single matched fabric (for "already up to date" checks)
  _matchCount: number;
};

export default function FabricStockUpdatePage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [sheetCols, setSheetCols] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Set<FabricUpdatableField>>(new Set());
  const [overwrite, setOverwrite] = useState(false); // apply even when values already match
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [fileName, setFileName] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set()); // by row index
  const [hideUnmatched, setHideUnmatched] = useState(false);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<null | { updated: number; failed: number }>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { authed } = useRequireRole("fabric");

  useEffect(() => { if (authed) { getSuppliers().then(setSuppliers); } }, [authed]);

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

      const { rows: parsed, cols } = parseFabricSheet(raw);
      setSheetCols(cols.present);

      // Build the match index over existing fabrics and tag each row with its result.
      const index = await buildFabricMatchIndex();
      const tagged: Row[] = parsed.map((base) => {
        const matches = index.get(fabricMatchKeyForRow(base)) ?? [];
        const _match = matches.length === 0 ? "none" : matches.length === 1 ? "one" : "multi";
        return { ...base, _match, _matchId: matches.length === 1 ? matches[0].id : undefined,
          _matched: matches.length === 1 ? matches[0] : undefined, _matchCount: matches.length };
      });
      setRows(tagged);
      setMode(new Set());
      setSelected(new Set());
      const counts = { one: 0, multi: 0, none: 0 } as Record<string, number>;
      tagged.forEach((p) => counts[p._match]++);
      showToast(`อ่านไฟล์: ตรงกัน ${counts.one} · ซ้ำ ${counts.multi} · ไม่พบ ${counts.none}`, "success");
    } catch (err: any) {
      showToast("อ่านไฟล์ไม่สำเร็จ: " + (err.message ?? ""), "error");
      setRows([]);
    }
  };

  const supplierIdFor = (name: string): string | null => {
    const norm = (s: string) => s.trim().replace(/\s+/g, " ");
    return suppliers.find((s) => norm(s.supplier_name) === norm(name))?.id ?? null;
  };

  // Would writing field `f` from this row actually change the matched fabric?
  const sameStr = (a: string, b: string) => (a ?? "").trim() === (b ?? "").trim();
  const fieldChanged = (r: Row, f: FabricUpdatableField): boolean => {
    const a = r._matched;
    if (!a) return true; // no baseline → treat as a change
    switch (f) {
      case "quantity":     return Number(a.quantity) !== r.quantity;
      case "min_quantity": return Number(a.min_quantity) !== r.min_quantity;
      case "unit_cost":    return Number(a.unit_cost) !== r.unit_cost;
      case "weight":       return Number(a.weight) !== r.weight;
      case "unit":         return !sameStr(a.unit, r.unit);
      case "cost_unit":    return !sameStr(a.cost_unit, r.cost_unit);
      case "composition":  return !sameStr(a.composition, r.composition);
      case "construction": return !sameStr(a.construction, r.construction);
      case "width":        return !sameStr(a.width, r.width);
      case "row_label":    return !sameStr(a.row_label, r.row_label);
      case "supplier": {
        const sid = supplierIdFor(r.supplier_name);
        if (sid == null) return false; // no matching supplier → current value left untouched
        return sid !== (a.supplier_id ?? null);
      }
    }
  };

  const toggleMode = (f: FabricUpdatableField) => {
    const next = new Set(mode);
    next.has(f) ? next.delete(f) : next.add(f);
    setMode(next);
    // Drop selections that became no-ops under the new mode
    const arr = Array.from(next);
    const noop = (r: Row) => !overwrite && arr.length > 0 && !arr.some((ff) => fieldChanged(r, ff));
    setSelected((prev) => new Set(Array.from(prev).filter((i) => rows[i] && rows[i]._match === "one" && !noop(rows[i]))));
  };

  // A row is a no-op when EVERY selected field already matches the current value.
  // Overwrite mode disables this so matched rows apply even when unchanged.
  const modeArr = Array.from(mode);
  const isNoop = (r: Row) => !overwrite && modeArr.length > 0 && !modeArr.some((f) => fieldChanged(r, f));
  // Selectable = single match AND (no mode chosen yet, or at least one selected field differs)
  const isSelectable = (r: Row) => r._match === "one" && !isNoop(r);

  // Visible rows (search + optional hide-unmatched)
  const visible = rows.map((r, i) => ({ r, i })).filter(({ r }) => {
    if (hideUnmatched && r._match !== "one") return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return r.fabric_type.toLowerCase().includes(q) || r.construction.toLowerCase().includes(q) ||
      r.color.toLowerCase().includes(q) || r.fabric_code.toLowerCase().includes(q);
  });

  const pg = usePagination(visible, `${search}|${hideUnmatched}`, 250);

  // Only single-match rows that would actually change are selectable
  const selectableOnPage = pg.pageItems.filter(({ r }) => isSelectable(r)).map(({ i }) => i);
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

  const doApply = async () => {
    const fields = Array.from(mode);
    if (fields.length === 0) { showToast("กรุณาเลือกคอลัมน์ที่จะอัปเดต", "error"); return; }
    const chosen = Array.from(selected).map((i) => rows[i]).filter((r) => r && r._match === "one" && r._matchId && !isNoop(r));
    if (chosen.length === 0) { showToast("ไม่มีรายการที่ต้องอัปเดต (ค่าตรงกันอยู่แล้ว)", "error"); return; }

    setSaving(true);
    try {
      const updates = chosen.map((r) => ({
        fabric_id: r._matchId!,
        quantity: r.quantity,
        min_quantity: r.min_quantity,
        unit_cost: r.unit_cost,
        unit: r.unit,
        cost_unit: r.cost_unit,
        composition: r.composition,
        construction: r.construction,
        weight: r.weight,
        width: r.width,
        row_label: r.row_label,
        // Only carry a supplier_id when the sheet name actually matches an existing
        // supplier. No match → undefined so the store LEAVES the item's current
        // supplier untouched (never silently clears it).
        supplier_id: supplierIdFor(r.supplier_name) ?? undefined,
        current_unit_cost: Number(r._matched?.unit_cost ?? 0),
        sheet_has_price: sheetCols.has("unit_cost"),
      }));

      const { updated, errors } = await applyFabricUpdates(updates, fields);
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
  // Matched rows whose selected fields already equal the current values (skipped)
  const noopCount = mode.size > 0 ? rows.filter((r) => r._match === "one" && isNoop(r)).length : 0;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>อัปเดตข้อมูลผ้าจาก Excel</h2>
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
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 14, color: "var(--text2)", cursor: "pointer" }}>
            <input type="checkbox" checked={overwrite} onChange={(e) => {
              const on = e.target.checked;
              setOverwrite(on);
              // Turning overwrite off can make some selected rows no-ops again → drop them
              if (!on) {
                const arr = Array.from(mode);
                const noop = (r: Row) => arr.length > 0 && !arr.some((ff) => fieldChanged(r, ff));
                setSelected((prev) => new Set(Array.from(prev).filter((i) => rows[i] && rows[i]._match === "one" && !noop(rows[i]))));
              }
            }} style={{ width: "auto" }} />
            เขียนทับทุกรายการที่จับคู่ได้ (รวมค่าที่ตรงกันอยู่แล้ว)
          </label>
          {stockInMode && (
            <div style={{ marginTop: 10, fontSize: 13, color: "var(--accent)" }}>
              ⚠ การอัปเดตสต็อคจะลบล็อตเดิมทั้งหมดและสร้างล็อตใหม่ (ราคาจากไฟล์ หรือราคาปัจจุบันหากไม่มี)
            </div>
          )}
          {noopCount > 0 && (
            <div style={{ marginTop: 10, fontSize: 13, color: "var(--text3)" }}>
              ข้าม {noopCount} รายการที่ค่าตรงกับข้อมูลปัจจุบันอยู่แล้ว (เปิด "เขียนทับ" เพื่ออัปเดตด้วย)
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
            <table style={{ tableLayout: "fixed", minWidth: 1100 }}>
              <colgroup>
                <col style={{ width: "44px" }} /><col style={{ width: "20%" }} /><col style={{ width: "6%" }} />
                <col style={{ width: "14%" }} /><col style={{ width: "9%" }} /><col style={{ width: "7%" }} />
                <col style={{ width: "8%" }} /><col style={{ width: "7%" }} /><col style={{ width: "8%" }} />
                <col style={{ width: "6%" }} /><col style={{ width: "11%" }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ textAlign: "center", background: "var(--bg2)" }}>
                    <input type="checkbox" checked={allSel} onChange={toggleAll} style={{ width: "auto", cursor: "pointer" }} />
                  </th>
                  <th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ชนิดผ้า</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>เลขที่</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>โครงสร้าง</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สี</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>หน้าผ้า</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สต็อค</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ขั้นต่ำ</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ราคา</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>หน่วย</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สถานะจับคู่</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map(({ r, i }) => {
                  const sel = selected.has(i);
                  const noop = r._match === "one" && isNoop(r);
                  const canSelect = isSelectable(r);
                  return (
                    <tr key={i} style={{ opacity: canSelect ? 1 : 0.55, background: sel ? "var(--bg4)" : undefined }}>
                      <td style={{ textAlign: "center" }}>
                        {canSelect && <input type="checkbox" checked={sel} onChange={() => toggleRow(i)} style={{ width: "auto", cursor: "pointer" }} />}
                      </td>
                      <td style={{ fontWeight: 500, wordBreak: "break-word" }}>{r.fabric_type}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text2)" }}>{r.fabric_code || "—"}</td>
                      <td style={{ wordBreak: "break-word", fontSize: 14, color: "var(--text2)" }}>{r.construction || "—"}</td>
                      <td style={{ fontSize: 14, color: "var(--text2)" }}>{r.color || "—"}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text2)" }}>{r.width || "—"}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.quantity.toLocaleString()}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.min_quantity.toLocaleString()}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.unit_cost ? `฿${r.unit_cost.toFixed(2)}` : "—"}</td>
                      <td style={{ fontSize: 14, color: "var(--text2)" }}>{r.unit || "—"}</td>
                      <td>
                        {r._match === "one"
                          ? (noop ? <span style={{ fontSize: 14, color: "var(--text3)" }}>ค่าตรงกันแล้ว</span>
                                  : <span style={{ fontSize: 14, color: "var(--green)" }}>✓ ตรงกัน</span>)
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
        จับคู่ด้วย ชนิดผ้า+เลขที่+สี+หน้าผ้า (หากมีเลขที่) หรือ ชนิดผ้า+โครงสร้าง+สี+หน้าผ้า (หากไม่มีเลขที่)
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
              <button className="primary" onClick={() => router.push("/fabrics")}>ไปที่หน้าสต็อคผ้า</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
