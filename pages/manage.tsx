import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/router";
import { getAccessories, addAccessory, updateAccessory, deleteAccessory, getSuppliers, bulkDeleteAccessories, bulkDeactivateAccessories, getLotMap, stockFromLots, valueFromLots, createLot, overwriteStock, type Accessory, type Supplier, type Lot } from "@/lib/store";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { useRequireRole } from "@/lib/auth";
import { SearchInput } from "@/lib/search";
import { compareAccessory } from "@/lib/sort";
import { numOr, numInput, DEFAULT_MIN_QTY, type NumField } from "@/lib/form-num";

const UNITS = ["เส้น","โหล","ชิ้น","ม้วน","หลา","กุรุส","กิโล","หลอด","กิโลกรัม"];

type FormData = Omit<Accessory, "id" | "created_at" | "updated_at" | "quantity" | "unit_cost" | "min_quantity"> & {
  quantity: NumField;
  unit_cost: NumField;
  min_quantity: NumField;
};

const emptyForm = (): FormData => ({
  type: "", acc_code: "", description: "", row: null,
  color: "", size: "", quantity: "", unit: "เส้น",
  unit_cost: "", min_quantity: "", supplier_id: null, valuation_method: "fifo", is_active: true,
});

type FormErrors = Partial<Record<keyof FormData, string>>;

function validate(form: FormData): FormErrors {
  const errors: FormErrors = {};
  if (!form.type.trim())  errors.type     = "กรุณาระบุประเภทอุปกรณ์";
  if (!form.unit.trim())  errors.unit     = "กรุณาระบุหน่วย";
  if (form.quantity !== "" && form.quantity < 0) errors.quantity = "จำนวนต้องไม่ติดลบ";
  return errors;
}

function TypeCombobox({ value, onChange, options, hasError }: {
  value: string; onChange: (v: string) => void; options: string[]; hasError?: boolean;
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
        placeholder="เช่น ซิป วีนัส"
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
              + สร้างประเภทใหม่: "{query}"
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
              + สร้างประเภทใหม่: "{query}"
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
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--text3)" }}>
              ไม่พบซัพพลายเออร์
            </div>
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
// overwriteStock in the store). Rendered only when stock-editing is enabled —
// a future separate-auth page will gate this via the `stockEditEnabled` flag.
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
        <input type="number" value={quantity}
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

export default function ManagePage() {
  const router = useRouter();
  const [items, setItems]     = useState<Accessory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [lotMap, setLotMap] = useState<Map<string, Lot[]>>(new Map());
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

  // Gate for in-place stock editing (overwrite → new lot). Hard-enabled for now;
  // a separate admin-auth page will drive this later. Flip to false to restore
  // the read-only price-history view in the edit modal.
  const stockEditEnabled = true;

  // Auth gate
  const { authed } = useRequireRole("acc");

  useEffect(() => {
    if (!authed) return;
    Promise.all([getAccessories(), getSuppliers(), getLotMap()])
      .then(([accs, sups, lm]) => { setItems(accs); setSuppliers(sups); setLotMap(lm); })
      .finally(() => setLoading(false));
  }, [authed]);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refresh = () => Promise.all([getAccessories(), getLotMap()]).then(([a, lm]) => { setItems(a); setLotMap(lm); });
  const types   = Array.from(new Set(items.map((i) => i.type))).sort();

  const filtered = useMemo(() => items.filter((i) => {
    if (!showInactive && !i.is_active) return false;
    if (filterType && i.type !== filterType) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const supName = (suppliers.find((s) => s.id === i.supplier_id)?.supplier_name ?? "").toLowerCase();
    return (
      i.type.toLowerCase().includes(q) ||
      i.acc_code.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.color.toLowerCase().includes(q) ||
      i.size.toLowerCase().includes(q) ||
      supName.includes(q)
    );
  }).sort(compareAccessory), [items, suppliers, search, filterType, showInactive]);

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
      const { deleted, blocked } = await bulkDeleteAccessories(ids);
      await refresh();
      setSelected(new Set());
      if (blocked.length > 0) {
        // Keep the blocked ids so the modal can offer deactivation
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
      await bulkDeactivateAccessories(ids);
      await refresh();
      setBulkModal(null);
      setSelected(new Set());
      showToast(`ปิดใช้งาน ${ids.length} รายการแล้ว`, "success");
    } catch (e: any) {
      showToast(e.message ?? "เกิดข้อผิดพลาด", "error");
    } finally { setSaving(false); }
  };

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setFormErrors({}); setShowModal(true); };
  const openEdit = (item: Accessory) => {
    setEditId(item.id);
    // Stock lives in lots — seed the editable field from the lot-derived total
    // (what the table shows), not the accessory's mirror column.
    const curStock = stockFromLots(lotMap.get(item.id) ?? []);
    setForm({
      type: item.type, acc_code: item.acc_code, description: item.description,
      row: item.row, color: item.color, size: item.size, quantity: curStock,
      unit: item.unit, unit_cost: item.unit_cost, min_quantity: item.min_quantity,
      supplier_id: item.supplier_id ?? null, valuation_method: item.valuation_method ?? "fifo", is_active: item.is_active ?? true,
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
      min_quantity: numOr(form.min_quantity, DEFAULT_MIN_QTY),
    };
    try {
      if (editId) {
        await updateAccessory(editId, payload);
        // Overwrite stock: if the quantity was changed, rebuild the item's lots
        // as a single opening lot at the entry's price (see overwriteStock).
        if (stockEditEnabled) {
          const curStock = stockFromLots(lotMap.get(editId) ?? []);
          if (payload.quantity !== curStock) {
            await overwriteStock(editId, payload.quantity, payload.unit_cost);
          }
        }
        showToast("อัพเดตแล้ว ✓", "success");
      } else {
        const created = await addAccessory(payload);
        // If an initial stock was entered, seed it as an opening lot so it
        // shows up under the lot model (stock is derived from lots).
        if (payload.quantity > 0) {
          await createLot({
            accessory_id: created.id,
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
      await deleteAccessory(id);
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
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width:"auto", minWidth:160 }}>
          <option value="">ทุกประเภท</option>
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
                  <th>ประเภท</th><th>รหัส</th><th>รายละเอียด</th><th>สี</th><th>ขนาด</th><th>แถว</th>
                  <th>ซัพพลายเออร์</th><th>สต็อค</th><th>หน่วย</th>
                  <th>ราคา</th><th>ขั้นต่ำ</th><th>สถานะ</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={14} style={{ textAlign:"center", color:"var(--text3)", padding:32 }}>ไม่พบรายการ</td></tr>
                )}
                {pg.pageItems.map((item) => (
                  <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.45, background: selected.has(item.id) ? "var(--bg4)" : undefined }}>
                    <td style={{ textAlign:"center" }}>
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleRow(item.id)} style={{ width:"auto", cursor:"pointer" }} />
                    </td>
                    <td><span className="tag">{item.type}</span></td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:15, color:"var(--text2)" }}>{item.acc_code || <span style={{color:"var(--red)",fontSize:14}}>ไม่มีรหัส</span>}</td>
                    <td style={{ maxWidth:160 }}>{item.description || "—"}</td>
                    <td style={{ color:"var(--text2)" }}>{item.color || "—"}</td>
                    <td style={{ color:"var(--text2)" }}>{item.size  || "—"}</td>
                    <td style={{ fontFamily:"var(--mono)", color:"var(--text3)" }}>{item.row ?? "—"}</td>
                    <td style={{ fontSize:17, color:"var(--text2)" }}>{suppliers.find((s) => s.id === item.supplier_id)?.supplier_name || "—"}</td>
                    <td className="num" style={{ fontFamily:"var(--mono)", fontWeight:500 }}>{stockFromLots(lotMap.get(item.id) ?? []).toLocaleString()}</td>
                    <td style={{ color:"var(--text2)" }}>{item.unit}</td>
                    <td className="num" style={{ fontFamily:"var(--mono)", fontSize:15 }}>฿{Number(item.unit_cost).toFixed(2)}</td>
                    <td className="num" style={{ fontFamily:"var(--mono)", fontSize:16, color:"var(--text3)" }}>{Number(item.min_quantity).toLocaleString()}</td>
                    <td>
                      {item.is_active
                        ? <span style={{ fontSize:14, color:"var(--green)" }}>● ใช้งาน</span>
                        : <span style={{ fontSize:14, color:"var(--red)" }}>○ เลิกผลิต</span>}
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

              {/* type + acc_code — both required */}
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">ชนิดอุปกรณ์ <span style={{color:"var(--red)"}}>*</span></label>
                  <TypeCombobox
                    value={form.type}
                    onChange={(v) => f("type", v)}
                    options={types}
                    hasError={!!formErrors.type}
                  />
                  {formErrors.type && <div style={{fontSize:14,color:"var(--red)",marginTop:3}}>{formErrors.type}</div>}
                </div>
                <div>
                  <label className="form-label">รหัสสินค้า</label>
                  <input value={form.acc_code} onChange={(e) => f("acc_code", e.target.value)}
                    placeholder="เช่น VC-32" />
                </div>
              </div>

              <div className="form-row">
                <label className="form-label">รายละเอียด</label>
                <input value={form.description} onChange={(e) => f("description", e.target.value)} placeholder="รายละเอียดสินค้า" />
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
                  <input value={form.color} onChange={(e) => f("color", e.target.value)} placeholder="เช่น สีดำ" />
                </div>
                <div>
                  <label className="form-label">ขนาด</label>
                  <input value={form.size} onChange={(e) => f("size", e.target.value)} placeholder="เช่น 5นิ้ว" />
                </div>
                <div>
                  <label className="form-label">แถว (ด้าย)</label>
                  <input type="number" value={form.row ?? ""}
                    onChange={(e) => f("row", e.target.value ? parseInt(e.target.value) : null)} placeholder="—" />
                </div>
              </div>

              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">หน่วย <span style={{color:"var(--red)"}}>*</span></label>
                  <select value={form.unit} onChange={(e) => f("unit", e.target.value)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">สต็อคขั้นต่ำ (แจ้งเตือน)</label>
                  <input type="number" value={form.min_quantity}
                    onChange={(e) => f("min_quantity", numInput(e.target.value))}
                    placeholder={String(DEFAULT_MIN_QTY)} />
                </div>
              </div>

              {!editId ? (
                /* ADD: these seed the opening lot (stock + price live in lots, not the accessory row) */
                <div className="form-row form-grid form-grid-2">
                  <div>
                    <label className="form-label">ราคาซื้อเริ่มต้น (฿)</label>
                    <input type="number" step="0.0001" value={form.unit_cost}
                      onChange={(e) => f("unit_cost", numInput(e.target.value))}
                      placeholder="0.00" />
                  </div>
                  <div>
                    <label className="form-label">สต็อคเริ่มต้น</label>
                    <input type="number" value={form.quantity}
                      onChange={(e) => f("quantity", numInput(e.target.value))}
                      placeholder="0"
                      style={formErrors.quantity ? {borderColor:"var(--red)"} : {}} />
                    {formErrors.quantity && <div style={{fontSize:11,color:"var(--red)",marginTop:3}}>{formErrors.quantity}</div>}
                  </div>
                </div>
              ) : (
                /* EDIT: when stock-editing is enabled, an editable stock+price field that
                   OVERWRITES the lots on save; always followed by the lot / price history. */
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
                        {stockEditEnabled
                          ? "ประวัติราคา / การรับเข้า (การแก้สต็อกด้านบนจะเขียนทับประวัตินี้)"
                          : "ประวัติราคา / การรับเข้า — แก้สต็อกหรือราคาผ่านหน้า “บันทึกรายการ” (รับเข้า) เท่านั้น"}
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
                  {[{val:true,label:"● ใช้งาน"},{val:false,label:"○ เลิกผลิต"}].map((opt) => (
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
                {items.find((i) => i.id === deleteConfirm)?.type} {items.find((i) => i.id === deleteConfirm)?.description}
              </strong>?</p>
              <p style={{ fontSize:12, color:"var(--text3)", marginTop:8 }}>
                ไม่สามารถลบได้หากมีประวัติรายการอ้างอิงอยู่ — ลองกดเลิกผลิตแทน
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
