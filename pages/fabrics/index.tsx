import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/router";
import { getFabrics, getSuppliers, stageFabric, getFabricLotMap, stockFromLots, valueFromLots,
  type Fabric, type Supplier, type FabricImportRow, type FabricLot } from "@/lib/fabric-store";
import { useSession, roleCan } from "@/lib/auth";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";
import { compareFabric } from "@/lib/sort";
import { STOCK_UNITS, WEIGHT_UNITS } from "@/lib/fabric-units";

type AddForm = {
  fabric_type: string; composition: string; construction: string; color: string;
  width: string; weight: string; weight_unit: string; row_label: string; fabric_code: string;
  quantity: string; unit: string; unit_cost: string; cost_unit: string; supplier_id: string;
};
const emptyAdd = (): AddForm => ({
  fabric_type: "", composition: "", construction: "", color: "",
  // numeric fields start blank so the greyed placeholder shows through (see lib/form-num)
  width: "", weight: "", weight_unit: "gm2", row_label: "", fabric_code: "",
  quantity: "", unit: "กก", unit_cost: "", cost_unit: "กก", supplier_id: "",
});

export default function FabricStockPage() {
  const router = useRouter();
  const [items, setItems] = useState<Fabric[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [lotMap, setLotMap] = useState<Map<string, FabricLot[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [showLow, setShowLow] = useState(false);
  const [viewItem, setViewItem] = useState<Fabric | null>(null);
  // Public page — the session only decides whether the "edit in manage" shortcut
  // shows, and only a fabric-side admin can follow it.
  const { role } = useSession();
  const canManage = roleCan(role, "fabric", "admin");   // manage is super-only now
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(emptyAdd());
  const [addErr, setAddErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    Promise.all([getFabrics(), getSuppliers(), getFabricLotMap()])
      .then(([fabs, sups, lm]) => { setItems(fabs); setSuppliers(sups); setLotMap(lm); })
      .finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const stockOf = (id: string) => stockFromLots(lotMap.get(id) ?? []);
  const valueOf = (id: string) => valueFromLots(lotMap.get(id) ?? []);
  const lotsOf = (id: string) => (lotMap.get(id) ?? []).filter((l) => Number(l.quantity_remaining) > 0);
  const types = Array.from(new Set(items.map((i) => i.fabric_type))).sort();

  const filtered = useMemo(() => items.filter((i) => {
    if (showLow && stockOf(i.id) > i.min_quantity) return false;
    if (filterType && i.fabric_type !== filterType) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.fabric_type.toLowerCase().includes(q) ||
      i.composition.toLowerCase().includes(q) ||
      i.construction.toLowerCase().includes(q) ||
      i.color.toLowerCase().includes(q) ||
      i.width.toLowerCase().includes(q) ||
      i.fabric_code.toLowerCase().includes(q) ||
      i.row_label.toLowerCase().includes(q)
    );
  }).sort(compareFabric), [items, lotMap, search, filterType, showLow]);

  const totalValue = items.reduce((s, i) => s + valueOf(i.id), 0);
  const lowCount = items.filter((i) => stockOf(i.id) <= Number(i.min_quantity)).length;
  const pg = usePagination(filtered, `${search}|${filterType}|${showLow}`);

  const af = (field: keyof AddForm, val: string) => { setAddForm((p) => ({ ...p, [field]: val })); setAddErr(""); };

  const handleStage = async () => {
    if (!addForm.fabric_type.trim()) { setAddErr("กรุณาระบุชนิดผ้า"); return; }
    if (!addForm.unit.trim()) { setAddErr("กรุณาระบุหน่วย"); return; }
    setSaving(true);
    try {
      const sup = suppliers.find((s) => s.id === addForm.supplier_id);
      const payload: Omit<FabricImportRow, "id" | "batch_id" | "status" | "created_at" | "approved_at"> = {
        fabric_type: addForm.fabric_type.trim(), composition: addForm.composition.trim(),
        construction: addForm.construction.trim(), color: addForm.color.trim(),
        width: addForm.width.trim(), weight: parseFloat(addForm.weight) || 0,
        weight_unit: addForm.weight_unit.trim(), row_label: addForm.row_label.trim(),
        fabric_code: addForm.fabric_code.trim(),
        quantity: parseFloat(addForm.quantity) || 0, min_quantity: 10, unit: addForm.unit.trim(),
        unit_cost: parseFloat(addForm.unit_cost) || 0, cost_unit: addForm.cost_unit.trim(),
        supplier_name: sup?.supplier_name ?? "", contact_person: sup?.contact_person ?? "",
        contact_number: sup?.contact_number ?? "", contact_email: sup?.contact_email ?? "",
        address: sup?.address ?? "", city: sup?.city ?? "", country: sup?.country ?? "",
        postal_code: sup?.postal_code ?? "", lead_time: sup?.lead_time ?? "",
        payment_term: sup?.payment_term ?? "", tax_id: sup?.tax_id ?? "",
      };
      const { skipped } = await stageFabric(payload);
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
          { label: "ชนิดผ้า",  en: "Fabric types", val: types.length, mono: false },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 500, fontFamily: s.mono ? "var(--mono)" : "var(--font)", color: (s as any).warn ? "var(--accent)" : "var(--text)" }}>{s.val}</div>
            <div style={{ fontSize: 10, color: "var(--text3)" }}>{s.en}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <SearchInput value={search} onChange={setSearch} placeholder="ค้นหาชนิดผ้า เส้นใย สี หน้าผ้า เลขที่…" leftIcon="🔍" style={{ flex: "1 1 240px" }} />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: "auto", minWidth: 160, maxWidth: 260 }}>
          <option value="">ทุกชนิดผ้า</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowLow(!showLow)}
          style={{ whiteSpace: "nowrap", ...(showLow ? { background: "#2b6fd4", borderColor: "var(--accent)", color: "var(--text)" } : {}) }}>
          ⚠ สต็อคต่ำ
        </button>
        <button className="primary" onClick={() => { setAddForm(emptyAdd()); setAddErr(""); setShowAdd(true); }}>+ เพิ่มผ้า</button>
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
                  <th>ชนิดผ้า</th><th>เลขที่</th><th>โครงสร้าง</th><th>สี</th><th>หน้าผ้า</th><th>น้ำหนัก</th><th>แถว</th>
                  <th>สต็อค</th><th>หน่วย</th><th>ราคา/หน่วย</th><th>มูลค่า</th><th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={12} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่พบรายการ</td></tr>
                )}
                {pg.pageItems.map((item) => {
                  const stock = stockOf(item.id);
                  const value = valueOf(item.id);
                  const avgCost = stock > 0 ? value / stock : 0;
                  const isLow = stock <= Number(item.min_quantity);
                  return (
                    <tr key={item.id} style={{ cursor: "pointer" }} onClick={() => setViewItem(item)}>
                      <td><span className="tag">{item.fabric_type}</span></td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 17, color: "var(--text2)" }}>{item.fabric_code || "—"}</td>
                      <td style={{ color: "var(--text2)" }}>{item.construction || "—"}</td>
                      <td style={{ color: "var(--text2)" }}>{item.color || "—"}</td>
                      <td style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>{item.width || "—"}</td>
                      <td className="num" style={{ color: "var(--text3)" }}>
                        {Number(item.weight) ? `${Number(item.weight).toLocaleString()} ${item.weight_unit}` : "—"}
                      </td>
                      <td style={{ fontFamily: "var(--mono)", color: "var(--text3)" }}>{item.row_label || "—"}</td>
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
                <div style={{ fontWeight: 500, fontSize: 16 }}>{viewItem.fabric_type}</div>
                <div style={{ fontSize: 14, color: "var(--text2)" }}>{[viewItem.color, viewItem.construction].filter(Boolean).join(" · ")}</div>
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
                  ["เลขที่", viewItem.fabric_code],
                  ["เส้นใย (Composition)", viewItem.composition],
                  ["โครงสร้าง (Construction)", viewItem.construction],
                  ["สี", viewItem.color],
                  ["หน้าผ้า", viewItem.width],
                  ["น้ำหนัก", Number(viewItem.weight) ? `${Number(viewItem.weight).toLocaleString()} ${viewItem.weight_unit}` : ""],
                  ["แถว", viewItem.row_label],
                  ["สต็อคคงเหลือ", `${vStock.toLocaleString()} ${viewItem.unit}`],
                  ["สต็อคขั้นต่ำ", `${Number(viewItem.min_quantity).toLocaleString()} ${viewItem.unit}`],
                  ["ราคาซื้อเฉลี่ย", `฿${vAvg.toLocaleString("th-TH", { minimumFractionDigits: 2 })}${viewItem.cost_unit ? ` / ${viewItem.cost_unit}` : ""}`],
                  ["มูลค่าคงเหลือ", `฿${vValue.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`],
                  ["วิธีคิดต้นทุน", viewItem.valuation_method === "lifo" ? "LIFO" : "FIFO"],
                  ["สถานะ", viewItem.is_active ? "ใช้งาน" : "เลิกใช้"],
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
                        <span style={{ width: 170, color: "var(--text3)", fontSize: 15, flexShrink: 0 }}>{label}</span>
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
                          <span style={{ width: 170, color: "var(--text3)", fontSize: 15, flexShrink: 0 }}>{label}</span>
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
              {canManage && (
                <button onClick={() => { setViewItem(null); router.push("/fabrics/manage"); }}>แก้ไขในหน้าจัดการ</button>
              )}
              <button className="primary" onClick={() => setViewItem(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* Staged add modal */}
      {showAdd && (
        /* No close-on-overlay-click: this form holds typed-in data, and an accidental
           click outside used to discard it. Close via ✕ or ยกเลิก only. */
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div style={{ fontWeight: 500 }}>เพิ่มผ้า (รอการอนุมัติ)</div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 14, color: "var(--text3)", marginBottom: 14, padding: "8px 10px", background: "var(--bg3)", borderRadius: "var(--r)" }}>
                รายการที่เพิ่มจะเข้าสู่คิวรอการอนุมัติในหน้านำเข้า ก่อนถูกเพิ่มเข้าระบบจริง
              </div>
              <div className="form-row">
                <label className="form-label">ชนิดผ้า <span style={{color:"var(--red)"}}>*</span></label>
                <input value={addForm.fabric_type} onChange={(e) => af("fabric_type", e.target.value)}
                  placeholder="เช่น 100% Cotton Single Jersey 20/1" list="fab-types" />
                <datalist id="fab-types">{types.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">เส้นใย (Composition)</label>
                  <input value={addForm.composition} onChange={(e) => af("composition", e.target.value)} placeholder="เช่น 100% Cotton" />
                </div>
                <div>
                  <label className="form-label">โครงสร้าง (Construction)</label>
                  <input value={addForm.construction} onChange={(e) => af("construction", e.target.value)} placeholder="เช่น Single Jersey" />
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">ซัพพลายเออร์</label>
                <select value={addForm.supplier_id} onChange={(e) => af("supplier_id", e.target.value)}>
                  <option value="">— ไม่ระบุ —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select>
              </div>
              <div className="form-row form-grid form-grid-3">
                <div><label className="form-label">สี</label><input value={addForm.color} onChange={(e) => af("color", e.target.value)} placeholder="เช่น ครีม" /></div>
                <div><label className="form-label">หน้าผ้า</label><input value={addForm.width} onChange={(e) => af("width", e.target.value)} placeholder="เช่น 73.5 หรือ 32T" /></div>
                <div><label className="form-label">แถว</label><input value={addForm.row_label} onChange={(e) => af("row_label", e.target.value)} placeholder="เช่น A1" /></div>
              </div>
              <div className="form-row form-grid form-grid-3">
                <div><label className="form-label">เลขที่</label><input value={addForm.fabric_code} onChange={(e) => af("fabric_code", e.target.value)} placeholder="เช่น 147" /></div>
                <div><label className="form-label">น้ำหนัก</label><input type="number" step="any" value={addForm.weight} onChange={(e) => af("weight", e.target.value)} placeholder="0" /></div>
                <div>
                  <label className="form-label">หน่วยน้ำหนัก</label>
                  <select value={addForm.weight_unit} onChange={(e) => af("weight_unit", e.target.value)}>
                    {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">หน่วยสต็อค <span style={{color:"var(--red)"}}>*</span></label>
                  <select value={addForm.unit} onChange={(e) => af("unit", e.target.value)}>
                    {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div><label className="form-label">สต็อคเริ่มต้น</label><input type="number" step="any" value={addForm.quantity} onChange={(e) => af("quantity", e.target.value)} placeholder="0" /></div>
              </div>
              <div className="form-row form-grid form-grid-2">
                <div><label className="form-label">ราคาซื้อ (฿)</label><input type="number" step="0.01" value={addForm.unit_cost} onChange={(e) => af("unit_cost", e.target.value)} placeholder="0.00" /></div>
                <div>
                  <label className="form-label">ราคาต่อหน่วย</label>
                  <select value={addForm.cost_unit} onChange={(e) => af("cost_unit", e.target.value)}>
                    {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
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
