// Excel export of current stock, in the SAME column layouts the importers read
// (lib importer HEADER_MAP / lib/fabric-sheet.ts), so an exported file round-trips
// straight back through /import and /fabrics/import.
//
// Layouts are taken verbatim from the reference sheets the user provided:
//   · Accessories — "สต็อคป้ายไซส์…"  (22 columns; includes ขั้นต่ำ)
//   · Fabrics     — "Fabric Stock…"   (24 columns; NO ขั้นต่ำ, NO เจ้าของ)
//
// COMPLETENESS: every table is paged through in full, ordered by the unique `id`.
// (Ordering by a non-unique column like `type`/`effective_date` across .range()
// pages can drop or duplicate rows once a table exceeds 1000 rows — which is why an
// earlier version could miss items. `id` is unique, so pagination is gap-free.)
// Stock quantity is the authoritative lot total; price is the item's reference
// unit_cost; supplier contact columns are joined from the item's supplier record.

import * as XLSX from "xlsx";
import { supabase } from "./supabase";
import type { Accessory, Supplier } from "./store";
import type { Fabric } from "./fabric-store";

// Page through an entire table, ordered by the unique id so no row is skipped.
async function fetchAll<T = any>(table: string): Promise<T[]> {
  const all: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return all;
}

// Sum remaining stock per item id from a lots table.
async function stockByItem(table: string, fkColumn: string): Promise<Map<string, number>> {
  const lots = await fetchAll<Record<string, any>>(table);
  const m = new Map<string, number>();
  for (const l of lots) {
    const id = l[fkColumn] as string;
    m.set(id, (m.get(id) ?? 0) + Number(l.quantity_remaining));
  }
  return m;
}

// File-name date code matching the reference files ("300769" = 30/07/2569 BE).
function thaiDateCode(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String((d.getFullYear() + 543) % 100).padStart(2, "0");
  return `${dd}${mm}${yy}`;
}

// The eleven supplier columns, in sheet order, blank when the item has no supplier.
function supplierCells(s: Supplier | undefined): (string | number)[] {
  return [
    s?.supplier_name ?? "",
    s?.contact_person ?? "",
    s?.contact_number ?? "",
    s?.contact_email ?? "",
    s?.address ?? "",
    s?.city ?? "",
    s?.country ?? "",
    s?.postal_code ?? "",
    s?.lead_time ?? "",
    s?.payment_term ?? "",
    s?.tax_id ?? "",
  ];
}

function writeSheet(header: (string | number)[], rows: (string | number)[][], filename: string) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  // `compression` DEFLATE-zips the sheet (SheetJS stores it uncompressed by default);
  // `bookSST` writes one shared-string table instead of repeating every cell's text
  // inline (the supplier columns repeat the same address on hundreds of rows). Together
  // they shrink the file by roughly an order of magnitude with identical contents.
  XLSX.writeFile(wb, filename, { compression: true, bookSST: true });
}

const th = (a: string, b: string) => String(a ?? "").localeCompare(String(b ?? ""), "th");

// ── Accessories ──────────────────────────────────────────────────────
// The trailing `id` column carries each item's database id so the updater's "exact"
// mode can match a re-uploaded export back to the exact same rows with zero ambiguity.
// The importer ignores unknown headers, so exported files still round-trip through /import.
const ACC_HEADER: string[] = [
  "ชนิดอุปกรณ์", "ลูกค้า", "รหัสสินค้า", "รายละเอียด", "แถว\r\n(เฉพาะด้าย)", "สี", "ขนาด",
  "สต็อคคงเหลือ", "หน่วย", "ราคาซื้อ", "ขั้นต่ำ",
  "ชื่อบริษัทซัพ", "ผู้ติดต่อ", "เบอร์ติดต่อ", "อีเมล", "ที่อยู่", "จังหวัด", "ประเทศ",
  "รหัสไปรษณีย์", "ระยะเวลาส่ง(วัน)", "เทอมจ่ายเงิน", "เลขผู้เสียภาษี", "id",
];

export async function exportAccessoriesXlsx(): Promise<number> {
  const [items, suppliers, stockMap] = await Promise.all([
    fetchAll<Accessory>("accessories"),
    fetchAll<Supplier>("suppliers"),
    stockByItem("accessory_lots", "accessory_id"),
  ]);
  const supMap = new Map(suppliers.map((s) => [s.id, s]));
  items.sort((a, b) => th(a.type, b.type) || th(a.description, b.description) || th(a.color, b.color) || th(a.size, b.size));
  const rows = items.map((a): (string | number)[] => [
    a.type, a.customer, a.acc_code, a.description,
    a.row ?? "", a.color, a.size,
    stockMap.get(a.id) ?? 0, a.unit, Number(a.unit_cost) || 0, Number(a.min_quantity) || 0,
    ...supplierCells(a.supplier_id ? supMap.get(a.supplier_id) : undefined),
    a.id,
  ]);
  writeSheet(ACC_HEADER, rows, `สต็อคอุปกรณ์ ${thaiDateCode()}.xlsx`);
  return rows.length;
}

// ── Fabrics ──────────────────────────────────────────────────────────
// Trailing `id` column — see ACC_HEADER: lets the fabric updater's "exact" mode match
// a re-uploaded export back to the exact rows. Importer ignores it, so round-trip is safe.
const FAB_HEADER: string[] = [
  "ชนิดผ้า", "เส้นใย (Composition)", "โครงสร้าง (Construction)", "สี", "หน้าผ้า",
  "น้ำหนัก", "หน่วย", "แถว", "เลขที่", "สต็อคคงเหลือ", "หน่วย", "ราคาต่อหน่วย", "หน่วย",
  "ชื่อบริษัทซัพ", "ผู้ติดต่อ", "เบอร์ติดต่อ", "อีเมล", "ที่อยู่", "จังหวัด", "ประเทศ",
  "รหัสไปรษณีย์", "ระยะเวลาส่ง(วัน)", "เทอมจ่ายเงิน", "เลขผู้เสียภาษี", "id",
];

export async function exportFabricsXlsx(): Promise<number> {
  const [items, suppliers, stockMap] = await Promise.all([
    fetchAll<Fabric>("fabrics"),
    fetchAll<Supplier>("fabric_suppliers"),
    stockByItem("fabric_lots", "fabric_id"),
  ]);
  const supMap = new Map(suppliers.map((s) => [s.id, s]));
  items.sort((a, b) => th(a.fabric_type, b.fabric_type) || th(a.color, b.color));
  const rows = items.map((f): (string | number)[] => [
    f.fabric_type, f.composition, f.construction, f.color, f.width,
    Number(f.weight) || 0, f.weight_unit, f.row_label, f.fabric_code,
    stockMap.get(f.id) ?? 0, f.unit, Number(f.unit_cost) || 0, f.cost_unit,
    ...supplierCells(f.supplier_id ? supMap.get(f.supplier_id) : undefined),
    f.id,
  ]);
  writeSheet(FAB_HEADER, rows, `สต็อคผ้า ${thaiDateCode()}.xlsx`);
  return rows.length;
}
