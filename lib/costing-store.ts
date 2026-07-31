import { supabase } from "./supabase";
import { getAccessories, getLotMap } from "./store";
import { getFabrics, getFabricLotMap } from "./fabric-store";

// ── Product costing (ต้นทุนสินค้า) ─────────────────────────────────────
// A THIRD, standalone section next to อุปกรณ์ / ผ้า. Unlike those two it is NOT a
// lot-based inventory — it's a per-style COSTING / QUOTATION sheet. Each row captures
// the full product spec from the "add product" Excel (order info + garment attributes
// + size breakdown) PLUS the cost inputs (fabric, trims, labor, overhead, margin),
// and the selling price is DERIVED live from those inputs (computeCosting), never
// stored — same "derive, don't store" philosophy as stock/value on the other sides.
//
// Everything lives in ONE table `product_costings`; the variable-length parts
// (size breakdown, fabric lines, trim/extra lines) are JSONB columns.
//
// Backing table — run this in Supabase BEFORE deploying (there is no sql/ folder;
// migrations are applied directly, see CLAUDE.md):
//
//   create extension if not exists "pgcrypto";
//   create table if not exists product_costings (
//     id uuid primary key default gen_random_uuid(),
//     -- order tracking
//     status text not null default 'quote',   -- quote|confirmed|production|shipped|done|cancelled
//     due_date date,                           -- กำหนดส่ง (target ship/delivery)
//     -- codes / tags (framework: assignable now, retroactive bulk-assign tool is future work)
//     code text not null default '',           -- an internal order/product code
//     tags text not null default '',           -- freeform tags (comma-separated) for grouping
//     product_id uuid,                         -- soft link to products.id (garment spec copied in)
//     -- order / identity (Excel header)
//     release_no text not null default '',
//     release_date date,
//     customer text not null default '',
//     pn_no text not null default '',
//     po_no text not null default '',
//     style_no text not null default '',
//     description text not null default '',
//     brand text not null default '',
//     season text not null default '',
//     -- garment attributes (dropdowns)
//     product_category text not null default '',
//     product_type text not null default '',
//     gender text not null default '',
//     product_group text not null default '',
//     fabric_type text not null default '',
//     length_type text not null default '',
//     neck text not null default '',
//     collar text not null default '',
//     fit text not null default '',
//     opening text not null default '',
//     has_hood text not null default '',
//     has_pocket text not null default '',
//     -- quantities
//     order_qty numeric not null default 0,
//     color_count numeric not null default 0,
//     size_count numeric not null default 0,
//     shipment text not null default '',
//     size_labels jsonb not null default '[]',   -- the order's size columns (labels)
//     size_breakdown jsonb not null default '[]',
//     embroidery_count numeric not null default 0,
//     print_count numeric not null default 0,
//     sublimation numeric not null default 0,
//     iron_count numeric not null default 0,
//     -- cost inputs
//     fabric_lines jsonb not null default '[]',
//     extras jsonb not null default '[]',
//     sew_labor numeric not null default 0,
//     cut_labor numeric not null default 0,
//     output_day numeric not null default 0,
//     waste_pct numeric not null default 3,
//     overhead_baht numeric not null default 8000,
//     profit_pct numeric not null default 10,
//     cutting_loss_pct numeric not null default 5,
//     note text not null default '',
//     created_by text not null default '',
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now()
//   );

// ── Order status (full production flow) ──────────────────────────────
// An order is logged first (default "quote") and moves through these stages.
// Costing is OPTIONAL — an order can sit at any stage with no cost entered yet.
export const ORDER_STATUSES = [
  { key: "quote",      th: "ใบเสนอราคา", en: "Quote",         color: "#64748b" },
  { key: "confirmed",  th: "ยืนยันแล้ว",  en: "Confirmed",     color: "#2563eb" },
  { key: "production", th: "กำลังผลิต",   en: "In production", color: "#d97706" },
  { key: "shipped",    th: "จัดส่งแล้ว",  en: "Shipped",       color: "#7c3aed" },
  { key: "done",       th: "เสร็จสิ้น",   en: "Done",          color: "#16a34a" },
  { key: "cancelled",  th: "ยกเลิก",     en: "Cancelled",     color: "#dc2626" },
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number]["key"];
export function statusMeta(key: string) {
  return ORDER_STATUSES.find((s) => s.key === key) ?? ORDER_STATUSES[0];
}

// Size breakdown. Sizes vary per job (XS S M L, or 1 2 3, or custom per customer —
// see the guideline sheet), so each order defines its OWN set of size columns in
// `size_labels`; each size row then carries a color plus a quantity keyed by label.
// Stored as: size_labels jsonb (the columns) + size_breakdown jsonb (the rows). No
// fixed size schema — new labels can be added freely without any migration.
export const DEFAULT_SIZE_LABELS = ["S", "M", "L", "XL"];
export type SizeRow = { color: string; qty: Record<string, number> };
// A fabric used in the garment. `fabric_id` optionally links to a real ผ้า item so
// price_per_yard can be auto-filled from live stock; it's still overridable by hand.
export type FabricLine = { label: string; fabric_id: string | null; yard_per_pc: number; price_per_yard: number };
// A trim / print / packaging cost, per piece (THB). `accessory_id` optionally links
// to a real อุปกรณ์ item to auto-fill `amount` from its current price.
export type ExtraLine = { label: string; accessory_id: string | null; amount: number };

export type ProductCosting = {
  id: string;
  status: string;
  due_date: string | null;
  // Codes / tags — framework only for now. A `code` and freeform `tags` live on every
  // order so they can be assigned per-order today; a bulk "retroactively tag existing
  // orders" tool (mirroring the accessory/fabric stock-update label backfill) is future
  // work and deliberately NOT implemented yet.
  code: string;
  tags: string;
  product_id: string | null;   // soft link to products.id; spec fields are also copied onto the order
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
  fabric_lines: FabricLine[];
  extras: ExtraLine[];
  sew_labor: number;
  cut_labor: number;
  output_day: number;
  waste_pct: number;
  overhead_baht: number;
  profit_pct: number;
  cutting_loss_pct: number;
  note: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CostingInput = Omit<ProductCosting, "id" | "created_at" | "updated_at">;

// ── The costing math ─────────────────────────────────────────────────
// Per-piece, adapted from the GKM spreadsheet but generalised:
//   · fabric  = Σ(yard/pc × price/yard) × (1 + cutting-loss%)   — clean per-piece,
//               no divide-by-order-qty (the GKM sheet's yard field was really total)
//   · material = fabric + Σ trims/print/packaging (each already per piece)
//   · waste    = material × waste%
//   · labor    = sewing + cutting
//   · overhead = overhead-per-day ÷ output-per-day
//   · total    = material + waste + labor + overhead
//   · profit   = margin ON THE PRICE:  total ÷ (1 − margin%) − total
//   · price    = total + profit
export type CostBreakdown = {
  fabricPerPc: number;
  extrasSum: number;
  materialSubtotal: number;
  wasteCost: number;
  laborTotal: number;
  overheadPerPc: number;
  totalCost: number;
  profit: number;
  sellingPrice: number;
};

export function computeCosting(c: {
  fabric_lines: FabricLine[];
  extras: ExtraLine[];
  sew_labor: number;
  cut_labor: number;
  output_day: number;
  waste_pct: number;
  overhead_baht: number;
  profit_pct: number;
  cutting_loss_pct: number;
}): CostBreakdown {
  const num = (v: any) => (isFinite(Number(v)) ? Number(v) : 0);
  const fabricRaw = c.fabric_lines.reduce((s, f) => s + num(f.yard_per_pc) * num(f.price_per_yard), 0);
  const fabricPerPc = fabricRaw * (1 + num(c.cutting_loss_pct) / 100);
  const extrasSum = c.extras.reduce((s, e) => s + num(e.amount), 0);
  const materialSubtotal = fabricPerPc + extrasSum;
  const wasteCost = materialSubtotal * (num(c.waste_pct) / 100);
  const laborTotal = num(c.sew_labor) + num(c.cut_labor);
  const overheadPerPc = num(c.output_day) > 0 ? num(c.overhead_baht) / num(c.output_day) : 0;
  const totalCost = materialSubtotal + wasteCost + laborTotal + overheadPerPc;
  const denom = 1 - num(c.profit_pct) / 100;
  const profit = denom > 0 ? totalCost / denom - totalCost : 0;
  const sellingPrice = totalCost + profit;
  return { fabricPerPc, extrasSum, materialSubtotal, wasteCost, laborTotal, overheadPerPc, totalCost, profit, sellingPrice };
}

// Whether any cost input has been entered — used to show "—" instead of ฿0.00
// for orders that are logged but not yet costed (costing is optional).
export function hasCosting(c: {
  fabric_lines: FabricLine[]; extras: ExtraLine[]; sew_labor: number; cut_labor: number;
}): boolean {
  const fab = c.fabric_lines.some((f) => Number(f.yard_per_pc) > 0 && Number(f.price_per_yard) > 0);
  const ex = c.extras.some((e) => Number(e.amount) > 0);
  return fab || ex || Number(c.sew_labor) > 0 || Number(c.cut_labor) > 0;
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function getCostings(): Promise<ProductCosting[]> {
  const all: ProductCosting[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("product_costings")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })   // unique tiebreaker → gap-free pagination
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as ProductCosting[]));
    if (data.length < PAGE) break;
  }
  return all;
}

export async function getCosting(id: string): Promise<ProductCosting | null> {
  const { data, error } = await supabase.from("product_costings").select("*").eq("id", id).single();
  if (error) return null;
  return data as ProductCosting;
}

export async function addCosting(input: CostingInput): Promise<ProductCosting> {
  const { data, error } = await supabase.from("product_costings").insert(input).select().single();
  if (error) throw error;
  return data as ProductCosting;
}

// Bulk-insert orders (used by the Excel importer). Chunked to stay under request limits.
export async function addCostingsBulk(inputs: CostingInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < inputs.length; i += CHUNK) {
    const slice = inputs.slice(i, i + CHUNK);
    const { error } = await supabase.from("product_costings").insert(slice);
    if (error) throw error;
    inserted += slice.length;
  }
  return inserted;
}

export async function updateCosting(id: string, input: Partial<CostingInput>): Promise<ProductCosting> {
  const { data, error } = await supabase
    .from("product_costings")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ProductCosting;
}

export async function deleteCosting(id: string): Promise<void> {
  const { error } = await supabase.from("product_costings").delete().eq("id", id);
  if (error) throw error;
}

// ── Live price sources ───────────────────────────────────────────────
// Pull selectable prices from the real inventories so a costing can be built off
// current data instead of hand-typed guesses. "Current price" = weighted-average
// cost of the item's remaining lots (the authoritative figure); when an item is out
// of stock (no lots) we fall back to its reference `unit_cost`.
export type PriceOption = { id: string; label: string; unit: string; price: number };

function avgCost(lots: { quantity_remaining: number; unit_cost: number }[] | undefined, fallback: number): number {
  if (!lots || lots.length === 0) return fallback;
  const qty = lots.reduce((s, l) => s + Number(l.quantity_remaining), 0);
  if (qty <= 0) return fallback;
  const val = lots.reduce((s, l) => s + Number(l.quantity_remaining) * Number(l.unit_cost), 0);
  return val / qty;
}

export async function getPriceSources(): Promise<{ fabrics: PriceOption[]; accessories: PriceOption[] }> {
  const [accs, accLots, fabs, fabLots] = await Promise.all([
    getAccessories(true),
    getLotMap(),
    getFabrics(true),
    getFabricLotMap(),
  ]);

  const accessories: PriceOption[] = accs
    .map((a) => ({
      id: a.id,
      label: [a.type, a.description, a.color, a.size].filter((x) => String(x).trim()).join(" · "),
      unit: a.unit,
      price: avgCost(accLots.get(a.id), Number(a.unit_cost) || 0),
    }))
    .sort((x, y) => x.label.localeCompare(y.label, "th"));

  const fabrics: PriceOption[] = fabs
    .map((f) => ({
      id: f.id,
      label: [f.fabric_type, f.color, f.width].filter((x) => String(x).trim()).join(" · "),
      unit: f.cost_unit || f.unit,
      price: avgCost(fabLots.get(f.id), Number(f.unit_cost) || 0),
    }))
    .sort((x, y) => x.label.localeCompare(y.label, "th"));

  return { fabrics, accessories };
}
