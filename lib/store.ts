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
  is_active: boolean;
  created_at: string;
  updated_at: string;
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

export async function addTransaction(
  accessory_id: string,
  type: Transaction["transaction_type"],
  qty: number,
  reference_no: string,
  note: string,
  created_by: string
): Promise<{ accessory: Accessory; transaction: Transaction } | { error: string }> {
  const { data: acc, error: fetchErr } = await supabase
    .from("accessories")
    .select("*")
    .eq("id", accessory_id)
    .single();

  if (fetchErr || !acc) return { error: "ไม่พบรายการ" };

  const before = Number(acc.quantity);
  let after = before;
  let txQty = qty;

  if (type === "IN" || type === "RETURN") { after = before + qty; txQty = qty; }
  else if (type === "OUT")  { after = before - qty; txQty = qty; }
  else if (type === "ADJUST") { after = qty; txQty = qty - before; }

  if (after < 0) return { error: "สต็อคไม่พอ" };

  const { data: updatedAcc, error: updateErr } = await supabase
    .from("accessories")
    .update({ quantity: after })
    .eq("id", accessory_id)
    .select()
    .single();
  if (updateErr) return { error: updateErr.message };

  const { data: tx, error: txErr } = await supabase
    .from("accessory_transactions")
    .insert({ accessory_id, transaction_type: type, quantity: txQty,
      quantity_before: before, quantity_after: after,
      reference_no: reference_no ?? "", note: note ?? "", created_by: created_by ?? "" })
    .select()
    .single();
  if (txErr) return { error: txErr.message };

  return { accessory: updatedAcc, transaction: tx };
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
  rows: (ImportRow & { overwriteId?: string })[]
): Promise<{ approved: number; errors: string[] }> {
  const errors: string[] = [];
  let approved = 0;

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
        quantity: r.quantity,                              // stock IS imported
        unit: r.unit,
        unit_cost: r.unit_cost,
        min_quantity: r.min_quantity > 0 ? r.min_quantity : 10,
        supplier_id,
        is_active: true,
      };

      if (r.overwriteId) {
        // Overwrite ALL data on the existing accessory
        const { error: updErr } = await supabase.from("accessories").update(fields).eq("id", r.overwriteId);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from("accessories").insert(fields);
        if (insErr) throw insErr;
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
