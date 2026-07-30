import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { readRole, type Role } from "@/lib/auth";
import {
  getCosting,
  addCosting,
  updateCosting,
  getPriceSources,
  computeCosting,
  ORDER_STATUSES,
  type CostingInput,
  type PriceOption,
} from "@/lib/costing-store";
import { getProducts, addProduct, productLabel, type Product, type ProductInput } from "@/lib/product-store";
import { PRODUCT_OPT as OPT } from "@/lib/product-spec";

// Preset trim/print/packaging chips (per piece), mirrored from the GKM app.
const EXTRA_PRESETS = [
  "ค่าพิมพ์", "ค่าปัก", "ค่าอาร์ม", "ค่าปิ๊ก", "ซิป", "ยางยืด", "เชือก", "กระดุม",
  "พิมพ์คอหลัง", "ตราเมน", "ตราไซส์", "ตราแคร์", "ด้ายเย็บ", "ป้ายแขวน", "ค่าถุง",
  "ค่าทิชชู่", "ค่ากล่อง/ค่ารถ", "ค่าย้อม", "ค่าซัก",
];

// ── Form state: all numeric fields held as strings so they can be blanked and
// typed freely (incl. decimals like 0.5). Coerced to numbers only in toInput(). ──
type SizeRowF = { color: string; s: string; m: string; l: string; xl: string };
type FabricLineF = { label: string; fabric_id: string | null; yard_per_pc: string; price_per_yard: string };
type ExtraLineF = { label: string; accessory_id: string | null; amount: string };

type FormState = {
  status: string; due_date: string; code: string; tags: string; product_id: string | null;
  release_no: string; release_date: string; customer: string; pn_no: string; po_no: string;
  style_no: string; description: string; brand: string; season: string;
  product_category: string; product_type: string; gender: string; product_group: string;
  fabric_type: string; length_type: string; neck: string; collar: string; fit: string;
  opening: string; has_hood: string; has_pocket: string;
  order_qty: string; color_count: string; size_count: string; shipment: string;
  size_breakdown: SizeRowF[];
  embroidery_count: string; print_count: string; sublimation: string; iron_count: string;
  fabric_lines: FabricLineF[];
  extras: ExtraLineF[];
  sew_labor: string; cut_labor: string; output_day: string;
  waste_pct: string; overhead_baht: string; profit_pct: string; cutting_loss_pct: string;
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
  size_breakdown: [],
  embroidery_count: "", print_count: "", sublimation: "", iron_count: "",
  fabric_lines: [],
  extras: [],
  sew_labor: "", cut_labor: "", output_day: "",
  waste_pct: "3", overhead_baht: "8000", profit_pct: "10", cutting_loss_pct: "5",
  note: "",
});

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
    size_breakdown: (c.size_breakdown ?? []).map((r: any) => ({ color: r.color ?? "", s: s(r.s), m: s(r.m), l: s(r.l), xl: s(r.xl) })),
    embroidery_count: s(c.embroidery_count), print_count: s(c.print_count), sublimation: s(c.sublimation), iron_count: s(c.iron_count),
    fabric_lines: (c.fabric_lines ?? []).map((f: any) => ({ label: f.label ?? "", fabric_id: f.fabric_id ?? null, yard_per_pc: s(f.yard_per_pc), price_per_yard: s(f.price_per_yard) })),
    extras: (c.extras ?? []).map((e: any) => ({ label: e.label ?? "", accessory_id: e.accessory_id ?? null, amount: s(e.amount) })),
    sew_labor: s(c.sew_labor), cut_labor: s(c.cut_labor), output_day: s(c.output_day),
    waste_pct: s(c.waste_pct), overhead_baht: s(c.overhead_baht), profit_pct: s(c.profit_pct),
    cutting_loss_pct: s(c.cutting_loss_pct), note: c.note ?? "",
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
    size_breakdown: f.size_breakdown.map((r) => ({ color: r.color.trim(), s: n(r.s), m: n(r.m), l: n(r.l), xl: n(r.xl) })),
    embroidery_count: n(f.embroidery_count), print_count: n(f.print_count), sublimation: n(f.sublimation), iron_count: n(f.iron_count),
    fabric_lines: f.fabric_lines.map((l) => ({ label: l.label.trim(), fabric_id: l.fabric_id, yard_per_pc: n(l.yard_per_pc), price_per_yard: n(l.price_per_yard) })),
    extras: f.extras.map((e) => ({ label: e.label.trim(), accessory_id: e.accessory_id, amount: n(e.amount) })),
    sew_labor: n(f.sew_labor), cut_labor: n(f.cut_labor), output_day: n(f.output_day),
    waste_pct: n(f.waste_pct), overhead_baht: n(f.overhead_baht), profit_pct: n(f.profit_pct),
    cutting_loss_pct: n(f.cutting_loss_pct), note: f.note.trim(), created_by: role ?? "",
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
  const [products, setProducts] = useState<Product[]>([]);
  const [savingProduct, setSavingProduct] = useState(false);
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
        const [src, prods] = await Promise.all([getPriceSources(), getProducts(true)]);
        if (!alive) return;
        setPrices(src);
        setProducts(prods);
        if (!isNew) {
          const c = await getCosting(id);
          if (alive && c) setForm(fromCosting(c));
          else if (alive && !c) notify("ไม่พบรายการ", "error");
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
  const orderQty = n(form.order_qty);
  const statusColor = (ORDER_STATUSES.find((st) => st.key === form.status) ?? ORDER_STATUSES[0]).color;

  // ── Fabric lines ──
  const addFabricLine = () => set("fabric_lines", [...form.fabric_lines, { label: "", fabric_id: null, yard_per_pc: "", price_per_yard: "" }]);
  const updFabricLine = (i: number, patch: Partial<FabricLineF>) =>
    set("fabric_lines", form.fabric_lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickFabric = (i: number, fid: string) => {
    const opt = prices.fabrics.find((o) => o.id === fid);
    updFabricLine(i, opt
      ? { fabric_id: opt.id, label: form.fabric_lines[i].label || opt.label, price_per_yard: String(round2(opt.price)) }
      : { fabric_id: null });
  };

  // ── Extras ──
  const addExtra = (e: ExtraLineF) => set("extras", [...form.extras, e]);
  const updExtra = (i: number, patch: Partial<ExtraLineF>) =>
    set("extras", form.extras.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const pickExtraAcc = (i: number, aid: string) => {
    const opt = prices.accessories.find((o) => o.id === aid);
    updExtra(i, opt
      ? { accessory_id: opt.id, label: form.extras[i].label || opt.label, amount: String(round2(opt.price)) }
      : { accessory_id: null });
  };

  // ── Size breakdown ──
  const addSizeRow = () => set("size_breakdown", [...form.size_breakdown, { color: "", s: "", m: "", l: "", xl: "" }]);
  const updSizeRow = (i: number, patch: Partial<SizeRowF>) =>
    set("size_breakdown", form.size_breakdown.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const sizeRowTotal = (r: SizeRowF) => n(r.s) + n(r.m) + n(r.l) + n(r.xl);
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
    ["ค่าแรง (เย็บ+ตัด)", bd.laborTotal],
    [`โสหุ้ย / ตัว (÷${form.output_day || 0} ตัว/วัน)`, bd.overheadPerPc],
  ];

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

      <div className="tx-grid">
        {/* ── Left: the form ── */}
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
              <Field label="Shipment"><input value={form.shipment} onChange={(e) => set("shipment", e.target.value)} /></Field>
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
              <Link href="/costing/products" style={{ fontSize: 13, color: "var(--accent)", paddingBottom: 8 }}>จัดการสินค้า →</Link>
            </div>
            <div className="form-grid form-grid-3">
              <Field label="ประเภทสินค้า"><Sel value={form.product_category} onChange={(v) => set("product_category", v)} options={OPT.category} /></Field>
              <Field label="ชนิดสินค้า"><Sel value={form.product_type} onChange={(v) => set("product_type", v)} options={OPT.type} /></Field>
              <Field label="เพศ"><Sel value={form.gender} onChange={(v) => set("gender", v)} options={OPT.gender} /></Field>
              <Field label="กลุ่มสินค้า"><Sel value={form.product_group} onChange={(v) => set("product_group", v)} options={OPT.group} /></Field>
              <Field label="ประเภทผ้า"><Sel value={form.fabric_type} onChange={(v) => set("fabric_type", v)} options={OPT.fabricType} /></Field>
              <Field label="ความยาว"><Sel value={form.length_type} onChange={(v) => set("length_type", v)} options={OPT.length} /></Field>
              <Field label="คอ"><Sel value={form.neck} onChange={(v) => set("neck", v)} options={OPT.neck} /></Field>
              <Field label="ปก"><Sel value={form.collar} onChange={(v) => set("collar", v)} options={OPT.collar} /></Field>
              <Field label="Fit"><Sel value={form.fit} onChange={(v) => set("fit", v)} options={OPT.fit} /></Field>
              <Field label="วิธีเปิด"><Sel value={form.opening} onChange={(v) => set("opening", v)} options={OPT.opening} /></Field>
              <Field label="มีหมวก"><Sel value={form.has_hood} onChange={(v) => set("has_hood", v)} options={OPT.yesno} /></Field>
              <Field label="มีกระเป๋า"><Sel value={form.has_pocket} onChange={(v) => set("has_pocket", v)} options={OPT.yesno} /></Field>
            </div>
          </SectionCard>

          <SectionCard title="จำนวน & ไซส์">
            <div className="form-grid form-grid-3">
              <Field label="จำนวนสั่ง (ตัว)"><input inputMode="numeric" value={form.order_qty} onChange={(e) => set("order_qty", e.target.value)} placeholder="0" /></Field>
              <Field label="จำนวนสี"><input inputMode="numeric" value={form.color_count} onChange={(e) => set("color_count", e.target.value)} placeholder="0" /></Field>
              <Field label="จำนวนไซส์"><input inputMode="numeric" value={form.size_count} onChange={(e) => set("size_count", e.target.value)} placeholder="0" /></Field>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label className="form-label" style={{ margin: 0 }}>ตารางไซส์ (สี × จำนวน)</label>
                <button className="small" style={{ padding: "4px 10px" }} onClick={addSizeRow}>+ เพิ่มสี</button>
              </div>
              {form.size_breakdown.length > 0 && (
                <div className="cost-line size" style={{ marginBottom: 4, fontSize: 12, color: "var(--text3)" }}>
                  <span>สี</span><span style={{ textAlign: "right" }}>S</span><span style={{ textAlign: "right" }}>M</span>
                  <span style={{ textAlign: "right" }}>L</span><span style={{ textAlign: "right" }}>XL</span>
                  <span style={{ textAlign: "right" }}>รวม</span><span />
                </div>
              )}
              {form.size_breakdown.map((r, i) => (
                <div className="cost-line size" key={i}>
                  <input value={r.color} onChange={(e) => updSizeRow(i, { color: e.target.value })} placeholder="เช่น แดง" />
                  <input className="num" inputMode="numeric" value={r.s} onChange={(e) => updSizeRow(i, { s: e.target.value })} placeholder="0" />
                  <input className="num" inputMode="numeric" value={r.m} onChange={(e) => updSizeRow(i, { m: e.target.value })} placeholder="0" />
                  <input className="num" inputMode="numeric" value={r.l} onChange={(e) => updSizeRow(i, { l: e.target.value })} placeholder="0" />
                  <input className="num" inputMode="numeric" value={r.xl} onChange={(e) => updSizeRow(i, { xl: e.target.value })} placeholder="0" />
                  <span className="num" style={{ color: "var(--text2)" }}>{sizeRowTotal(r).toLocaleString()}</span>
                  <button className="cl-x" title="ลบ" onClick={() => set("size_breakdown", form.size_breakdown.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              {form.size_breakdown.length > 0 && (
                <div style={{ textAlign: "right", fontSize: 13, color: "var(--text2)", marginTop: 4 }}>
                  รวมทั้งหมด <b style={{ fontFamily: "var(--mono)" }}>{sizeGrandTotal.toLocaleString()}</b> ตัว
                </div>
              )}
            </div>

            <div className="form-grid form-grid-4" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 16 }}>
              <Field label="จำนวนปัก"><input inputMode="numeric" value={form.embroidery_count} onChange={(e) => set("embroidery_count", e.target.value)} placeholder="0" /></Field>
              <Field label="จำนวนพิมพ์"><input inputMode="numeric" value={form.print_count} onChange={(e) => set("print_count", e.target.value)} placeholder="0" /></Field>
              <Field label="Sublimation"><input inputMode="numeric" value={form.sublimation} onChange={(e) => set("sublimation", e.target.value)} placeholder="0" /></Field>
              <Field label="จำนวนรีด"><input inputMode="numeric" value={form.iron_count} onChange={(e) => set("iron_count", e.target.value)} placeholder="0" /></Field>
            </div>
          </SectionCard>

          <SectionCard title="ผ้า (ต้นทุนต่อตัว)">
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
              เลือกผ้าจากสต็อคเพื่อดึงราคาปัจจุบัน (ถัวเฉลี่ยจากล็อต) หรือกรอกราคาเอง · ค่าผ้า/ตัว = Σ(หลา/ตัว × ราคา/หลา) × (1 + เผื่อตัด {form.cutting_loss_pct || 0}%)
            </div>
            {form.fabric_lines.length > 0 && (
              <div className="cost-line fabric" style={{ fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>
                <span>ชื่อผ้า</span><span>ดึงจากสต็อคผ้า</span><span style={{ textAlign: "right" }}>หลา/ตัว</span><span style={{ textAlign: "right" }}>ราคา/หลา</span><span />
              </div>
            )}
            {form.fabric_lines.map((l, i) => (
              <div className="cost-line fabric" key={i}>
                <input value={l.label} onChange={(e) => updFabricLine(i, { label: e.target.value })} placeholder="เช่น ผ้าตัวเสื้อ / ผ้าปก" />
                <select value={l.fabric_id ?? ""} onChange={(e) => pickFabric(i, e.target.value)}>
                  <option value="">— กรอกเอง —</option>
                  {prices.fabrics.map((o) => <option key={o.id} value={o.id}>{o.label}{o.price ? ` (฿${round2(o.price)}/${o.unit})` : ""}</option>)}
                </select>
                <input className="num" inputMode="decimal" value={l.yard_per_pc} onChange={(e) => updFabricLine(i, { yard_per_pc: e.target.value })} placeholder="0" />
                <input className="num" inputMode="decimal" value={l.price_per_yard} onChange={(e) => updFabricLine(i, { price_per_yard: e.target.value })} placeholder="0" />
                <button className="cl-x" title="ลบ" onClick={() => set("fabric_lines", form.fabric_lines.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button className="small" style={{ padding: "5px 12px", marginTop: 4 }} onClick={addFabricLine}>+ เพิ่มผ้า</button>
          </SectionCard>

          <SectionCard title="ค่าตกแต่ง / พิมพ์ / แพ็ค (ต่อตัว, บาท)">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {EXTRA_PRESETS.map((label) => (
                <button key={label} className="small" style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => addExtra({ label, accessory_id: null, amount: "" })}>+ {label}</button>
              ))}
            </div>
            <div style={{ marginBottom: 12, maxWidth: 360 }}>
              <Field label="ดึงจากอุปกรณ์ (เติมราคาปัจจุบันอัตโนมัติ)">
                <select value="" onChange={(e) => {
                  const opt = prices.accessories.find((o) => o.id === e.target.value);
                  if (opt) addExtra({ label: opt.label, accessory_id: opt.id, amount: String(round2(opt.price)) });
                }}>
                  <option value="">— เลือกอุปกรณ์ —</option>
                  {prices.accessories.map((o) => <option key={o.id} value={o.id}>{o.label}{o.price ? ` (฿${round2(o.price)}/${o.unit})` : ""}</option>)}
                </select>
              </Field>
            </div>
            {form.extras.map((e, i) => (
              <div className="cost-line extra" key={i}>
                <input value={e.label} onChange={(ev) => updExtra(i, { label: ev.target.value, accessory_id: null })} placeholder="ชื่อรายการ" />
                <input className="num" inputMode="decimal" value={e.amount} onChange={(ev) => updExtra(i, { amount: ev.target.value })} placeholder="บาท/ตัว" />
                <button className="cl-x" title="ลบ" onClick={() => set("extras", form.extras.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button className="small" style={{ padding: "5px 12px", marginTop: 4 }} onClick={() => addExtra({ label: "", accessory_id: null, amount: "" })}>+ กำหนดเอง</button>
          </SectionCard>

          <SectionCard title="ค่าแรง & ผลผลิต">
            <div className="form-grid form-grid-3">
              <Field label="ค่าแรงเย็บ / ตัว"><input inputMode="decimal" value={form.sew_labor} onChange={(e) => set("sew_labor", e.target.value)} placeholder="0" /></Field>
              <Field label="ค่าแรงตัด / ตัว"><input inputMode="decimal" value={form.cut_labor} onChange={(e) => set("cut_labor", e.target.value)} placeholder="0" /></Field>
              <Field label="ผลผลิต (ตัว/วัน)"><input inputMode="numeric" value={form.output_day} onChange={(e) => set("output_day", e.target.value)} placeholder="0" /></Field>
            </div>
            <button className="small" style={{ marginTop: 10, padding: "4px 10px", fontSize: 12 }}
              onClick={() => set("cut_labor", String(round2(n(form.sew_labor) / 2)))}>
              ตั้งค่าแรงตัด = ค่าแรงเย็บ ÷ 2
            </button>
          </SectionCard>

          <SectionCard title="ตั้งค่าต้นทุน">
            <div className="form-grid form-grid-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <Field label="เผื่อเสีย %"><input inputMode="decimal" value={form.waste_pct} onChange={(e) => set("waste_pct", e.target.value)} /></Field>
              <Field label="เผื่อตัดผ้า %"><input inputMode="decimal" value={form.cutting_loss_pct} onChange={(e) => set("cutting_loss_pct", e.target.value)} /></Field>
              <Field label="โสหุ้ย/วัน (บาท)"><input inputMode="numeric" value={form.overhead_baht} onChange={(e) => set("overhead_baht", e.target.value)} /></Field>
              <Field label="กำไร %"><input inputMode="decimal" value={form.profit_pct} onChange={(e) => set("profit_pct", e.target.value)} /></Field>
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
              กำไรคิดจากราคาขาย: ราคาขาย = ต้นทุน ÷ (1 − กำไร%) — เท่ากับสูตรในสเปรดชีตเดิม
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="หมายเหตุ"><input value={form.note} onChange={(e) => set("note", e.target.value)} /></Field>
            </div>
          </SectionCard>
        </div>

        {/* ── Right: live cost breakdown ── */}
        <div>
          <div className="card" style={{ padding: 18, position: "sticky", top: 86 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, color: "var(--text2)", marginBottom: 14 }}>สรุปต้นทุน (สด)</h2>
            <table style={{ fontSize: 14 }}>
              <tbody>
                {breakdownRows.map(([label, val]) => (
                  <tr key={label}>
                    <td style={{ border: "none", padding: "6px 0", color: "var(--text2)" }}>{label}</td>
                    <td className="num" style={{ border: "none", padding: "6px 0" }}>{fmt(val)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ borderTop: "2px solid var(--border2)", borderBottom: "none", padding: "10px 0 6px", fontWeight: 600 }}>ต้นทุนรวม / ตัว</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border2)", borderBottom: "none", padding: "10px 0 6px", fontWeight: 600, fontSize: 15 }}>{fmt(bd.totalCost)}</td>
                </tr>
                <tr>
                  <td style={{ border: "none", padding: "6px 0", color: "var(--green)" }}>กำไร ({form.profit_pct || 0}%)</td>
                  <td className="num" style={{ border: "none", padding: "6px 0", color: "var(--green)" }}>{fmt(bd.profit)}</td>
                </tr>
                <tr>
                  <td style={{ border: "none", padding: "6px 0", fontWeight: 700, color: "var(--accent)" }}>ราคาขาย / ตัว</td>
                  <td className="num" style={{ border: "none", padding: "6px 0", fontWeight: 700, color: "var(--accent)", fontSize: 17 }}>{fmt(bd.sellingPrice)}</td>
                </tr>
              </tbody>
            </table>

            {orderQty > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--text3)" }}>จำนวนสั่ง</span>
                  <span style={{ fontFamily: "var(--mono)" }}>{orderQty.toLocaleString()} ตัว</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--text3)" }}>ต้นทุนทั้งออเดอร์</span>
                  <span style={{ fontFamily: "var(--mono)" }}>฿{fmt(bd.totalCost * orderQty)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text3)" }}>มูลค่าขายทั้งออเดอร์</span>
                  <span style={{ fontFamily: "var(--mono)", color: "var(--accent)" }}>฿{fmt(bd.sellingPrice * orderQty)}</span>
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
