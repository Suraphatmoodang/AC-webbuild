import { LEAD_STATUSES, LEAD_CHANNELS, emptyLeadInput, type LeadInput } from "./lead-store";

// Parser for the factory's lead sheet (Customer_Lead_Tracking_Garment_Factory.xlsx, "Leads" tab).
// Mirrors lib/costing-sheet.ts: columns are matched BY HEADER NAME, not position, so the shop can
// reorder or insert columns in Excel without breaking the import.
//
// The sheet's dates are Thai-style DD/MM/YYYY text (not real Excel date cells), so dateStr()
// handles that form explicitly — a naive `new Date(...)` would read 10/08/2026 as 8 October.

const FIELDS: Record<string, string[]> = {
  lead_code:         ["Lead ID", "LeadID", "รหัส"],
  received_date:     ["วันที่รับเรื่อง", "วันที่ติดต่อ", "วันที่"],
  customer_name:     ["ชื่อลูกค้า", "ชื่อ", "FB name", "Name"],
  company:           ["บริษัท/องค์กร", "บริษัท", "องค์กร", "Company"],
  channel:           ["ช่องทาง", "Channel"],
  contact_link:      ["Contact / Link", "Contact/Link", "Contact", "Link"],
  line_id:           ["ID: LINE", "Line ID", "LINE ID", "LINE"],
  phone:             ["โทรศัพท์", "เบอร์โทร", "Phone"],
  email:             ["อีเมล", "Email"],
  job_title:         ["ตำแหน่ง", "Job title"],
  product_type:      ["ประเภทสินค้า", "สินค้า", "Product"],
  qty:               ["จำนวน (ตัว)", "จำนวน", "Qty"],
  details:           ["รายละเอียดเบื้องต้น", "รายละเอียด", "Details"],
  status:            ["สถานะ", "Status"],
  owner:             ["ผู้รับผิดชอบ", "ผู้ดูแล", "Owner"],
  last_contact_date: ["วันที่ติดต่อล่าสุด"],
  follow_up_date:    ["วันที่ติดตามครั้งถัดไป", "ติดตามครั้งถัดไป"],
  priority:          ["Priority", "ความสำคัญ"],
  appointment_date:  ["วันที่นัดหมาย"],
  merchandiser:      ["Merchandiser", "เมอร์"],
  target_price:      ["งบ/ราคาเป้าหมาย", "งบ", "ราคาเป้าหมาย"],
  lost_reason:       ["เหตุผลไม่ได้งาน"],
  subcontract:       ["งานซับคอนแทรค", "งานซับ", "ซับคอนแทรค", "Subcontract"],
  note:              ["หมายเหตุ", "Note"],
};

// Shown as chips on the import page so the user can compare against their file.
export const EXPECTED_HEADERS = [
  "Lead ID", "วันที่รับเรื่อง", "ชื่อลูกค้า", "บริษัท/องค์กร", "ช่องทาง", "Contact / Link",
  "ID: LINE", "โทรศัพท์", "ประเภทสินค้า", "จำนวน (ตัว)", "รายละเอียดเบื้องต้น", "สถานะ",
  "ผู้รับผิดชอบ", "วันที่ติดต่อล่าสุด", "วันที่ติดตามครั้งถัดไป", "Priority", "วันที่นัดหมาย",
  "Merchandiser", "งบ/ราคาเป้าหมาย", "เหตุผลไม่ได้งาน", "หมายเหตุ",
];

const normHeader = (v: any) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const str = (v: any) => (v === undefined || v === null ? "" : String(v).trim());

// "10/08/2026" (DD/MM/YYYY) · a real Date cell · or an ISO string → "YYYY-MM-DD" | null.
//
// Date cells need care: Excel stores them as serial numbers, and SheetJS converts serial 46244
// ("10/08/2026") to 2026-08-09T16:59:56Z — four seconds short of midnight. Reading LOCAL parts
// off that in UTC+7 gives the 9th, silently shifting every imported date back a day. So a Date
// is snapped to the NEAREST whole UTC day before its parts are read, which is correct both for
// that rounding error and for dates built at local midnight.
export function dateStr(v: any): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const snapped = new Date(Math.round(v.getTime() / 86400000) * 86400000);
    return snapped.toISOString().slice(0, 10);
  }
  const t = str(v);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);      // the sheet's own format
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (ymd) return ymd[0];
  const parsed = new Date(t);
  if (isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

// The sheet stores the Thai status label; we store a key. Unknown/blank → the first stage.
export function statusKeyFromThai(label: string): string {
  const t = str(label);
  return LEAD_STATUSES.find((s) => s.th === t)?.key ?? LEAD_STATUSES[0].key;
}

// Keep the sheet's channel spelling when we recognise it, otherwise fall back to อื่นๆ so the
// filter dropdown never gains a stray one-off value.
function channelOf(v: any): string {
  const t = str(v);
  if (!t) return "";
  const hit = LEAD_CHANNELS.find((c) => c.toLowerCase() === t.toLowerCase());
  return hit ?? (LEAD_CHANNELS.includes("อื่นๆ") ? "อื่นๆ" : t);
}

// งานซับคอนแทรค is a yes/no column the sheet may not have at all: anything ticked/affirmative
// counts, everything else (including a blank column) is false.
const TRUEISH = ["ใช่", "y", "yes", "true", "1", "x", "✓", "งานซับ", "subcontract"];
function boolOf(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return TRUEISH.includes(str(v).toLowerCase());
}

export type LeadResolvedColumns = { index: Record<string, number>; missing: string[] };

export function resolveLeadColumns(headerRow: any[]): LeadResolvedColumns {
  const headers = headerRow.map(normHeader);
  const index: Record<string, number> = {};
  const claimed = new Set<number>();
  for (const [field, labels] of Object.entries(FIELDS)) {
    const found = headers.findIndex((h, i) => !claimed.has(i) && labels.some((l) => normHeader(l) === h));
    index[field] = found;
    if (found >= 0) claimed.add(found);
  }
  // Require at least one identifying column, otherwise this isn't the lead sheet.
  const missing: string[] = [];
  if (index.customer_name < 0 && index.lead_code < 0 && index.company < 0) {
    missing.push("ชื่อลูกค้า / Lead ID / บริษัท");
  }
  return { index, missing };
}

export function parseLeadSheet(raw: any[][]): { rows: LeadInput[]; cols: LeadResolvedColumns } {
  const cols = resolveLeadColumns(raw[0] ?? []);
  if (cols.missing.length) return { rows: [], cols };
  const g = (r: any[], field: string) => { const i = cols.index[field]; return i >= 0 ? r[i] : undefined; };

  const rows = raw.slice(1).map((r): LeadInput | null => {
    const name = str(g(r, "customer_name"));
    const company = str(g(r, "company"));
    const code = str(g(r, "lead_code"));
    if (!name && !company && !code) return null;      // blank/spacer row

    const received = dateStr(g(r, "received_date"));
    const noteText = str(g(r, "note"));
    return emptyLeadInput({
      lead_code: code,
      received_date: received,
      customer_name: name,
      company,
      channel: channelOf(g(r, "channel")),
      contact_link: str(g(r, "contact_link")),
      line_id: str(g(r, "line_id")),
      phone: str(g(r, "phone")),
      email: str(g(r, "email")),
      job_title: str(g(r, "job_title")),
      product_type: str(g(r, "product_type")),
      qty: str(g(r, "qty")),
      details: str(g(r, "details")),
      status: statusKeyFromThai(str(g(r, "status"))),
      owner: str(g(r, "owner")),
      last_contact_date: dateStr(g(r, "last_contact_date")),
      follow_up_date: dateStr(g(r, "follow_up_date")),
      priority: str(g(r, "priority")),
      appointment_date: dateStr(g(r, "appointment_date")),
      merchandiser: str(g(r, "merchandiser")),
      target_price: str(g(r, "target_price")),
      lost_reason: str(g(r, "lost_reason")),
      subcontract: boolOf(g(r, "subcontract")),
      note: noteText,
      // Seed the conversation log from หมายเหตุ so imported rows aren't blank on the board.
      log: noteText ? [{ ts: `${received ?? new Date().toISOString().slice(0, 10)}T09:00`, text: noteText }] : [],
    });
  }).filter((x): x is LeadInput => x !== null);

  return { rows, cols };
}
