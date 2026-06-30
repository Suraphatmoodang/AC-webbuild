import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAccessories, getSuppliers, stageAccessory, type Accessory, type Supplier, type ImportRow } from "@/lib/store";
import { usePagination, PaginationBar } from "@/lib/pagination";

const UNITS = ["เส้น","โหล","ชิ้น","ม้วน","หลา","กุรุส","กิโล","หลอด","กิโลกรัม"];

type AddForm = {
  type: string; acc_code: string; description: string; row: string;
  color: string; size: string; quantity: string; unit: string; unit_cost: string;
  supplier_id: string;
};
const emptyAdd = (): AddForm => ({
  type: "", acc_code: "", description: "", row: "", color: "", size: "",
  quantity: "0", unit: "เส้น", unit_cost: "0", supplier_id: "",
});

export default function StockPage() {
  const router = useRouter();
  const [items, setItems] = useState<Accessory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [showLow, setShowLow] = useState(false);
  const [viewItem, setViewItem] = useState<Accessory | null>(null);
  const [authed, setAuthed] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(emptyAdd());
  const [addErr, setAddErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    setAuthed(typeof window !== "undefined" && sessionStorage.getItem("manage_auth") === "1");
    Promise.all([getAccessories(), getSuppliers()])
      .then(([accs, sups]) => { setItems(accs); setSuppliers(sups); })
      .finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const supName = (id: string | null) => suppliers.find((s) => s.id === id)?.supplier_name ?? "—";
  const types = Array.from(new Set(items.map((i) => i.type))).sort();

  const filtered = items.filter((i) => {
    if (showLow && i.quantity > i.min_quantity) return false;
    if (filterType && i.type !== filterType) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.type.toLowerCase().includes(q) ||
      i.acc_code.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.color.toLowerCase().includes(q) ||
      i.size.toLowerCase().includes(q)
    );
  });

  const totalValue = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost), 0);
  const lowCount = items.filter((i) => Number(i.quantity) <= Number(i.min_quantity)).length;
  const pg = usePagination(filtered, `${search}|${filterType}|${showLow}`);

  const af = (field: keyof AddForm, val: string) => { setAddForm((p) => ({ ...p, [field]: val })); setAddErr(""); };

  const handleStage = async () => {
    if (!addForm.type.trim()) { setAddErr("กรุณาระบุประเภทอุปกรณ์"); return; }
    if (!addForm.unit.trim()) { setAddErr("กรุณาระบุหน่วย"); return; }
    setSaving(true);
    try {
      const sup = suppliers.find((s) => s.id === addForm.supplier_id);
      const payload: Omit<ImportRow, "id" | "batch_id" | "status" | "created_at" | "approved_at"> = {
        type: addForm.type.trim(), acc_code: addForm.acc_code.trim(), description: addForm.description.trim(),
        row: addForm.row ? parseInt(addForm.row) || null : null,
        color: addForm.color.trim(), size: addForm.size.trim(),
        quantity: parseFloat(addForm.quantity) || 0, unit: addForm.unit.trim(),
        unit_cost: parseFloat(addForm.unit_cost) || 0,
        supplier_name: sup?.supplier_name ?? "", contact_person: sup?.contact_person ?? "",
        contact_number: sup?.contact_number ?? "", contact_email: sup?.contact_email ?? "",
        address: sup?.address ?? "", city: sup?.city ?? "", country: sup?.country ?? "",
        postal_code: sup?.postal_code ?? "", lead_time: sup?.lead_time ?? "",
        payment_term: sup?.payment_term ?? "", tax_id: sup?.tax_id ?? "",
      };
      const { skipped } = await stageAccessory(payload);
      if (skipped) showToast("รายการนี้มีอยู่ในคิวรอตรวจสอบแล้ว", "error");
      else showToast("ส่งรายการเข้าคิวรอการอนุมัติแล้ว ✓", "success");
      setShowAdd(false);
      setAddForm(emptyAdd());
    } catch (e: any) {
      showToast("เกิดข้อผิดพลาด: " + (e.message ?? ""), "error");
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "รายการทั้งหมด", en: "Total items",  val: items.length, mono: false },
          { label: "มูลค่าสต็อค (฿)", en: "Stock value", val: "฿" + totalValue.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), mono: true },
          { label: "สต็อคต่ำ", en: "Low stock",   val: lowCount,     mono: false, warn: lowCount > 0 },
          { label: "ประเภท",   en: "Types",       val: types.length, mono: false },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 500, fontFamily: s.mono ? "var(--mono)" : "var(--font)", color: (s as any).warn ? "var(--accent)" : "var(--text)" }}>{s.val}</div>
            <div style={{ fontSize: 10, color: "var(--text3)" }}>{s.en}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text3)" }}>🔍</span>
          <input placeholder="ค้นหาชื่อ รหัส สี ขนาด…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: "auto", minWidth: 160 }}>
          <option value="">ทุกประเภท</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowLow(!showLow)}
          style={{ whiteSpace: "nowrap", ...(showLow ? { background: "#2b6fd4", borderColor: "var(--accent)", color: "var(--text)" } : {}) }}>
          ⚠ สต็อคต่ำ
        </button>
        {authed && <button className="primary" onClick={() => { setAddForm(emptyAdd()); setAddErr(""); setShowAdd(true); }}>+ เพิ่มอุปกรณ์</button>}
        <span style={{ alignSelf: "center", fontSize: 17, color: "var(--text3)", minWidth: 90, whiteSpace: "nowrap" }}>{filtered.length} รายการ</span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text3)" }}>กำลังโหลด…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>ประเภท</th><th>รหัส</th><th>รายละเอียด</th><th>สี</th><th>ขนาด</th><th>แถว</th>
                  <th>สต็อค</th><th>หน่วย</th><th>ราคา/หน่วย</th><th>มูลค่า</th><th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่พบรายการ</td></tr>
                )}
                {pg.pageItems.map((item) => {
                  const isLow = Number(item.quantity) <= Number(item.min_quantity);
                  return (
                    <tr key={item.id} style={{ cursor: "pointer" }} onClick={() => setViewItem(item)}>
                      <td><span className="tag">{item.type}</span></td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 17, color: "var(--text2)" }}>{item.acc_code || "—"}</td>
                      <td>{item.description || "—"}</td>
                      <td style={{ color: "var(--text2)" }}>{item.color || "—"}</td>
                      <td style={{ color: "var(--text2)" }}>{item.size || "—"}</td>
                      <td style={{ fontFamily: "var(--mono)", color: "var(--text3)" }}>{item.row ?? "—"}</td>
                      <td className="num" style={{ color: isLow ? "var(--accent)" : "var(--text)", fontWeight: isLow ? 500 : 400 }}>
                        {Number(item.quantity).toLocaleString()}
                      </td>
                      <td style={{ color: "var(--text2)" }}>{item.unit}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 15 }}>
                        ฿{Number(item.unit_cost).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--text2)" }}>
                        ฿{(Number(item.quantity) * Number(item.unit_cost)).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td>
                        {isLow
                          ? <span className="badge badge-low">ต่ำ</span>
                          : <span style={{ fontSize: 15, color: "var(--green)" }}>✓ ปกติ</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar {...pg} />
      </div>

      {/* Detail modal */}
      {viewItem && (
        <div className="modal-overlay" onClick={() => setViewItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ fontWeight: 500, fontSize: 16 }}>{viewItem.type}</div>
                <div style={{ fontSize: 14, color: "var(--text2)" }}>{viewItem.description}</div>
              </div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setViewItem(null)}>✕</button>
            </div>
            <div className="modal-body">
              {[
                ["รหัสสินค้า", viewItem.acc_code],
                ["รายละเอียด", viewItem.description],
                ["สี", viewItem.color],
                ["ขนาด", viewItem.size],
                ["แถว (ด้าย)", viewItem.row != null ? String(viewItem.row) : ""],
                ["สต็อคคงเหลือ", `${Number(viewItem.quantity).toLocaleString()} ${viewItem.unit}`],
                ["สต็อคขั้นต่ำ", `${Number(viewItem.min_quantity).toLocaleString()} ${viewItem.unit}`],
                ["ราคาซื้อ", `฿${Number(viewItem.unit_cost).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`],
                ["มูลค่าคงเหลือ", `฿${(Number(viewItem.quantity) * Number(viewItem.unit_cost)).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`],
                ["ซัพพลายเออร์", supName(viewItem.supplier_id)],
                ["สถานะ", viewItem.is_active ? "ใช้งาน" : "เลิกผลิต"],
              ].map(([label, val]) => (
                <div key={label} style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ width: 150, color: "var(--text3)", fontSize: 15, flexShrink: 0 }}>{label}</span>
                  <span style={{ color: "var(--text)" }}>{val || "—"}</span>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              {authed && (
                <button onClick={() => { setViewItem(null); router.push("/manage"); }}>แก้ไขในหน้าจัดการ</button>
              )}
              <button className="primary" onClick={() => setViewItem(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* Staged add modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500 }}>เพิ่มอุปกรณ์ (รอการอนุมัติ)</div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 14, color: "var(--text3)", marginBottom: 14, padding: "8px 10px", background: "var(--bg3)", borderRadius: "var(--r)" }}>
                รายการที่เพิ่มจะเข้าสู่คิวรอการอนุมัติในหน้านำเข้า ก่อนถูกเพิ่มเข้าระบบจริง
              </div>
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">ชนิดอุปกรณ์ <span style={{color:"var(--red)"}}>*</span></label>
                  <input value={addForm.type} onChange={(e) => af("type", e.target.value)} placeholder="เช่น ซิป วีนัส" list="idx-types" />
                  <datalist id="idx-types">{types.map((t) => <option key={t} value={t} />)}</datalist>
                </div>
                <div>
                  <label className="form-label">รหัสสินค้า</label>
                  <input value={addForm.acc_code} onChange={(e) => af("acc_code", e.target.value)} placeholder="เช่น VC-32" />
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">รายละเอียด</label>
                <input value={addForm.description} onChange={(e) => af("description", e.target.value)} placeholder="รายละเอียดสินค้า" />
              </div>
              <div className="form-row">
                <label className="form-label">ซัพพลายเออร์</label>
                <select value={addForm.supplier_id} onChange={(e) => af("supplier_id", e.target.value)}>
                  <option value="">— ไม่ระบุ —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select>
              </div>
              <div className="form-row form-grid form-grid-3">
                <div><label className="form-label">สี</label><input value={addForm.color} onChange={(e) => af("color", e.target.value)} placeholder="เช่น สีดำ" /></div>
                <div><label className="form-label">ขนาด</label><input value={addForm.size} onChange={(e) => af("size", e.target.value)} placeholder="เช่น 5นิ้ว" /></div>
                <div><label className="form-label">แถว (ด้าย)</label><input type="number" value={addForm.row} onChange={(e) => af("row", e.target.value)} placeholder="—" /></div>
              </div>
              <div className="form-row form-grid form-grid-3">
                <div>
                  <label className="form-label">หน่วย <span style={{color:"var(--red)"}}>*</span></label>
                  <select value={addForm.unit} onChange={(e) => af("unit", e.target.value)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div><label className="form-label">ราคาซื้อ (฿)</label><input type="number" step="0.01" value={addForm.unit_cost} onChange={(e) => af("unit_cost", e.target.value)} /></div>
                <div><label className="form-label">สต็อคเริ่มต้น</label><input type="number" value={addForm.quantity} onChange={(e) => af("quantity", e.target.value)} /></div>
              </div>
              {addErr && <div style={{ color: "var(--red)", fontSize: 14, marginTop: 4 }}>{addErr}</div>}
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowAdd(false)}>ยกเลิก</button>
              <button className="primary" onClick={handleStage} disabled={saving}>
                {saving ? "กำลังส่ง…" : "ส่งเข้าคิวอนุมัติ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
