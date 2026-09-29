import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getSuppliers, addSupplier, updateSupplier, deleteSupplier, bulkDeleteSuppliers, type Supplier } from "@/lib/store";
import { useRequireAccess, type Section } from "@/lib/auth";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";
import { matchesQuery } from "@/lib/search-match";
import {
  parseSupplierSheet, planSupplierImport,
  type PlannedRow, type SupplierSheetResult,
} from "@/lib/supplier-sheet";

type FormData = Omit<Supplier, "id" | "created_at" | "updated_at">;

// Accessory and fabric suppliers are SEPARATE tables (`suppliers` /
// `fabric_suppliers`) with identical shape — see lib/store.ts and lib/fabric-store.ts.
// The UI is identical too, so this page is parameterised by its data source and
// section instead of being duplicated: /suppliers renders it with the accessory
// store, /fabrics/suppliers with the fabric store. Change supplier UI once, here.
export type SupplierApi = {
  list:       () => Promise<Supplier[]>;
  add:        (input: FormData) => Promise<Supplier>;
  update:     (id: string, input: Partial<FormData>) => Promise<Supplier>;
  remove:     (id: string) => Promise<void>;
  bulkRemove: (ids: string[]) => Promise<void>;
};

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

export function SuppliersView({ api, section }: { api: SupplierApi; section: Section }) {
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
  // ── Excel import ──
  // Suppliers used to be add-one-at-a-time only, which meant 30+ manual entries when a
  // stock sheet arrived carrying suppliers the table didn't have yet. The panel below
  // previews the file first and NEVER overwrites a saved value — see importing notes.
  const [impOpen, setImpOpen]   = useState(false);
  const [impName, setImpName]   = useState("");
  const [impRes, setImpRes]     = useState<SupplierSheetResult | null>(null);
  const [impPlan, setImpPlan]   = useState<PlannedRow[]>([]);
  const [impErr, setImpErr]     = useState("");
  const [impFill, setImpFill]   = useState(true);   // also top up blanks on existing rows
  const [impBusy, setImpBusy]   = useState(false);

  // Auth gate — suppliers are "ops" work, so the section admin, the auditor (both
  // sections) and super can all open it. Scoped to whichever section rendered it.
  const { authed } = useRequireAccess(section, "ops");

  useEffect(() => {
    if (!authed) return;
    api.list().then(setItems).finally(() => setLoading(false));
  }, [authed]);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refresh = () => api.list().then(setItems);

  const filtered = items.filter((i) =>
    matchesQuery(search, i.supplier_name, i.supplier_code, i.contact_person, i.contact_number, i.contact_email, i.city, i.tax_id));

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
      await api.bulkRemove(ids);
      await refresh();
      setSelected(new Set());
      setBulkConfirm(false);
      showToast(`ลบ ${ids.length} รายการแล้ว`, "success");
    } catch (e: any) {
      showToast(e.message ?? "เกิดข้อผิดพลาด", "error");
    } finally { setSaving(false); }
  };

  // ── Excel import ───────────────────────────────────────────────
  // `xlsx` is loaded on demand: it's a large dependency and this page is opened far
  // more often to look something up than to import a file.
  const pickImportFile = async (file: File) => {
    setImpErr(""); setImpRes(null); setImpPlan([]); setImpName(file.name);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) { setImpErr("ไม่พบชีตในไฟล์"); return; }
      // raw:false → the text as displayed, so a phone number typed as 0812345678 keeps
      // its leading zero instead of arriving as the number 812345678.
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as any[][];
      const res = parseSupplierSheet(raw);
      if (res.missingName) {
        setImpErr("ไม่พบคอลัมน์ “ชื่อบริษัทซัพ” — ต้องมีคอลัมน์ชื่อซัพพลายเออร์อย่างน้อยหนึ่งคอลัมน์");
        return;
      }
      if (res.rows.length === 0) { setImpErr("ไม่พบรายการซัพพลายเออร์ในไฟล์"); return; }
      setImpRes(res);
      setImpPlan(planSupplierImport(res.rows, items as any));
    } catch (e: any) {
      setImpErr(e?.message ?? "อ่านไฟล์ไม่สำเร็จ");
    }
  };

  const impCounts = {
    new:       impPlan.filter((p) => p.plan === "new").length,
    fillable:  impPlan.filter((p) => p.plan === "fillable").length,
    existing:  impPlan.filter((p) => p.plan === "existing").length,
    duplicate: impPlan.filter((p) => p.plan === "duplicate").length,
  };

  const closeImport = () => {
    setImpOpen(false); setImpRes(null); setImpPlan([]); setImpErr(""); setImpName("");
  };

  const runImport = async () => {
    setImpBusy(true);
    let added = 0, filled = 0;
    const failed: string[] = [];
    try {
      // One row at a time so a single bad row can't lose the whole batch — the counts
      // reported at the end are what actually landed, not what was attempted.
      for (const p of impPlan) {
        try {
          if (p.plan === "new") { await api.add(p.row); added++; }
          else if (p.plan === "fillable" && impFill && p.existingId) {
            await api.update(p.existingId, p.fills); filled++;
          }
        } catch (e: any) {
          failed.push(p.row.supplier_name);
        }
      }
      await refresh();
      closeImport();
      const parts = [added ? `เพิ่ม ${added}` : "", filled ? `เติมข้อมูล ${filled}` : ""].filter(Boolean);
      showToast(
        (parts.length ? parts.join(" · ") : "ไม่มีรายการใหม่") +
          (failed.length ? ` · ไม่สำเร็จ ${failed.length}` : " ✓"),
        failed.length ? "error" : "success",
      );
    } finally {
      setImpBusy(false);
    }
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
      if (editId) { await api.update(editId, form); showToast("อัพเดตแล้ว ✓", "success"); }
      else        { await api.add(form);            showToast("เพิ่มซัพพลายเออร์แล้ว ✓", "success"); }
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
      await api.remove(id);
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
        <button onClick={() => setImpOpen(true)} style={{ whiteSpace: "nowrap" }}>นำเข้า Excel</button>
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
        /* No close-on-overlay-click: this form holds typed-in data, and an accidental
           click outside used to discard it. Close via ✕ or ยกเลิก only. */
        <div className="modal-overlay">
          <div className="modal">
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

      {/* ── Excel import ──────────────────────────────────────────
          Preview first, then apply. Two rules make this safe to run twice: a name that
          already exists is never inserted again (so no duplicates for the stock updater
          to pick between), and an existing row is only ever topped up where it is BLANK —
          nothing saved is overwritten. */}
      {impOpen && (
        <div className="modal-overlay" onClick={closeImport}>
          <div className="modal" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500 }}>นำเข้าซัพพลายเออร์จาก Excel</div>
              <button className="ghost" onClick={closeImport}>✕</button>
            </div>

            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 14, color: "var(--text3)", lineHeight: 1.65 }}>
                อ่านหัวคอลัมน์ตาม<b style={{ color: "var(--text2)" }}>ชื่อ</b> ไม่ใช่ตำแหน่ง — ใช้ไฟล์สต็อคที่มีคอลัมน์ซัพพลายเออร์อยู่แล้วได้เลย
                (<span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>ชื่อบริษัทซัพ · ผู้ติดต่อ · เบอร์ติดต่อ · อีเมล · ที่อยู่ · จังหวัด · ประเทศ · รหัสไปรษณีย์ · ระยะเวลาส่ง(วัน) · เทอมจ่ายเงิน · เลขผู้เสียภาษี</span>)
                <br />ต้องมีคอลัมน์ <b style={{ color: "var(--text2)" }}>ชื่อบริษัทซัพ</b> · ชื่อที่มีอยู่แล้วจะไม่ถูกเพิ่มซ้ำ และข้อมูลที่บันทึกไว้จะไม่ถูกเขียนทับ
              </div>

              <input type="file" accept=".xlsx,.xls,.csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImportFile(f); }} />
              {impName && (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>
                  ไฟล์: <b style={{ color: "var(--text2)" }}>{impName}</b>
                  {impRes && <> · พบ {impRes.rows.length} รายการ</>}
                </div>
              )}

              {impErr && (
                <div style={{ fontSize: 14, color: "var(--red)", background: "var(--bg3)",
                  padding: "10px 14px", borderRadius: "var(--r)" }}>{impErr}</div>
              )}

              {impRes && (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
                    <span style={{ padding: "3px 10px", borderRadius: 999, background: "#dcfce7", color: "var(--green)" }}>
                      ใหม่ {impCounts.new}
                    </span>
                    <span style={{ padding: "3px 10px", borderRadius: 999, background: "#fef3c7", color: "#b45309" }}>
                      เติมข้อมูลที่ว่าง {impCounts.fillable}
                    </span>
                    <span style={{ padding: "3px 10px", borderRadius: 999, background: "var(--bg4)", color: "var(--text3)" }}>
                      มีอยู่แล้ว {impCounts.existing}
                    </span>
                    {impCounts.duplicate > 0 && (
                      <span style={{ padding: "3px 10px", borderRadius: 999, background: "#ede9fe", color: "#6d28d9" }}>
                        ชื่อซ้ำในไฟล์ {impCounts.duplicate}
                      </span>
                    )}
                    {impRes.skipped > 0 && (
                      <span style={{ color: "var(--text3)", alignSelf: "center" }}>ข้ามแถวที่ไม่มีชื่อ {impRes.skipped}</span>
                    )}
                  </div>

                  {impRes.unknownHeaders.length > 0 && (
                    <div style={{ fontSize: 13, color: "#b45309" }}>
                      คอลัมน์ที่ไม่รู้จัก (ข้ามไป): {impRes.unknownHeaders.join(" · ")}
                    </div>
                  )}

                  {impCounts.fillable > 0 && (
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, cursor: "pointer" }}>
                      <input type="checkbox" checked={impFill} onChange={(e) => setImpFill(e.target.checked)}
                        style={{ width: "auto", marginTop: 3, cursor: "pointer" }} />
                      <span>เติมข้อมูลที่ยังว่างของซัพพลายเออร์ที่มีอยู่แล้ว ({impCounts.fillable} ราย) — ค่าที่กรอกไว้แล้วไม่ถูกแก้</span>
                    </label>
                  )}

                  <div style={{ maxHeight: 340, overflow: "auto", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
                    <table style={{ fontSize: 14 }}>
                      <thead className="sticky-head">
                        <tr>
                          <th style={{ whiteSpace: "nowrap" }}>สถานะ</th>
                          <th style={{ whiteSpace: "nowrap" }}>ชื่อบริษัท</th>
                          <th style={{ whiteSpace: "nowrap" }}>ผู้ติดต่อ</th>
                          <th style={{ whiteSpace: "nowrap" }}>เบอร์ติดต่อ</th>
                          <th style={{ whiteSpace: "nowrap" }}>จังหวัด</th>
                        </tr>
                      </thead>
                      <tbody>
                        {impPlan.map((p, i) => {
                          const meta = p.plan === "new" ? { th: "ใหม่", bg: "#dcfce7", fg: "var(--green)" }
                            : p.plan === "fillable" ? { th: `เติม ${Object.keys(p.fills).length} ช่อง`, bg: "#fef3c7", fg: "#b45309" }
                            : p.plan === "duplicate" ? { th: "ซ้ำในไฟล์", bg: "#ede9fe", fg: "#6d28d9" }
                            : { th: "มีอยู่แล้ว", bg: "var(--bg4)", fg: "var(--text3)" };
                          const dim = p.plan === "existing" || p.plan === "duplicate";
                          return (
                            <tr key={i} style={{ opacity: dim ? 0.55 : 1 }}>
                              <td>
                                <span style={{ fontSize: 11, whiteSpace: "nowrap", padding: "2px 8px",
                                  borderRadius: 999, background: meta.bg, color: meta.fg }}>{meta.th}</span>
                              </td>
                              <td style={{ fontWeight: 500, wordBreak: "break-word" }}>{p.row.supplier_name}</td>
                              <td style={{ color: "var(--text2)" }}>{p.row.contact_person || "—"}</td>
                              <td style={{ color: "var(--text2)", fontFamily: "var(--mono)", fontSize: 13 }}>{p.row.contact_number || "—"}</td>
                              <td style={{ color: "var(--text2)" }}>{p.row.city || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button onClick={closeImport}>ยกเลิก</button>
              <button className="primary" disabled={!impRes || impBusy || (impCounts.new === 0 && !(impFill && impCounts.fillable > 0))}
                onClick={runImport}>
                {impBusy ? "กำลังนำเข้า…"
                  : impCounts.new > 0 || (impFill && impCounts.fillable > 0)
                    ? `นำเข้า ${impCounts.new}${impFill && impCounts.fillable ? ` + เติม ${impCounts.fillable}` : ""} รายการ`
                    : "ไม่มีรายการใหม่"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}

// Route: accessory suppliers (`suppliers` table). The fabric twin lives at
// pages/fabrics/suppliers.tsx and renders the same view over `fabric_suppliers`.
export default function AccessorySuppliersPage() {
  return (
    <SuppliersView
      section="acc"
      api={{
        list: getSuppliers, add: addSupplier, update: updateSupplier,
        remove: deleteSupplier, bulkRemove: bulkDeleteSuppliers,
      }}
    />
  );
}
