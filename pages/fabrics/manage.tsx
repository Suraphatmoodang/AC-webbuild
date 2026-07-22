import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/router";
import { useRequireRole } from "@/lib/auth";
import { getFabrics, addFabric, updateFabric, deleteFabric, getSuppliers, bulkDeleteFabrics,
  bulkDeactivateFabrics, getFabricLotMap, stockFromLots, valueFromLots, createFabricLot, overwriteFabricStock,
  type Fabric, type Supplier, type FabricLot } from "@/lib/fabric-store";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";
import { compareFabric } from "@/lib/sort";
import { STOCK_UNITS, WEIGHT_UNITS } from "@/lib/fabric-units";
import { numOr, numInput, DEFAULT_MIN_QTY, type NumField } from "@/lib/form-num";

type FormData = Omit<Fabric, "id" | "created_at" | "updated_at" | "quantity" | "unit_cost" | "min_quantity" | "weight"> & {
  quantity: NumField;
  unit_cost: NumField;
  min_quantity: NumField;
  weight: NumField;
};

const emptyForm = (): FormData => ({
  fabric_type: "", composition: "", construction: "", color: "",
  width: "", weight: "", weight_unit: "gm2", row_label: "", fabric_code: "",
  quantity: "", unit: "กก", unit_cost: "", cost_unit: "กก",
  min_quantity: "", supplier_id: null, valuation_method: "fifo", is_active: true,
});

type FormErrors = Partial<Record<keyof FormData, string>>;

function validate(form: FormData): FormErrors {
  const errors: FormErrors = {};
  if (!form.fabric_type.trim()) errors.fabric_type = "กรุณาระบุชนิดผ้า";
  if (!form.unit.trim())        errors.unit        = "กรุณาระบุหน่วย";
  if (form.quantity !== "" && form.quantity < 0) errors.quantity = "จำนวนต้องไม่ติดลบ";
  return errors;
}

// Free-text-with-suggestions input: pick an existing value or type a brand new one.
// Used for ชนิดผ้า / เส้นใย / โครงสร้าง, which are open vocabularies that grow as
// new fabrics arrive — a plain <select> would make new values unenterable.
function Combobox({ value, onChange, options, placeholder, hasError }: {
  value: string; onChange: (v: string) => void; options: string[];
  placeholder?: string; hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  useEffect(() => { setQuery(value); }, [value]);
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));
  const select = (opt: string) => { onChange(opt); setQuery(opt); setOpen(false); };
  return (
    <div style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        style={hasError ? { borderColor: "var(--red)" } : {}}
        autoComplete="off"
      />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg3)", border: "1px solid var(--border2)",
          borderRadius: "var(--r)", zIndex: 200, maxHeight: 200, overflowY: "auto",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          {filtered.length === 0 && query && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--accent)", cursor: "pointer" }}
              onMouseDown={() => select(query)}>
              + เพิ่มใหม่: "{query}"
            </div>
          )}
          {filtered.map((opt) => (
            <div key={opt} onMouseDown={() => select(opt)}
              style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer",
                background: opt === value ? "var(--bg4)" : "transparent",
                color: opt === value ? "var(--accent)" : "var(--text)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg4)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = opt === value ? "var(--bg4)" : "transparent")}>
              {opt}
            </div>
          ))}
          {filtered.length > 0 && query && !options.includes(query) && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--accent)", cursor: "pointer",
              borderTop: "1px solid var(--border)" }}
              onMouseDown={() => select(query)}>
              + เพิ่มใหม่: "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SupplierCombobox({ value, onChange, options }: {
  value: string | null; onChange: (v: string | null) => void; options: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedName = options.find((o) => o.id === value)?.name ?? "";
  const display = open ? query : selectedName;
  const filtered = options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));
  const select = (id: string) => { onChange(id); setOpen(false); setQuery(""); };
  const clear = () => { onChange(null); setQuery(""); setOpen(false); };
  return (
    <div style={{ position: "relative" }}>
      <input
        value={display}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="ค้นหาซัพพลายเออร์…"
        autoComplete="off"
      />
      {value && (
        <button type="button" onMouseDown={clear}
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
            border: "none", background: "transparent", color: "var(--text3)", padding: "2px 6px", fontSize: 16 }}>
          ✕
        </button>
      )}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg3)", border: "1px solid var(--border2)",
          borderRadius: "var(--r)", zIndex: 200, maxHeight: 220, overflowY: "auto",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--text3)", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
            onMouseDown={clear}>
            — ไม่ระบุ —
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--text3)" }}>ไม่พบซัพพลายเออร์</div>
          )}
          {filtered.map((opt) => (
            <div key={opt.id} onMouseDown={() => select(opt.id)}
              style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer",
                background: opt.id === value ? "var(--bg4)" : "transparent",
                color: opt.id === value ? "var(--accent)" : "var(--text)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg4)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = opt.id === value ? "var(--bg4)" : "transparent")}>
              {opt.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Editable stock + price for the edit modal. Changing the stock and saving
// OVERWRITES the item's lots with one new opening lot at this price (see
// overwriteFabricStock in the store). Gated by `stockEditEnabled`.
function StockEditor({ currentStock, quantity, unitCost, unit, onQuantity, onUnitCost, error }: {
  currentStock: number;
  quantity: number;
  unitCost: number;
  unit: string;
  onQuantity: (v: number) => void;
  onUnitCost: (v: number) => void;
  error?: string;
}) {
  const changed = quantity !== currentStock;
  return (
    <div className="form-row form-grid form-grid-2">
      <div>
        <label className="form-label">ราคาซื้อ/หน่วย (฿)</label>
        <input type="number" step="0.0001" value={unitCost}
          onChange={(e) => onUnitCost(parseFloat(e.target.value) || 0)} />
      </div>
      <div>
        <label className="form-label">สต็อค (เขียนทับ)</label>
        <input type="number" step="any" value={quantity}
          onChange={(e) => onQuantity(parseFloat(e.target.value) || 0)}
          style={error ? { borderColor: "var(--red)" } : {}} />
        {error && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 3 }}>{error}</div>}
        {changed && !error && (
          <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 3 }}>
            จะลบล็อตเดิมทั้งหมดและสร้างล็อตใหม่ {quantity.toLocaleString()} {unit} ที่ ฿{Number(unitCost).toFixed(2)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FabricManagePage() {
  const router = useRouter();
  const [items, setItems]     = useState<Fabric[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [lotMap, setLotMap] = useState<Map<string, FabricLot[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [filterType, setFilterType]   = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [showModal, setShowModal]       = useState(false);
  const [editId, setEditId]             = useState<string | null>(null);
  const [form, setForm]                 = useState<FormData>(emptyForm());
  const [formErrors, setFormErrors]     = useState<FormErrors>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState<null | { blocked: string[] }>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Gate for in-place stock editing (overwrite → new lot). Mirrors the accessory
  // manage page; flip to false to restore the read-only price-history view.
  const stockEditEnabled = true;

  const { authed } = useRequireRole("fabric");

  useEffect(() => {
    if (!authed) return;
    Promise.all([getFabrics(), getSuppliers(), getFabricLotMap()])
      .then(([fabs, sups, lm]) => { setItems(fabs); setSuppliers(sups); setLotMap(lm); })
      .finally(() => setLoading(false));
  }, [authed]);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refresh = () => Promise.all([getFabrics(), getFabricLotMap()]).then(([f, lm]) => { setItems(f); setLotMap(lm); });
  const types        = Array.from(new Set(items.map((i) => i.fabric_type).filter(Boolean))).sort();
  const compositions = Array.from(new Set(items.map((i) => i.composition).filter(Boolean))).sort();
  const constructions = Array.from(new Set(items.map((i) => i.construction).filter(Boolean))).sort();

  const filtered = useMemo(() => items.filter((i) => {
    if (!showInactive && !i.is_active) return false;
    if (filterType && i.fabric_type !== filterType) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const supName = (suppliers.find((s) => s.id === i.supplier_id)?.supplier_name ?? "").toLowerCase();
    return (
      i.fabric_type.toLowerCase().includes(q) ||
      i.composition.toLowerCase().includes(q) ||
      i.construction.toLowerCase().includes(q) ||
      i.color.toLowerCase().includes(q) ||
      i.width.toLowerCase().includes(q) ||
      i.fabric_code.toLowerCase().includes(q) ||
      i.row_label.toLowerCase().includes(q) ||
      supName.includes(q)
    );
  }).sort(compareFabric), [items, suppliers, search, filterType, showInactive]);

  const pg = usePagination(filtered, `${search}|${filterType}|${showInactive}`);

  // Page-scoped selection
  const pageIds = pg.pageItems.map((i) => i.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleRow = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const togglePageAll = () => {
    const next = new Set(selected);
    if (allPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setSelected(next);
  };

  const runBulkDelete = async () => {
    setSaving(true);
    try {
      const ids = Array.from(selected);
      const { deleted, blocked } = await bulkDeleteFabrics(ids);
      await refresh();
      setSelected(new Set());
      if (blocked.length > 0) {
        setBulkModal({ blocked });
        showToast(`ลบแล้ว ${deleted.length} · ลบไม่ได้ ${blocked.length} รายการ (มีประวัติธุรกรรม)`, "error");
      } else {
        showToast(`ลบ ${deleted.length} รายการแล้ว`, "success");
      }
    } catch (e: any) {
      showToast(e.message ?? "เกิดข้อผิดพลาด", "error");
    } finally { setSaving(false); }
  };

  const runBulkDeactivate = async (ids: string[]) => {
    setSaving(true);
    try {
      await bulkDeactivateFabrics(ids);
      await refresh();
      setBulkModal(null);
      setSelected(new Set());
      showToast(`ปิดใช้งาน ${ids.length} รายการแล้ว`, "success");
    } catch (e: any) {
      showToast(e.message ?? "เกิดข้อผิดพลาด", "error");
    } finally { setSaving(false); }
  };

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setFormErrors({}); setShowModal(true); };
  const openEdit = (item: Fabric) => {
    setEditId(item.id);
    // Stock lives in lots — seed the editable field from the lot-derived total
    // (what the table shows), not the fabric's mirror column.
    const curStock = stockFromLots(lotMap.get(item.id) ?? []);
    setForm({
      fabric_type: item.fabric_type, composition: item.composition, construction: item.construction,
      color: item.color, width: item.width, weight: item.weight, weight_unit: item.weight_unit,
      row_label: item.row_label, fabric_code: item.fabric_code, quantity: curStock,
      unit: item.unit, unit_cost: item.unit_cost, cost_unit: item.cost_unit, min_quantity: item.min_quantity,
      supplier_id: item.supplier_id ?? null, valuation_method: item.valuation_method ?? "fifo",
      is_active: item.is_active ?? true,
    });
    setFormErrors({});
    setShowModal(true);
  };

  const handleSave = async () => {
    const errors = validate(form);
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    setSaving(true);
    // Blank numeric fields mean "not entered" → fall back to 0 (and the default
    // minimum for สต็อคขั้นต่ำ) before anything reaches the DB.
    const payload = {
      ...form,
      quantity: numOr(form.quantity),
      unit_cost: numOr(form.unit_cost),
      weight: numOr(form.weight),
      min_quantity: numOr(form.min_quantity, DEFAULT_MIN_QTY),
    };
    try {
      if (editId) {
        await updateFabric(editId, payload);
        // Overwrite stock: if the quantity was changed, rebuild the item's lots
        // as a single opening lot at the entry's price.
        if (stockEditEnabled) {
          const curStock = stockFromLots(lotMap.get(editId) ?? []);
          if (payload.quantity !== curStock) {
            await overwriteFabricStock(editId, payload.quantity, payload.unit_cost);
          }
        }
        showToast("อัพเดตแล้ว ✓", "success");
      } else {
        const created = await addFabric(payload);
        // If an initial stock was entered, seed it as an opening lot so it shows
        // up under the lot model (stock is derived from lots).
        if (payload.quantity > 0) {
          await createFabricLot({
            fabric_id: created.id,
            quantity: payload.quantity,
            unit_cost: payload.unit_cost,
            source: "MIGRATION",
            note: "ยอดเริ่มต้น",
          });
        }
        showToast("เพิ่มรายการแล้ว ✓", "success");
      }
      await refresh();
      setShowModal(false);
    } catch (e: any) {
      showToast(e.message ?? "เกิดข้อผิดพลาด", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    try {
      await deleteFabric(id);
      await refresh();
      setDeleteConfirm(null);
      showToast("ลบรายการแล้ว", "success");
    } catch (e: any) {
      showToast(e.message ?? "ลบไม่ได้ — มีประวัติรายการอ้างอิงอยู่", "error");
    } finally {
      setSaving(false);
    }
  };

  const f = (field: keyof FormData, val: string | number | boolean | null) => {
    setForm((prev) => ({ ...prev, [field]: val }));
    setFormErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  if (!authed) return null;

  return (
    <div>
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <SearchInput value={search} onChange={setSearch} placeholder="ค้นหา…" style={{ flex:"1 1 200px" }} />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width:"auto", minWidth:160, maxWidth:260 }}>
          <option value="">ทุกชนิดผ้า</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowInactive(!showInactive)}
          style={showInactive ? { borderColor:"var(--text3)", color:"var(--text2)" } : {}}>
          {showInactive ? "ซ่อนรายการปิด" : "แสดงรายการปิด"}
        </button>
        <button className="primary" onClick={openAdd}>+ เพิ่มรายการใหม่</button>
        {selected.size > 0 && (
          <button className="danger" onClick={runBulkDelete} disabled={saving}>
            ลบที่เลือก ({selected.size})
          </button>
        )}
        <span style={{ marginLeft:"auto", alignSelf:"center", fontSize:12, color:"var(--text3)" }}>{filtered.length} รายการ</span>
      </div>

      <div className="card" style={{ overflow:"hidden" }}>
        {loading ? (
          <div style={{ padding:48, textAlign:"center", color:"var(--text3)" }}>กำลังโหลด…</div>
        ) : (
          <div style={{ height:"72vh", overflowY:"auto", overflowX:"auto" }}>
            <table>
              <thead className="sticky-head">
                <tr>
                  <th style={{ width:40, textAlign:"center" }}>
                    <input type="checkbox" checked={allPageSelected} onChange={togglePageAll} style={{ width:"auto", cursor:"pointer" }} />
                  </th>
                  <th>ชนิดผ้า</th><th>เลขที่</th><th>เส้นใย</th><th>โครงสร้าง</th><th>สี</th><th>หน้าผ้า</th><th>แถว</th>
                  <th>ซัพพลายเออร์</th><th>สต็อค</th><th>หน่วย</th>
                  <th>ราคา</th><th>ขั้นต่ำ</th><th>สถานะ</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={15} style={{ textAlign:"center", color:"var(--text3)", padding:32 }}>ไม่พบรายการ</td></tr>
                )}
                {pg.pageItems.map((item) => (
                  <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.45, background: selected.has(item.id) ? "var(--bg4)" : undefined }}>
                    <td style={{ textAlign:"center" }}>
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleRow(item.id)} style={{ width:"auto", cursor:"pointer" }} />
                    </td>
                    <td style={{ maxWidth:200 }}><span className="tag">{item.fabric_type}</span></td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:15, color:"var(--text2)" }}>{item.fabric_code || <span style={{color:"var(--red)",fontSize:14}}>ไม่มีเลขที่</span>}</td>
                    <td style={{ maxWidth:140, color:"var(--text2)" }}>{item.composition || "—"}</td>
                    <td style={{ maxWidth:140, color:"var(--text2)" }}>{item.construction || "—"}</td>
                    <td style={{ color:"var(--text2)" }}>{item.color || "—"}</td>
                    <td style={{ fontFamily:"var(--mono)", color:"var(--text2)" }}>{item.width || "—"}</td>
                    <td style={{ fontFamily:"var(--mono)", color:"var(--text3)" }}>{item.row_label || "—"}</td>
                    <td style={{ fontSize:17, color:"var(--text2)" }}>{suppliers.find((s) => s.id === item.supplier_id)?.supplier_name || "—"}</td>
                    <td className="num" style={{ fontFamily:"var(--mono)", fontWeight:500 }}>{stockFromLots(lotMap.get(item.id) ?? []).toLocaleString()}</td>
                    <td style={{ color:"var(--text2)" }}>{item.unit}</td>
                    <td className="num" style={{ fontFamily:"var(--mono)", fontSize:15 }}>฿{Number(item.unit_cost).toFixed(2)}</td>
                    <td className="num" style={{ fontFamily:"var(--mono)", fontSize:16, color:"var(--text3)" }}>{Number(item.min_quantity).toLocaleString()}</td>
                    <td>
                      {item.is_active
                        ? <span style={{ fontSize:14, color:"var(--green)" }}>● ใช้งาน</span>
                        : <span style={{ fontSize:14, color:"var(--red)" }}>○ เลิกใช้</span>}
                    </td>
                    <td>
                      <div style={{ display:"flex", gap:4 }}>
                        <button className="ghost" style={{ padding:"4px 8px", fontSize:15 }} onClick={() => openEdit(item)}>แก้ไข</button>
                        <button className="ghost" style={{ padding:"4px 8px", fontSize:15, color:"var(--red)" }} onClick={() => setDeleteConfirm(item.id)}>ลบ</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar {...pg} />
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        /* No close-on-overlay-click: this form holds typed-in data, and an accidental
           click outside used to discard it. Close via ✕ or ยกเลิก only. */
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div style={{ fontWeight:500 }}>{editId ? "แก้ไขรายการ" : "เพิ่มรายการใหม่"}</div>
              <button className="ghost" style={{ padding:"4px 8px" }} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">

              <div className="form-row">
                <label className="form-label">ชนิดผ้า <span style={{color:"var(--red)"}}>*</span></label>
                <Combobox value={form.fabric_type} onChange={(v) => f("fabric_type", v)} options={types}
                  placeholder="เช่น 100% Cotton Single Jersey 20/1" hasError={!!formErrors.fabric_type} />
                {formErrors.fabric_type && <div style={{fontSize:14,color:"var(--red)",marginTop:3}}>{formErrors.fabric_type}</div>}
              </div>

              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">เส้นใย (Composition)</label>
                  <Combobox value={form.composition} onChange={(v) => f("composition", v)} options={compositions}
                    placeholder="เช่น 100% Cotton" />
                </div>
                <div>
                  <label className="form-label">โครงสร้าง (Construction)</label>
                  <Combobox value={form.construction} onChange={(v) => f("construction", v)} options={constructions}
                    placeholder="เช่น Single Jersey" />
                </div>
              </div>

              <div className="form-row">
                <label className="form-label">ซัพพลายเออร์ · Supplier</label>
                <SupplierCombobox
                  value={form.supplier_id}
                  onChange={(v) => f("supplier_id", v)}
                  options={suppliers.map((s) => ({ id: s.id, name: s.supplier_name }))}
                />
              </div>

              <div className="form-row form-grid form-grid-3">
                <div>
                  <label className="form-label">สี</label>
                  <input value={form.color} onChange={(e) => f("color", e.target.value)} placeholder="เช่น ครีม" />
                </div>
                <div>
                  <label className="form-label">หน้าผ้า</label>
                  <input value={form.width} onChange={(e) => f("width", e.target.value)} placeholder="เช่น 73.5 / 32T" />
                </div>
                <div>
                  <label className="form-label">แถว</label>
                  <input value={form.row_label} onChange={(e) => f("row_label", e.target.value)} placeholder="เช่น A1" />
                </div>
              </div>

              <div className="form-row form-grid form-grid-3">
                <div>
                  <label className="form-label">เลขที่</label>
                  <input value={form.fabric_code} onChange={(e) => f("fabric_code", e.target.value)} placeholder="เช่น 147" />
                </div>
                <div>
                  <label className="form-label">น้ำหนัก</label>
                  <input type="number" step="any" value={form.weight}
                    onChange={(e) => f("weight", numInput(e.target.value))}
                    placeholder="0" />
                </div>
                <div>
                  <label className="form-label">หน่วยน้ำหนัก</label>
                  <select value={form.weight_unit} onChange={(e) => f("weight_unit", e.target.value)}>
                    <option value="">—</option>
                    {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row form-grid form-grid-3">
                <div>
                  <label className="form-label">หน่วยสต็อค <span style={{color:"var(--red)"}}>*</span></label>
                  <select value={form.unit} onChange={(e) => f("unit", e.target.value)}>
                    {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">ราคาต่อหน่วย</label>
                  <select value={form.cost_unit} onChange={(e) => f("cost_unit", e.target.value)}>
                    <option value="">—</option>
                    {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">สต็อคขั้นต่ำ</label>
                  <input type="number" step="any" value={form.min_quantity}
                    onChange={(e) => f("min_quantity", numInput(e.target.value))}
                    placeholder={String(DEFAULT_MIN_QTY)} />
                </div>
              </div>

              {!editId ? (
                /* ADD: these seed the opening lot (stock + price live in lots, not the fabric row) */
                <div className="form-row form-grid form-grid-2">
                  <div>
                    <label className="form-label">ราคาซื้อเริ่มต้น (฿)</label>
                    <input type="number" step="0.0001" value={form.unit_cost}
                      onChange={(e) => f("unit_cost", numInput(e.target.value))}
                      placeholder="0.00" />
                  </div>
                  <div>
                    <label className="form-label">สต็อคเริ่มต้น</label>
                    <input type="number" step="any" value={form.quantity}
                      onChange={(e) => f("quantity", numInput(e.target.value))}
                      placeholder="0"
                      style={formErrors.quantity ? {borderColor:"var(--red)"} : {}} />
                    {formErrors.quantity && <div style={{fontSize:11,color:"var(--red)",marginTop:3}}>{formErrors.quantity}</div>}
                  </div>
                </div>
              ) : (
                /* EDIT: editable stock+price that OVERWRITES the lots on save, followed
                   by the lot / price history. */
                <>
                {stockEditEnabled && (
                  <StockEditor
                    currentStock={stockFromLots(lotMap.get(editId) ?? [])}
                    quantity={numOr(form.quantity)}
                    unitCost={numOr(form.unit_cost)}
                    unit={form.unit}
                    onQuantity={(v) => f("quantity", v)}
                    onUnitCost={(v) => f("unit_cost", v)}
                    error={formErrors.quantity}
                  />
                )}
                {(() => {
                  const lots = lotMap.get(editId) ?? [];
                  const stock = stockFromLots(lots);
                  const value = valueFromLots(lots);
                  const avg = stock > 0 ? value / stock : 0;
                  // Each lot is a receipt at a price on a date → the item's price history. Newest first.
                  const history = [...lots].sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime());
                  const SOURCE_TH: Record<string, string> = { IN: "รับเข้า", RETURN: "คืนสต็อค", MIGRATION: "นำเข้า/ตั้งต้น", ADJUST: "ปรับยอด" };
                  return (
                    <div className="form-row">
                      <div style={{ display:"flex", gap:12, marginBottom:10 }}>
                        <div style={{ flex:1, background:"var(--bg3)", borderRadius:"var(--r)", padding:"8px 12px" }}>
                          <div style={{ fontSize:12, color:"var(--text3)" }}>สต็อคปัจจุบัน</div>
                          <div style={{ fontFamily:"var(--mono)", fontWeight:500 }}>{stock.toLocaleString()} {form.unit}</div>
                        </div>
                        <div style={{ flex:1, background:"var(--bg3)", borderRadius:"var(--r)", padding:"8px 12px" }}>
                          <div style={{ fontSize:12, color:"var(--text3)" }}>ราคาเฉลี่ย (จากล็อต)</div>
                          <div style={{ fontFamily:"var(--mono)", fontWeight:500 }}>฿{avg.toLocaleString("th-TH", { minimumFractionDigits:2, maximumFractionDigits:2 })}</div>
                        </div>
                      </div>
                      <div style={{ fontSize:12, color:"var(--text3)", marginBottom:4 }}>
                        ประวัติราคา / การรับเข้า (การแก้สต็อกด้านบนจะเขียนทับประวัตินี้)
                      </div>
                      {history.length === 0 ? (
                        <div style={{ fontSize:14, color:"var(--text3)", padding:"6px 0" }}>ยังไม่มีล็อต (ยังไม่มีการรับเข้า)</div>
                      ) : (
                        <div style={{ maxHeight:160, overflowY:"auto", border:"1px solid var(--border)", borderRadius:"var(--r)" }}>
                          <div style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr 1fr 1.2fr", gap:4, fontSize:12, color:"var(--text3)", padding:"6px 10px", borderBottom:"1px solid var(--border)", position:"sticky", top:0, background:"var(--bg2)" }}>
                            <span>วันที่</span><span className="num">รับเข้า</span><span className="num">ราคา/หน่วย</span><span>ที่มา</span>
                          </div>
                          {history.map((l) => (
                            <div key={l.id} style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr 1fr 1.2fr", gap:4, fontSize:13, padding:"6px 10px", borderBottom:"1px solid var(--border)" }}>
                              <span style={{ fontFamily:"var(--mono)", color:"var(--text2)" }}>{new Date(l.effective_date).toLocaleDateString("th-TH")}</span>
                              <span className="num" style={{ fontFamily:"var(--mono)" }}>{Number(l.quantity_received).toLocaleString()}</span>
                              <span className="num" style={{ fontFamily:"var(--mono)" }}>฿{Number(l.unit_cost).toFixed(2)}</span>
                              <span style={{ color:"var(--text3)", fontSize:12 }}>{SOURCE_TH[l.source] ?? l.source}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                </>
              )}

              {/* is_active toggle */}
              <div className="form-row">
                <label className="form-label">สถานะรายการ</label>
                <div style={{ display:"flex", gap:8 }}>
                  {[{val:true,label:"● ใช้งาน"},{val:false,label:"○ เลิกใช้"}].map((opt) => (
                    <button key={String(opt.val)} onClick={() => f("is_active", opt.val)}
                      style={form.is_active === opt.val ? {
                        borderColor: opt.val ? "var(--green)" : "var(--red)",
                        color: opt.val ? "var(--green)" : "var(--red)",
                        background: "var(--bg4)",
                      } : {}}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

            </div>
            <div className="modal-footer">
              <button onClick={() => setShowModal(false)}>ยกเลิก</button>
              <button className="primary" onClick={handleSave} disabled={saving}>
                {saving ? "กำลังบันทึก…" : editId ? "บันทึกการแก้ไข" : "เพิ่มรายการ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth:360 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight:500, color:"var(--red)" }}>ยืนยันการลบ</div>
              <button className="ghost" style={{ padding:"4px 8px" }} onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color:"var(--text2)" }}>ต้องการลบ <strong style={{ color:"var(--text)" }}>
                {items.find((i) => i.id === deleteConfirm)?.fabric_type} {items.find((i) => i.id === deleteConfirm)?.color}
              </strong>?</p>
              <p style={{ fontSize:12, color:"var(--text3)", marginTop:8 }}>
                ไม่สามารถลบได้หากมีประวัติรายการอ้างอิงอยู่ — ลองกดเลิกใช้แทน
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setDeleteConfirm(null)}>ยกเลิก</button>
              <button className="danger" onClick={() => handleDelete(deleteConfirm)} disabled={saving}>
                {saving ? "กำลังลบ…" : "ลบรายการ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete blocked → offer deactivation */}
      {bulkModal && (
        <div className="modal-overlay" onClick={() => setBulkModal(null)}>
          <div className="modal" style={{ maxWidth:440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight:500, color:"var(--accent)" }}>ลบบางรายการไม่ได้</div>
              <button className="ghost" style={{ padding:"4px 8px" }} onClick={() => setBulkModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color:"var(--text2)" }}>
                <strong style={{ color:"var(--text)" }}>{bulkModal.blocked.length} รายการ</strong> มีประวัติธุรกรรมอยู่ จึงลบไม่ได้เพื่อรักษาประวัติ
              </p>
              <p style={{ fontSize:14, color:"var(--text3)", marginTop:8 }}>
                แนะนำให้ "ปิดใช้งาน" แทนการลบ — รายการจะถูกซ่อนจากการใช้งานปกติ แต่ประวัติยังคงอยู่
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setBulkModal(null)}>ไว้ภายหลัง</button>
              <button className="primary" onClick={() => runBulkDeactivate(bulkModal.blocked)} disabled={saving}>
                {saving ? "กำลังดำเนินการ…" : `ปิดใช้งาน ${bulkModal.blocked.length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
