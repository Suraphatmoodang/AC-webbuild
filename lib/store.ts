import { supabase } from "./supabase";

export type Accessory = {
  id: string;
  type: string;
  acc_code: string;        // Required per data dict
  description: string;
  row: number | null;
  color: string;
  size: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  min_quantity: number;
  supplier: string;        // NEW
  is_active: boolean;      // NEW
  created_at: string;
  updated_at: string;
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
  let q = supabase.from("accessories").select("*").order("type").order("description");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
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

// ── Transactions ──────────────────────────────────────────────

export async function getTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("accessory_transactions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
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
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .order("supplier_name");
  if (error) throw error;
  return data ?? [];
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
