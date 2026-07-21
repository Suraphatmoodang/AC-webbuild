import type { Accessory } from "@/lib/store";
import type { Fabric } from "@/lib/fabric-store";

// Ordering of garment sizes (smallest → largest). "XXL" and "2XL" share a rank
// since the data uses both interchangeably.
const SIZE_RANK: Record<string, number> = {
  XXS: 0, "2XS": 1, XS: 2, S: 3, M: 4, L: 5, XL: 6,
  XXL: 7, "2XL": 7, XXXL: 8, "3XL": 8, "4XL": 9, "5XL": 10,
  "6XL": 11, "7XL": 12, "8XL": 13, "9XL": 14, "10XL": 15,
};

// Compare two size strings: known garment sizes by rank, otherwise
// numeric-aware locale compare (handles 40/2, 5นิ้ว, 23.8นิ้ว, …).
export const compareSize = (a: string, b: string): number => {
  const na = (a || "").trim().toUpperCase(), nb = (b || "").trim().toUpperCase();
  const ra = SIZE_RANK[na], rb = SIZE_RANK[nb];
  if (ra !== undefined && rb !== undefined) return ra - rb;
  if (ra !== undefined) return -1;               // known garment sizes first
  if (rb !== undefined) return 1;
  return na.localeCompare(nb, "th", { numeric: true });
};

// Canonical hierarchy for every accessory listing: type → description → color → size.
// Keeps items of the same type grouped, then by description (product line), then
// color, then size. Description sits high because some types (e.g. กระดุม) keep
// the size there with an empty `size` field ("ขนาด 14/4", "18/4", …); numeric-aware
// compare orders those naturally (14/4 < 20/4 < 100/4). Use to sort any Accessory[].
export const compareAccessory = (a: Accessory, b: Accessory): number =>
  (a.type || "").localeCompare(b.type || "", "th", { numeric: true }) ||
  (a.description || "").localeCompare(b.description || "", "th", { numeric: true }) ||
  (a.color || "").localeCompare(b.color || "", "th", { numeric: true }) ||
  compareSize(a.size, b.size);

// Canonical hierarchy for every fabric listing: ชนิดผ้า → โครงสร้าง → สี → หน้าผ้า → เลขที่.
// Mirrors compareAccessory: kind first so a fabric's variants stay grouped, then the
// discriminators in the order a person reads them off the shelf. `width` and
// `fabric_code` are text but mostly numeric ("73.5", "32T", "147"), so numeric-aware
// compare orders them naturally instead of lexically (147 after 23, not before).
export const compareFabric = (a: Fabric, b: Fabric): number =>
  (a.fabric_type || "").localeCompare(b.fabric_type || "", "th", { numeric: true }) ||
  (a.construction || "").localeCompare(b.construction || "", "th", { numeric: true }) ||
  (a.color || "").localeCompare(b.color || "", "th", { numeric: true }) ||
  (a.width || "").localeCompare(b.width || "", "th", { numeric: true }) ||
  (a.fabric_code || "").localeCompare(b.fabric_code || "", "th", { numeric: true });
