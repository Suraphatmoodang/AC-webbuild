import { useEffect, useState } from "react";
import {
  getAccessories, addAccessory, updateAccessory, deleteAccessory,
  type Accessory,
} from "@/lib/store";

const UNITS = ["เส้น", "โหล", "ชิ้น", "ม้วน", "หลา", "กุรุส", "กิโล", "หลอด", "กิโลกรัม", "ขิ้น"];

type FormData = Omit<Accessory, "id" | "created_at" | "updated_at">;

const emptyForm = (): FormData => ({
  type: "", acc_code: "", description: "", row: null,
  color: "", size: "", quantity: 0, unit: "เส้น",
  unit_cost: 0, min_quantity: 10,
});

export default function ManagePage() {
  const [items, setItems] = useState<Accessory[]>([]);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => { setItems(getAccessories()); }, []);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const types = Array.from(new Set(items.map((i) => i.type))).sort();

  const filtered = items.filter((i) => {
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

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (item: Accessory) => {
    setEditId(item.id);
    setForm({
      type: item.type, acc_code: item.acc_code, description: item.description,
      row: item.row, color: item.color, size: item.size,
      quantity: item.quantity, unit: item.unit, unit_cost: item.unit_cost,
      min_quantity: item.min_quantity,
    });
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.type.trim()) { showToast("กรุณาระบุประเภทอุปกรณ์", "error"); return; }
    if (editId) {
      updateAccessory(editId, form);
      showToast("อัพเดตแล้ว ✓", "success");
    } else {
      addAccessory(form);
      showToast("เพิ่มรายการแล้ว ✓", "success");
    }
    setItems(getAccessories());
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    deleteAccessory(id);
    setItems(getAccessories());
    setDeleteConfirm(null);
    showToast("ลบรายการแล้ว", "success");
  };

  const f = (field: keyof FormData, val: string | number | null) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          placeholder="ค้นหา…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 200px" }}
        />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: "auto", minWidth: 160 }}>
          <option value="">ทุกประเภท</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="primary" onClick={openAdd}>+ เพิ่มรายการใหม่</button>
        <span style={{ alignSelf: "center", fontSize: 12, color: "var(--text3)" }}>{filtered.length} รายการ</span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>ประเภท</th>
                <th>รหัส</th>
                <th>รายละเอียด</th>
                <th>สี</th>
                <th>ขนาด</th>
                <th>แถว</th>
                <th className="num">สต็อค</th>
                <th>หน่วย</th>
                <th className="num">ราคา</th>
                <th className="num">ขั้นต่ำ</th>
                <th>แก้ไข</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่พบรายการ</td></tr>
              )}
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td><span className="tag">{item.type}</span></td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text2)" }}>{item.acc_code || "—"}</td>
                  <td style={{ maxWidth: 180 }}>{item.description || "—"}</td>
                  <td style={{ color: "var(--text2)" }}>{item.color || "—"}</td>
                  <td style={{ color: "var(--text2)" }}>{item.size || "—"}</td>
                  <td style={{ fontFamily: "var(--mono)", color: "var(--text3)" }}>{item.row ?? "—"}</td>
                  <td className="num" style={{ fontFamily: "var(--mono)", fontWeight: 500 }}>{item.quantity.toLocaleString()}</td>
                  <td style={{ color: "var(--text2)" }}>{item.unit}</td>
                  <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>฿{item.unit_cost.toFixed(2)}</td>
                  <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text3)" }}>{item.min_quantity}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => openEdit(item)}>แก้ไข</button>
                      <button className="ghost" style={{ padding: "4px 8px", fontSize: 12, color: "var(--red)" }} onClick={() => setDeleteConfirm(item.id)}>ลบ</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500 }}>{editId ? "แก้ไขรายการ" : "เพิ่มรายการใหม่"}</div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">ชนิดอุปกรณ์ *</label>
                  <input value={form.type} onChange={(e) => f("type", e.target.value)} placeholder="เช่น ซิป วีนัส" list="type-list" />
                  <datalist id="type-list">
                    {types.map((t) => <option key={t} value={t} />)}
                  </datalist>
                </div>
                <div>
                  <label className="form-label">รหัสสินค้า</label>
                  <input value={form.acc_code} onChange={(e) => f("acc_code", e.target.value)} placeholder="เช่น VC-32" />
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">รายละเอียด</label>
                <input value={form.description} onChange={(e) => f("description", e.target.value)} placeholder="รายละเอียดสินค้า" />
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
                  <input type="number" value={form.row ?? ""} onChange={(e) => f("row", e.target.value ? parseInt(e.target.value) : null)} placeholder="—" />
                </div>
              </div>
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">หน่วย</label>
                  <select value={form.unit} onChange={(e) => f("unit", e.target.value)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">ราคาซื้อ (฿)</label>
                  <input type="number" step="0.01" value={form.unit_cost} onChange={(e) => f("unit_cost", parseFloat(e.target.value) || 0)} />
                </div>
              </div>
              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">สต็อคเริ่มต้น</label>
                  <input type="number" value={form.quantity} onChange={(e) => f("quantity", parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="form-label">สต็อคขั้นต่ำ (แจ้งเตือน)</label>
                  <input type="number" value={form.min_quantity} onChange={(e) => f("min_quantity", parseFloat(e.target.value) || 0)} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowModal(false)}>ยกเลิก</button>
              <button className="primary" onClick={handleSave}>{editId ? "บันทึกการแก้ไข" : "เพิ่มรายการ"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500, color: "var(--red)" }}>ยืนยันการลบ</div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: "var(--text2)" }}>
                ต้องการลบรายการ <strong style={{ color: "var(--text)" }}>
                  {items.find((i) => i.id === deleteConfirm)?.type} {items.find((i) => i.id === deleteConfirm)?.description}
                </strong> ออกจากระบบ?
              </p>
              <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
                การลบจะไม่สามารถย้อนกลับได้ ประวัติรายการที่เกี่ยวข้องจะยังคงอยู่
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setDeleteConfirm(null)}>ยกเลิก</button>
              <button className="danger" onClick={() => handleDelete(deleteConfirm)}>ลบรายการ</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
