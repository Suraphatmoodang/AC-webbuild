import { supabase } from "./supabase";

// Product catalog (สินค้า) — a reusable master list of garment definitions following
// the "add product" Excel spec. An order (product_costings) references a product via
// product_costings.product_id and copies its spec fields in, so past orders stay
// stable even if the product is later edited or removed (the link is a soft grouping,
// not a hard FK). This is what makes logging a new order fast: pick a product and the
// garment attributes fill themselves.
//
// Backing table — run in Supabase BEFORE deploying (no sql/ folder; see CLAUDE.md):
//
//   create table if not exists products (
//     id uuid primary key default gen_random_uuid(),
//     style_no text not null default '',
//     description text not null default '',
//     brand text not null default '',
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
//     note text not null default '',
//     is_active boolean not null default true,
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now()
//   );
//   alter table product_costings add column if not exists product_id uuid;

export type Product = {
  id: string;
  style_no: string;
  description: string;
  brand: string;
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
  note: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductInput = Omit<Product, "id" | "created_at" | "updated_at">;

export function emptyProductInput(): ProductInput {
  return {
    style_no: "", description: "", brand: "",
    product_category: "", product_type: "", gender: "", product_group: "", fabric_type: "",
    length_type: "", neck: "", collar: "", fit: "", opening: "", has_hood: "", has_pocket: "",
    note: "", is_active: true,
  };
}

export async function getProducts(activeOnly = false): Promise<Product[]> {
  const all: Product[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("products").select("*").order("style_no").order("product_type").range(from, from + PAGE - 1);
    if (activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Product[]));
    if (data.length < PAGE) break;
  }
  return all;
}

export async function addProduct(input: ProductInput): Promise<Product> {
  const { data, error } = await supabase.from("products").insert(input).select().single();
  if (error) throw error;
  return data as Product;
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
  const { data, error } = await supabase
    .from("products")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Product;
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}

// A short human label for a product, for dropdowns and lists.
export function productLabel(p: Product): string {
  return [p.style_no, p.product_type, p.description].filter((x) => String(x).trim()).join(" · ") || "(ไม่มีชื่อ)";
}
