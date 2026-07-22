import { supabase } from "./supabase";

// Fabric side (ผ้า) — an independent mirror of lib/store.ts over the `fabrics`,
// `fabric_lots`, `fabric_transactions`, `fabric_imports` and `fabric_suppliers`
// tables. Same lot-based (FIFO/LIFO) model and staging→approval import flow as
// accessories. NO rows are shared with the accessory side.
//
// Suppliers used to be the one shared table; they are now split — fabric suppliers
// live in `fabric_suppliers` and are unrelated to the accessory `suppliers` rows.
// The row SHAPE is identical, so the `Supplier` type is still re-used (type only,
// no runtime coupling). The helpers below deliberately keep the same names as the
// accessory store's, so a fabric page importing `getSuppliers` from THIS module
// gets fabric suppliers.
export type { Supplier } from "./store";
import type { Supplier } from "./store";

export type Fabric = {
  id: string;
  fabric_type: string;      // ชนิดผ้า — the fabric's name/kind, top of the hierarchy
  composition: string;      // เส้นใย
  construction: string;     // โครงสร้าง
  color: string;            // สี
  width: string;            // หน้าผ้า — text: values include "73.5" and "32T", "35 1/2T"
  weight: number;           // น้ำหนัก
  weight_unit: string;      // หน่วยน้ำหนัก (gm2)
  row_label: string;        // แถว — text: "A1", "B1"
  fabric_code: string;      // เลขที่
  quantity: number;         // mirror of the lot total; lots are authoritative
  unit: string;             // หน่วยสต็อค (กก / หลา / เมตร)
  unit_cost: number;        // reference price on the fabric (lots hold the real cost)
  cost_unit: string;        // หน่วยที่ราคาอิงอยู่
  min_quantity: number;
  supplier_id: string | null;   // FK → fabric_suppliers.id (NOT the accessory suppliers table)
  valuation_method: "fifo" | "lifo";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FabricLot = {
  id: string;
  fabric_id: string;
  quantity_received: number;
  quantity_remaining: number;
  unit_cost: number;
  effective_date: string;
  created_at: string;
  source: "IN" | "RETURN" | "MIGRATION" | "ADJUST";
  note: string;
};

export type FabricImportRow = {
  id: string;
  batch_id: string;
  status: "pending" | "approved" | "rejected";
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
  created_at: string;
  approved_at: string | null;
};

// What a transaction did to lots, recorded at write time so it can be replayed in
// reverse by revertFabricTransaction (exact undo).
export type FabricLotEffect =
  | { op: "create"; lot_id: string; quantity: number }
  | { op: "consume"; lots: { lot_id: string; consumed: number }[] }
  | { op: "adjust"; lot_id: string; before: number; after: number };

export type FabricTransaction = {
  id: string;
  fabric_id: string;
  transaction_type: "IN" | "OUT" | "ADJUST" | "RETURN";
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference_no: string;
  note: string;
  created_by: string;
  created_at: string;
  lot_effects?: FabricLotEffect | null;
};

// ── Fabric suppliers ─────────────────────────────────────
// Independent of the accessory `suppliers` table — same columns, different rows.
// Named to match the accessory store so fabric pages import `getSuppliers` and get
// these. Mirrors lib/store.ts's supplier helpers.

export async function getSuppliers(): Promise<Supplier[]> {
  const all: Supplier[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("fabric_suppliers")
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
  const { data, error } = await supabase.from("fabric_suppliers").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateSupplier(
  id: string,
  input: Partial<Omit<Supplier, "id" | "created_at" | "updated_at">>
): Promise<Supplier> {
  const { data, error } = await supabase
    .from("fabric_suppliers").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSupplier(id: string): Promise<void> {
  const { error } = await supabase.from("fabric_suppliers").delete().eq("id", id);
  if (error) throw error;
}

export async function bulkDeleteSuppliers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from("fabric_suppliers").delete().in("id", slice);
    if (error) throw error;
  }
}

// ── Fabrics ──────────────────────────────────────────────

export async function getFabrics(activeOnly = false): Promise<Fabric[]> {
  // Supabase caps a single query at 1000 rows; page through to load them all.
  const all: Fabric[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("fabrics").select("*").order("fabric_type").order("color").range(from, from + PAGE - 1);
    if (activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

export async function addFabric(
  input: Omit<Fabric, "id" | "created_at" | "updated_at">
): Promise<Fabric> {
  const { data, error } = await supabase.from("fabrics").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateFabric(
  id: string,
  input: Partial<Omit<Fabric, "id" | "created_at" | "updated_at">>
): Promise<Fabric> {
  const { data, error } = await supabase.from("fabrics").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFabric(id: string): Promise<void> {
  const { error } = await supabase.from("fabrics").delete().eq("id", id);
  if (error) throw error;
}

// Bulk delete fabrics. Items with transaction history are blocked by the DB
// foreign key (ON DELETE RESTRICT); we detect those up front and skip them,
// returning which ids were deleted vs. blocked so the UI can offer deactivation.
export async function bulkDeleteFabrics(
  ids: string[]
): Promise<{ deleted: string[]; blocked: string[] }> {
  if (ids.length === 0) return { deleted: [], blocked: [] };

  const blockedSet = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("fabric_transactions")
      .select("fabric_id")
      .in("fabric_id", slice);
    if (error) throw error;
    for (const r of data ?? []) blockedSet.add(r.fabric_id);
  }

  const deletable = ids.filter((id) => !blockedSet.has(id));
  for (let i = 0; i < deletable.length; i += CHUNK) {
    const slice = deletable.slice(i, i + CHUNK);
    const { error } = await supabase.from("fabrics").delete().in("id", slice);
    if (error) throw error;
  }

  return { deleted: deletable, blocked: Array.from(blockedSet) };
}

export async function bulkDeactivateFabrics(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from("fabrics").update({ is_active: false }).in("id", slice);
    if (error) throw error;
  }
}

// ── Transactions ──────────────────────────────────────────────

export async function getFabricTransactions(): Promise<FabricTransaction[]> {
  const all: FabricTransaction[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("fabric_transactions")
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

export async function getFabricTransactionsByFabric(fabric_id: string): Promise<FabricTransaction[]> {
  const { data, error } = await supabase
    .from("fabric_transactions")
    .select("*")
    .eq("fabric_id", fabric_id)
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
export async function addFabricTransaction(opts: {
  fabric_id: string;
  type: FabricTransaction["transaction_type"];
  qty: number;                       // IN/OUT/RETURN: amount; ADJUST: target remaining for the lot
  unit_cost?: number;                // IN/RETURN
  lot_id?: string;                   // OUT (restrict to lot) / ADJUST (which lot)
  return_position?: "front" | "back" | "date";  // RETURN
  return_date?: string;              // RETURN when position = "date"
  reference_no?: string;
  note?: string;
  created_by?: string;
}): Promise<{ ok: true; before: number; after: number } | { error: string }> {
  const { fabric_id, type, qty } = opts;
  try {
    const { data: fab, error: fetchErr } = await supabase
      .from("fabrics").select("*").eq("id", fabric_id).single();
    if (fetchErr || !fab) return { error: "ไม่พบรายการ" };
    const method: "fifo" | "lifo" = fab.valuation_method === "lifo" ? "lifo" : "fifo";

    const lotsBefore = await getFabricLots(fabric_id);
    const before = stockFromLots(lotsBefore);
    let txQty = qty;
    let effect: FabricLotEffect | null = null;   // recorded so the tx can be reverted exactly

    if (type === "IN" || type === "RETURN") {
      let effective = new Date().toISOString();
      if (type === "RETURN") {
        const sorted = [...lotsBefore].sort((a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime());
        if (opts.return_position === "front" && sorted.length > 0) {
          effective = new Date(new Date(sorted[0].effective_date).getTime() - 1000).toISOString();
        } else if (opts.return_position === "date" && opts.return_date) {
          effective = new Date(opts.return_date).toISOString();
        } // "back" or default → now (newest)
      }
      const newLot = await createFabricLot({
        fabric_id, quantity: qty, unit_cost: opts.unit_cost ?? 0,
        effective_date: effective, source: type === "RETURN" ? "RETURN" : "IN",
        note: opts.note ?? "",
      });
      effect = { op: "create", lot_id: newLot.id, quantity: qty };
      txQty = qty;
    } else if (type === "OUT") {
      const touched = await consumeFabricStock(fabric_id, qty, method, opts.lot_id);
      effect = { op: "consume", lots: touched.map((t) => ({ lot_id: t.lot_id, consumed: t.consumed })) };
      txQty = qty;
    } else if (type === "ADJUST") {
      if (!opts.lot_id) return { error: "กรุณาเลือกล็อตที่ต้องการปรับ" };
      const target = lotsBefore.find((l) => l.id === opts.lot_id);
      if (!target) return { error: "ไม่พบล็อต" };
      txQty = qty - Number(target.quantity_remaining);
      effect = { op: "adjust", lot_id: opts.lot_id, before: Number(target.quantity_remaining), after: qty };
      await adjustFabricLot(opts.lot_id, qty);
    }

    const lotsAfter = await getFabricLots(fabric_id);
    const after = stockFromLots(lotsAfter);

    const payload = { fabric_id, transaction_type: type, quantity: txQty,
      quantity_before: before, quantity_after: after,
      reference_no: opts.reference_no ?? "", note: opts.note ?? "", created_by: opts.created_by ?? "",
      lot_effects: effect };
    let { error: txErr } = await supabase.from("fabric_transactions").insert(payload);
    // Graceful fallback: if the lot_effects column hasn't been migrated yet, still
    // record the transaction (it just won't be revertible).
    if (txErr && /lot_effects/i.test(txErr.message)) {
      const { lot_effects, ...rest } = payload;
      ({ error: txErr } = await supabase.from("fabric_transactions").insert(rest));
    }
    if (txErr) return { error: txErr.message };

    // Keep the fabrics.quantity mirror roughly in sync (not authoritative).
    await supabase.from("fabrics").update({ quantity: after }).eq("id", fabric_id);

    return { ok: true, before, after };
  } catch (e: any) {
    return { error: e.message ?? "เกิดข้อผิดพลาด" };
  }
}

// Revert a transaction — exact undo: replay its recorded `lot_effects` in reverse,
// then delete the transaction row. LATEST-ONLY: allowed only when this is the most
// recent transaction for its fabric, which guarantees no later movement has touched
// the lots it affected (so the reversal is exact and safe).
export async function revertFabricTransaction(
  transactionId: string
): Promise<{ ok: true } | { error: string }> {
  try {
    const { data: tx, error: txErr } = await supabase
      .from("fabric_transactions").select("*").eq("id", transactionId).single();
    if (txErr || !tx) return { error: "ไม่พบรายการ" };

    // Must be the latest transaction for this fabric.
    const { data: latest } = await supabase
      .from("fabric_transactions").select("id")
      .eq("fabric_id", tx.fabric_id)
      .order("created_at", { ascending: false }).limit(1).single();
    if (!latest || latest.id !== tx.id) {
      return { error: "ย้อนได้เฉพาะรายการล่าสุดของผ้าชิ้นนี้" };
    }

    const effect = tx.lot_effects as FabricLotEffect | null | undefined;
    if (!effect) return { error: "รายการนี้ไม่มีข้อมูลล็อตสำหรับย้อน (บันทึกก่อนเปิดฟีเจอร์)" };

    if (effect.op === "create") {
      const { error } = await supabase.from("fabric_lots").delete().eq("id", effect.lot_id);
      if (error) throw error;
    } else if (effect.op === "consume") {
      for (const e of effect.lots) {
        const { data: lot, error: getErr } = await supabase
          .from("fabric_lots").select("quantity_remaining").eq("id", e.lot_id).single();
        if (getErr) throw getErr;
        if (!lot) continue; // lot gone (shouldn't happen for the latest tx) — skip
        const { error } = await supabase.from("fabric_lots")
          .update({ quantity_remaining: Number(lot.quantity_remaining) + e.consumed })
          .eq("id", e.lot_id);
        if (error) throw error;
      }
    } else if (effect.op === "adjust") {
      const { error } = await supabase.from("fabric_lots")
        .update({ quantity_remaining: effect.before }).eq("id", effect.lot_id);
      if (error) throw error;
    }

    const { error: delErr } = await supabase.from("fabric_transactions").delete().eq("id", tx.id);
    if (delErr) throw delErr;

    // Re-sync the mirror column from the restored lots.
    const restored = stockFromLots(await getFabricLots(tx.fabric_id));
    await supabase.from("fabrics").update({ quantity: restored }).eq("id", tx.fabric_id);

    return { ok: true };
  } catch (e: any) {
    return { error: e.message ?? "เกิดข้อผิดพลาด" };
  }
}

// ── Imports (staging) ──────────────────────────────────────────

// Fields that define an "exact" import row for dedupe purposes.
// NOTE: quantity and min_quantity are intentionally EXCLUDED — the same fabric
// with a different stock level is still the same fabric, so it should be flagged
// as a duplicate rather than treated as a new entry.
const IMPORT_MATCH_FIELDS = [
  "fabric_type", "composition", "construction", "color", "width",
  "weight", "weight_unit", "row_label", "fabric_code",
  "unit", "unit_cost", "cost_unit", "supplier_name", "contact_person",
  "contact_number", "contact_email", "address", "city", "country",
  "postal_code", "lead_time", "payment_term", "tax_id",
] as const;

// Normalize a value for matching: trim ends AND collapse internal runs of
// whitespace to a single space. Catches duplicates that differ only by
// inconsistent spacing.
function normalizeForMatch(v: any): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

function importRowKey(r: Record<string, any>): string {
  return IMPORT_MATCH_FIELDS.map((f) => normalizeForMatch(r[f])).join(String.fromCharCode(1));
}

export async function createFabricImportBatch(
  rows: Omit<FabricImportRow, "id" | "batch_id" | "status" | "created_at" | "approved_at">[]
): Promise<{ batch_id: string; count: number; skipped: number }> {
  const batch_id = crypto.randomUUID();

  // 1. Load keys of all rows already pending in staging, so a re-upload of
  //    identical rows doesn't create duplicates in the review queue.
  const existing = await getPendingFabricImports();
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
    const { error } = await supabase.from("fabric_imports").insert(slice);
    if (error) throw error;
  }
  return { batch_id, count: payload.length, skipped };
}

export async function getPendingFabricImports(): Promise<FabricImportRow[]> {
  const all: FabricImportRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("fabric_imports")
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
export async function getApprovedFabricImports(): Promise<FabricImportRow[]> {
  const all: FabricImportRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("fabric_imports")
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

// Stage a single manually-added fabric into the approval queue.
export async function stageFabric(
  input: Omit<FabricImportRow, "id" | "batch_id" | "status" | "created_at" | "approved_at">
): Promise<{ skipped: boolean }> {
  const existing = await getPendingFabricImports();
  const seen = new Set(existing.map((r) => importRowKey(r)));
  if (seen.has(importRowKey(input))) return { skipped: true };

  const { error } = await supabase
    .from("fabric_imports")
    .insert({ ...input, batch_id: crypto.randomUUID(), status: "pending" });
  if (error) throw error;
  return { skipped: false };
}

// Edit a pending staging row before approval (fix typos, wrong numbers, etc.).
export async function updateFabricImportRow(
  id: string,
  input: Partial<Omit<FabricImportRow, "id" | "batch_id" | "status" | "created_at" | "approved_at">>
): Promise<FabricImportRow> {
  const { data, error } = await supabase
    .from("fabric_imports").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

// Rejecting deletes the staging rows outright — they're noise once rejected.
export async function rejectFabricImports(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from("fabric_imports").delete().in("id", slice);
    if (error) throw error;
  }
}

// Approve staging rows. Each row may carry an optional `overwriteId`:
//   - no overwriteId → insert as a NEW fabric (imported stock included)
//   - overwriteId set → UPDATE that existing fabric, overwriting ALL data
export async function approveFabricImports(
  rows: (FabricImportRow & { overwriteId?: string })[],
  onProgress?: (done: number, total: number) => void   // writing is sequential/slow
): Promise<{ approved: number; errors: string[] }> {
  const errors: string[] = [];
  let approved = 0;
  let done = 0;

  // Match supplier names against existing FABRIC suppliers only — never auto-create.
  // (Was matching the accessory `suppliers` table, which is why staged fabric rows
  //  carrying a supplier_name never linked and left supplier_id null.)
  const { data: existingSuppliers } = await supabase.from("fabric_suppliers").select("id, supplier_name");
  const supplierMap = new Map<string, string>(
    (existingSuppliers ?? []).map((s: any) => [normalizeForMatch(s.supplier_name), s.id])
  );

  for (const r of rows) {
    try {
      let supplier_id: string | null = null;
      const sKey = normalizeForMatch(r.supplier_name);
      if (sKey && supplierMap.has(sKey)) supplier_id = supplierMap.get(sKey)!;

      const fields = {
        fabric_type: r.fabric_type,
        composition: r.composition,
        construction: r.construction,
        color: r.color,
        width: r.width,
        weight: r.weight,
        weight_unit: r.weight_unit,
        row_label: r.row_label,
        fabric_code: r.fabric_code,
        unit: r.unit,
        unit_cost: r.unit_cost,        // reference price (lots hold the real cost)
        cost_unit: r.cost_unit,
        min_quantity: r.min_quantity > 0 ? r.min_quantity : 10,
        supplier_id,
        is_active: true,
      };

      if (r.overwriteId) {
        // Overwrite master data on the existing fabric. Existing LOTS are left
        // untouched — the item already has real stock history.
        const { error: updErr } = await supabase.from("fabrics")
          .update({ ...fields, quantity: r.quantity }).eq("id", r.overwriteId);
        if (updErr) throw updErr;
      } else {
        // New fabric: insert, then create its opening lot from the imported
        // stock + price (dated today). This is how the migration seeds stock.
        const { data: newFab, error: insErr } = await supabase.from("fabrics")
          .insert({ ...fields, quantity: r.quantity }).select("id").single();
        if (insErr) throw insErr;

        if (Number(r.quantity) > 0) {
          const { error: lotErr } = await supabase.from("fabric_lots").insert({
            fabric_id: newFab.id,
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
        .from("fabric_imports")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", r.id);
      if (markErr) throw markErr;

      approved += 1;
    } catch (e: any) {
      errors.push(`${r.fabric_type} ${r.color}: ${e.message ?? "error"}`);
    }
    onProgress?.(++done, rows.length);
  }

  return { approved, errors };
}

// Build a map of "fabric_type|fabric_code|color|width" → matching existing fabrics,
// so the review page can both flag duplicates and show them for comparison.
export async function getFabricDuplicateMap(): Promise<Map<string, Fabric[]>> {
  const map = new Map<string, Fabric[]>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("fabrics").select("*").range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const f of data as Fabric[]) {
      const key = `${f.fabric_type}|${f.fabric_code}|${f.color}|${f.width}`;
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    if (data.length < PAGE) break;
  }
  return map;
}

// ── Lots (FIFO/LIFO inventory) ─────────────────────────────────

// Fetch all lots, paged past the 1000-row cap. Optionally for one fabric.
export async function getFabricLots(fabricId?: string): Promise<FabricLot[]> {
  const all: FabricLot[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("fabric_lots").select("*").order("effective_date").range(from, from + PAGE - 1);
    if (fabricId) q = q.eq("fabric_id", fabricId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

// Build a map of fabric_id → its lots (sorted by effective_date ascending).
export async function getFabricLotMap(): Promise<Map<string, FabricLot[]>> {
  const lots = await getFabricLots();
  const map = new Map<string, FabricLot[]>();
  for (const l of lots) {
    const arr = map.get(l.fabric_id) ?? [];
    arr.push(l);
    map.set(l.fabric_id, arr);
  }
  Array.from(map.values()).forEach((arr) =>
    arr.sort((a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime()));
  return map;
}

// Derive total stock and value for a fabric from its lots.
export function stockFromLots(lots: FabricLot[]): number {
  return lots.reduce((s, l) => s + Number(l.quantity_remaining), 0);
}
export function valueFromLots(lots: FabricLot[]): number {
  return lots.reduce((s, l) => s + Number(l.quantity_remaining) * Number(l.unit_cost), 0);
}

// Create a new lot (used by IN, RETURN, MIGRATION).
export async function createFabricLot(input: {
  fabric_id: string;
  quantity: number;
  unit_cost: number;
  effective_date?: string;      // defaults to now
  source?: FabricLot["source"];
  note?: string;
}): Promise<FabricLot> {
  const eff = input.effective_date ?? new Date().toISOString();
  const { data, error } = await supabase.from("fabric_lots").insert({
    fabric_id: input.fabric_id,
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

// Overwrite a fabric's total stock: wipe every existing lot and (when quantity > 0)
// create a single opening lot at `unit_cost`. Used by the manage page's stock edit.
// NOTE: this replaces the item's lot layering / price history.
export async function overwriteFabricStock(
  fabric_id: string,
  quantity: number,
  unit_cost: number
): Promise<void> {
  const { error: delErr } = await supabase.from("fabric_lots").delete().eq("fabric_id", fabric_id);
  if (delErr) throw delErr;
  if (quantity > 0) {
    const { error: lotErr } = await supabase.from("fabric_lots").insert({
      fabric_id,
      quantity_received: quantity,
      quantity_remaining: quantity,
      unit_cost,
      source: "MIGRATION",
      note: "แก้ไขสต็อก (เขียนทับ)",
    });
    if (lotErr) throw lotErr;
  }
  const { error: mirErr } = await supabase.from("fabrics").update({ quantity }).eq("id", fabric_id);
  if (mirErr) throw mirErr;
}

// Consume `qty` from a fabric's lots in FIFO or LIFO order.
// Throws if insufficient stock. Optionally restrict to a single lot (lotId).
export async function consumeFabricStock(
  fabric_id: string,
  qty: number,
  method: "fifo" | "lifo",
  lotId?: string
): Promise<{ lot_id: string; consumed: number; unit_cost: number }[]> {
  let lots = await getFabricLots(fabric_id);
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
      .from("fabric_lots").update({ quantity_remaining: avail - take }).eq("id", lot.id);
    if (error) throw error;
    touched.push({ lot_id: lot.id, consumed: take, unit_cost: Number(lot.unit_cost) });
    remaining -= take;
  }
  return touched;
}

// Adjust a specific lot's remaining quantity to an exact value (for corrections).
export async function adjustFabricLot(lotId: string, newRemaining: number): Promise<void> {
  if (newRemaining < 0) throw new Error("จำนวนต้องไม่ติดลบ");
  const { error } = await supabase
    .from("fabric_lots").update({ quantity_remaining: newRemaining }).eq("id", lotId);
  if (error) throw error;
}

// ── Stock Updater (bulk update existing fabrics by matching) ─────

export type FabricUpdatableField =
  | "quantity" | "min_quantity" | "unit_cost" | "unit" | "cost_unit"
  | "composition" | "construction" | "weight" | "width" | "row_label" | "supplier";

// Build a code-aware match index over existing fabrics.
// Two key shapes: C = type|code|color|width ; D = type|construction|color|width.
// A row that carries เลขที่ matches precisely on the code; one that omits it falls
// back to the descriptive fields. Appending a field can only split groups, never
// merge them, so the extra discriminators introduce no new collisions.
const dKey = (f: { fabric_type: string; construction: string; color: string; width: string }): string => {
  const n = (v: string) => normalizeForMatch(v);
  return `D|${n(f.fabric_type)}|${n(f.construction)}|${n(f.color)}|${n(f.width)}`;
};
const cKey = (f: { fabric_type: string; fabric_code: string; color: string; width: string }): string => {
  const n = (v: string) => normalizeForMatch(v);
  return `C|${n(f.fabric_type)}|${n(f.fabric_code)}|${n(f.color)}|${n(f.width)}`;
};

// Keys under which an EXISTING fabric is indexed. A coded item is reachable both by
// its precise C-key AND by a code-less D-key, so an update-sheet row that omits the
// code can still match it (matched only when the D-fields are unambiguous).
function fabricIndexKeys(f: {
  fabric_type: string; fabric_code: string; construction: string; color: string; width: string;
}): string[] {
  return f.fabric_code.trim() ? [cKey(f), dKey(f)] : [dKey(f)];
}

export async function buildFabricMatchIndex(): Promise<Map<string, Fabric[]>> {
  const fabs = await getFabrics();
  const map = new Map<string, Fabric[]>();
  for (const f of fabs) {
    for (const k of fabricIndexKeys(f)) {
      const arr = map.get(k) ?? [];
      arr.push(f);
      map.set(k, arr);
    }
  }
  return map;
}

// A sheet row's single lookup key: with a code it must match a coded item exactly
// (C-key); without a code it matches by D-fields, reaching coded items too.
export function fabricMatchKeyForRow(r: {
  fabric_type: string; fabric_code: string; construction: string; color: string; width: string;
}): string {
  return r.fabric_code.trim() ? cKey(r) : dKey(r);
}

// Apply a bulk update to matched fabrics. Each entry pairs a fabric id with the
// sheet row's values. `fields` selects which columns to write (the "mode").
// If "quantity" is included, the fabric's lots are REPLACED with one opening lot.
export async function applyFabricUpdates(
  updates: {
    fabric_id: string;
    quantity?: number;
    min_quantity?: number;
    unit_cost?: number;      // sheet price (for the replacement lot / field)
    unit?: string;
    cost_unit?: string;
    composition?: string;
    construction?: string;
    weight?: number;
    width?: string;
    row_label?: string;
    supplier_id?: string | null;
    current_unit_cost: number; // fallback price if sheet has none
    sheet_has_price: boolean;
  }[],
  fields: FabricUpdatableField[]
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  for (const u of updates) {
    try {
      // 1. Build the master-field patch from selected columns
      const patch: Record<string, any> = {};
      if (fields.includes("min_quantity") && u.min_quantity !== undefined) patch.min_quantity = u.min_quantity;
      if (fields.includes("unit_cost") && u.unit_cost !== undefined) patch.unit_cost = u.unit_cost;
      if (fields.includes("unit") && u.unit !== undefined) patch.unit = u.unit;
      if (fields.includes("cost_unit") && u.cost_unit !== undefined) patch.cost_unit = u.cost_unit;
      if (fields.includes("composition") && u.composition !== undefined) patch.composition = u.composition;
      if (fields.includes("construction") && u.construction !== undefined) patch.construction = u.construction;
      if (fields.includes("weight") && u.weight !== undefined) patch.weight = u.weight;
      if (fields.includes("width") && u.width !== undefined) patch.width = u.width;
      if (fields.includes("row_label") && u.row_label !== undefined) patch.row_label = u.row_label;
      if (fields.includes("supplier") && u.supplier_id !== undefined) patch.supplier_id = u.supplier_id;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("fabrics").update(patch).eq("id", u.fabric_id);
        if (error) throw error;
      }

      // 2. If stock is being updated → wipe existing lots, create one opening lot
      if (fields.includes("quantity") && u.quantity !== undefined) {
        const { error: delErr } = await supabase.from("fabric_lots").delete().eq("fabric_id", u.fabric_id);
        if (delErr) throw delErr;
        if (u.quantity > 0) {
          const lotPrice = u.sheet_has_price ? (u.unit_cost ?? 0) : u.current_unit_cost;
          const { error: lotErr } = await supabase.from("fabric_lots").insert({
            fabric_id: u.fabric_id,
            quantity_received: u.quantity,
            quantity_remaining: u.quantity,
            unit_cost: lotPrice,
            source: "MIGRATION",
            note: "อัปเดตสต็อค",
          });
          if (lotErr) throw lotErr;
        }
        await supabase.from("fabrics").update({ quantity: u.quantity }).eq("id", u.fabric_id);
      }

      updated += 1;
    } catch (e: any) {
      errors.push(`${u.fabric_id}: ${e.message ?? "error"}`);
    }
  }
  return { updated, errors };
}
