// Change log for a bulk-updater run (/stock-update and /fabrics/stock-update).
//
// Why this exists: applyStockUpdates / applyFabricUpdates write master fields straight to
// the item row and record NOTHING. Stock movements have `*_transactions`, imports have
// `*_imports`, but a bulk field edit left no trace at all — so "who changed this ชนิดผ้า,
// from what, when" was unanswerable. This captures the before/after at apply time and hands
// it back as a spreadsheet the operator can keep.
//
// It is a RECEIPT, not an audit trail: nothing is stored server-side, so the record only
// exists if the file is saved. A real audit table was the alternative and can still be added
// later (one row per change, surfaced on the สรุป/บันทึก page) — this was chosen because it
// needs no migration.
import * as XLSX from "xlsx";

// One field on one item. `before` / `after` are already display strings, so the caller
// decides how a number or a supplier id should read.
export type ChangeRecord = {
  ref: string;      // locator in the operator's own terms (แถว|เลขที่, or a code)
  name: string;     // what the item is, for someone reading the log later
  field: string;    // the Thai column label, as shown in the tick-boxes
  before: string;
  after: string;
  id: string;       // database id — the only unambiguous handle
  ok: boolean;      // false when the write for this item failed
};

export type UpdateLogMeta = {
  section: "อุปกรณ์" | "ผ้า";
  fileName: string;
  matchMode: string;       // "ตรงกันเป๊ะจาก id" | "ค้นหาและจับคู่"
  columns: string[];       // the ticked column labels
  rowsApplied: number;
  rowsFailed: number;
  by: string;              // role, the only identity the client has
};

const BLANK = "(ว่าง)";
export const logValue = (v: any): string => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? BLANK : s;
};

export function buildUpdateLog(meta: UpdateLogMeta, records: ChangeRecord[]): XLSX.WorkBook {
  const stamp = new Date().toLocaleString("th-TH", { hour12: false });
  const summary: any[][] = [
    ["บันทึกการอัปเดตจาก Excel", ""],
    ["เวลา", stamp],
    ["หมวด", meta.section],
    ["ไฟล์ต้นทาง", meta.fileName || "(ไม่ทราบชื่อไฟล์)"],
    ["โหมดจับคู่", meta.matchMode],
    ["คอลัมน์ที่อัปเดต", meta.columns.join(", ")],
    ["ผู้ใช้ (บทบาท)", meta.by || "-"],
    ["", ""],
    ["รายการที่อัปเดตสำเร็จ", meta.rowsApplied],
    ["รายการที่ไม่สำเร็จ", meta.rowsFailed],
    ["จำนวนช่องที่เปลี่ยน", records.filter((r) => r.ok).length],
  ];
  // Count per column so a run can be checked at a glance against what was expected.
  const perCol = new Map<string, number>();
  for (const r of records) if (r.ok) perCol.set(r.field, (perCol.get(r.field) ?? 0) + 1);
  perCol.forEach((n, f) => summary.push([`— ${f}`, n]));

  const detail: any[][] = [["สถานะ", "ตัวระบุ", "รายการ", "คอลัมน์", "ค่าเดิม", "ค่าใหม่", "id"]];
  // Failures first: they're the rows someone has to act on.
  for (const r of [...records].sort((a, b) => Number(a.ok) - Number(b.ok)))
    detail.push([r.ok ? "สำเร็จ" : "ไม่สำเร็จ", r.ref, r.name, r.field, r.before, r.after, r.id]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "สรุป");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), "ก่อน-หลัง");
  return wb;
}

// Filename carries the section and a sortable timestamp, so a folder of these stays readable.
export function updateLogFileName(section: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `update-log-${section}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
}

export function downloadUpdateLog(meta: UpdateLogMeta, records: ChangeRecord[]): void {
  XLSX.writeFile(buildUpdateLog(meta, records),
    updateLogFileName(meta.section === "ผ้า" ? "fabric" : "accessory"));
}
