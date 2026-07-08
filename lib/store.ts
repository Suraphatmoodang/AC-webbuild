import { supabase } from "./supabase";

export type Accessory = {
  id: string;
  type: string;
  acc_code: string;
  description: string;
  row: number | null;
  color: string;
  size: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  min_quantity: number;
  supplier_id: string | null;   // FK → suppliers.id
  valuation_method: "fifo" | "lifo";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Lot = {
  id: string;
  accessory_id: string;
  quantity_received: number;
  quantity_remaining: number;
  unit_cost: number;
  effective_date: string;
  created_at: string;
  source: "IN" | "RETURN" | "MIGRATION" | "ADJUST";
  note: string;
};

export type ImportRow = {
  id: string;
  batch_id: string;
  status: "pending" | "approved" | "rejected";
  type: string;
  acc_code: string;
  description: string;
  row: number | null;
  color: string;
  size: string;
  quantity: number;
  min_quantity: number;
  unit: string;
  unit_cost: number;
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
  created_at: string;
  approved_at: string | null;
};

export type Transaction = {
  id: string;
  accessory_id: string;
  transaction_type: "IN" | "OUT" | "ADJUST" | "RETURN";
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference_no: string;
  note: string;
  created_by: string;
  created_at: string;
};

export type Supplier = {
  id: string;
  supplier_code: string;
  supplier_name: string;
  contact_person: string;
  contact_number: string;
  contact_email: string;
  line_id: string;
  address: string;
  city: string;
  country: string;
  postal_code: string;
  lead_time: string;
  payment_term: string;
  tax_id: string;
  created_at: string;
  updated_at: string;
};

// ── Accessories ──────────────────────────────────────────────

export async function getAccessories(activeOnly = false): Promise<Accessory[]> {
  // Supabase caps a single query at 1000 rows; page through to load them all.
  const all: Accessory[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("accessories").select("*").order("type").order("description").range(from, from + PAGE - 1);
    if (activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

export async function addAccessory(
  input: Omit<Accessory, "id" | "created_at" | "updated_at">
): Promise<Accessory> {
  const { data, error } = await supabase
    .from("accessories")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAccessory(
  id: string,
  input: Partial<Omit<Accessory, "id" | "created_at" | "updated_at">>
): Promise<Accessory> {
  const { data, error } = await supabase
    .from("accessories")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAccessory(id: string): Promise<void> {
  const { error } = await supabase.from("accessories").delete().eq("id", id);
  if (error) throw error;
}

// Bulk delete accessories. Items with transaction history are blocked by the
// DB foreign key (ON DELETE RESTRICT); we detect those up front and skip them,
// returning which ids were deleted vs. blocked so the UI can offer deactivation.
export async function bulkDeleteAccessories(
  ids: string[]
): Promise<{ deleted: string[]; blocked: string[] }> {
  if (ids.length === 0) return { deleted: [], blocked: [] };

  // Find which of these ids have transactions referencing them.
  const blockedSet = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("accessory_transactions")
      .select("accessory_id")
      .in("accessory_id", slice);
    if (error) throw error;
    for (const r of data ?? []) blockedSet.add(r.accessory_id);
  }

  const deletable = ids.filter((id) => !blockedSet.has(id));
  for (let i = 0; i < deletable.length; i += CHUNK) {
    const slice = deletable.slice(i, i + CHUNK);
    const { error } = await supabase.from("accessories").delete().in("id", slice);
    if (error) throw error;
  }

  return { deleted: deletable, blocked: Array.from(blockedSet) };
}

export async function bulkDeactivateAccessories(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from("accessories").update({ is_active: false }).in("id", slice);
    if (error) throw error;
  }
}

export async function bulkDeleteSuppliers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from("suppliers").delete().in("id", slice);
    if (error) throw error;
  }
}

// ── Transactions ──────────────────────────────────────────────

export async function getTransactions(): Promise<Transaction[]> {
  const all: Transaction[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("accessory_transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

export async function getTransactionsByAccessory(accessory_id: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("accessory_transactions")
    .select("*")
    .eq("accessory_id", accessory_id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Lot-aware transaction. Behavior by type:
//  IN     → creates a new lot (qty + unit_cost), dated today
//  RETURN → creates a new lot (qty + unit_cost) with chosen queue position
//  OUT    → consumes lots FIFO/LIFO (or a specific lot), errors if insufficient
//  ADJUST → sets a specific lot's remaining quantity to an exact value
// Stock before/after on the transaction row are derived from lot totals.
export async function addTransaction(opts: {
  accessory_id: string;
  type: Transaction["transaction_type"];
  qty: number;                       // IN/OUT/RETURN: amount; ADJUST: target remaining for the lot
  unit_cost?: number;                // IN/RETURN
  lot_id?: string;                   // OUT (restrict to lot) / ADJUST (which lot)
  return_position?: "front" | "back" | "date";  // RETURN
  return_date?: string;              // RETURN when position = "date"
  reference_no?: string;
  note?: string;
  created_by?: string;
}): Promise<{ ok: true; before: number; after: number } | { error: string }> {
  const { accessory_id, type, qty } = opts;
  try {
    const { data: acc, error: fetchErr } = await supabase
      .from("accessories").select("*").eq("id", accessory_id).single();
    if (fetchErr || !acc) return { error: "ไม่พบรายการ" };
    const method: "fifo" | "lifo" = acc.valuation_method === "lifo" ? "lifo" : "fifo";

    const lotsBefore = await getLots(accessory_id);
    const before = stockFromLots(lotsBefore);
    let txQty = qty;

    if (type === "IN" || type === "RETURN") {
      // Determine effective_date for queue positioning
      let effective = new Date().toISOString();
      if (type === "RETURN") {
        const sorted = [...lotsBefore].sort((a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime());
        if (opts.return_position === "front" && sorted.length > 0) {
          effective = new Date(new Date(sorted[0].effective_date).getTime() - 1000).toISOString();
        } else if (opts.return_position === "date" && opts.return_date) {
          effective = new Date(opts.return_date).toISOString();
        } // "back" or default → now (newest)
      }
      await createLot({
        accessory_id, quantity: qty, unit_cost: opts.unit_cost ?? 0,
        effective_date: effective, source: type === "RETURN" ? "RETURN" : "IN",
        note: opts.note ?? "",
      });
      txQty = qty;
    } else if (type === "OUT") {
      await consumeStock(accessory_id, qty, method, opts.lot_id);
      txQty = qty;
    } else if (type === "ADJUST") {
      if (!opts.lot_id) return { error: "กรุณาเลือกล็อตที่ต้องการปรับ" };
      const target = lotsBefore.find((l) => l.id === opts.lot_id);
      if (!target) return { error: "ไม่พบล็อต" };
      txQty = qty - Number(target.quantity_remaining);
      await adjustLot(opts.lot_id, qty);
    }

    const lotsAfter = await getLots(accessory_id);
    const after = stockFromLots(lotsAfter);

    const { error: txErr } = await supabase
      .from("accessory_transactions")
      .insert({ accessory_id, transaction_type: type, quantity: txQty,
        quantity_before: before, quantity_after: after,
        reference_no: opts.reference_no ?? "", note: opts.note ?? "", created_by: opts.created_by ?? "" });
    if (txErr) return { error: txErr.message };

    return { ok: true, before, after };
  } catch (e: any) {
    return { error: e.message ?? "เกิดข้อผิดพลาด" };
  }
}

// ── Suppliers ──────────────────────────────────────────────

export async function getSuppliers(): Promise<Supplier[]> {
  const all: Supplier[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .order("supplier_name")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

export async function addSupplier(
  input: Omit<Supplier, "id" | "created_at" | "updated_at">
): Promise<Supplier> {
  const { data, error } = await supabase
    .from("suppliers")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSupplier(
  id: string,
  input: Partial<Omit<Supplier, "id" | "created_at" | "updated_at">>
): Promise<Supplier> {
  const { data, error } = await supabase
    .from("suppliers")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSupplier(id: string): Promise<void> {
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) throw error;
}

// ── Imports (staging) ──────────────────────────────────────────

// Fields that define an "exact" import row for dedupe purposes.
// Every one must match for a row to be considered a duplicate.
// Fields that define an "exact" import row for dedupe purposes.
// NOTE: quantity and min_quantity are intentionally EXCLUDED — the same item
// with a different stock level is still the same item, so it should be flagged
// as a duplicate rather than treated as a new entry.
const IMPORT_MATCH_FIELDS = [
  "type", "acc_code", "description", "row", "color", "size",
  "unit", "unit_cost", "supplier_name", "contact_person",
  "contact_number", "contact_email", "address", "city", "country",
  "postal_code", "lead_time", "payment_term", "tax_id",
] as const;

// Normalize a value for matching: trim ends AND collapse internal runs of
// whitespace to a single space. Catches duplicates that differ only by
// inconsistent spacing (e.g. "ยูเนี่ยนซิป  จำกัด" vs "ยูเนี่ยนซิป จำกัด").
function normalizeForMatch(v: any): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

function importRowKey(r: Record<string, any>): string {
  return IMPORT_MATCH_FIELDS.map((f) => normalizeForMatch(r[f])).join("\u0001");
}

export async function createImportBatch(
  rows: Omit<ImportRow, "id" | "batch_id" | "status" | "created_at" | "approved_at">[]
): Promise<{ batch_id: string; count: number; skipped: number }> {
  const batch_id = crypto.randomUUID();

  // 1. Load keys of all rows already pending in staging, so a re-upload
  //    of identical rows doesn't create duplicates in the review queue.
  const existing = await getPendingImports();
  const seen = new Set<string>(existing.map((r) => importRowKey(r)));

  // 2. Filter the incoming rows: skip any that exactly match a pending row,
  //    and also skip exact duplicates within the same uploaded file.
  const toInsert: typeof rows = [];
  let skipped = 0;
  for (const r of rows) {
    const key = importRowKey(r);
    if (seen.has(key)) { skipped += 1; continue; }
    seen.add(key);
    toInsert.push(r);
  }

  const payload = toInsert.map((r) => ({ ...r, batch_id, status: "pending" as const }));

  // 3. Insert in chunks so large imports don't hit request limits.
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error } = await supabase.from("accessory_imports").insert(slice);
    if (error) throw error;
  }
  return { batch_id, count: payload.length, skipped };
}

export async function getPendingImports(): Promise<ImportRow[]> {
  // Supabase caps a single query at 1000 rows; page through to get them all.
  const all: ImportRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("accessory_imports")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

// Approved staging rows — used for the "added entries" log.
export async function getApprovedImports(): Promise<ImportRow[]> {
  const all: ImportRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("accessory_imports")
      .select("*")
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

// Stage a single manually-added accessory into the approval queue.
export async function stageAccessory(
  input: Omit<ImportRow, "id" | "batch_id" | "status" | "created_at" | "approved_at">
): Promise<{ skipped: boolean }> {
  // Reuse the same exact-match dedupe as the bulk importer.
  const existing = await getPendingImports();
  const seen = new Set(existing.map((r) => importRowKey(r)));
  if (seen.has(importRowKey(input))) return { skipped: true };

  const { error } = await supabase
    .from("accessory_imports")
    .insert({ ...input, batch_id: crypto.randomUUID(), status: "pending" });
  if (error) throw error;
  return { skipped: false };
}

// Edit a pending staging row before approval (fix typos, wrong numbers, etc.).
// Only the data fields — id/batch/status/timestamps stay managed by the system.
export async function updateImportRow(
  id: string,
  input: Partial<Omit<ImportRow, "id" | "batch_id" | "status" | "created_at" | "approved_at">>
): Promise<ImportRow> {
  const { data, error } = await supabase
    .from("accessory_imports")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Purge approved staging rows older than N days. Not yet wired to any UI —
// call this (manually or from a scheduled job) when the log table grows large.
// The accessories themselves are unaffected; only the log source rows are removed.
export async function purgeApprovedImportsOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("accessory_imports")
    .delete()
    .eq("status", "approved")
    .lt("approved_at", cutoff)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// Rejecting deletes the staging rows outright — they're noise once rejected,
// and this keeps the staging table from accumulating junk.
export async function rejectImports(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from("accessory_imports").delete().in("id", slice);
    if (error) throw error;
  }
}

// Approve staging rows. Each row may carry an optional `overwriteId`:
//   - no overwriteId → insert as a NEW accessory (imported stock included)
//   - overwriteId set → UPDATE that existing accessory, overwriting ALL data
//     (admin-level: the import is treated as authoritative, stock included)
export async function approveImports(
  rows: (ImportRow & { overwriteId?: string })[],
  onProgress?: (done: number, total: number) => void   // called after each row (writing is sequential/slow)
): Promise<{ approved: number; errors: string[] }> {
  const errors: string[] = [];
  let approved = 0;
  let done = 0;

  // Match supplier names against existing suppliers only — never auto-create.
  const { data: existingSuppliers } = await supabase.from("suppliers").select("id, supplier_name");
  const supplierMap = new Map<string, string>(
    (existingSuppliers ?? []).map((s: any) => [normalizeForMatch(s.supplier_name), s.id])
  );

  for (const r of rows) {
    try {
      let supplier_id: string | null = null;
      const sKey = normalizeForMatch(r.supplier_name);
      if (sKey && supplierMap.has(sKey)) supplier_id = supplierMap.get(sKey)!;

      const fields = {
        type: r.type,
        acc_code: r.acc_code,
        description: r.description,
        row: r.row,
        color: r.color,
        size: r.size,
        unit: r.unit,
        unit_cost: r.unit_cost,        // reference price on the accessory (lots hold the real cost)
        min_quantity: r.min_quantity > 0 ? r.min_quantity : 10,
        supplier_id,
        is_active: true,
      };

      if (r.overwriteId) {
        // Overwrite master data on the existing accessory. Existing LOTS are left
        // untouched — the item already has real stock history. Stock is corrected
        // via the transactions/updater tools, not by re-importing.
        const { error: updErr } = await supabase.from("accessories")
          .update({ ...fields, quantity: r.quantity }).eq("id", r.overwriteId);
        if (updErr) throw updErr;
      } else {
        // New accessory: insert, then create its opening lot from the imported
        // stock + price (dated today). This is how the migration seeds stock.
        const { data: newAcc, error: insErr } = await supabase.from("accessories")
          .insert({ ...fields, quantity: r.quantity }).select("id").single();
        if (insErr) throw insErr;

        if (Number(r.quantity) > 0) {
          const { error: lotErr } = await supabase.from("accessory_lots").insert({
            accessory_id: newAcc.id,
            quantity_received: r.quantity,
            quantity_remaining: r.quantity,
            unit_cost: r.unit_cost,
            source: "MIGRATION",
            note: "นำเข้าครั้งแรก",
          });
          if (lotErr) throw lotErr;
        }
      }

      const { error: markErr } = await supabase
        .from("accessory_imports")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", r.id);
      if (markErr) throw markErr;

      approved += 1;
    } catch (e: any) {
      errors.push(`${r.type} ${r.description}: ${e.message ?? "error"}`);
    }
    onProgress?.(++done, rows.length);
  }

  return { approved, errors };
}

// Build a map of "type|acc_code|color|size" → matching existing accessories,
// so the review page can both flag duplicates and show them for comparison.
export async function getDuplicateMap(): Promise<Map<string, Accessory[]>> {
  const map = new Map<string, Accessory[]>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("accessories").select("*").range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const a of data as Accessory[]) {
      const key = `${a.type}|${a.acc_code}|${a.color}|${a.size}`;
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    if (data.length < PAGE) break;
  }
  return map;
}

// ── Lots (FIFO/LIFO inventory) ─────────────────────────────────

// Fetch all lots, paged past the 1000-row cap. Optionally for one accessory.
export async function getLots(accessoryId?: string): Promise<Lot[]> {
  const all: Lot[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("accessory_lots").select("*").order("effective_date").range(from, from + PAGE - 1);
    if (accessoryId) q = q.eq("accessory_id", accessoryId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

// Build a map of accessory_id → its lots (sorted by effective_date ascending).
export async function getLotMap(): Promise<Map<string, Lot[]>> {
  const lots = await getLots();
  const map = new Map<string, Lot[]>();
  for (const l of lots) {
    const arr = map.get(l.accessory_id) ?? [];
    arr.push(l);
    map.set(l.accessory_id, arr);
  }
  // each accessory's lots sorted oldest-effective first
  Array.from(map.values()).forEach((arr) => arr.sort((a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime()));
  return map;
}

// Derive total stock and value for an accessory from its lots.
export function stockFromLots(lots: Lot[]): number {
  return lots.reduce((s, l) => s + Number(l.quantity_remaining), 0);
}
export function valueFromLots(lots: Lot[]): number {
  return lots.reduce((s, l) => s + Number(l.quantity_remaining) * Number(l.unit_cost), 0);
}

// Create a new lot (used by IN, RETURN, MIGRATION).
export async function createLot(input: {
  accessory_id: string;
  quantity: number;
  unit_cost: number;
  effective_date?: string;      // defaults to now
  source?: Lot["source"];
  note?: string;
}): Promise<Lot> {
  const eff = input.effective_date ?? new Date().toISOString();
  const { data, error } = await supabase.from("accessory_lots").insert({
    accessory_id: input.accessory_id,
    quantity_received: input.quantity,
    quantity_remaining: input.quantity,
    unit_cost: input.unit_cost,
    effective_date: eff,
    source: input.source ?? "IN",
    note: input.note ?? "",
  }).select().single();
  if (error) throw error;
  return data;
}

// Consume `qty` from an accessory's lots in FIFO or LIFO order.
// Throws if insufficient stock. Optionally restrict to a single lot (lotId).
// Returns the lots touched with amounts consumed (for optional cost tracking later).
export async function consumeStock(
  accessory_id: string,
  qty: number,
  method: "fifo" | "lifo",
  lotId?: string
): Promise<{ lot_id: string; consumed: number; unit_cost: number }[]> {
  let lots = await getLots(accessory_id);
  if (lotId) {
    lots = lots.filter((l) => l.id === lotId);
  } else {
    lots.sort((a, b) => {
      const t = new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime();
      return method === "fifo" ? t : -t;
    });
  }

  const available = lots.reduce((s, l) => s + Number(l.quantity_remaining), 0);
  if (qty > available) {
    throw new Error(`สต็อคไม่พอ: ต้องการ ${qty} มีเพียง ${available}`);
  }

  const touched: { lot_id: string; consumed: number; unit_cost: number }[] = [];
  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const avail = Number(lot.quantity_remaining);
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);
    const { error } = await supabase
      .from("accessory_lots")
      .update({ quantity_remaining: avail - take })
      .eq("id", lot.id);
    if (error) throw error;
    touched.push({ lot_id: lot.id, consumed: take, unit_cost: Number(lot.unit_cost) });
    remaining -= take;
  }
  return touched;
}

// Adjust a specific lot's remaining quantity to an exact value (for corrections).
export async function adjustLot(lotId: string, newRemaining: number): Promise<void> {
  if (newRemaining < 0) throw new Error("จำนวนต้องไม่ติดลบ");
  const { error } = await supabase
    .from("accessory_lots")
    .update({ quantity_remaining: newRemaining })
    .eq("id", lotId);
  if (error) throw error;
}

// ── Stock Updater (bulk update existing accessories by matching) ─────

export type UpdatableField = "quantity" | "min_quantity" | "unit_cost" | "description" | "supplier" | "unit" | "acc_code";

// Build a code-aware match index over existing accessories.
// Two key shapes: C = type|code|description|color|size ; D = type|description|color|size.
// `size` is appended as a TIEBREAKER: it's blank on ~98% of rows (a no-op there,
// identical to matching without it), but on the ~2% that carry a size it separates
// otherwise-identical size-variants (e.g. the same zip in 5/6/7 นิ้ว) that would
// otherwise collide as false "duplicates". Appending a field can only split groups,
// never merge them, so it introduces no new collisions. This also makes the updater
// consistent with the importer's dedupe (IMPORT_MATCH_FIELDS / getDuplicateMap),
// both of which already include size.
const dKey = (a: { type: string; description: string; color: string; size: string }): string => {
  const n = (v: string) => normalizeForMatch(v);
  return `D|${n(a.type)}|${n(a.description)}|${n(a.color)}|${n(a.size)}`;
};
const cKey = (a: { type: string; acc_code: string; description: string; color: string; size: string }): string => {
  const n = (v: string) => normalizeForMatch(v);
  return `C|${n(a.type)}|${n(a.acc_code)}|${n(a.description)}|${n(a.color)}|${n(a.size)}`;
};

// Keys under which an EXISTING accessory is indexed. A coded item is reachable both
// by its precise C-key AND by a code-less D-key, so an update-sheet row that omits
// the code can still match it (matched only when the D-fields are unambiguous).
function accessoryIndexKeys(a: { type: string; acc_code: string; description: string; color: string; size: string }): string[] {
  return a.acc_code.trim() ? [cKey(a), dKey(a)] : [dKey(a)];
}

export async function buildAccessoryMatchIndex(): Promise<Map<string, Accessory[]>> {
  const accs = await getAccessories();
  const map = new Map<string, Accessory[]>();
  for (const a of accs) {
    for (const k of accessoryIndexKeys(a)) {
      const arr = map.get(k) ?? [];
      arr.push(a);
      map.set(k, arr);
    }
  }
  return map;
}

// A sheet row's single lookup key: with a code it must match a coded item exactly
// (C-key); without a code it matches by D-fields, reaching coded items too.
export function matchKeyForRow(r: { type: string; acc_code: string; description: string; color: string; size: string }): string {
  return r.acc_code.trim() ? cKey(r) : dKey(r);
}

// Apply a bulk update to matched accessories. Each entry pairs an accessory id
// with the sheet row's values. `fields` selects which columns to write (the "mode").
// If "quantity" is included, the accessory's lots are REPLACED with one opening lot.
export async function applyStockUpdates(
  updates: {
    accessory_id: string;
    quantity?: number;
    min_quantity?: number;
    unit_cost?: number;      // sheet price (for the replacement lot / field)
    description?: string;
    unit?: string;
    acc_code?: string;
    supplier_id?: string | null;
    current_unit_cost: number; // fallback price if sheet has none
    sheet_has_price: boolean;
  }[],
  fields: UpdatableField[]
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  for (const u of updates) {
    try {
      // 1. Build the master-field patch from selected columns
      const patch: Record<string, any> = {};
      if (fields.includes("min_quantity") && u.min_quantity !== undefined) patch.min_quantity = u.min_quantity;
      if (fields.includes("unit_cost") && u.unit_cost !== undefined) patch.unit_cost = u.unit_cost;
      if (fields.includes("description") && u.description !== undefined) patch.description = u.description;
      if (fields.includes("unit") && u.unit !== undefined) patch.unit = u.unit;
      // acc_code may be intentionally set to "" (to clear a wrongly-stored code)
      if (fields.includes("acc_code") && u.acc_code !== undefined) patch.acc_code = u.acc_code;
      if (fields.includes("supplier") && u.supplier_id !== undefined) patch.supplier_id = u.supplier_id;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("accessories").update(patch).eq("id", u.accessory_id);
        if (error) throw error;
      }

      // 2. If stock is being updated → wipe existing lots, create one opening lot
      if (fields.includes("quantity") && u.quantity !== undefined) {
        const { error: delErr } = await supabase.from("accessory_lots").delete().eq("accessory_id", u.accessory_id);
        if (delErr) throw delErr;
        if (u.quantity > 0) {
          const lotPrice = u.sheet_has_price ? (u.unit_cost ?? 0) : u.current_unit_cost;
          const { error: lotErr } = await supabase.from("accessory_lots").insert({
            accessory_id: u.accessory_id,
            quantity_received: u.quantity,
            quantity_remaining: u.quantity,
            unit_cost: lotPrice,
            source: "MIGRATION",
            note: "อัปเดตสต็อค",
          });
          if (lotErr) throw lotErr;
        }
        // keep accessories.quantity mirror roughly in sync (not authoritative)
        await supabase.from("accessories").update({ quantity: u.quantity }).eq("id", u.accessory_id);
      }

      updated += 1;
    } catch (e: any) {
      errors.push(`${u.accessory_id}: ${e.message ?? "error"}`);
    }
  }
  return { updated, errors };
}
