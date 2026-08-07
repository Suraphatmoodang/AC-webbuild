// Parser for the "add product" order spreadsheet, used by the order importer
// (/costing/import). Columns are resolved BY HEADER NAME, not position, so the sheet
// can be reordered freely (same approach as lib/fabric-sheet.ts).
//
// The template you provided doubles as its own dropdown-source: below the header row
// each column lists its allowed values (Top ท่อนบน / Bottom … , เสื้อโปโล / Sweather … ).
// Those are NOT orders, so a row only counts as an order when it carries real order
// data — a customer, a Style/PO, or an order quantity (see parseCostingSheet's filter).
//
// One data row = one order. The color/size cells (สี · S · M · L · XL) become a single
// size-breakdown entry on that order; multi-colour orders (one colour per row) are not
// merged here — that's fine for a first import and can be grouped later.

import { DEFAULT_SIZE_LABELS, type CostingInput, type SizeRow } from "./costing-store";

export type CostingSheetRow = {
  release_no: string;
  release_date: string | null;
  customer: string;
  pn_no: string;
  po_no: string;
  style_no: string;
  description: string;
  brand: string;
  season: string;
  product_category: string;
  product_type: string;
  gender: string;
  product_group: string;
  fabric_type: string;
  length_type: string;
  neck: string;
  collar: string;
  fit: string;
  opening: string;
  has_hood: string;
  has_pocket: string;
  order_qty: number;
  color_count: number;
  size_count: number;
  shipment: string;
  size_labels: string[];
  size_breakdown: SizeRow[];
  embroidery_count: number;
  print_count: number;
  sublimation: number;
  iron_count: number;
};

// field → accepted header labels (first normalized match wins).
const FIELDS: Record<string, string[]> = {
  release_no:       ["เลขที่ปล่อยใบผลิต"],
  release_date:     ["วันที่ปล่อยผลิต"],
  customer:         ["ลูกค้า"],
  pn_no:            ["PN no.", "PN no", "PN"],
  po_no:            ["PO no.", "PO no", "PO"],
  style_no:         ["Style no.", "Style no", "Style"],
  description:      ["รายละเอียด"],
  brand:            ["ยี่ห้อ"],
  season:           ["Season"],
  product_category: ["ประเภทสินค้า"],
  product_type:     ["ชนิดสินค้า"],
  gender:           ["เพศ"],
  product_group:    ["กลุ่มสินค้า"],
  fabric_type:      ["ประเภทผ้า"],
  length_type:      ["ความยาว"],
  neck:             ["คอ"],
  collar:           ["ปก"],
  fit:              ["Fit"],
  opening:          ["วิธีเปิด"],
  has_hood:         ["มีหมวก"],
  has_pocket:       ["มีกระเป๋า"],
  order_qty:        ["จำนวนสั่ง"],
  color_count:      ["จำนวนสี"],
  size_count:       ["จำนวนไซส์"],
  shipment:         ["Shipment"],
  size_color:       ["สี"],
  size_s:           ["S"],
  size_m:           ["M"],
  size_l:           ["L"],
  size_xl:          ["XL"],
  embroidery_count: ["จำนวนปัก"],
  print_count:      ["จำนวนพิมพ์"],
  sublimation:      ["Sublimation"],
  iron_count:       ["จำนวนรีด"],
};

// Header labels shown in the importer's "expected format" hint, in sheet order.
export const EXPECTED_HEADERS = [
  "เลขที่ปล่อยใบผลิต", "วันที่ปล่อยผลิต", "ลูกค้า", "PN no.", "PO no.", "Style no.", "รายละเอียด",
  "ยี่ห้อ", "Season", "ประเภทสินค้า", "ชนิดสินค้า", "เพศ", "กลุ่มสินค้า", "ประเภทผ้า", "ความยาว",
  "คอ", "ปก", "Fit", "วิธีเปิด", "มีหมวก", "มีกระเป๋า", "จำนวนสั่ง", "จำนวนสี", "จำนวนไซส์",
  "Shipment", "สี", "S", "M", "L", "XL", "รวม", "จำนวนปัก", "จำนวนพิมพ์", "Sublimation", "จำนวนรีด",
];

const normHeader = (v: any) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const str = (v: any) => (v === undefined || v === null ? "" : String(v).trim());
const num = (v: any) => { const n = parseFloat(String(v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };

// The template's second row annotates each column ("key in" / "drop down" / "sum")
// and its dropdown-source rows below hold single option values — none are orders. A
// cell holding one of these tokens is metadata, not real order data.
const ANNOTATIONS = new Set(["key in", "drop down", "sum"]);
const realStr = (v: any) => { const t = str(v); return ANNOTATIONS.has(t.toLowerCase()) ? "" : t; };

// Excel date cells come back as JS Date objects when the sheet is read with
// { cellDates: true }; otherwise as text. Normalize to "YYYY-MM-DD" or null.
function dateStr(v: any): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const t = new Date(String(v));
  if (!isNaN(t.getTime())) {
    const y = t.getFullYear(), m = String(t.getMonth() + 1).padStart(2, "0"), d = String(t.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

export type CostingResolvedColumns = { index: Record<string, number>; missing: string[] };

export function resolveCostingColumns(headerRow: any[]): CostingResolvedColumns {
  const headers = headerRow.map(normHeader);
  const index: Record<string, number> = {};
  const claimed = new Set<number>();
  for (const [field, labels] of Object.entries(FIELDS)) {
    const found = headers.findIndex((h, i) => !claimed.has(i) && labels.some((l) => normHeader(l) === h));
    index[field] = found;
    if (found >= 0) claimed.add(found);
  }
  // Require at least the columns that identify an order — otherwise it isn't this sheet.
  const missing: string[] = [];
  if (index.customer < 0 && index.style_no < 0 && index.po_no < 0 && index.order_qty < 0) {
    missing.push("ลูกค้า / Style no. / PO no. / จำนวนสั่ง");
  }
  return { index, missing };
}

export function parseCostingSheet(raw: any[][]): { rows: CostingSheetRow[]; cols: CostingResolvedColumns } {
  const cols = resolveCostingColumns(raw[0] ?? []);
  const g = (r: any[], field: string) => { const i = cols.index[field]; return i >= 0 ? r[i] : undefined; };

  const rows = raw.slice(1)
    // Real order rows carry identifying data; the template's annotation/dropdown rows don't.
    .filter((r) => realStr(g(r, "customer")) || realStr(g(r, "style_no")) || realStr(g(r, "po_no")) || num(g(r, "order_qty")) > 0)
    .map((r): CostingSheetRow => {
      const color = str(g(r, "size_color"));
      const s = num(g(r, "size_s")), m = num(g(r, "size_m")), l = num(g(r, "size_l")), xl = num(g(r, "size_xl"));
      // The sheet's size columns are S/M/L/XL; each order can add more later in the editor.
      const size_breakdown: SizeRow[] = (color || s || m || l || xl)
        ? [{ color, qty: { S: s, M: m, L: l, XL: xl } }] : [];
      return {
        release_no: str(g(r, "release_no")),
        release_date: dateStr(g(r, "release_date")),
        customer: str(g(r, "customer")),
        pn_no: str(g(r, "pn_no")),
        po_no: str(g(r, "po_no")),
        style_no: str(g(r, "style_no")),
        description: str(g(r, "description")),
        brand: str(g(r, "brand")),
        season: str(g(r, "season")),
        product_category: str(g(r, "product_category")),
        product_type: str(g(r, "product_type")),
        gender: str(g(r, "gender")),
        product_group: str(g(r, "product_group")),
        fabric_type: str(g(r, "fabric_type")),
        length_type: str(g(r, "length_type")),
        neck: str(g(r, "neck")),
        collar: str(g(r, "collar")),
        fit: str(g(r, "fit")),
        opening: str(g(r, "opening")),
        has_hood: str(g(r, "has_hood")),
        has_pocket: str(g(r, "has_pocket")),
        order_qty: num(g(r, "order_qty")),
        color_count: num(g(r, "color_count")),
        size_count: num(g(r, "size_count")),
        shipment: str(g(r, "shipment")),
        size_labels: [...DEFAULT_SIZE_LABELS],
        size_breakdown,
        embroidery_count: num(g(r, "embroidery_count")),
        print_count: num(g(r, "print_count")),
        sublimation: num(g(r, "sublimation")),
        iron_count: num(g(r, "iron_count")),
      };
    });

  return { rows, cols };
}

// Turn a parsed sheet row into a full order for insertion: imported orders start at
// status "quote" with NO costing entered (costing is optional and added later).
export function sheetRowToCostingInput(r: CostingSheetRow, created_by: string): CostingInput {
  return {
    status: "quote",
    due_date: null,
    code: "",
    tags: "",
    product_id: null,   // imported orders aren't linked to a catalog product
    ...r,
    fabric_lines: [],
    extras: [],
    sew_labor: 0,
    cut_labor: 0,
    qc_labor: 0,
    pack_labor: 0,
    output_day: 0,
    waste_pct: 3,
    overhead_baht: 8000,
    overhead_pc: 0,
    profit_pct: 10,
    cutting_loss_pct: 5,
    actual_entries: [],
    note: "",
    created_by,
  };
}
