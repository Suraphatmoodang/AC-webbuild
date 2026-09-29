// Parser for a supplier spreadsheet, used by the import panel on the suppliers page
// (/suppliers and /fabrics/suppliers — one shared view, see pages/suppliers.tsx).
//
// Columns are resolved BY HEADER NAME, not position, exactly like lib/fabric-sheet.ts.
// The accepted labels deliberately include the ones the FABRIC STOCK sheet already uses
// for its supplier block (ชื่อบริษัทซัพ / ผู้ติดต่อ / เบอร์ติดต่อ / …), so the supplier
// columns of an existing stock sheet can be imported as-is with no re-keying. There is
// no "three columns called หน่วย" problem here, so no second resolution pass is needed.

import type { Supplier } from "./store";

export type SupplierSheetRow = Omit<Supplier, "id" | "created_at" | "updated_at">;

const FIELDS: Record<keyof SupplierSheetRow, string[]> = {
  supplier_name:  ["ชื่อบริษัทซัพ", "ชื่อบริษัทซัพพลายเออร์", "ซัพพลายเออร์", "ชื่อบริษัท", "ชื่อซัพพลายเออร์", "supplier_name"],
  supplier_code:  ["รหัสซัพ", "รหัสซัพพลายเออร์", "รหัส", "supplier_code"],
  contact_person: ["ผู้ติดต่อ", "contact_person"],
  contact_number: ["เบอร์ติดต่อ", "เบอร์โทร", "โทรศัพท์", "contact_number"],
  contact_email:  ["อีเมล", "email", "contact_email"],
  line_id:        ["line id", "line", "ไลน์", "line_id"],
  address:        ["ที่อยู่", "address"],
  city:           ["จังหวัด", "city"],
  country:        ["ประเทศ", "country"],
  postal_code:    ["รหัสไปรษณีย์", "postal_code"],
  lead_time:      ["ระยะเวลาส่ง(วัน)", "ระยะเวลาส่ง", "lead_time"],
  payment_term:   ["เทอมจ่ายเงิน", "เทอมจ่าย", "payment_term"],
  tax_id:         ["เลขผู้เสียภาษี", "เลขประจำตัวผู้เสียภาษี", "tax_id"],
};

const norm = (v: any) => String(v ?? "").trim().replace(/\s+/g, " ");
// Header matching is case-insensitive so "Address" and "address" both land; the VALUES
// are never case-folded, because a supplier's name is matched byte-for-byte elsewhere
// (the stock updater links by name — see pages/fabrics/stock-update.tsx).
const normKey = (v: any) => norm(v).toLowerCase();
const str = (v: any) => (v === undefined || v === null ? "" : String(v).trim());

export type SupplierSheetResult = {
  rows: SupplierSheetRow[];
  /** Fields the sheet actually carries — the preview shows only these columns. */
  present: (keyof SupplierSheetRow)[];
  /** Header texts the parser did not recognise, so a typo'd column is visible not silent. */
  unknownHeaders: string[];
  /** True when there is no ชื่อบริษัทซัพ column at all — nothing can be imported. */
  missingName: boolean;
  /** Rows skipped for having no name (spacer/total rows). */
  skipped: number;
};

// `raw` is a sheet read with header:1 — row 0 is the header row.
export function parseSupplierSheet(raw: any[][]): SupplierSheetResult {
  const headers = (raw[0] ?? []).map(normKey);
  const index = {} as Record<keyof SupplierSheetRow, number>;
  const claimed = new Set<number>();

  for (const [field, labels] of Object.entries(FIELDS) as [keyof SupplierSheetRow, string[]][]) {
    const at = headers.findIndex((h, i) =>
      !claimed.has(i) && h !== "" && labels.some((l) => normKey(l) === h));
    index[field] = at;
    if (at >= 0) claimed.add(at);
  }

  const unknownHeaders = (raw[0] ?? [])
    .map((h, i) => ({ h: norm(h), i }))
    .filter(({ h, i }) => h && !claimed.has(i))
    .map(({ h }) => h);

  const present = (Object.keys(FIELDS) as (keyof SupplierSheetRow)[]).filter((f) => index[f] >= 0);
  const missingName = index.supplier_name < 0;

  let skipped = 0;
  const rows: SupplierSheetRow[] = [];
  if (!missingName) {
    for (const r of raw.slice(1)) {
      const g = (f: keyof SupplierSheetRow) => (index[f] >= 0 ? str(r[index[f]]) : "");
      const name = g("supplier_name");
      // A row with no name is a spacer or a totals line, not a supplier.
      if (!name) { if ((r ?? []).some((c) => str(c))) skipped++; continue; }
      rows.push({
        supplier_name: name,
        supplier_code: g("supplier_code"),
        contact_person: g("contact_person"),
        contact_number: g("contact_number"),
        contact_email: g("contact_email"),
        line_id: g("line_id"),
        address: g("address"),
        city: g("city"),
        country: g("country"),
        postal_code: g("postal_code"),
        lead_time: g("lead_time"),
        payment_term: g("payment_term"),
        tax_id: g("tax_id"),
      });
    }
  }
  return { rows, present, unknownHeaders, missingName, skipped };
}

// How a parsed row relates to what's already in the table.
//   · "new"       — no supplier with this name yet → will be inserted
//   · "existing"  — already there and the sheet adds nothing → skipped
//   · "fillable"  — already there, and the sheet has values for fields that are BLANK
//                   on the saved row → can be topped up without overwriting anything
//   · "duplicate" — the same name appears more than once in the sheet itself
export type RowPlan = "new" | "existing" | "fillable" | "duplicate";
export type PlannedRow = {
  row: SupplierSheetRow;
  plan: RowPlan;
  existingId: string | null;
  /** For "fillable": only the blank fields the sheet can fill. */
  fills: Partial<SupplierSheetRow>;
};

// Name matching mirrors the stock updater's rule EXACTLY (trim + collapse inner
// whitespace, case-SENSITIVE), so a supplier imported here is one the updater can link.
export const supplierKey = (name: string) => String(name ?? "").trim().replace(/\s+/g, " ");

const FILLABLE: (keyof SupplierSheetRow)[] = [
  "supplier_code", "contact_person", "contact_number", "contact_email", "line_id",
  "address", "city", "country", "postal_code", "lead_time", "payment_term", "tax_id",
];

export function planSupplierImport(
  rows: SupplierSheetRow[],
  existing: { id: string; supplier_name: string }[],
): PlannedRow[] {
  const byName = new Map<string, { id: string; supplier_name: string }>();
  for (const e of existing) byName.set(supplierKey(e.supplier_name), e);
  const seen = new Set<string>();
  const existingFull = new Map<string, any>();
  for (const e of existing as any[]) existingFull.set(supplierKey(e.supplier_name), e);

  return rows.map((row): PlannedRow => {
    const k = supplierKey(row.supplier_name);
    if (seen.has(k)) return { row, plan: "duplicate", existingId: null, fills: {} };
    seen.add(k);
    const hit = byName.get(k);
    if (!hit) return { row, plan: "new", existingId: null, fills: {} };
    const saved = existingFull.get(k) ?? {};
    const fills: Partial<SupplierSheetRow> = {};
    for (const f of FILLABLE) {
      const sheetVal = String(row[f] ?? "").trim();
      const savedVal = String(saved[f] ?? "").trim();
      if (sheetVal && !savedVal) (fills as any)[f] = sheetVal;
    }
    return Object.keys(fills).length
      ? { row, plan: "fillable", existingId: hit.id, fills }
      : { row, plan: "existing", existingId: hit.id, fills: {} };
  });
}
