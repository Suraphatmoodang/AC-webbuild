// Garment-spec dropdown option lists, taken from the "add product" Excel. Shared by
// the products catalog (/costing/products) and the order editor (/costing/[id]) so
// both offer identical choices. These are the attributes that define a PRODUCT
// (the reusable garment), as opposed to order-specific data (customer, PO, qty, …).

export const PRODUCT_OPT = {
  category: ["Top ท่อนบน", "Bottom ท่อนล่าง", "Dress ชุดยาว", "ACC"],
  type: [
    "เสื้อโปโล", "Sweater", "เสื้อ bomber jacket", "เสื้อเชิ้ต", "เสื้อแจ็กเก็ต", "เสื้อกล้าม",
    "เสื้อกั๊ก", "เสื้อกีฬา", "เสื้อคอกลม", "เสื้อคอวี", "เสื้อช็อป", "เสื้อนอน", "เสื้อสครัป",
    "เสื้อหมวก", "กระโปรง", "กางเกง swim trunk", "กางเกงกระโปรง", "กางเกงขายาวเอวยางยืด",
    "กางเกงขายาวมีซิป", "กางเกงขาสั้นเอวยางยืด", "กางเกงขาสั้นมีซิป", "กางเกงนอน", "กางเกงวอร์ม",
    "กางเกงสครัป", "ชุดกระโปรง", "ถุงผ้า", "ปลอกหมอน",
  ],
  gender: ["unisex ผู้ใหญ่", "unisex เด็ก", "ผู้ชาย", "ผู้หญิง", "เด็กชาย", "เด็กหญิง"],
  group: ["Casual", "Sportswear", "Workwear"],
  fabricType: ["100% cotton", "Jersey", "Interlock", "Fleece"],
  length: ["แขนสั้น", "แขนยาว", "ขาสั้น", "ขายาว"],
  neck: ["โปโล", "คอกลม", "คอวี"],
  collar: ["ปกทอ", "ปกผ้าในตัว"],
  fit: ["Regular", "Oversize", "Fit", "Boxy", "Crop"],
  opening: ["กระดุม", "ซิป", "สแนป", "เชือก", "ตะขอ"],
  yesno: ["ไม่มี", "มี"],
};

// The garment-spec fields that a Product carries and that an order copies from it.
export const PRODUCT_SPEC_FIELDS = [
  "style_no", "description", "brand",
  "product_category", "product_type", "gender", "product_group", "fabric_type",
  "length_type", "neck", "collar", "fit", "opening", "has_hood", "has_pocket",
] as const;
export type ProductSpecField = (typeof PRODUCT_SPEC_FIELDS)[number];

// ── Creatable-dropdown options ───────────────────────────────────────
// The descriptive attribute fields are shown as a "type-or-pick" combobox (lib/combo):
// the user can choose a preset OR type a brand-new value. To keep the suggestion list
// growing, we fold in every distinct value already saved across the catalog so any
// previously typed custom entry becomes pickable next time. (has_hood/has_pocket stay
// a plain yes/no select — they're binary, not descriptive.)
export type ComboField =
  | "product_category" | "product_type" | "gender" | "product_group" | "fabric_type"
  | "length_type" | "neck" | "collar" | "fit" | "opening";

const COMBO_BASE: Record<ComboField, keyof typeof PRODUCT_OPT> = {
  product_category: "category", product_type: "type", gender: "gender",
  product_group: "group", fabric_type: "fabricType", length_type: "length",
  neck: "neck", collar: "collar", fit: "fit", opening: "opening",
};

// Base presets first (stable order), then any extra saved values appended, sorted (Thai).
export function mergedOptions(base: readonly string[], existing: (string | null | undefined)[]): string[] {
  const seen = new Set(base.map((b) => b.trim()));
  const extra: string[] = [];
  for (const v of existing) {
    const t = String(v ?? "").trim();
    if (t && !seen.has(t)) { seen.add(t); extra.push(t); }
  }
  extra.sort((a, b) => a.localeCompare(b, "th"));
  return [...base, ...extra];
}

// Build the option list for every combo field from a set of catalog/order rows.
export function buildComboOptions(items: Array<Record<string, any>>): Record<ComboField, string[]> {
  const out = {} as Record<ComboField, string[]>;
  (Object.keys(COMBO_BASE) as ComboField[]).forEach((f) => {
    out[f] = mergedOptions(PRODUCT_OPT[COMBO_BASE[f]], items.map((it) => it[f]));
  });
  return out;
}
