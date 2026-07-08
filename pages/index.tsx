import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAccessories, getSuppliers, stageAccessory, getLotMap, stockFromLots, valueFromLots, type Accessory, type Supplier, type ImportRow, type Lot } from "@/lib/store";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";

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
  const [lotMap, setLotMap] = useState<Map<string, Lot[]>>(new Map());
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
    Promise.all([getAccessories(), getSuppliers(), getLotMap()])
      .then(([accs, sups, lm]) => { setItems(accs); setSuppliers(sups); setLotMap(lm); })
      .finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const supName = (id: string | null) => suppliers.find((s) => s.id === id)?.supplier_name ?? "—";
  const stockOf = (id: string) => stockFromLots(lotMap.get(id) ?? []);
  const valueOf = (id: string) => valueFromLots(lotMap.get(id) ?? []);
  const lotsOf = (id: string) => (lotMap.get(id) ?? []).filter((l) => Number(l.quantity_remaining) > 0);
  const types = Array.from(new Set(items.map((i) => i.type))).sort();

  const filtered = items.filter((i) => {
    if (showLow && stockOf(i.id) > i.min_quantity) return false;
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

  const totalValue = items.reduce((s, i) => s + valueOf(i.id), 0);
  const lowCount = items.filter((i) => stockOf(i.id) <= Number(i.min_quantity)).length;
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
        quantity: parseFloat(addForm.quantity) || 0, min_quantity: 10, unit: addForm.unit.trim(),
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
      <div className="stat-grid" style={{ marginBottom: 24 }}>
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
        <SearchInput value={search} onChange={setSearch} placeholder="ค้นหาชื่อ รหัส สี ขนาด…" leftIcon="🔍" style={{ flex: "1 1 240px" }} />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: "auto", minWidth: 160 }}>
          <option value="">ทุกประเภท</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowLow(!showLow)}
          style={{ whiteSpace: "nowrap", ...(showLow ? { background: "#2b6fd4", borderColor: "var(--accent)", color: "var(--text)" } : {}) }}>
          ⚠ สต็อคต่ำ
        </button>
        <button className="primary" onClick={() => { setAddForm(emptyAdd()); setAddErr(""); setShowAdd(true); }}>+ เพิ่มอุปกรณ์</button>
        <span style={{ alignSelf: "center", fontSize: 17, color: "var(--text3)", minWidth: 90, whiteSpace: "nowrap" }}>{filtered.length} รายการ</span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text3)" }}>กำลังโหลด…</div>
        ) : (
          <div style={{ height: "72vh", overflowY: "auto", overflowX: "auto" }}>
            <table>
              <thead className="sticky-head">
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
                  const stock = stockOf(item.id);
                  const value = valueOf(item.id);
                  const avgCost = stock > 0 ? value / stock : 0;
                  const isLow = stock <= Number(item.min_quantity);
                  return (
                    <tr key={item.id} style={{ cursor: "pointer" }} onClick={() => setViewItem(item)}>
                      <td><span className="tag">{item.type}</span></td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 17, color: "var(--text2)" }}>{item.acc_code || "—"}</td>
                      <td>{item.description || "—"}</td>
                      <td style={{ color: "var(--text2)" }}>{item.color || "—"}</td>
                      <td style={{ color: "var(--text2)" }}>{item.size || "—"}</td>
                      <td style={{ fontFamily: "var(--mono)", color: "var(--text3)" }}>{item.row ?? "—"}</td>
                      <td className="num" style={{ color: isLow ? "var(--accent)" : "var(--text)", fontWeight: isLow ? 500 : 400 }}>
                        {stock.toLocaleString()}
                      </td>
                      <td style={{ color: "var(--text2)" }}>{item.unit}</td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 15 }}>
                        ฿{avgCost.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--text2)" }}>
                        ฿{value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
              {(() => {
                const sup = suppliers.find((s) => s.id === viewItem.supplier_id) ?? null;
                const vStock = stockOf(viewItem.id);
                const vValue = valueOf(viewItem.id);
                const vAvg = vStock > 0 ? vValue / vStock : 0;
                const vLots = lotsOf(viewItem.id);
                const rows: [string, string][] = [
                  ["รหัสสินค้า", viewItem.acc_code],
                  ["รายละเอียด", viewItem.description],
                  ["สี", viewItem.color],
                  ["ขนาด", viewItem.size],
                  ["แถว (ด้าย)", viewItem.row != null ? String(viewItem.row) : ""],
                  ["สต็อคคงเหลือ", `${vStock.toLocaleString()} ${viewItem.unit}`],
                  ["สต็อคขั้นต่ำ", `${Number(viewItem.min_quantity).toLocaleString()} ${viewItem.unit}`],
                  ["ราคาซื้อเฉลี่ย", `฿${vAvg.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`],
                  ["มูลค่าคงเหลือ", `฿${vValue.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`],
                  ["วิธีคิดต้นทุน", viewItem.valuation_method === "lifo" ? "LIFO" : "FIFO"],
                  ["สถานะ", viewItem.is_active ? "ใช้งาน" : "เลิกผลิต"],
                ];
                const supRows: [string, string][] = sup ? [
                  ["ชื่อบริษัท", sup.supplier_name],
                  ["รหัสซัพพลายเออร์", sup.supplier_code],
                  ["ผู้ติดต่อ", sup.contact_person],
                  ["เบอร์ติดต่อ", sup.contact_number],
                  ["อีเมล", sup.contact_email],
                  ["Line ID", sup.line_id],
                  ["ที่อยู่", sup.address],
                  ["จังหวัด", sup.city],
                  ["ประเทศ", sup.country],
                  ["รหัสไปรษณีย์", sup.postal_code],
                  ["ระยะเวลาส่ง", sup.lead_time],
                  ["เทอมจ่ายเงิน", sup.payment_term],
                  ["เลขผู้เสียภาษี", sup.tax_id],
                ] : [];
                return (
                  <>
                    {rows.map(([label, val]) => (
                      <div key={label} style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                        <span style={{ width: 150, color: "var(--text3)", fontSize: 15, flexShrink: 0 }}>{label}</span>
                        <span style={{ color: "var(--text)", wordBreak: "break-word" }}>{val || "—"}</span>
                      </div>
                    ))}

                    {/* Per-lot breakdown */}
                    <div style={{ padding: "14px 0 4px", fontSize: 14, color: "var(--accent)", fontWeight: 500 }}>
                      ล็อตสต็อค ({vLots.length})
                    </div>
                    {vLots.length === 0 ? (
                      <div style={{ padding: "8px 0", color: "var(--text3)", fontSize: 15 }}>ไม่มีล็อตคงเหลือ</div>
                    ) : (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, fontSize: 12, color: "var(--text3)", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                          <span>วันที่</span><span className="num">คงเหลือ</span><span className="num">ราคา/หน่วย</span><span className="num">มูลค่า</span>
                        </div>
                        {vLots.map((l) => (
                          <div key={l.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>{new Date(l.effective_date).toLocaleDateString("th-TH")}</span>
                            <span className="num" style={{ fontFamily: "var(--mono)" }}>{Number(l.quantity_remaining).toLocaleString()}</span>
                            <span className="num" style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>฿{Number(l.unit_cost).toFixed(2)}</span>
                            <span className="num" style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>฿{(Number(l.quantity_remaining) * Number(l.unit_cost)).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ padding: "14px 0 4px", fontSize: 14, color: "var(--accent)", fontWeight: 500 }}>
                      ซัพพลายเออร์
                    </div>
                    {sup ? (
                      supRows.map(([label, val]) => (
                        <div key={label} style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ width: 150, color: "var(--text3)", fontSize: 15, flexShrink: 0 }}>{label}</span>
                          <span style={{ color: "var(--text)", wordBreak: "break-word" }}>{val || "—"}</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: "8px 0", color: "var(--text3)", fontSize: 15 }}>ไม่ได้ระบุซัพพลายเออร์</div>
                    )}
                  </>
                );
              })()}
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
