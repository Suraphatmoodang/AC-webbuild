import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getSuppliers, addSupplier, updateSupplier, deleteSupplier, bulkDeleteSuppliers, type Supplier } from "@/lib/store";
import { useRequireAuth } from "@/lib/auth";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";

type FormData = Omit<Supplier, "id" | "created_at" | "updated_at">;

const emptyForm = (): FormData => ({
  supplier_code: "", supplier_name: "", contact_person: "", contact_number: "",
  contact_email: "", line_id: "", address: "", city: "", country: "ไทย",
  postal_code: "", lead_time: "", payment_term: "", tax_id: "",
});

type FormErrors = Partial<Record<keyof FormData, string>>;

function validate(form: FormData): FormErrors {
  const errors: FormErrors = {};
  if (!form.supplier_name.trim()) errors.supplier_name = "กรุณาระบุชื่อซัพพลายเออร์";
  return errors;
}

export default function SuppliersPage() {
  const router = useRouter();
  const [items, setItems]     = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [showModal, setShowModal]   = useState(false);
  const [editId, setEditId]         = useState<string | null>(null);
  const [form, setForm]             = useState<FormData>(emptyForm());
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [viewItem, setViewItem]     = useState<Supplier | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Auth gate — suppliers are shared, so ANY logged-in admin may edit them
  // (accessory, fabric, or super), not just one section's.
  const { authed } = useRequireAuth();

  useEffect(() => {
    if (!authed) return;
    getSuppliers().then(setItems).finally(() => setLoading(false));
  }, [authed]);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refresh = () => getSuppliers().then(setItems);

  const filtered = items.filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.supplier_name.toLowerCase().includes(q) ||
      i.supplier_code.toLowerCase().includes(q) ||
      i.contact_person.toLowerCase().includes(q) ||
      i.contact_number.toLowerCase().includes(q) ||
      i.contact_email.toLowerCase().includes(q) ||
      i.city.toLowerCase().includes(q) ||
      i.tax_id.toLowerCase().includes(q)
    );
  });

  const pg = usePagination(filtered, search);

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
      await bulkDeleteSuppliers(ids);
      await refresh();
      setSelected(new Set());
      setBulkConfirm(false);
      showToast(`ลบ ${ids.length} รายการแล้ว`, "success");
    } catch (e: any) {
      showToast(e.message ?? "เกิดข้อผิดพลาด", "error");
    } finally { setSaving(false); }
  };

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setFormErrors({}); setShowModal(true); };
  const openEdit = (item: Supplier) => {
    setEditId(item.id);
    setForm({
      supplier_code: item.supplier_code, supplier_name: item.supplier_name,
      contact_person: item.contact_person, contact_number: item.contact_number,
      contact_email: item.contact_email, line_id: item.line_id, address: item.address,
      city: item.city, country: item.country, postal_code: item.postal_code,
      lead_time: item.lead_time, payment_term: item.payment_term, tax_id: item.tax_id,
    });
    setFormErrors({});
    setShowModal(true);
  };

  const handleSave = async () => {
    const errors = validate(form);
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    setSaving(true);
    try {
      if (editId) { await updateSupplier(editId, form); showToast("อัพเดตแล้ว ✓", "success"); }
      else        { await addSupplier(form);            showToast("เพิ่มซัพพลายเออร์แล้ว ✓", "success"); }
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
      await deleteSupplier(id);
      await refresh();
      setDeleteConfirm(null);
      showToast("ลบซัพพลายเออร์แล้ว", "success");
    } catch (e: any) {
      showToast(e.message ?? "ลบไม่ได้", "error");
    } finally {
      setSaving(false);
    }
  };

  const f = (field: keyof FormData, val: string) => {
    setForm((prev) => ({ ...prev, [field]: val }));
    setFormErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  if (!authed) return null;

  return (
    <div>
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <SearchInput value={search} onChange={setSearch} placeholder="ค้นหาชื่อ ผู้ติดต่อ เบอร์ อีเมล…" style={{ flex:"1 1 240px" }} />
        <button className="primary" onClick={openAdd}>+ เพิ่มซัพพลายเออร์</button>
        {selected.size > 0 && (
          <button className="danger" onClick={() => setBulkConfirm(true)} disabled={saving}>
            ลบที่เลือก ({selected.size})
          </button>
        )}
        <span style={{ marginLeft:"auto", alignSelf:"center", fontSize:16, color:"var(--text3)" }}>{filtered.length} ราย</span>
      </div>

      <div className="card" style={{ overflow:"hidden" }}>
        {loading ? (
          <div style={{ padding:48, textAlign:"center", color:"var(--text3)" }}>กำลังโหลด…</div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ tableLayout:"fixed", minWidth:1040 }}>
              <colgroup>
                <col style={{ width:"40px" }} />{/* checkbox */}
                <col style={{ width:"19%" }} />{/* ชื่อบริษัท */}
                <col style={{ width:"12%" }} />{/* ผู้ติดต่อ */}
                <col style={{ width:"15%" }} />{/* เบอร์ติดต่อ */}
                <col style={{ width:"19%" }} />{/* อีเมล */}
                <col style={{ width:"11%" }} />{/* จังหวัด */}
                <col style={{ width:"9%"  }} />{/* ระยะเวลาส่ง */}
                <col style={{ width:"9%"  }} />{/* เทอมจ่าย */}
                <col style={{ width:"110px" }} />{/* actions */}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign:"center" }}>
                    <input type="checkbox" checked={allPageSelected} onChange={togglePageAll} style={{ width:"auto", cursor:"pointer" }} />
                  </th>
                  <th style={{ whiteSpace:"nowrap" }}>ชื่อบริษัท</th><th style={{ whiteSpace:"nowrap" }}>ผู้ติดต่อ</th><th style={{ whiteSpace:"nowrap" }}>เบอร์ติดต่อ</th><th style={{ whiteSpace:"nowrap" }}>อีเมล</th><th style={{ whiteSpace:"nowrap" }}>จังหวัด</th><th style={{ whiteSpace:"nowrap" }}>ระยะเวลาส่ง</th><th style={{ whiteSpace:"nowrap" }}>เทอมจ่าย</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign:"center", color:"var(--text3)", padding:32 }}>ไม่พบรายการ</td></tr>
                )}
                {pg.pageItems.map((item) => (
                  <tr key={item.id} style={{ cursor:"pointer", background: selected.has(item.id) ? "var(--bg4)" : undefined }} onClick={() => setViewItem(item)}>
                    <td style={{ textAlign:"center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleRow(item.id)} style={{ width:"auto", cursor:"pointer" }} />
                    </td>
                    <td style={{ fontWeight:500, wordBreak:"break-word" }}>{item.supplier_name}</td>
                    <td style={{ color:"var(--text2)", wordBreak:"break-word" }}>{item.contact_person || "—"}</td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:15, color:"var(--text2)", wordBreak:"break-word" }}>{item.contact_number || "—"}</td>
                    <td style={{ fontSize:15, color:"var(--text2)", wordBreak:"break-all" }}>{item.contact_email || "—"}</td>
                    <td style={{ color:"var(--text2)", wordBreak:"break-word" }}>{item.city || "—"}</td>
                    <td style={{ color:"var(--text2)", whiteSpace:"nowrap" }}>{item.lead_time || "—"}</td>
                    <td style={{ color:"var(--text2)", whiteSpace:"nowrap" }}>{item.payment_term || "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display:"flex", gap:4 }}>
                        <button className="ghost" style={{ padding:"4px 8px", fontSize:15, whiteSpace:"nowrap" }} onClick={() => openEdit(item)}>แก้ไข</button>
                        <button className="ghost" style={{ padding:"4px 8px", fontSize:15, color:"var(--red)", whiteSpace:"nowrap" }} onClick={() => setDeleteConfirm(item.id)}>ลบ</button>
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

      {/* View detail modal */}
      {viewItem && (
        <div className="modal-overlay" onClick={() => setViewItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight:500 }}>{viewItem.supplier_name}</div>
              <button className="ghost" style={{ padding:"4px 8px" }} onClick={() => setViewItem(null)}>✕</button>
            </div>
            <div className="modal-body">
              {[
                ["รหัสซัพพลายเออร์", viewItem.supplier_code],
                ["ผู้ติดต่อ", viewItem.contact_person],
                ["เบอร์ติดต่อ", viewItem.contact_number],
                ["อีเมล", viewItem.contact_email],
                ["Line ID", viewItem.line_id],
                ["ที่อยู่", viewItem.address],
                ["จังหวัด", viewItem.city],
                ["ประเทศ", viewItem.country],
                ["รหัสไปรษณีย์", viewItem.postal_code],
                ["ระยะเวลาส่ง", viewItem.lead_time],
                ["เทอมจ่ายเงิน", viewItem.payment_term],
                ["เลขผู้เสียภาษี", viewItem.tax_id],
              ].map(([label, val]) => (
                <div key={label} style={{ display:"flex", padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
                  <span style={{ width:160, color:"var(--text3)", fontSize:15, flexShrink:0 }}>{label}</span>
                  <span style={{ color:"var(--text)" }}>{val || "—"}</span>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button onClick={() => { const it = viewItem; setViewItem(null); openEdit(it); }}>แก้ไข</button>
              <button className="primary" onClick={() => setViewItem(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight:500 }}>{editId ? "แก้ไขซัพพลายเออร์" : "เพิ่มซัพพลายเออร์ใหม่"}</div>
              <button className="ghost" style={{ padding:"4px 8px" }} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <label className="form-label">ชื่อบริษัท <span style={{color:"var(--red)"}}>*</span></label>
                <input value={form.supplier_name} onChange={(e) => f("supplier_name", e.target.value)}
                  placeholder="ชื่อบริษัทซัพพลายเออร์"
                  style={formErrors.supplier_name ? {borderColor:"var(--red)"} : {}} />
                {formErrors.supplier_name && <div style={{fontSize:14,color:"var(--red)",marginTop:3}}>{formErrors.supplier_name}</div>}
              </div>

              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">รหัสซัพพลายเออร์</label>
                  <input value={form.supplier_code} onChange={(e) => f("supplier_code", e.target.value)} placeholder="—" />
                </div>
                <div>
                  <label className="form-label">ผู้ติดต่อ</label>
                  <input value={form.contact_person} onChange={(e) => f("contact_person", e.target.value)} placeholder="ชื่อผู้ติดต่อ" />
                </div>
              </div>

              <div className="form-row form-grid form-grid-2">
                <div>
                  <label className="form-label">เบอร์ติดต่อ</label>
                  <input value={form.contact_number} onChange={(e) => f("contact_number", e.target.value)} placeholder="0X-XXXXXXX" />
                </div>
                <div>
                  <label className="form-label">อีเมล</label>
                  <input value={form.contact_email} onChange={(e) => f("contact_email", e.target.value)} placeholder="email@example.com" />
                </div>
              </div>

              <div className="form-row">
                <label className="form-label">Line ID</label>
                <input value={form.line_id} onChange={(e) => f("line_id", e.target.value)} placeholder="—" />
              </div>

              <div className="form-row">
                <label className="form-label">ที่อยู่</label>
                <textarea value={form.address} onChange={(e) => f("address", e.target.value)}
                  placeholder="ที่อยู่บริษัท" rows={2} style={{ resize:"vertical" }} />
              </div>

              <div className="form-row form-grid form-grid-3">
                <div>
                  <label className="form-label">จังหวัด</label>
                  <input value={form.city} onChange={(e) => f("city", e.target.value)} placeholder="กรุงเทพมหานคร" />
                </div>
                <div>
                  <label className="form-label">ประเทศ</label>
                  <input value={form.country} onChange={(e) => f("country", e.target.value)} placeholder="ไทย" />
                </div>
                <div>
                  <label className="form-label">รหัสไปรษณีย์</label>
                  <input value={form.postal_code} onChange={(e) => f("postal_code", e.target.value)} placeholder="10XXX" />
                </div>
              </div>

              <div className="form-row form-grid form-grid-3">
                <div>
                  <label className="form-label">ระยะเวลาส่ง</label>
                  <input value={form.lead_time} onChange={(e) => f("lead_time", e.target.value)} placeholder="14 วัน" />
                </div>
                <div>
                  <label className="form-label">เทอมจ่ายเงิน</label>
                  <input value={form.payment_term} onChange={(e) => f("payment_term", e.target.value)} placeholder="เครดิต30 วัน" />
                </div>
                <div>
                  <label className="form-label">เลขผู้เสียภาษี</label>
                  <input value={form.tax_id} onChange={(e) => f("tax_id", e.target.value)} placeholder="—" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowModal(false)}>ยกเลิก</button>
              <button className="primary" onClick={handleSave} disabled={saving}>
                {saving ? "กำลังบันทึก…" : editId ? "บันทึกการแก้ไข" : "เพิ่มซัพพลายเออร์"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth:420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight:500, color:"var(--red)" }}>ยืนยันการลบ</div>
              <button className="ghost" style={{ padding:"4px 8px" }} onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color:"var(--text2)" }}>ต้องการลบ <strong style={{ color:"var(--text)" }}>
                {items.find((i) => i.id === deleteConfirm)?.supplier_name}
              </strong> ออกจากระบบ?</p>
              <p style={{ fontSize:14, color:"var(--text3)", marginTop:8 }}>
                การลบจะไม่กระทบกับอุปกรณ์ที่อ้างอิงชื่อซัพพลายเออร์นี้อยู่
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

      {/* Bulk delete confirm */}
      {bulkConfirm && (
        <div className="modal-overlay" onClick={() => setBulkConfirm(false)}>
          <div className="modal" style={{ maxWidth:420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight:500, color:"var(--red)" }}>ยืนยันการลบหลายรายการ</div>
              <button className="ghost" style={{ padding:"4px 8px" }} onClick={() => setBulkConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color:"var(--text2)" }}>
                ต้องการลบซัพพลายเออร์ <strong style={{ color:"var(--text)" }}>{selected.size} ราย</strong> ที่เลือกไว้?
              </p>
              <p style={{ fontSize:14, color:"var(--text3)", marginTop:8 }}>
                อุปกรณ์ที่อ้างอิงซัพพลายเออร์เหล่านี้จะถูกตั้งค่าเป็น "ไม่ระบุซัพพลายเออร์" โดยอัตโนมัติ
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setBulkConfirm(false)}>ยกเลิก</button>
              <button className="danger" onClick={runBulkDelete} disabled={saving}>
                {saving ? "กำลังลบ…" : `ลบ ${selected.size} ราย`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
