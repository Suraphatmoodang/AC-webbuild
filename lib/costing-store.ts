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
//     sew_labor numeric not null default 0,    -- labor: QC (เช็ค) — pre-existing column
//     cut_labor numeric not null default 0,     -- labor: ตัด (cut)
//     qc_labor numeric not null default 0,      -- labor: เย็บ (sew) — NEW; add via: alter table product_costings add column qc_labor numeric not null default 0
//     pack_labor numeric not null default 0,    -- labor: แพ็ค (pack)
//     output_day numeric not null default 0,    -- LEGACY (overhead used to be ÷ this); unused, kept for old rows
//     waste_pct numeric not null default 3,
//     overhead_baht numeric not null default 8000, -- LEGACY (was โสหุ้ย/วัน); unused, kept for old rows
//     overhead_pc numeric not null default 0,   -- โสหุ้ย/ตัว (baht per piece, typed directly)
//     profit_pct numeric not null default 10,
//     cutting_loss_pct numeric not null default 5,
//     offer_price numeric not null default 0,   -- offered/budget price for the WHOLE order (kept for budget-vs-actual; not in the cost math). Add via: alter table product_costings add column offer_price numeric not null default 0
//     actual_entries jsonb not null default '[]',   -- Phase D: hand-logged actual costs
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
// A fabric used in the garment. `fabric_id` links to a real ผ้า item so the spec + price
// can be auto-filled from live stock; null = a PLACEHOLDER (fabric not in stock yet), to be
// linked retroactively once it arrives. All spec fields stay overridable by hand.
//   · label       = หน้าที่ใช้ (garment part: ตัวเสื้อ / ปก / ซับใน) — optional
//   · code        = เลขที่ (fabric number/code)
//   · fabric_type = ชนิดผ้า (composition/type, e.g. "60% cotton 40% spandex")
//   · color / width = สี / หน้าผ้า (หน้าผ้า is descriptive only — NOT in the cost math)
//   · unit        = หน่วย ("หลา" | "กิโล"); yard_per_pc & price_per_yard are IN that unit
// Note: the JSONB keys yard_per_pc / price_per_yard are kept (generic "qty per pc" / "price
// per unit") so existing saved lines don't need a backfill; the UI labels them จำนวน/ตัว & ราคา/หน่วย.
// `price_per_yard` is the ORDER'S own price used in the costing math — it's typed by hand and
// is NOT auto-filled from stock on link (the order keeps its own price; actual cost is
// reconciled later from tagged transactions).
export type FabricLine = {
  label: string; fabric_id: string | null;
  code: string; fabric_type: string; color: string; width: string;
  unit: string; yard_per_pc: number; price_per_yard: number;
};
// A trim / print / packaging cost. `accessory_id` links to a real อุปกรณ์ item (null =
// PLACEHOLDER, linked retroactively once it's in stock), mirroring the fabric line.
// Two cost modes per line:
//   · "flat" → a single per-piece baht amount (`amount`) — good for printing / packing
//   · "qty"  → `qty_per_pc × unit_price` in `unit` — good for counted trims (ซิป, กระดุม)
// Old rows have no `mode` and are treated as "flat" (they only carry `amount`).
//   · label = the item's short name (ซิป, พิมพ์…) — kept short so linking back to stock is easy
//   · desc  = a fuller free-text description for later reference (composition, spec, stock name);
//             auto-filled from the picked อุปกรณ์ but editable. Purely descriptive — the hard link
//             to stock is `accessory_id`, so a long desc never affects matching. (JSONB, no migration.)
//   · unit_price / amount = the order's own price used in the math (NOT auto-filled from stock on link)
export type ExtraLine = {
  label: string; desc: string; accessory_id: string | null;
  mode: "flat" | "qty"; amount: number; qty_per_pc: number; unit: string; unit_price: number;
};
// Per-line cost, honoring the mode (old rows with no mode fall back to the flat amount).
export function extraLineCost(e: { mode?: string; amount: number; qty_per_pc?: number; unit_price?: number }): number {
  const num = (v: any) => (isFinite(Number(v)) ? Number(v) : 0);
  return e.mode === "qty" ? num(e.qty_per_pc) * num(e.unit_price) : num(e.amount);
}

// Phase D — a hand-logged ACTUAL cost incurred on the order (labor paid, dye bill, transport,
// off-system material buy, rework…). Material actuals are mostly DERIVED from tagged OUT
// transactions (see getOrderActualMaterial); these entries capture everything else + any
// material bought outside the stock system. Stored as JSONB `actual_entries` (no per-field migration).
export const ACTUAL_CATEGORIES = [
  { key: "material", th: "วัตถุดิบ" },
  { key: "labor",    th: "ค่าแรง" },
  { key: "overhead", th: "โสหุ้ย" },
  { key: "other",    th: "อื่นๆ" },
] as const;
export type ActualCategory = (typeof ACTUAL_CATEGORIES)[number]["key"];
export type ActualEntry = { date: string; category: ActualCategory; label: string; amount: number; note: string };

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
  sew_labor: number;   // labor: QC (เช็ค) — pre-existing column
  cut_labor: number;   // labor: ตัด (cut)
  qc_labor: number;    // labor: เย็บ (sew) — new column
  pack_labor: number;  // labor: แพ็ค (pack)
  output_day: number;    // LEGACY, unused (overhead is now typed per-piece)
  waste_pct: number;
  overhead_baht: number; // LEGACY, unused
  overhead_pc: number;   // โสหุ้ย/ตัว (baht per piece)
  profit_pct: number;
  cutting_loss_pct: number;
  offer_price: number;   // offered/budget price for the WHOLE order — stored for budget-vs-actual; NOT in the cost math
  actual_entries: ActualEntry[];   // Phase D: hand-logged actual costs (JSONB)
  note: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CostingInput = Omit<ProductCosting, "id" | "created_at" | "updated_at">;

// ── The costing math ─────────────────────────────────────────────────
// Fabric qty and the trim/print/packaging (extras) are keyed as ORDER TOTALS — that's
// how the shop actually records them — so they're divided by จำนวนสั่ง (order_qty) to get
// the per-piece figures the sheet is built on. Labor and โสหุ้ย are already typed per piece.
// With no order_qty yet, those total-based terms can't be split, so they contribute 0
// (the per-piece cost / selling price read as ฿0 until a quantity is entered).
//   · fabric  = Σ(total yards × price/yard) ÷ order_qty × (1 + cutting-loss%)
//   · material = fabric + Σ(total trims/print/packaging ÷ order_qty)
//   · waste    = material × waste%
//   · labor    = ตัด + เย็บ + QC + แพ็ค   (already per piece)
//   · overhead = โสหุ้ย/ตัว (typed directly per piece)
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
  sew_labor: number;   // QC (เช็ค)
  cut_labor: number;   // ตัด
  qc_labor: number;    // เย็บ
  pack_labor: number;  // แพ็ค
  waste_pct: number;
  overhead_pc: number; // โสหุ้ย/ตัว (typed directly)
  profit_pct: number;
  cutting_loss_pct: number;
  order_qty: number;   // fabric qty & extras are ORDER TOTALS → divided by this to per-piece
}): CostBreakdown {
  const num = (v: any) => (isFinite(Number(v)) ? Number(v) : 0);
  // Fabric qty & extras are keyed as totals for the whole order; convert to per-piece by
  // dividing by จำนวนสั่ง. No order qty yet → perPc 0, so those terms drop to 0 (can't split).
  const qty = num(c.order_qty);
  const perPc = qty > 0 ? 1 / qty : 0;
  const fabricRaw = c.fabric_lines.reduce((s, f) => s + num(f.yard_per_pc) * num(f.price_per_yard), 0) * perPc;
  const fabricPerPc = fabricRaw * (1 + num(c.cutting_loss_pct) / 100);
  const extrasSum = c.extras.reduce((s, e) => s + extraLineCost(e), 0) * perPc;
  const materialSubtotal = fabricPerPc + extrasSum;
  const wasteCost = materialSubtotal * (num(c.waste_pct) / 100);
  const laborTotal = num(c.cut_labor) + num(c.sew_labor) + num(c.qc_labor) + num(c.pack_labor);   // ตัด + เย็บ + QC + แพ็ค
  const overheadPerPc = num(c.overhead_pc);
  const totalCost = materialSubtotal + wasteCost + laborTotal + overheadPerPc;
  const denom = 1 - num(c.profit_pct) / 100;
  const profit = denom > 0 ? totalCost / denom - totalCost : 0;
  const sellingPrice = totalCost + profit;
  return { fabricPerPc, extrasSum, materialSubtotal, wasteCost, laborTotal, overheadPerPc, totalCost, profit, sellingPrice };
}

// Whether any cost input has been entered — used to show "—" instead of ฿0.00
// for orders that are logged but not yet costed (costing is optional).
export function hasCosting(c: {
  fabric_lines: FabricLine[]; extras: ExtraLine[]; sew_labor: number; cut_labor: number; qc_labor: number; pack_labor: number;
}): boolean {
  const fab = c.fabric_lines.some((f) => Number(f.yard_per_pc) > 0 && Number(f.price_per_yard) > 0);
  const ex = c.extras.some((e) => extraLineCost(e) > 0);
  return fab || ex || Number(c.sew_labor) > 0 || Number(c.cut_labor) > 0 || Number(c.qc_labor) > 0 || Number(c.pack_labor) > 0;
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
// `label`/`unit`/`price` are common to both sides; the extra spec fields are set for
// fabrics only, so a picked fabric can auto-fill เลขที่/ชนิดผ้า/สี/หน้าผ้า on the costing line.
export type PriceOption = {
  id: string; label: string; unit: string; price: number; stock: number;
  code?: string; fabric_type?: string; color?: string; width?: string;
};

function avgCost(lots: { quantity_remaining: number; unit_cost: number }[] | undefined, fallback: number): number {
  if (!lots || lots.length === 0) return fallback;
  const qty = lots.reduce((s, l) => s + Number(l.quantity_remaining), 0);
  if (qty <= 0) return fallback;
  const val = lots.reduce((s, l) => s + Number(l.quantity_remaining) * Number(l.unit_cost), 0);
  return val / qty;
}

// Current on-hand stock = Σ remaining across the item's lots (0 when out of stock / no lots).
function stockQty(lots: { quantity_remaining: number }[] | undefined): number {
  if (!lots || lots.length === 0) return 0;
  return lots.reduce((s, l) => s + Number(l.quantity_remaining), 0);
}

async function loadAccessoryPrices(): Promise<PriceOption[]> {
  // ALL items (not active-only) so this matches what /stock lists.
  const [accs, accLots] = await Promise.all([getAccessories(), getLotMap()]);
  return accs
    .map((a) => ({
      id: a.id,
      label: [a.type, a.description, a.color, a.size].filter((x) => String(x).trim()).join(" · "),
      unit: a.unit,
      price: avgCost(accLots.get(a.id), Number(a.unit_cost) || 0),
      stock: stockQty(accLots.get(a.id)),
    }))
    .sort((x, y) => x.label.localeCompare(y.label, "th"));
}

async function loadFabricPrices(): Promise<PriceOption[]> {
  const [fabs, fabLots] = await Promise.all([getFabrics(), getFabricLotMap()]);
  return fabs
    .map((f) => ({
      id: f.id,
      label: [f.fabric_code, f.fabric_type, f.color, f.width].filter((x) => String(x).trim()).join(" · "),
      unit: f.cost_unit || f.unit,
      price: avgCost(fabLots.get(f.id), Number(f.unit_cost) || 0),
      stock: stockQty(fabLots.get(f.id)),
      code: f.fabric_code ?? "",
      fabric_type: f.fabric_type ?? "",
      color: f.color ?? "",
      width: f.width ?? "",
    }))
    .sort((x, y) => x.label.localeCompare(y.label, "th"));
}

// ── Active orders (for tagging transactions) ─────────────────────────
// A lightweight list of orders that are still "live" (not done/cancelled), used to power
// the searchable order selector on the transaction pages. `label` is a search-friendly
// one-liner; the individual fields drive the confirm preview.
export type OrderRef = {
  id: string; code: string; customer: string; style_no: string; po_no: string;
  description: string; status: string; due_date: string | null; label: string;
};

export async function getActiveOrders(): Promise<OrderRef[]> {
  const { data, error } = await supabase
    .from("product_costings")
    .select("id, code, customer, style_no, po_no, description, status, due_date")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .filter((o: any) => o.status !== "done" && o.status !== "cancelled")
    .map((o: any) => ({
      id: o.id, code: o.code ?? "", customer: o.customer ?? "", style_no: o.style_no ?? "",
      po_no: o.po_no ?? "", description: o.description ?? "", status: o.status ?? "quote",
      due_date: o.due_date ?? null,
      label: [o.code, o.customer, o.style_no || o.po_no, o.description]
        .map((x) => String(x ?? "").trim()).filter(Boolean).join(" · "),
    }));
}

// ── Per-order material flows (received / used) ───────────────────────
// Aggregates the transactions tagged to an order — by hard link (order_id) OR, for an order
// that wasn't in the system when recorded, by reference_no matching the order's code. Grouped
// per stock item id; IN/RETURN → received, OUT → used. Resilient: if the order_id column
// isn't migrated yet (or anything errors), returns empty maps so the page still renders.
export type ItemFlow = { received: number; used: number };

export async function getOrderFlows(orderId: string, code: string): Promise<{ acc: Map<string, ItemFlow>; fab: Map<string, ItemFlow> }> {
  const acc = new Map<string, ItemFlow>();
  const fab = new Map<string, ItemFlow>();
  const codeTrim = (code || "").trim();
  const add = (map: Map<string, ItemFlow>, id: string | null, type: string, qty: number) => {
    if (!id) return;
    const cur = map.get(id) ?? { received: 0, used: 0 };
    if (type === "IN" || type === "RETURN") cur.received += qty;
    else if (type === "OUT") cur.used += qty;
    map.set(id, cur);
  };
  const filt = (q: any) => (codeTrim ? q.or(`order_id.eq.${orderId},reference_no.eq.${codeTrim}`) : q.eq("order_id", orderId));
  try {
    const [accRes, fabRes] = await Promise.all([
      filt(supabase.from("accessory_transactions").select("accessory_id, transaction_type, quantity")),
      filt(supabase.from("fabric_transactions").select("fabric_id, transaction_type, quantity")),
    ]);
    if (!accRes.error) for (const r of (accRes.data ?? []) as any[]) add(acc, r.accessory_id, r.transaction_type, Number(r.quantity) || 0);
    if (!fabRes.error) for (const r of (fabRes.data ?? []) as any[]) add(fab, r.fabric_id, r.transaction_type, Number(r.quantity) || 0);
  } catch {
    /* order_id not migrated yet, or a transient error — fall back to empty (planned-only view) */
  }
  return { acc, fab };
}

// ── Actual material cost (Phase D) ───────────────────────────────────
// The REAL material spend consumed for an order = Σ over the order's tagged OUT transactions
// of (consumed qty × that lot's unit_cost) — read straight from lot_effects + the lots' cost,
// so it reflects true FIFO/LIFO cost, not a re-typed estimate. Resilient: any error → 0.
async function sumLotCosts(table: "accessory_lots" | "fabric_lots", consumed: Map<string, number>): Promise<number> {
  if (consumed.size === 0) return 0;
  const ids = Array.from(consumed.keys());
  let sum = 0;
  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from(table).select("id, unit_cost").in("id", ids.slice(i, i + CHUNK));
    if (error) continue;
    for (const lot of (data ?? []) as any[]) sum += (consumed.get(lot.id) ?? 0) * (Number(lot.unit_cost) || 0);
  }
  return sum;
}

export async function getOrderActualMaterial(orderId: string, code: string): Promise<number> {
  const codeTrim = (code || "").trim();
  const filt = (q: any) => (codeTrim ? q.or(`order_id.eq.${orderId},reference_no.eq.${codeTrim}`) : q.eq("order_id", orderId));
  try {
    const [accTx, fabTx] = await Promise.all([
      filt(supabase.from("accessory_transactions").select("lot_effects").eq("transaction_type", "OUT")),
      filt(supabase.from("fabric_transactions").select("lot_effects").eq("transaction_type", "OUT")),
    ]);
    const gather = (rows: any[] | null | undefined) => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) {
        const eff = r.lot_effects;
        if (eff && eff.op === "consume" && Array.isArray(eff.lots)) {
          for (const l of eff.lots) if (l?.lot_id) m.set(l.lot_id, (m.get(l.lot_id) ?? 0) + (Number(l.consumed) || 0));
        }
      }
      return m;
    };
    const accConsumed = accTx.error ? new Map<string, number>() : gather(accTx.data as any[]);
    const fabConsumed = fabTx.error ? new Map<string, number>() : gather(fabTx.data as any[]);
    const [accCost, fabCost] = await Promise.all([sumLotCosts("accessory_lots", accConsumed), sumLotCosts("fabric_lots", fabConsumed)]);
    return accCost + fabCost;
  } catch {
    return 0;
  }
}

export async function getPriceSources(): Promise<{ fabrics: PriceOption[]; accessories: PriceOption[] }> {
  // Each side loads independently so a failure (or slow query) on one can't blank the other;
  // a failing side logs and returns [] instead of taking the whole dropdown set down with it.
  const [accessories, fabrics] = await Promise.all([
    loadAccessoryPrices().catch((e) => { console.error("getPriceSources: accessories failed", e); return [] as PriceOption[]; }),
    loadFabricPrices().catch((e) => { console.error("getPriceSources: fabrics failed", e); return [] as PriceOption[]; }),
  ]);
  return { fabrics, accessories };
}
