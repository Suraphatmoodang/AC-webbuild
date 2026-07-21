// Parser for the fabric stock spreadsheet, shared by the importer (/fabrics/import)
// and the bulk updater (/fabrics/stock-update) so both read a file identically.
//
// Columns are resolved BY HEADER NAME, not position, so reordering columns is safe.
// The wrinkle this file exists to solve: the source sheet has THREE columns all
// literally headed "หน่วย" —
//
//   … น้ำหนัก | หน่วย | … | สต็อคคงเหลือ | หน่วย | ราคาต่อหน่วย | หน่วย | …
//               ^gm2                        ^กก/หลา              ^price basis
//
// A naive name lookup would map all three to the first match. So the unit columns are
// resolved in a second pass by NEAREST PRECEDING ANCHOR: each "หน่วย" column belongs to
// whichever of น้ำหนัก / สต็อคคงเหลือ / ราคาต่อหน่วย sits closest to its left. That reads
// the sheet the way a person does, and — unlike a "first match after the anchor" rule —
// it still does the right thing on a sheet that carries only one of the three.

export type FabricSheetRow = {
  fabric_type: string;
  composition: string;
  construction: string;
  color: string;
  width: string;
  weight: number;
  weight_unit: string;
  row_label: string;
  fabric_code: string;
  quantity: number;
  min_quantity: number;
  unit: string;
  unit_cost: number;
  cost_unit: string;
  supplier_name: string;
  contact_person: string;
  contact_number: string;
  contact_email: string;
  address: string;
  city: string;
  country: string;
  postal_code: string;
  lead_time: string;
  payment_term: string;
  tax_id: string;
};

type FieldSpec = {
  labels: string[];   // accepted header texts; first match (whitespace-normalized) wins
  unitOf?: string;    // this is a "หน่วย" column belonging to the named field (2nd pass)
  required?: boolean; // missing → the importer rejects the file
};

// Declared in sheet order, which is also the order they're resolved in.
const FIELDS: Record<string, FieldSpec> = {
  fabric_type:    { labels: ["ชนิดผ้า"], required: true },
  composition:    { labels: ["เส้นใย (Composition)", "เส้นใย", "Composition"] },
  construction:   { labels: ["โครงสร้าง (Construction)", "โครงสร้าง", "Construction"] },
  color:          { labels: ["สี"] },
  width:          { labels: ["หน้าผ้า"] },
  weight:         { labels: ["น้ำหนัก"] },
  weight_unit:    { labels: ["หน่วย"], unitOf: "weight" },
  row_label:      { labels: ["แถว"] },
  fabric_code:    { labels: ["เลขที่"] },
  quantity:       { labels: ["สต็อคคงเหลือ", "สต็อค"] },
  unit:           { labels: ["หน่วย"], unitOf: "quantity", required: true },
  unit_cost:      { labels: ["ราคาต่อหน่วย", "ราคาซื้อ"] },
  cost_unit:      { labels: ["หน่วย"], unitOf: "unit_cost" },
  min_quantity:   { labels: ["ขั้นต่ำ"] },
  supplier_name:  { labels: ["ชื่อบริษัทซัพ", "ชื่อบริษัทซัพพลายเออร์", "ซัพพลายเออร์"] },
  contact_person: { labels: ["ผู้ติดต่อ"] },
  contact_number: { labels: ["เบอร์ติดต่อ"] },
  contact_email:  { labels: ["อีเมล"] },
  address:        { labels: ["ที่อยู่"] },
  city:           { labels: ["จังหวัด"] },
  country:        { labels: ["ประเทศ"] },
  postal_code:    { labels: ["รหัสไปรษณีย์"] },
  lead_time:      { labels: ["ระยะเวลาส่ง(วัน)", "ระยะเวลาส่ง"] },
  payment_term:   { labels: ["เทอมจ่ายเงิน"] },
  tax_id:         { labels: ["เลขผู้เสียภาษี"] },
};

export const normHeader = (v: any) => String(v ?? "").trim().replace(/\s+/g, " ");
// Excel hands back numbers for cells like หน้าผ้า 73.5 or เลขที่ 147; these fields are
// text in the DB (they also hold "32T", "35 1/2T"), so stringify without reformatting.
export const str = (v: any) => (v === undefined || v === null ? "" : String(v).trim());
export const num = (v: any) => { const n = parseFloat(String(v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };

export type ResolvedColumns = {
  index: Record<string, number>;  // field → column index, -1 when absent
  present: Set<string>;           // fields the sheet actually carries
  missing: string[];              // required fields not found (labels, for the error toast)
};

// Map every field to a column index off the header row.
export function resolveFabricColumns(headerRow: any[]): ResolvedColumns {
  const headers = headerRow.map(normHeader);
  const index: Record<string, number> = {};
  const present = new Set<string>();
  const claimed = new Set<number>();   // a column feeds exactly one field

  const entries = Object.entries(FIELDS);

  // Pass 1 — unambiguous fields, matched by name.
  for (const [field, spec] of entries) {
    if (spec.unitOf) { index[field] = -1; continue; }
    const found = headers.findIndex((h, i) =>
      !claimed.has(i) && spec.labels.some((l) => normHeader(l) === h));
    index[field] = found;
    if (found >= 0) { claimed.add(found); present.add(field); }
  }

  // Pass 2 — every leftover "หน่วย" column goes to the anchor nearest on its left.
  // A unit column sitting before all three anchors has nothing to belong to and is
  // ignored rather than guessed at.
  const unitFields = entries.filter(([, s]) => s.unitOf);
  const unitCols = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => !claimed.has(i) && unitFields.some(([, s]) => s.labels.some((l) => normHeader(l) === h)));

  for (const { i } of unitCols) {
    let best: string | null = null;
    let bestAnchor = -1;
    for (const [field, spec] of unitFields) {
      if (index[field] >= 0) continue;                 // already has its column
      const anchor = index[spec.unitOf!];
      if (anchor >= 0 && anchor < i && anchor > bestAnchor) { best = field; bestAnchor = anchor; }
    }
    if (best) { index[best] = i; claimed.add(i); present.add(best); }
  }

  const missing = entries
    .filter(([field, spec]) => spec.required && index[field] < 0)
    .map(([, spec]) => spec.labels[0]);

  return { index, present, missing };
}

// Turn a raw sheet (row 0 = headers) into typed rows. Rows without a ชนิดผ้า AND
// without a สี are treated as spacers/notes and dropped.
export function parseFabricSheet(raw: any[][]): { rows: FabricSheetRow[]; cols: ResolvedColumns } {
  const cols = resolveFabricColumns(raw[0] ?? []);
  const g = (r: any[], field: string) => {
    const i = cols.index[field];
    return i >= 0 ? r[i] : undefined;
  };

  const rows = raw.slice(1)
    .filter((r) => str(g(r, "fabric_type")) || str(g(r, "color")))
    .map((r): FabricSheetRow => ({
      fabric_type: str(g(r, "fabric_type")),
      composition: str(g(r, "composition")),
      construction: str(g(r, "construction")),
      color: str(g(r, "color")),
      width: str(g(r, "width")),
      weight: num(g(r, "weight")),
      weight_unit: str(g(r, "weight_unit")),
      row_label: str(g(r, "row_label")),
      fabric_code: str(g(r, "fabric_code")),
      quantity: num(g(r, "quantity")),
      min_quantity: num(g(r, "min_quantity")),
      unit: str(g(r, "unit")),
      unit_cost: num(g(r, "unit_cost")),
      cost_unit: str(g(r, "cost_unit")),
      supplier_name: str(g(r, "supplier_name")),
      contact_person: str(g(r, "contact_person")),
      contact_number: str(g(r, "contact_number")),
      contact_email: str(g(r, "contact_email")),
      address: str(g(r, "address")),
      city: str(g(r, "city")),
      country: str(g(r, "country")),
      postal_code: str(g(r, "postal_code")),
      lead_time: str(g(r, "lead_time")),
      payment_term: str(g(r, "payment_term")),
      tax_id: str(g(r, "tax_id")),
    }));

  return { rows, cols };
}
