import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useRequireAccess } from "@/lib/auth";
import * as XLSX from "xlsx";
import { buildFabricMatchIndex, fabricMatchKeyForRow, applyFabricUpdates, getSuppliers,
  type Fabric, type Supplier, type FabricUpdatableField } from "@/lib/fabric-store";
import { parseFabricSheet, type FabricSheetRow } from "@/lib/fabric-sheet";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";
import { OwnerTag } from "@/lib/owner-tag";

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
  { field: "owner",        label: "เจ้าของ",        sheetKey: "owner" },
  { field: "supplier",     label: "ซัพพลายเออร์",  sheetKey: "supplier_name" },
];

type MatchMode = "exact" | "find";
type MatchData = { identity: Map<string, Fabric[]>; byId: Map<string, Fabric> };

type Row = FabricSheetRow & {
  _match: "one" | "multi" | "none";
  _matchId?: string;
  _matched?: Fabric;    // the single matched fabric (for "already up to date" checks)
  _matches?: Fabric[];  // all matched items — kept for "multi" so we can show the clash
  _matchCount: number;
};

// Match a parsed row against existing fabrics. Exact mode matches by database id (from
// an export) — fault-free; find mode matches by identity key (type/construction/color/width).
function computeRows(base: FabricSheetRow[], mode: MatchMode, data: MatchData | null): Row[] {
  if (!data) return [];
  return base.map((b) => {
    const matches = mode === "exact"
      ? (b.id && data.byId.has(b.id) ? [data.byId.get(b.id)!] : [])
      : (data.identity.get(fabricMatchKeyForRow(b)) ?? []);
    const _match = matches.length === 0 ? "none" : matches.length === 1 ? "one" : "multi";
    return {
      ...b, _match,
      _matchId: matches.length === 1 ? matches[0].id : undefined,
      _matched: matches.length === 1 ? matches[0] : undefined,
      _matches: matches.length > 1 ? matches : undefined,
      _matchCount: matches.length,
    };
  });
}

export default function FabricStockUpdatePage() {
  const router = useRouter();
  const [baseRows, setBaseRows] = useState<FabricSheetRow[]>([]);
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [matchMode, setMatchMode] = useState<MatchMode>("find");
  const rows = useMemo(() => computeRows(baseRows, matchMode, matchData), [baseRows, matchMode, matchData]);
  const [sheetCols, setSheetCols] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Set<FabricUpdatableField>>(new Set());
  const [overwrite, setOverwrite] = useState(false); // apply even when values already match
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [fileName, setFileName] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set()); // by row index
  const [matchFilter, setMatchFilter] = useState<"all" | "one" | "multi" | "none">("all");
  const [pageSize, setPageSize] = useState(250);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<null | { updated: number; failed: number }>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { authed } = useRequireAccess("fabric", "admin");

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

      // Build the match index over existing fabrics, plus an id→item map for exact mode.
      const identity = await buildFabricMatchIndex();
      const byId = new Map<string, Fabric>();
      identity.forEach((arr) => arr.forEach((f) => byId.set(f.id, f)));
      const data: MatchData = { identity, byId };

      // Default to exact matching when the file carries ids (an export); else find-and-match.
      const hasIds = cols.present.has("id") && parsed.some((b) => b.id);
      const startMode: MatchMode = hasIds ? "exact" : "find";
      setMatchData(data);
      setBaseRows(parsed);
      setMatchMode(startMode);
      setMode(new Set());
      setSelected(new Set());
      const counts = { one: 0, multi: 0, none: 0 } as Record<string, number>;
      computeRows(parsed, startMode, data).forEach((p) => counts[p._match]++);
      showToast(`อ่านไฟล์: ตรงกัน ${counts.one} · ซ้ำ ${counts.multi} · ไม่พบ ${counts.none}`, "success");
    } catch (err: any) {
      showToast("อ่านไฟล์ไม่สำเร็จ: " + (err.message ?? ""), "error");
      setBaseRows([]);
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
      case "owner":        return !sameStr(a.owner, r.owner);
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

  // Visible rows (status filter + search)
  const visible = rows.map((r, i) => ({ r, i })).filter(({ r }) => {
    if (matchFilter !== "all" && r._match !== matchFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return r.fabric_type.toLowerCase().includes(q) || r.construction.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q) ||
      r.color.toLowerCase().includes(q) || r.fabric_code.toLowerCase().includes(q);
  });

  const pg = usePagination(visible, `${search}|${matchFilter}`, pageSize);

  // Only single-match rows that would actually change are selectable
  const selectableOnPage = pg.pageItems.filter(({ r }) => isSelectable(r)).map(({ i }) => i);
  const allSel = selectableOnPage.length > 0 && selectableOnPage.every((i) => selected.has(i));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSel) selectableOnPage.forEach((i) => next.delete(i));
    else selectableOnPage.forEach((i) => next.add(i));
    setSelected(next);
  };
  // Every selectable row across ALL pages (respects the current filter/search).
  const selectableAll = visible.filter(({ r }) => isSelectable(r)).map(({ i }) => i);
  const selectAllMatched = () => setSelected(new Set(selectableAll));
  const toggleRow = (i: number) => {
    const next = new Set(selected);
    next.has(i) ? next.delete(i) : next.add(i);
    setSelected(next);
  };

  const deleteUnmatched = () => {
    setBaseRows((prev) => prev.filter((_, i) => rows[i]?._match === "one"));
    setSelected(new Set());
    showToast("ลบรายการที่ไม่ตรงออกแล้ว", "success");
  };

  const doApply = async () => {
    const fields = Array.from(mode);
    if (fields.length === 0) { showToast("กรุณาเลือกคอลัมน์ที่จะอัปเดต", "error"); return; }
    const chosenIdx = Array.from(selected).filter((i) => rows[i] && rows[i]._match === "one" && rows[i]._matchId && !isNoop(rows[i]));
    const chosen = chosenIdx.map((i) => rows[i]);
    if (chosen.length === 0) { showToast("ไม่มีรายการที่ต้องอัปเดต (ค่าตรงกันอยู่แล้ว)", "error"); return; }

    setSaving(true);
    setProgress({ done: 0, total: chosen.length });
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
        owner: r.owner,
        // Only carry a supplier_id when the sheet name actually matches an existing
        // supplier. No match → undefined so the store LEAVES the item's current
        // supplier untouched (never silently clears it).
        supplier_id: supplierIdFor(r.supplier_name) ?? undefined,
        current_unit_cost: Number(r._matched?.unit_cost ?? 0),
        sheet_has_price: sheetCols.has("unit_cost"),
      }));

      const { updated, errors } = await applyFabricUpdates(updates, fields, (d, t) => setProgress({ done: d, total: t }));
      setConfirm(false);
      setResult({ updated, failed: errors.length });
      // Remove applied rows from the list (by their index in baseRows)
      const applied = new Set(chosenIdx);
      setBaseRows((prev) => prev.filter((_, i) => !applied.has(i)));
      setSelected(new Set());
    } catch (e: any) {
      showToast("เกิดข้อผิดพลาด: " + (e.message ?? ""), "error");
    } finally { setSaving(false); setProgress(null); }
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

      {/* Match mode — exact (by id, from an export) vs find-and-match (by identity) */}
      {rows.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 10 }}>วิธีจับคู่</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => { setMatchMode("exact"); setSelected(new Set()); }} disabled={!sheetCols.has("id")}
              style={{ fontSize: 14, padding: "8px 14px", opacity: sheetCols.has("id") ? 1 : 0.4,
                ...(matchMode === "exact" ? { background: "var(--accent)", color: "#0f0f0f", borderColor: "var(--accent)" } : {}) }}
              title={sheetCols.has("id") ? "" : "ไฟล์นี้ไม่มีคอลัมน์ id (ต้องเป็นไฟล์ที่ส่งออกจากระบบ)"}>
              ตรงกันเป๊ะจาก id{!sheetCols.has("id") && " (ไม่มี id ในไฟล์)"}
            </button>
            <button onClick={() => { setMatchMode("find"); setSelected(new Set()); }}
              style={{ fontSize: 14, padding: "8px 14px",
                ...(matchMode === "find" ? { background: "var(--accent)", color: "#0f0f0f", borderColor: "var(--accent)" } : {}) }}>
              ค้นหาและจับคู่ (ชนิดผ้า/โครงสร้าง/สี/หน้าผ้า)
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--text3)" }}>
            {matchMode === "exact"
              ? "จับคู่ด้วยรหัสระบบ (id) จากไฟล์ที่ส่งออก — อัปเดตตรงรายการเดิมแบบไม่มีพลาด แม้แก้คอลัมน์อื่น"
              : "จับคู่ด้วยคุณสมบัติผ้า — ใช้กับไฟล์ที่ไม่มี id (การแก้ ชนิดผ้า/โครงสร้าง/สี/หน้าผ้า อาจทำให้จับคู่ไม่ได้)"}
          </div>
        </div>
      )}

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
          {/* Status filter — click ซ้ำ / ไม่พบ to isolate the rows that didn't match, for diagnosing. */}
          <div style={{ display: "flex", gap: 4 }}>
            {([
              ["all", "ทั้งหมด", rows.length, "var(--text2)"],
              ["one", "ตรงกัน", counts.one, "var(--green)"],
              ["multi", "ซ้ำ", counts.multi, "var(--accent)"],
              ["none", "ไม่พบ", counts.none, "var(--red)"],
            ] as const).map(([key, label, n, color]) => (
              <button key={key} onClick={() => setMatchFilter(key)}
                style={{ fontSize: 14, padding: "7px 12px", whiteSpace: "nowrap",
                  ...(matchFilter === key ? { background: "var(--accent)", color: "#0f0f0f", borderColor: "var(--accent)" }
                                          : { color }) }}>
                {label} {n}
              </button>
            ))}
          </div>
          {/* Rows per page — bump it up to scroll through many ไม่พบ/ซ้ำ rows while diagnosing. */}
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ width: "auto" }} title="จำนวนแถวต่อหน้า">
            <option value={100}>100 / หน้า</option>
            <option value={250}>250 / หน้า</option>
            <option value={1000}>1000 / หน้า</option>
            <option value={100000}>ทั้งหมด</option>
          </select>
          {selectableAll.length > 0 && (
            <button onClick={selectAllMatched}>เลือกทั้งหมดที่ตรงกัน ({selectableAll.length})</button>
          )}
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())}>ล้างการเลือก</button>
          )}
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
            <table style={{ tableLayout: "fixed", minWidth: 1180 }}>
              <colgroup>
                <col style={{ width: "44px" }} /><col style={{ width: "18%" }} /><col style={{ width: "6%" }} />
                <col style={{ width: "13%" }} /><col style={{ width: "8%" }} /><col style={{ width: "7%" }} />
                <col style={{ width: "7%" }} /><col style={{ width: "6%" }} /><col style={{ width: "7%" }} />
                <col style={{ width: "6%" }} /><col style={{ width: "9%" }} /><col style={{ width: "10%" }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ textAlign: "center", background: "var(--bg2)" }}>
                    <input type="checkbox" checked={allSel} onChange={toggleAll} style={{ width: "auto", cursor: "pointer" }} />
                  </th>
                  <th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ชนิดผ้า</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>เลขที่</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>โครงสร้าง</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สี</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>หน้าผ้า</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สต็อค</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ขั้นต่ำ</th><th className="num" style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>ราคา</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>หน่วย</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>เจ้าของ</th><th style={{ whiteSpace: "nowrap", background: "var(--bg2)" }}>สถานะจับคู่</th>
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
                      <td><OwnerTag owner={r.owner} /></td>
                      <td>
                        {r._match === "one"
                          ? (noop ? <span style={{ fontSize: 14, color: "var(--text3)" }}>ค่าตรงกันแล้ว</span>
                                  : <span style={{ fontSize: 14, color: "var(--green)" }}>✓ ตรงกัน</span>)
                          : r._match === "multi"
                            ? <span className="badge badge-low" style={{ cursor: "help" }}
                                title={"จับคู่ได้หลายรายการ (เจ้าของ/เลขที่ ต่างกันแต่ระบุตัวไม่ได้):\n" +
                                  (r._matches ?? []).map((f, k) => `${k + 1}. ${[f.fabric_type, f.construction, f.color, f.width].filter(Boolean).join(" · ")}` +
                                    `  [เจ้าของ: ${f.owner || "—"} · เลขที่: ${f.fabric_code || "—"}]`).join("\n")}>
                                ซ้ำ {r._matchCount}
                              </span>
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

      {/* Write progress — updates are written one row at a time, so this tracks it live */}
      {progress && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500, color: "var(--accent)" }}>กำลังอัปเดต…</div>
            </div>
            <div className="modal-body">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--text2)", marginBottom: 8 }}>
                <span>อัปเดตแล้ว</span>
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
