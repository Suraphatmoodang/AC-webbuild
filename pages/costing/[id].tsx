import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { readRole, type Role } from "@/lib/auth";
import {
  getCosting,
  addCosting,
  updateCosting,
  getPriceSources,
  getOrderFlows,
  getOrderActualMaterial,
  computeCosting,
  ORDER_STATUSES,
  ACTUAL_CATEGORIES,
  DEFAULT_SIZE_LABELS,
  type SizeRow,
  type CostingInput,
  type PriceOption,
  type ItemFlow,
} from "@/lib/costing-store";
import { getProducts, addProduct, productLabel, type Product, type ProductInput } from "@/lib/product-store";
import { PRODUCT_OPT as OPT, buildComboOptions } from "@/lib/product-spec";
import { Combo } from "@/lib/combo";
import { StockSelect } from "@/lib/stock-select";

// Preset trim/print/packaging chips (per piece), mirrored from the GKM app.
const EXTRA_PRESETS = [
  "ค่าพิมพ์", "ค่าปัก", "ค่าอาร์ม", "ซิป", "ยางยืด", "เชือก", "กระดุม",
  "พิมพ์คอหลัง", "ตราเมน", "ตราไซส์", "ตราแคร์", "ด้ายเย็บ", "ป้ายแขวน", "ค่าถุง",
  "ค่าทิชชู่", "ค่ากล่อง/ค่ารถ", "ค่าย้อม", "ค่าซัก",
];

// Ladder used to auto-seed size columns from จำนวนไซส์ (grow-only).
const SIZE_LADDER = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];

// ── Form state: all numeric fields held as strings so they can be blanked and
// typed freely (incl. decimals like 0.5). Coerced to numbers only in toInput(). ──
// Per-order dynamic size columns (labels held in form.size_labels). Quantities are
// held as strings keyed by label so cells can be blanked; they should sum to the total.
type SizeRowF = { color: string; qty: Record<string, string> };
const emptySizeRow = (): SizeRowF => ({ color: "", qty: {} });
type FabricLineF = {
  label: string; fabric_id: string | null;
  code: string; fabric_type: string; color: string; width: string;
  unit: string; yard_per_pc: string; price_per_yard: string;
};
type ActualEntryF = { date: string; category: string; label: string; amount: string; note: string };
const emptyActual = (): ActualEntryF => ({ date: new Date().toISOString().split("T")[0], category: "material", label: "", amount: "", note: "" });
type ExtraLineF = {
  label: string; accessory_id: string | null;
  mode: "flat" | "qty"; amount: string; qty_per_pc: string; unit: string; unit_price: string;
};
const emptyExtra = (p: Partial<ExtraLineF> = {}): ExtraLineF => ({
  label: "", accessory_id: null, mode: "flat", amount: "", qty_per_pc: "", unit: "ชิ้น", unit_price: "", ...p,
});

type FormState = {
  status: string; due_date: string; code: string; tags: string; product_id: string | null;
  release_no: string; release_date: string; customer: string; pn_no: string; po_no: string;
  style_no: string; description: string; brand: string; season: string;
  product_category: string; product_type: string; gender: string; product_group: string;
  fabric_type: string; length_type: string; neck: string; collar: string; fit: string;
  opening: string; has_hood: string; has_pocket: string;
  order_qty: string; color_count: string; size_count: string; shipment: string;
  size_labels: string[];
  size_breakdown: SizeRowF[];
  embroidery_count: string; print_count: string; sublimation: string; iron_count: string;
  fabric_lines: FabricLineF[];
  extras: ExtraLineF[];
  // labor buckets: ตัด / เช็ค / แพ็ค. sew_labor holds เช็ค (repurposed from the old เย็บ).
  cut_labor: string; sew_labor: string; pack_labor: string;
  output_day: string;      // LEGACY, hidden — carried through so old rows keep the value
  waste_pct: string; overhead_baht: string; overhead_pc: string; profit_pct: string; cutting_loss_pct: string;
  actual_entries: ActualEntryF[];
  note: string;
};

const emptyForm = (): FormState => ({
  status: "quote", due_date: "", code: "", tags: "", product_id: null,
  release_no: "", release_date: "", customer: "", pn_no: "", po_no: "",
  style_no: "", description: "", brand: "", season: "",
  product_category: "", product_type: "", gender: "", product_group: "",
  fabric_type: "", length_type: "", neck: "", collar: "", fit: "",
  opening: "", has_hood: "", has_pocket: "",
  order_qty: "", color_count: "", size_count: "", shipment: "",
  size_labels: [...DEFAULT_SIZE_LABELS],
  size_breakdown: [],
  embroidery_count: "", print_count: "", sublimation: "", iron_count: "",
  fabric_lines: [],
  extras: [],
  cut_labor: "", sew_labor: "", pack_labor: "", output_day: "",
  waste_pct: "3", overhead_baht: "8000", overhead_pc: "", profit_pct: "10", cutting_loss_pct: "5",
  actual_entries: [],
  note: "",
});

// Overhead moved from (โสหุ้ย/วัน ÷ ผลผลิต) to a directly-typed per-piece value. For rows
// saved under the old model, seed the new field from the old calc so the number doesn't drop.
function legacyOverheadPc(c: any): string {
  if (c.overhead_pc != null && Number(c.overhead_pc) > 0) return s(c.overhead_pc);
  const day = Number(c.output_day) || 0;
  const perDay = Number(c.overhead_baht) || 0;
  return day > 0 && perDay > 0 ? String(round2(perDay / day)) : "";
}

const n = (s: string): number => parseFloat(s) || 0;
const fmt = (v: number) => (isFinite(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function fromCosting(c: any): FormState {
  return {
    ...emptyForm(),
    status: c.status ?? "quote", due_date: c.due_date ?? "", code: c.code ?? "", tags: c.tags ?? "", product_id: c.product_id ?? null,
    release_no: c.release_no ?? "", release_date: c.release_date ?? "", customer: c.customer ?? "",
    pn_no: c.pn_no ?? "", po_no: c.po_no ?? "", style_no: c.style_no ?? "",
    description: c.description ?? "", brand: c.brand ?? "", season: c.season ?? "",
    product_category: c.product_category ?? "", product_type: c.product_type ?? "", gender: c.gender ?? "",
    product_group: c.product_group ?? "", fabric_type: c.fabric_type ?? "", length_type: c.length_type ?? "",
    neck: c.neck ?? "", collar: c.collar ?? "", fit: c.fit ?? "", opening: c.opening ?? "",
    has_hood: c.has_hood ?? "", has_pocket: c.has_pocket ?? "",
    order_qty: s(c.order_qty), color_count: s(c.color_count), size_count: s(c.size_count), shipment: c.shipment ?? "",
    size_labels: Array.isArray(c.size_labels) && c.size_labels.length ? c.size_labels.map(String) : [...DEFAULT_SIZE_LABELS],
    size_breakdown: (c.size_breakdown ?? []).map((r: any) => ({
      color: r.color ?? "",
      qty: Object.fromEntries(Object.entries(r.qty ?? {}).map(([k, v]) => [k, s(v as number)])),
    })),
    embroidery_count: s(c.embroidery_count), print_count: s(c.print_count), sublimation: s(c.sublimation), iron_count: s(c.iron_count),
    fabric_lines: (c.fabric_lines ?? []).map((f: any) => ({
      label: f.label ?? "", fabric_id: f.fabric_id ?? null,
      code: f.code ?? "", fabric_type: f.fabric_type ?? "", color: f.color ?? "", width: f.width ?? "",
      unit: f.unit || "หลา", yard_per_pc: s(f.yard_per_pc), price_per_yard: s(f.price_per_yard),
    })),
    extras: (c.extras ?? []).map((e: any) => ({
      label: e.label ?? "", accessory_id: e.accessory_id ?? null,
      mode: e.mode === "qty" ? "qty" : "flat",
      amount: s(e.amount), qty_per_pc: s(e.qty_per_pc), unit: e.unit || "ชิ้น", unit_price: s(e.unit_price),
    })),
    cut_labor: s(c.cut_labor), sew_labor: s(c.sew_labor), pack_labor: s(c.pack_labor), output_day: s(c.output_day),
    waste_pct: s(c.waste_pct), overhead_baht: s(c.overhead_baht), overhead_pc: legacyOverheadPc(c), profit_pct: s(c.profit_pct),
    cutting_loss_pct: s(c.cutting_loss_pct),
    actual_entries: (c.actual_entries ?? []).map((e: any) => ({
      date: e.date ?? "", category: e.category ?? "other", label: e.label ?? "", amount: s(e.amount), note: e.note ?? "",
    })),
    note: c.note ?? "",
  };
}

function toInput(f: FormState, role: Role | null): CostingInput {
  return {
    status: f.status || "quote", due_date: f.due_date || null, code: f.code.trim(), tags: f.tags.trim(), product_id: f.product_id,
    release_no: f.release_no.trim(), release_date: f.release_date || null, customer: f.customer.trim(),
    pn_no: f.pn_no.trim(), po_no: f.po_no.trim(), style_no: f.style_no.trim(),
    description: f.description.trim(), brand: f.brand.trim(), season: f.season.trim(),
    product_category: f.product_category, product_type: f.product_type, gender: f.gender,
    product_group: f.product_group, fabric_type: f.fabric_type, length_type: f.length_type,
    neck: f.neck, collar: f.collar, fit: f.fit, opening: f.opening,
    has_hood: f.has_hood, has_pocket: f.has_pocket,
    order_qty: n(f.order_qty), color_count: n(f.color_count), size_count: n(f.size_count), shipment: f.shipment.trim(),
    size_labels: f.size_labels,
    size_breakdown: f.size_breakdown.map((r) => ({
      color: r.color.trim(),
      qty: Object.fromEntries(f.size_labels.map((L) => [L, n(r.qty[L] ?? "")])),
    })),
    embroidery_count: n(f.embroidery_count), print_count: n(f.print_count), sublimation: n(f.sublimation), iron_count: n(f.iron_count),
    fabric_lines: f.fabric_lines.map((l) => ({
      label: l.label.trim(), fabric_id: l.fabric_id,
      code: l.code.trim(), fabric_type: l.fabric_type.trim(), color: l.color.trim(), width: l.width.trim(),
      unit: l.unit || "หลา", yard_per_pc: n(l.yard_per_pc), price_per_yard: n(l.price_per_yard),
    })),
    extras: f.extras.map((e) => ({
      label: e.label.trim(), accessory_id: e.accessory_id,
      mode: e.mode === "qty" ? "qty" as const : "flat" as const,
      amount: n(e.amount), qty_per_pc: n(e.qty_per_pc), unit: e.unit || "ชิ้น", unit_price: n(e.unit_price),
    })),
    cut_labor: n(f.cut_labor), sew_labor: n(f.sew_labor), pack_labor: n(f.pack_labor), output_day: n(f.output_day),
    waste_pct: n(f.waste_pct), overhead_baht: n(f.overhead_baht), overhead_pc: n(f.overhead_pc), profit_pct: n(f.profit_pct),
    cutting_loss_pct: n(f.cutting_loss_pct),
    actual_entries: f.actual_entries.map((e) => ({
      date: e.date || "",
      category: (["material", "labor", "overhead", "other"].includes(e.category) ? e.category : "other") as any,
      label: e.label.trim(), amount: n(e.amount), note: e.note.trim(),
    })),
    note: f.note.trim(), created_by: role ?? "",
  };
}

// ── Small presentational helpers ─────────────────────────────────────
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="form-label" style={{ marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— ไม่ระบุ —</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 500, color: "var(--text2)", marginBottom: 14 }}>{title}</h2>
      {children}
    </div>
  );
}

export default function CostingEditor() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : "";
  const isNew = id === "new";

  const [role, setRole] = useState<Role | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [prices, setPrices] = useState<{ fabrics: PriceOption[]; accessories: PriceOption[] }>({ fabrics: [], accessories: [] });
  // Phase C — actual material flows (received/used) tagged to this order, per stock item id.
  const [flows, setFlows] = useState<{ acc: Map<string, ItemFlow>; fab: Map<string, ItemFlow> }>({ acc: new Map(), fab: new Map() });
  // Phase D — actual material spend derived from tagged OUT transactions × lot unit_cost.
  const [actualMaterial, setActualMaterial] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [savingProduct, setSavingProduct] = useState(false);
  const [newSize, setNewSize] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const notify = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Gate: costing/orders is SUPER-ADMIN only.
  useEffect(() => {
    const r = readRole();
    if (!r) { router.replace("/login"); return; }
    if (r !== "super") { router.replace("/"); return; }
    setRole(r);
    setAuthed(true);
  }, [router]);

  useEffect(() => {
    if (!authed || !router.isReady) return;
    let alive = true;
    (async () => {
      try {
        // Prices and the product catalog load INDEPENDENTLY: the catalog is optional (e.g.
        // the `products` table may not exist yet), and a failure there must NOT blank the
        // fabric/accessory price dropdowns. So settle each on its own.
        const [priceRes, prodRes] = await Promise.allSettled([getPriceSources(), getProducts(true)]);
        if (!alive) return;
        if (priceRes.status === "fulfilled") setPrices(priceRes.value);
        else { console.error("โหลดราคาสต็อคไม่สำเร็จ", priceRes.reason); notify("โหลดราคาสต็อคไม่สำเร็จ", "error"); }
        if (prodRes.status === "fulfilled") setProducts(prodRes.value);
        else console.error("โหลดแคตตาล็อกสินค้าไม่สำเร็จ (ตาราง products อาจยังไม่ถูกสร้าง)", prodRes.reason);
        if (!isNew) {
          const c = await getCosting(id);
          if (alive && c) {
            setForm(fromCosting(c));
            // Load the order's tagged material flows (received/used) + actual material spend — non-fatal.
            getOrderFlows(c.id, c.code).then((f) => { if (alive) setFlows(f); }).catch(() => {});
            getOrderActualMaterial(c.id, c.code).then((m) => { if (alive) setActualMaterial(m); }).catch(() => {});
          } else if (alive && !c) notify("ไม่พบรายการ", "error");
        }
      } catch (e: any) {
        if (alive) notify(e.message ?? "โหลดข้อมูลไม่สำเร็จ", "error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [authed, router.isReady, id, isNew]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  // ── Auto-seed the size grid from the counts ──
  // Typing จำนวนสี seeds that many blank color rows; จำนวนไซส์ seeds that many size
  // columns from SIZE_LADDER. Grow-only: lowering a count never deletes what you've filled in.
  const setColorCount = (v: string) => setForm((f) => {
    const want = Math.max(0, Math.floor(n(v)));
    const rows = want > f.size_breakdown.length
      ? [...f.size_breakdown, ...Array.from({ length: want - f.size_breakdown.length }, emptySizeRow)]
      : f.size_breakdown;
    return { ...f, color_count: v, size_breakdown: rows };
  });
  const setSizeCount = (v: string) => setForm((f) => {
    const want = Math.max(0, Math.floor(n(v)));
    let labels = f.size_labels;
    if (want > labels.length) {
      const extra = SIZE_LADDER.filter((L) => !labels.includes(L)).slice(0, want - labels.length);
      labels = [...labels, ...extra];
    }
    return { ...f, size_count: v, size_labels: labels };
  });

  // ── Product link ──
  // Pick a catalog product → copy its garment spec onto the order (still editable),
  // and remember the link. Clearing the picker just drops the link, leaving fields.
  const pickProduct = (pid: string) => {
    if (!pid) { set("product_id", null); return; }
    const p = products.find((x) => x.id === pid);
    if (!p) { set("product_id", null); return; }
    setForm((f) => ({
      ...f, product_id: p.id,
      style_no: p.style_no || f.style_no, description: p.description || f.description, brand: p.brand || f.brand,
      product_category: p.product_category, product_type: p.product_type, gender: p.gender,
      product_group: p.product_group, fabric_type: p.fabric_type, length_type: p.length_type,
      neck: p.neck, collar: p.collar, fit: p.fit, opening: p.opening,
      has_hood: p.has_hood, has_pocket: p.has_pocket,
    }));
  };

  // Save the order's current garment spec as a NEW catalog product and link it.
  const saveAsNewProduct = async () => {
    const input: ProductInput = {
      style_no: form.style_no.trim(), description: form.description.trim(), brand: form.brand.trim(),
      product_category: form.product_category, product_type: form.product_type, gender: form.gender,
      product_group: form.product_group, fabric_type: form.fabric_type, length_type: form.length_type,
      neck: form.neck, collar: form.collar, fit: form.fit, opening: form.opening,
      has_hood: form.has_hood, has_pocket: form.has_pocket, note: "", is_active: true,
    };
    if (!input.style_no && !input.product_type && !input.description) {
      notify("ระบุ Style no. / ชนิดสินค้า / รายละเอียด ก่อนบันทึกเป็นสินค้า", "error");
      return;
    }
    setSavingProduct(true);
    try {
      const p = await addProduct(input);
      setProducts((ps) => [...ps, p].sort((a, b) => String(a.style_no).localeCompare(String(b.style_no), "th")));
      set("product_id", p.id);
      notify("บันทึกเป็นสินค้าใหม่แล้ว");
    } catch (e: any) {
      notify(e.message ?? "บันทึกสินค้าไม่สำเร็จ", "error");
    } finally {
      setSavingProduct(false);
    }
  };

  const bd = useMemo(() => computeCosting(toInput(form, role)), [form, role]);
  // Type-or-pick options: presets + distinct values already saved in the catalog.
  const comboOpts = useMemo(() => buildComboOptions(products), [products]);
  // Distinct units seen across accessory stock — fills the extra-line unit dropdown.
  const accUnits = useMemo(() => {
    const set = new Set<string>();
    for (const o of prices.accessories) { const u = (o.unit || "").trim(); if (u) set.add(u); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "th"));
  }, [prices.accessories]);
  const orderQty = n(form.order_qty);
  const statusColor = (ORDER_STATUSES.find((st) => st.key === form.status) ?? ORDER_STATUSES[0]).color;

  // ── Fabric lines ──
  const addFabricLine = () => set("fabric_lines", [...form.fabric_lines,
    { label: "", fabric_id: null, code: "", fabric_type: "", color: "", width: "", unit: "หลา", yard_per_pc: "", price_per_yard: "" }]);
  const updFabricLine = (i: number, patch: Partial<FabricLineF>) =>
    set("fabric_lines", form.fabric_lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  // Pick a stock fabric → link it and pull spec + price. Clearing the dropdown (— กรอกเอง —)
  // just drops the link, leaving whatever was typed → the line becomes a placeholder. The
  // garment-part label (หน้าที่ใช้) is never overwritten; it describes the role, not the fabric.
  const pickFabric = (i: number, fid: string) => {
    const opt = prices.fabrics.find((o) => o.id === fid);
    if (!opt) { updFabricLine(i, { fabric_id: null }); return; }
    updFabricLine(i, {
      fabric_id: opt.id,
      code: opt.code ?? "", fabric_type: opt.fabric_type ?? "", color: opt.color ?? "", width: opt.width ?? "",
      unit: opt.unit || "หลา", price_per_yard: String(round2(opt.price)),
    });
  };

  // ── Extras ──
  const addExtra = (p: Partial<ExtraLineF> = {}) => set("extras", [...form.extras, emptyExtra(p)]);
  const updExtra = (i: number, patch: Partial<ExtraLineF>) =>
    set("extras", form.extras.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  // Pick a stock อุปกรณ์ → link it and pull its unit price into qty-mode (price is per-unit,
  // so จำนวน/ตัว × ราคา/หน่วย is the correct shape). Clearing → placeholder, values kept.
  const pickExtraAcc = (i: number, aid: string) => {
    const opt = prices.accessories.find((o) => o.id === aid);
    if (!opt) { updExtra(i, { accessory_id: null }); return; }
    updExtra(i, {
      accessory_id: opt.id, label: form.extras[i].label || opt.label,
      mode: "qty", unit: opt.unit || "ชิ้น", unit_price: String(round2(opt.price)),
    });
  };

  // ── Actual cost entries (Phase D) ──
  const addActual = () => set("actual_entries", [...form.actual_entries, emptyActual()]);
  const updActual = (i: number, patch: Partial<ActualEntryF>) =>
    set("actual_entries", form.actual_entries.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // ── Size breakdown ──
  const addSizeRow = () => set("size_breakdown", [...form.size_breakdown, emptySizeRow()]);
  const updSizeColor = (i: number, color: string) =>
    set("size_breakdown", form.size_breakdown.map((r, j) => (j === i ? { ...r, color } : r)));
  const updSizeCell = (i: number, label: string, val: string) =>
    set("size_breakdown", form.size_breakdown.map((r, j) => (j === i ? { ...r, qty: { ...r.qty, [label]: val } } : r)));
  const sizeRowTotal = (r: SizeRowF) => form.size_labels.reduce((t, L) => t + n(r.qty[L] ?? ""), 0);

  // ── Size columns (labels) — each order chooses its own; sizes vary per job. ──
  const addSizeCol = (raw: string) => {
    const label = raw.trim();
    if (!label || form.size_labels.includes(label)) return;
    set("size_labels", [...form.size_labels, label]);
    setNewSize("");
  };
  const removeSizeCol = (label: string) => {
    set("size_labels", form.size_labels.filter((L) => L !== label));
    set("size_breakdown", form.size_breakdown.map((r) => {
      const { [label]: _drop, ...rest } = r.qty;
      return { ...r, qty: rest };
    }));
  };
  const sizeGrandTotal = form.size_breakdown.reduce((t, r) => t + sizeRowTotal(r), 0);

  const save = async () => {
    const input = toInput(form, role);
    if (!input.style_no && !input.po_no && !input.customer) {
      notify("กรุณาระบุอย่างน้อย Style no. / PO / ลูกค้า", "error");
      return;
    }
    setSaving(true);
    try {
      if (isNew) await addCosting(input);
      else await updateCosting(id, input);
      router.push("/costing");
    } catch (e: any) {
      notify(e.message ?? "บันทึกไม่สำเร็จ", "error");
      setSaving(false);
    }
  };

  if (authed !== true) return null;
  if (loading) return <div style={{ padding: 40, color: "var(--text3)" }}>กำลังโหลด…</div>;

  const breakdownRows: [string, number][] = [
    ["ค่าผ้า / ตัว", bd.fabricPerPc],
    ["ค่าตกแต่ง/พิมพ์/แพ็ค / ตัว", bd.extrasSum],
    ["รวมวัตถุดิบ", bd.materialSubtotal],
    [`เผื่อเสีย (${form.waste_pct || 0}%)`, bd.wasteCost],
    ["ค่าแรง (ตัด+เช็ค+แพ็ค)", bd.laborTotal],
    ["โสหุ้ย / ตัว", bd.overheadPerPc],
  ];

  // ── Per-order material ledger rows ──
  // planned = per-piece qty × จำนวนสั่ง (derived, no stored planned_qty); received/used come
  // from transactions tagged to this order (flows). Only quantity-bearing lines appear
  // (fabric lines + qty-mode accessory lines); flat baht/ตัว extras aren't material-tracked.
  type MatRow = { name: string; unit: string; planned: number; linked: boolean; received: number; used: number };
  const materialRows: MatRow[] = isNew ? [] : [
    ...form.fabric_lines.map((l): MatRow => {
      const flow = l.fabric_id ? flows.fab.get(l.fabric_id) : undefined;
      return {
        name: [l.label, l.fabric_type, l.color].map((x) => x.trim()).filter(Boolean).join(" · ") || l.code.trim() || "ผ้า",
        unit: l.unit || "หลา", planned: n(l.yard_per_pc), linked: !!l.fabric_id,
        received: flow?.received ?? 0, used: flow?.used ?? 0,
      };
    }),
    ...form.extras.filter((e) => e.mode === "qty").map((e): MatRow => {
      const flow = e.accessory_id ? flows.acc.get(e.accessory_id) : undefined;
      return {
        name: e.label.trim() || "อุปกรณ์",
        unit: e.unit || "ชิ้น", planned: n(e.qty_per_pc), linked: !!e.accessory_id,
        received: flow?.received ?? 0, used: flow?.used ?? 0,
      };
    }),
  ];

  // ── Estimate vs actual (Phase D) ──
  // Estimate = per-piece cost × จำนวนสั่ง, by category. Actual = derived material spend
  // (tagged OUT × lot cost) + hand-logged actual_entries. Variance = actual − estimate.
  const actualByCat: Record<string, number> = { material: 0, labor: 0, overhead: 0, other: 0 };
  for (const e of form.actual_entries) {
    const cat = actualByCat[e.category] !== undefined ? e.category : "other";
    actualByCat[cat] += n(e.amount);
  }
  const cmpRows = [
    { th: "วัตถุดิบ (+เผื่อเสีย)", est: (bd.materialSubtotal + bd.wasteCost) * orderQty, act: actualMaterial + actualByCat.material },
    { th: "ค่าแรง", est: bd.laborTotal * orderQty, act: actualByCat.labor },
    { th: "โสหุ้ย", est: bd.overheadPerPc * orderQty, act: actualByCat.overhead },
    { th: "อื่นๆ", est: 0, act: actualByCat.other },
  ];
  const cmpEstTotal = cmpRows.reduce((s, r) => s + r.est, 0);
  const cmpActTotal = cmpRows.reduce((s, r) => s + r.act, 0);

  return (
    <div className="costing-page" style={{ maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <Link href="/costing" style={{ fontSize: 14, color: "var(--text3)" }}>← กลับไปรายการ</Link>
          <h1 style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>{isNew ? "สร้างต้นทุนสินค้า" : "แก้ไขต้นทุนสินค้า"}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text3)" }}>สถานะ</span>
            <select value={form.status} onChange={(e) => set("status", e.target.value)}
              style={{ width: "auto", borderColor: statusColor, color: statusColor, fontWeight: 500 }}>
              {ORDER_STATUSES.map((st) => <option key={st.key} value={st.key} style={{ color: "var(--text)" }}>{st.th}</option>)}
            </select>
          </div>
          <button onClick={() => router.push("/costing")}>ยกเลิก</button>
          <button className="primary" onClick={save} disabled={saving}>{saving ? "กำลังบันทึก…" : isNew ? "บันทึก" : "บันทึกการแก้ไข"}</button>
        </div>
      </div>

      <div>
        {/* ── The form (single full-width column; cost summary sits full-width at the bottom) ── */}
        <div>
          <SectionCard title="ข้อมูลออเดอร์">
            <div className="form-grid form-grid-3">
              <Field label="เลขที่ปล่อยใบผลิต"><input value={form.release_no} onChange={(e) => set("release_no", e.target.value)} /></Field>
              <Field label="วันที่ปล่อยผลิต"><input type="date" value={form.release_date} onChange={(e) => set("release_date", e.target.value)} /></Field>
              <Field label="กำหนดส่ง"><input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
              <Field label="ลูกค้า"><input value={form.customer} onChange={(e) => set("customer", e.target.value)} /></Field>
              <Field label="PN no."><input value={form.pn_no} onChange={(e) => set("pn_no", e.target.value)} /></Field>
              <Field label="PO no."><input value={form.po_no} onChange={(e) => set("po_no", e.target.value)} /></Field>
              <Field label="Style no."><input value={form.style_no} onChange={(e) => set("style_no", e.target.value)} /></Field>
              <Field label="ยี่ห้อ"><input value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
              <Field label="Season"><input value={form.season} onChange={(e) => set("season", e.target.value)} /></Field>
              <Field label="ที่อยู่จัดส่ง"><input value={form.shipment} onChange={(e) => set("shipment", e.target.value)} /></Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="รายละเอียด"><input value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
            </div>
            {/* Code / tags — framework fields. Assignable per-order now; a bulk
                "retroactively tag existing orders" tool is planned but not built yet. */}
            <div className="form-grid form-grid-2" style={{ marginTop: 12 }}>
              <Field label="รหัส (Code)" hint="รหัสภายในของออเดอร์ — จะมีเครื่องมือกำหนดย้อนหลังภายหลัง">
                <input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="เว้นว่างได้" />
              </Field>
              <Field label="แท็ก (Tags)" hint="คั่นด้วยจุลภาค เช่น ด่วน, ลูกค้าประจำ">
                <input value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="เว้นว่างได้" />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="คุณสมบัติสินค้า">
            {/* Pick from the products catalog to auto-fill the spec, or save the current
                spec as a new product. Fields below stay fully editable per order. */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14,
              paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: "1 1 260px" }}>
                <label className="form-label" style={{ marginBottom: 4 }}>เลือกจากแคตตาล็อกสินค้า</label>
                <select value={form.product_id ?? ""} onChange={(e) => pickProduct(e.target.value)}>
                  <option value="">— ไม่อ้างอิงสินค้า —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                </select>
              </div>
              <button type="button" onClick={saveAsNewProduct} disabled={savingProduct} style={{ whiteSpace: "nowrap" }}>
                {savingProduct ? "กำลังบันทึก…" : "+ บันทึกเป็นสินค้าใหม่"}
              </button>
            </div>
            <div className="form-grid form-grid-3">
              <Field label="ประเภทสินค้า"><Combo value={form.product_category} onChange={(v) => set("product_category", v)} options={comboOpts.product_category} /></Field>
              <Field label="ชนิดสินค้า"><Combo value={form.product_type} onChange={(v) => set("product_type", v)} options={comboOpts.product_type} /></Field>
              <Field label="เพศ"><Combo value={form.gender} onChange={(v) => set("gender", v)} options={comboOpts.gender} /></Field>
              <Field label="กลุ่มสินค้า"><Combo value={form.product_group} onChange={(v) => set("product_group", v)} options={comboOpts.product_group} /></Field>
              <Field label="ประเภทผ้า"><Combo value={form.fabric_type} onChange={(v) => set("fabric_type", v)} options={comboOpts.fabric_type} /></Field>
              <Field label="ความยาว"><Combo value={form.length_type} onChange={(v) => set("length_type", v)} options={comboOpts.length_type} /></Field>
              <Field label="คอ"><Combo value={form.neck} onChange={(v) => set("neck", v)} options={comboOpts.neck} /></Field>
              <Field label="ปก"><Combo value={form.collar} onChange={(v) => set("collar", v)} options={comboOpts.collar} /></Field>
              <Field label="Fit"><Combo value={form.fit} onChange={(v) => set("fit", v)} options={comboOpts.fit} /></Field>
              <Field label="วิธีเปิด"><Combo value={form.opening} onChange={(v) => set("opening", v)} options={comboOpts.opening} /></Field>
              <Field label="มีหมวก"><Sel value={form.has_hood} onChange={(v) => set("has_hood", v)} options={OPT.yesno} /></Field>
              <Field label="มีกระเป๋า"><Sel value={form.has_pocket} onChange={(v) => set("has_pocket", v)} options={OPT.yesno} /></Field>
            </div>
          </SectionCard>

          <SectionCard title="จำนวน & ไซส์">
            <div className="form-grid form-grid-3">
              <Field label="จำนวนสั่ง (ตัว)"><input inputMode="numeric" value={form.order_qty} onChange={(e) => set("order_qty", e.target.value)} placeholder="0" /></Field>
              <Field label="จำนวนสี" hint="สร้างแถวสีให้อัตโนมัติ"><input inputMode="numeric" value={form.color_count} onChange={(e) => setColorCount(e.target.value)} placeholder="0" /></Field>
              <Field label="จำนวนไซส์" hint="สร้างคอลัมน์ไซส์ให้อัตโนมัติ"><input inputMode="numeric" value={form.size_count} onChange={(e) => setSizeCount(e.target.value)} placeholder="0" /></Field>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                <label className="form-label" style={{ margin: 0 }}>ตารางไซส์ (สี × จำนวน)</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input value={newSize} onChange={(e) => setNewSize(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSizeCol(newSize); } }}
                    placeholder="เพิ่มไซส์ เช่น XS, 2XL, 1" style={{ width: 160 }} />
                  <button className="small" style={{ padding: "4px 10px" }} onClick={() => addSizeCol(newSize)}>+ ไซส์</button>
                  <button className="small" style={{ padding: "4px 10px" }} onClick={addSizeRow}>+ เพิ่มสี</button>
                </div>
              </div>

              {form.size_labels.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text3)", padding: "6px 0" }}>ยังไม่มีคอลัมน์ไซส์ — เพิ่มไซส์ก่อน</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="size-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", minWidth: 110 }}>สี</th>
                        {form.size_labels.map((L) => (
                          <th key={L}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                              {L}
                              <button type="button" className="cl-x" title={`ลบไซส์ ${L}`}
                                style={{ fontSize: 14 }} onClick={() => removeSizeCol(L)}>×</button>
                            </span>
                          </th>
                        ))}
                        <th style={{ textAlign: "right" }}>รวม</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {form.size_breakdown.map((r, i) => (
                        <tr key={i}>
                          <td><input value={r.color} onChange={(e) => updSizeColor(i, e.target.value)} placeholder="เช่น แดง" /></td>
                          {form.size_labels.map((L) => (
                            <td key={L}>
                              <input className="num" inputMode="numeric" value={r.qty[L] ?? ""}
                                onChange={(e) => updSizeCell(i, L, e.target.value)} placeholder="0" style={{ width: 54 }} />
                            </td>
                          ))}
                          <td className="num" style={{ color: "var(--text2)" }}>{sizeRowTotal(r).toLocaleString()}</td>
                          <td>
                            <button className="cl-x" title="ลบแถว"
                              onClick={() => set("size_breakdown", form.size_breakdown.filter((_, j) => j !== i))}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {form.size_breakdown.length > 0 && (() => {
                // Live check that the size split adds up to the order total (non-blocking).
                const diff = sizeGrandTotal - orderQty;
                const matched = orderQty > 0 && diff === 0;
                const color = matched ? "var(--green)" : orderQty > 0 ? "#d97706" : "var(--text2)";
                return (
                  <div style={{ textAlign: "right", fontSize: 13, color, marginTop: 4 }}>
                    รวมไซส์ <b style={{ fontFamily: "var(--mono)" }}>{sizeGrandTotal.toLocaleString()}</b>
                    {orderQty > 0
                      ? <> / {orderQty.toLocaleString()} ตัว — {diff === 0 ? "พอดี" : diff < 0 ? `ขาด ${Math.abs(diff).toLocaleString()}` : `เกิน ${diff.toLocaleString()}`}</>
                      : <> ตัว</>}
                  </div>
                );
              })()}
            </div>

            <div className="form-grid form-grid-4" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 16 }}>
              <Field label="จำนวนปัก"><input inputMode="numeric" value={form.embroidery_count} onChange={(e) => set("embroidery_count", e.target.value)} placeholder="0" /></Field>
              <Field label="จำนวนพิมพ์"><input inputMode="numeric" value={form.print_count} onChange={(e) => set("print_count", e.target.value)} placeholder="0" /></Field>
              <Field label="Sublimation"><input inputMode="numeric" value={form.sublimation} onChange={(e) => set("sublimation", e.target.value)} placeholder="0" /></Field>
              <Field label="จำนวนรีด"><input inputMode="numeric" value={form.iron_count} onChange={(e) => set("iron_count", e.target.value)} placeholder="0" /></Field>
            </div>
          </SectionCard>

          <SectionCard title="ผ้า (ต้นทุนต่อตัว)">
            <div style={{ fontSize: 14, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
              เลือกผ้าจากสต็อคเพื่อดึงสเปคและราคาปัจจุบัน (ถัวเฉลี่ยจากล็อต) หรือกรอกเองเป็น placeholder แล้วเชื่อมกับสต็อคภายหลัง · <b style={{ color: "var(--text2)" }}>จำนวนกรอกเป็นยอดรวมทั้งออเดอร์</b> · ค่าผ้า/ตัว = Σ(จำนวนรวม × ราคา/หน่วย) ÷ จำนวนสั่ง × (1 + เผื่อตัด {form.cutting_loss_pct || 0}%)
            </div>
            {form.fabric_lines.map((l, i) => {
              const linked = !!l.fabric_id;
              const unit = l.unit || "หลา";
              return (
                <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 12, marginBottom: 10 }}>
                  {/* ② ชนิดผ้า: dropdown links to a real fabric (auto-fills the row); "— กรอกเอง —"
                      leaves it a placeholder. The type text below is editable in both cases. */}
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <label className="form-label" style={{ marginBottom: 4 }}>ชนิดผ้า — ดึงจากสต็อค หรือ กรอกเอง</label>
                      <StockSelect
                        value={l.fabric_id}
                        onChange={(id) => pickFabric(i, id)}
                        options={prices.fabrics}
                        placeholder="— กรอกเอง (Placeholder) —"
                        formatRight={(o) => (o.price ? `฿${round2(o.price)}/${o.unit}` : "")}
                      />
                      <input style={{ marginTop: 6 }} value={l.fabric_type} onChange={(e) => updFabricLine(i, { fabric_type: e.target.value })} placeholder="เช่น 60% cotton 40% spandex" />
                      {linked && (() => {
                        // Show current on-hand stock for the linked fabric (after selection only — the
                        // dropdown list stays uncrowded). Falls back silently if the option isn't loaded.
                        const opt = prices.fabrics.find((o) => o.id === l.fabric_id);
                        if (!opt) return null;
                        return (
                          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>
                            คงเหลือในสต็อค: <b style={{ fontFamily: "var(--mono)", color: opt.stock > 0 ? "var(--text2)" : "var(--red)" }}>
                              {opt.stock.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> {opt.unit}
                          </div>
                        );
                      })()}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                      <button className="cl-x" title="ลบผ้า" onClick={() => set("fabric_lines", form.fabric_lines.filter((_, j) => j !== i))}>×</button>
                      <span style={{ fontSize: 11, whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 999,
                        background: linked ? "#dcfce7" : "#fef3c7", color: linked ? "var(--green)" : "#b45309" }}>
                        {linked ? "เชื่อมสต็อคแล้ว" : "ยังไม่มีในสต็อค"}
                      </span>
                    </div>
                  </div>
                  <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
                    <Field label="หน้าที่ใช้"><input value={l.label} onChange={(e) => updFabricLine(i, { label: e.target.value })} placeholder="เช่น ตัวเสื้อ / ปก" /></Field>
                    <Field label="เลขที่"><input value={l.code} onChange={(e) => updFabricLine(i, { code: e.target.value })} placeholder="เช่น 192" /></Field>
                    <Field label="สี"><input value={l.color} onChange={(e) => updFabricLine(i, { color: e.target.value })} placeholder="เช่น กรม" /></Field>
                    <Field label="หน้าผ้า"><input value={l.width} onChange={(e) => updFabricLine(i, { width: e.target.value })} placeholder={'เช่น 60" / 32T'} /></Field>
                    <Field label="จำนวนรวม (ทั้งออเดอร์)">
                      <div style={{ display: "flex", gap: 6 }}>
                        <input className="num" inputMode="decimal" value={l.yard_per_pc} onChange={(e) => updFabricLine(i, { yard_per_pc: e.target.value })} placeholder="0" style={{ flex: 1, minWidth: 0 }} />
                        <select value={unit} onChange={(e) => updFabricLine(i, { unit: e.target.value })} style={{ width: 78, flexShrink: 0 }}>
                          <option value="หลา">หลา</option>
                          <option value="กิโล">กิโล</option>
                        </select>
                      </div>
                    </Field>
                    <Field label={`ราคา/${unit}`}><input className="num" inputMode="decimal" value={l.price_per_yard} onChange={(e) => updFabricLine(i, { price_per_yard: e.target.value })} placeholder="0" /></Field>
                  </div>
                </div>
              );
            })}
            <button className="small" style={{ padding: "5px 12px", marginTop: 4 }} onClick={addFabricLine}>+ เพิ่มผ้า</button>
          </SectionCard>

          <SectionCard title="ค่าตกแต่ง / พิมพ์ / แพ็ค (รวมทั้งออเดอร์, บาท)">
            <div style={{ fontSize: 14, color: "var(--text3)", marginBottom: 10, lineHeight: 1.65 }}>
              เพิ่ม<b style={{ color: "var(--text2)" }}>อุปกรณ์/ค่าตกแต่ง/พิมพ์/แพ็ค</b>ของออเดอร์ที่นี่ — กดปุ่ม preset ด้านล่าง หรือ “+ เพิ่มอุปกรณ์” เพื่อเพิ่มรายการ<br />
              ช่อง <b style={{ color: "var(--text2)" }}>“ดึงจากอุปกรณ์”</b> อ่านรายการจาก<b style={{ color: "var(--text2)" }}>สต็อคอุปกรณ์</b> (หน้า อุปกรณ์) และเติม<b style={{ color: "var(--text2)" }}>ราคาปัจจุบัน</b>ให้อัตโนมัติ (ถัวเฉลี่ยจากล็อตที่เหลือ) · ไม่เลือก = placeholder ไว้เชื่อมภายหลัง · <b style={{ color: "var(--text2)" }}>กรอกเป็นยอดรวมทั้งออเดอร์</b> แบบเหมา (บาทรวม) หรือ จำนวนรวม × ราคา/หน่วย ก็ได้ (หารด้วยจำนวนสั่งเป็นต้นทุน/ตัว)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {EXTRA_PRESETS.map((label) => (
                <button key={label} className="small" style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => addExtra({ label })}>+ {label}</button>
              ))}
            </div>
            {form.extras.map((e, i) => {
              const linked = !!e.accessory_id;
              return (
                <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 12, marginBottom: 10 }}>
                  {/* Top row: stock link + item name, with chip/× at right — mirrors the fabric card. */}
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <label className="form-label" style={{ marginBottom: 4 }}>ดึงจากอุปกรณ์ หรือ กรอกเอง</label>
                      <StockSelect
                        value={e.accessory_id}
                        onChange={(id) => pickExtraAcc(i, id)}
                        options={prices.accessories}
                        placeholder="— กรอกเอง (Placeholder) —"
                        formatRight={(o) => (o.price ? `฿${round2(o.price)}/${o.unit}` : "")}
                      />
                      <input style={{ marginTop: 6 }} value={e.label} title={e.label} onChange={(ev) => updExtra(i, { label: ev.target.value })} placeholder="ชื่อรายการ เช่น ซิป, พิมพ์" />
                      {linked && (() => {
                        // On-hand stock for the linked accessory, shown only after selection.
                        const opt = prices.accessories.find((o) => o.id === e.accessory_id);
                        if (!opt) return null;
                        return (
                          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>
                            คงเหลือในสต็อค: <b style={{ fontFamily: "var(--mono)", color: opt.stock > 0 ? "var(--text2)" : "var(--red)" }}>
                              {opt.stock.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> {opt.unit}
                          </div>
                        );
                      })()}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                      <button className="cl-x" title="ลบ" onClick={() => set("extras", form.extras.filter((_, j) => j !== i))}>×</button>
                      <span style={{ fontSize: 11, whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 999,
                        background: linked ? "#dcfce7" : "#fef3c7", color: linked ? "var(--green)" : "#b45309" }}>
                        {linked ? "เชื่อมสต็อคแล้ว" : "ยังไม่มีในสต็อค"}
                      </span>
                    </div>
                  </div>
                  {/* Second row: cost mode + amounts, in a grid like the fabric card. */}
                  <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
                    <Field label="รูปแบบ">
                      <select value={e.mode} onChange={(ev) => updExtra(i, { mode: ev.target.value === "qty" ? "qty" : "flat" })}>
                        <option value="flat">เหมา (บาทรวม)</option>
                        <option value="qty">จำนวน × ราคา</option>
                      </select>
                    </Field>
                    {e.mode === "flat" ? (
                      <Field label="บาท (รวมทั้งออเดอร์)">
                        <input className="num" inputMode="decimal" value={e.amount} onChange={(ev) => updExtra(i, { amount: ev.target.value })} placeholder="0" />
                      </Field>
                    ) : (
                      <>
                        <Field label="จำนวนรวม (ทั้งออเดอร์)">
                          <input className="num" inputMode="decimal" value={e.qty_per_pc} onChange={(ev) => updExtra(i, { qty_per_pc: ev.target.value })} placeholder="0" />
                        </Field>
                        <Field label="หน่วย">
                          <select value={e.unit} onChange={(ev) => updExtra(i, { unit: ev.target.value })}>
                            {e.unit === "" && <option value="">— หน่วย —</option>}
                            {(e.unit && !accUnits.includes(e.unit) ? [e.unit, ...accUnits] : accUnits).map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="ราคา/หน่วย">
                          <input className="num" inputMode="decimal" value={e.unit_price} onChange={(ev) => updExtra(i, { unit_price: ev.target.value })} placeholder="0" />
                        </Field>
                      </>
                    )}
                  </div>
                  {e.mode === "qty" && n(e.qty_per_pc) > 0 && n(e.unit_price) > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6, textAlign: "right" }}>
                      = ฿{fmt(n(e.qty_per_pc) * n(e.unit_price))} รวม{orderQty > 0 ? ` · ฿${fmt((n(e.qty_per_pc) * n(e.unit_price)) / orderQty)}/ตัว` : ""}
                    </div>
                  )}
                </div>
              );
            })}
            <button className="small" style={{ padding: "5px 12px", marginTop: 4 }} onClick={() => addExtra()}>+ เพิ่มอุปกรณ์</button>
          </SectionCard>

          <SectionCard title="ค่าแรง">
            <div className="form-grid form-grid-3">
              <Field label="ค่าแรงตัด / ตัว"><input inputMode="decimal" value={form.cut_labor} onChange={(e) => set("cut_labor", e.target.value)} placeholder="0" /></Field>
              <Field label="ค่าแรงเช็ค / ตัว"><input inputMode="decimal" value={form.sew_labor} onChange={(e) => set("sew_labor", e.target.value)} placeholder="0" /></Field>
              <Field label="ค่าแรงแพ็ค / ตัว"><input inputMode="decimal" value={form.pack_labor} onChange={(e) => set("pack_labor", e.target.value)} placeholder="0" /></Field>
            </div>
          </SectionCard>

          <SectionCard title="ตั้งค่าต้นทุน">
            <div className="form-grid form-grid-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <Field label="เผื่อเสีย %"><input inputMode="decimal" value={form.waste_pct} onChange={(e) => set("waste_pct", e.target.value)} /></Field>
              <Field label="เผื่อตัดผ้า %"><input inputMode="decimal" value={form.cutting_loss_pct} onChange={(e) => set("cutting_loss_pct", e.target.value)} /></Field>
              <Field label="โสหุ้ย/ตัว (บาท)"><input inputMode="decimal" value={form.overhead_pc} onChange={(e) => set("overhead_pc", e.target.value)} placeholder="0" /></Field>
              <Field label="กำไร %"><input inputMode="decimal" value={form.profit_pct} onChange={(e) => set("profit_pct", e.target.value)} /></Field>
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
              กำไรคิดจากราคาขาย: ราคาขาย = ต้นทุน ÷ (1 − กำไร%) — เท่ากับสูตรในสเปรดชีตเดิม
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="หมายเหตุ"><input value={form.note} onChange={(e) => set("note", e.target.value)} /></Field>
            </div>
          </SectionCard>

          {/* ── Per-order material ledger (existing orders only) ── */}
          {!isNew && (
            <SectionCard title="การติดตามวัสดุ (ตามออเดอร์)">
              <div style={{ fontSize: 14, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
                แผน = จำนวนรวมที่กรอก (ทั้งออเดอร์) · รับเข้า/เบิกใช้ มาจากรายการเคลื่อนไหวสต็อคที่ผูกกับออเดอร์นี้ (หน้า บันทึกรายการ) · คงเหลือ = รับเข้า − เบิกใช้
              </div>
              {materialRows.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>ยังไม่มีวัสดุที่ติดตามได้ — เพิ่มผ้า หรืออุปกรณ์แบบ “จำนวน × ราคา”</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ fontSize: 14, minWidth: 640 }}>
                    <thead>
                      <tr style={{ color: "var(--text3)", fontSize: 12, textAlign: "left" }}>
                        <th style={{ padding: "6px 8px" }}>วัสดุ</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>แผน</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>รับเข้า</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>เบิกใช้</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>คงเหลือ</th>
                        <th style={{ padding: "6px 8px" }}>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materialRows.map((r, i) => {
                        const remaining = r.received - r.used;
                        return (
                          <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                            <td style={{ padding: "8px" }}>{r.name} <span style={{ color: "var(--text3)", fontSize: 12 }}>({r.unit})</span></td>
                            <td className="num" style={{ padding: "8px", textAlign: "right" }}>{r.planned > 0 ? r.planned.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>
                            <td className="num" style={{ padding: "8px", textAlign: "right" }}>{r.linked ? r.received.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>
                            <td className="num" style={{ padding: "8px", textAlign: "right" }}>{r.linked ? r.used.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>
                            <td className="num" style={{ padding: "8px", textAlign: "right", fontWeight: 500,
                              color: r.linked ? (remaining < 0 ? "var(--red)" : "var(--text)") : "var(--text3)" }}>
                              {r.linked ? remaining.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                            </td>
                            <td style={{ padding: "8px" }}>
                              <span style={{ fontSize: 11, whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 999,
                                background: r.linked ? "#dcfce7" : "#fef3c7", color: r.linked ? "var(--green)" : "#b45309" }}>
                                {r.linked ? "เชื่อมสต็อค" : "ยังไม่มีในสต็อค"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}
          {/* ── Estimate vs actual + actual-cost log (existing orders only) ── */}
          {!isNew && (
            <SectionCard title="ต้นทุนจริง vs ประมาณการ">
              <div style={{ fontSize: 14, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
                ประมาณการ = ต้นทุน/ตัว × จำนวนสั่ง · วัตถุดิบจริงดึงจากการเบิกใช้ที่ผูกกับออเดอร์ (× ต้นทุนล็อตจริง) อัตโนมัติ — ค่าแรง/โสหุ้ย/อื่นๆ บันทึกจริงด้านล่าง
              </div>
              <div style={{ overflowX: "auto", marginBottom: 14 }}>
                <table style={{ fontSize: 14, minWidth: 520, width: "100%" }}>
                  <thead>
                    <tr style={{ color: "var(--text3)", fontSize: 12 }}>
                      <th style={{ padding: "6px 8px", textAlign: "left" }}>หมวด</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>ประมาณการ</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>จริง</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>ส่วนต่าง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmpRows.map((r) => {
                      const diff = r.act - r.est;
                      const pct = r.est > 0 ? (diff / r.est) * 100 : null;
                      return (
                        <tr key={r.th} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px" }}>{r.th}</td>
                          <td className="num" style={{ padding: "8px", textAlign: "right" }}>{fmt(r.est)}</td>
                          <td className="num" style={{ padding: "8px", textAlign: "right" }}>{fmt(r.act)}</td>
                          <td className="num" style={{ padding: "8px", textAlign: "right", color: diff > 0.005 ? "var(--red)" : diff < -0.005 ? "var(--green)" : "var(--text3)" }}>
                            {diff > 0 ? "+" : ""}{fmt(diff)}{pct !== null ? ` (${diff > 0 ? "+" : ""}${pct.toFixed(0)}%)` : ""}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: "2px solid var(--border2)" }}>
                      <td style={{ padding: "10px 8px", fontWeight: 600 }}>รวมทั้งออเดอร์</td>
                      <td className="num" style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(cmpEstTotal)}</td>
                      <td className="num" style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(cmpActTotal)}</td>
                      <td className="num" style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600, color: cmpActTotal - cmpEstTotal > 0.005 ? "var(--red)" : cmpActTotal - cmpEstTotal < -0.005 ? "var(--green)" : "var(--text3)" }}>
                        {cmpActTotal - cmpEstTotal > 0 ? "+" : ""}{fmt(cmpActTotal - cmpEstTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {actualMaterial > 0 && (
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
                  * วัตถุดิบจริงรวมยอดเบิกใช้อัตโนมัติ ฿{fmt(actualMaterial)} + ที่บันทึกเองในหมวดวัตถุดิบ
                </div>
              )}

              <div style={{ fontSize: 13, color: "var(--text2)", fontWeight: 500, marginBottom: 8 }}>บันทึกต้นทุนจริง (ค่าแรง/โสหุ้ย/อื่นๆ หรือวัตถุดิบนอกระบบ)</div>
              {form.actual_entries.map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
                  <div style={{ flex: "0 1 150px" }}>
                    <label className="form-label" style={{ marginBottom: 4 }}>วันที่</label>
                    <input type="date" value={e.date} onChange={(ev) => updActual(i, { date: ev.target.value })} />
                  </div>
                  <div style={{ flex: "0 1 120px" }}>
                    <label className="form-label" style={{ marginBottom: 4 }}>หมวด</label>
                    <select value={e.category} onChange={(ev) => updActual(i, { category: ev.target.value })}>
                      {ACTUAL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.th}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: "2 1 180px" }}>
                    <label className="form-label" style={{ marginBottom: 4 }}>รายการ</label>
                    <input value={e.label} onChange={(ev) => updActual(i, { label: ev.target.value })} placeholder="เช่น ค่าแรงเย็บงวด 1" />
                  </div>
                  <div style={{ flex: "0 1 120px" }}>
                    <label className="form-label" style={{ marginBottom: 4 }}>จำนวน (บาท)</label>
                    <input className="num" inputMode="decimal" value={e.amount} onChange={(ev) => updActual(i, { amount: ev.target.value })} placeholder="0" />
                  </div>
                  <button className="cl-x" title="ลบ" onClick={() => set("actual_entries", form.actual_entries.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <button className="small" style={{ padding: "5px 12px", marginTop: 4 }} onClick={addActual}>+ เพิ่มรายการจริง</button>
            </SectionCard>
          )}
        </div>

        {/* ── Live cost summary — the itemized "costing sheet", full-width at the bottom.
            Left = per-piece breakdown table; right = whole-order totals. Stacks on mobile. ── */}
        <div className="card" style={{ padding: 20, marginTop: 4 }}>
          <h2 style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)", marginBottom: 16 }}>สรุปต้นทุน (สด)</h2>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "center" }}>
            {/* Itemized sheet */}
            <div style={{ flex: "1 1 360px", maxWidth: 480 }}>
              <table style={{ fontSize: 14, width: "100%" }}>
                <tbody>
                  {breakdownRows.map(([label, val]) => (
                    <tr key={label}>
                      <td style={{ border: "none", padding: "6px 0", color: "var(--text2)" }}>{label}</td>
                      <td className="num" style={{ border: "none", padding: "6px 0", textAlign: "right" }}>{fmt(val)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ borderTop: "2px solid var(--border2)", borderBottom: "none", padding: "10px 0 6px", fontWeight: 600 }}>ต้นทุนรวม / ตัว</td>
                    <td className="num" style={{ borderTop: "2px solid var(--border2)", borderBottom: "none", padding: "10px 0 6px", fontWeight: 600, fontSize: 15, textAlign: "right" }}>{fmt(bd.totalCost)}</td>
                  </tr>
                  <tr>
                    <td style={{ border: "none", padding: "6px 0", color: "var(--green)" }}>กำไร ({form.profit_pct || 0}%)</td>
                    <td className="num" style={{ border: "none", padding: "6px 0", color: "var(--green)", textAlign: "right" }}>{fmt(bd.profit)}</td>
                  </tr>
                  <tr>
                    <td style={{ border: "none", padding: "6px 0", fontWeight: 700, color: "var(--accent)" }}>ราคาขาย / ตัว</td>
                    <td className="num" style={{ border: "none", padding: "6px 0", fontWeight: 700, color: "var(--accent)", fontSize: 17, textAlign: "right" }}>{fmt(bd.sellingPrice)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Whole-order totals */}
            {orderQty > 0 && (
              <div style={{ flex: "1 1 240px", maxWidth: 340, background: "var(--bg3)", borderRadius: "var(--r)", padding: "16px 18px", fontSize: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ color: "var(--text3)" }}>จำนวนสั่ง</span>
                  <span style={{ fontFamily: "var(--mono)" }}>{orderQty.toLocaleString()} ตัว</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ color: "var(--text3)" }}>ต้นทุนทั้งออเดอร์</span>
                  <span style={{ fontFamily: "var(--mono)" }}>฿{fmt(bd.totalCost * orderQty)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text3)" }}>มูลค่าขายทั้งออเดอร์</span>
                  <span style={{ fontFamily: "var(--mono)", color: "var(--accent)", fontWeight: 600 }}>฿{fmt(bd.sellingPrice * orderQty)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}

function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}
