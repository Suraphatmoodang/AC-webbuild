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

const ACCESSORIES_KEY = "acc_stock_accessories";
const TRANSACTIONS_KEY = "acc_stock_transactions";

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function now() {
  return new Date().toISOString();
}

const SEED_ACCESSORIES: Accessory[] = [
  { id: "a1", type: "ซิป วีนัส", acc_code: "VC-32", description: "ซิปไนล่อน #03", row: null, color: "", size: "5นิ้ว", quantity: 0, unit: "เส้น", unit_cost: 2.72, min_quantity: 50, created_at: now(), updated_at: now() },
  { id: "a2", type: "ซิป วีนัส", acc_code: "VC-32", description: "ซิปไนล่อน #03", row: null, color: "", size: "6นิ้ว", quantity: 0, unit: "เส้น", unit_cost: 2.93, min_quantity: 50, created_at: now(), updated_at: now() },
  { id: "a3", type: "ซิป วีนัส", acc_code: "VC-36", description: "ซิปไนล่อน #03 ออโต้ล็อค", row: null, color: "", size: "5นิ้ว", quantity: 0, unit: "เส้น", unit_cost: 3.39, min_quantity: 50, created_at: now(), updated_at: now() },
  { id: "a4", type: "ซิป YKK", acc_code: "", description: "ซิปไนล่อน #03", row: null, color: "", size: "5นิ้ว", quantity: 0, unit: "เส้น", unit_cost: 2.78, min_quantity: 50, created_at: now(), updated_at: now() },
  { id: "a5", type: "ซิป YKK", acc_code: "", description: "ซิบหัวยาง", row: null, color: "สีดำ", size: "17 นิ้ว", quantity: 0, unit: "เส้น", unit_cost: 28.98, min_quantity: 20, created_at: now(), updated_at: now() },
  { id: "a6", type: "ป้ายเมน", acc_code: "", description: "ป้ายเมน แอพพาเรล", row: null, color: "", size: "", quantity: 0, unit: "โหล", unit_cost: 6.6, min_quantity: 10, created_at: now(), updated_at: now() },
  { id: "a7", type: "ป้ายเมน", acc_code: "", description: "ป้ายเมน ดามาร์ท", row: null, color: "", size: "", quantity: 0, unit: "โหล", unit_cost: 5.5, min_quantity: 10, created_at: now(), updated_at: now() },
  { id: "a8", type: "ป้ายแคร์", acc_code: "", description: "ป้ายแคร์ โทนิค", row: null, color: "", size: "S", quantity: 0, unit: "โหล", unit_cost: 14.4, min_quantity: 10, created_at: now(), updated_at: now() },
  { id: "a9", type: "ป้ายแคร์", acc_code: "", description: "ป้ายแคร์ โทนิค", row: null, color: "", size: "M", quantity: 0, unit: "โหล", unit_cost: 14.4, min_quantity: 10, created_at: now(), updated_at: now() },
  { id: "a10", type: "ป้ายไซส์", acc_code: "", description: "ป้ายสั่งทอ", row: null, color: "สีขาว", size: "S", quantity: 0, unit: "โหล", unit_cost: 3.6, min_quantity: 20, created_at: now(), updated_at: now() },
  { id: "a11", type: "ป้ายไซส์", acc_code: "", description: "ป้ายทอ ม้วน", row: null, color: "สีดำ", size: "M", quantity: 0, unit: "โหล", unit_cost: 1.6, min_quantity: 20, created_at: now(), updated_at: now() },
  { id: "a12", type: "กระดุม", acc_code: "", description: "ขนาด 18/4", row: null, color: "ใส", size: "", quantity: 0, unit: "กุรุส", unit_cost: 40, min_quantity: 5, created_at: now(), updated_at: now() },
  { id: "a13", type: "กระดุม", acc_code: "", description: "ขนาด 18/4", row: null, color: "ดำ", size: "", quantity: 0, unit: "กุรุส", unit_cost: 40, min_quantity: 5, created_at: now(), updated_at: now() },
  { id: "a14", type: "เทปใส", acc_code: "", description: "เทปใสต่อไหล่", row: null, color: "", size: "", quantity: 0, unit: "กิโล", unit_cost: 1250, min_quantity: 2, created_at: now(), updated_at: now() },
  { id: "a15", type: "เทปโพลี", acc_code: "", description: "", row: null, color: "ขาว", size: "", quantity: 0, unit: "ม้วน", unit_cost: 92, min_quantity: 3, created_at: now(), updated_at: now() },
  { id: "a16", type: "Magic Tape เวลโก้", acc_code: "VW020-A", description: "เมจิกเทป 20 มิล ตัวผู้", row: null, color: "ขาว", size: "", quantity: 0, unit: "หลา", unit_cost: 5, min_quantity: 100, created_at: now(), updated_at: now() },
  { id: "a17", type: "Magic Tape เวลโก้", acc_code: "VB020-B", description: "เมจิกเทป 20 มิล ตัวเมีย", row: null, color: "ดำ", size: "", quantity: 0, unit: "หลา", unit_cost: 5, min_quantity: 100, created_at: now(), updated_at: now() },
  { id: "a18", type: "ยางเอว", acc_code: "EW-032", description: "ยางโคเช ขนาด 1 1/4นิ้ว", row: null, color: "ขาว", size: "", quantity: 0, unit: "ม้วน", unit_cost: 107.5, min_quantity: 5, created_at: now(), updated_at: now() },
  { id: "a19", type: "ยางกลม", acc_code: "M6624", description: "ยางกลม 3 มิล", row: null, color: "ดำ", size: "", quantity: 0, unit: "หลา", unit_cost: 2.5, min_quantity: 200, created_at: now(), updated_at: now() },
  { id: "a20", type: "ด้าย สหต้าชิ่ง", acc_code: "40/2", description: "ด้ายเย็บ 40/2", row: 1, color: "5001", size: "", quantity: 0, unit: "หลอด", unit_cost: 35.16, min_quantity: 10, created_at: now(), updated_at: now() },
  { id: "a21", type: "ด้าย สหต้าชิ่ง", acc_code: "40/2", description: "ด้ายเย็บ 40/2", row: 1, color: "5003", size: "", quantity: 0, unit: "หลอด", unit_cost: 35.16, min_quantity: 10, created_at: now(), updated_at: now() },
  { id: "a22", type: "ตะขอ", acc_code: "TH575/SL", description: "ตะขอกางเกง", row: null, color: "สีเงิน", size: "", quantity: 0, unit: "กุรุส", unit_cost: 210, min_quantity: 3, created_at: now(), updated_at: now() },
  { id: "a23", type: "สต็อปเปอร์", acc_code: "SW007-B", description: "ขนาด 31/2", row: null, color: "ดำ 999", size: "", quantity: 0, unit: "ชิ้น", unit_cost: 3, min_quantity: 50, created_at: now(), updated_at: now() },
];

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, data: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(data));
}

export function getAccessories(): Accessory[] {
  const stored = loadFromStorage<Accessory[] | null>(ACCESSORIES_KEY, null);
  if (!stored) {
    saveToStorage(ACCESSORIES_KEY, SEED_ACCESSORIES);
    return SEED_ACCESSORIES;
  }
  return stored;
}

export function saveAccessories(data: Accessory[]) {
  saveToStorage(ACCESSORIES_KEY, data);
}

export function getTransactions(): Transaction[] {
  return loadFromStorage<Transaction[]>(TRANSACTIONS_KEY, []);
}

export function saveTransactions(data: Transaction[]) {
  saveToStorage(TRANSACTIONS_KEY, data);
}

export function addTransaction(
  accessory_id: string,
  type: Transaction["transaction_type"],
  qty: number,
  reference_no: string,
  note: string,
  created_by: string
): { accessory: Accessory; transaction: Transaction } | { error: string } {
  const accessories = getAccessories();
  const idx = accessories.findIndex((a) => a.id === accessory_id);
  if (idx === -1) return { error: "ไม่พบรายการ" };

  const acc = { ...accessories[idx] };
  const before = acc.quantity;
  let after = before;

  if (type === "IN" || type === "RETURN") after = before + qty;
  else if (type === "OUT") after = before - qty;
  else if (type === "ADJUST") after = qty;

  if (after < 0) return { error: "สต็อคไม่พอ" };

  acc.quantity = after;
  acc.updated_at = now();
  accessories[idx] = acc;
  saveAccessories(accessories);

  const tx: Transaction = {
    id: uuid(),
    accessory_id,
    transaction_type: type,
    quantity: type === "ADJUST" ? qty - before : qty,
    quantity_before: before,
    quantity_after: after,
    reference_no,
    note,
    created_by,
    created_at: now(),
  };
  const txns = getTransactions();
  txns.unshift(tx);
  saveTransactions(txns);

  return { accessory: acc, transaction: tx };
}

export function addAccessory(data: Omit<Accessory, "id" | "created_at" | "updated_at">): Accessory {
  const accessories = getAccessories();
  const acc: Accessory = { ...data, id: uuid(), created_at: now(), updated_at: now() };
  accessories.push(acc);
  saveAccessories(accessories);
  return acc;
}

export function updateAccessory(id: string, data: Partial<Accessory>): Accessory | null {
  const accessories = getAccessories();
  const idx = accessories.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  accessories[idx] = { ...accessories[idx], ...data, updated_at: now() };
  saveAccessories(accessories);
  return accessories[idx];
}

export function deleteAccessory(id: string): boolean {
  const accessories = getAccessories();
  const filtered = accessories.filter((a) => a.id !== id);
  if (filtered.length === accessories.length) return false;
  saveAccessories(filtered);
  return true;
}
