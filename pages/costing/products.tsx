import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { readRole, type Role } from "@/lib/auth";
import { getProducts, addProduct, updateProduct, deleteProduct, emptyProductInput, productLabel, type Product, type ProductInput } from "@/lib/product-store";
import { PRODUCT_OPT, buildComboOptions } from "@/lib/product-spec";
import { Combo } from "@/lib/combo";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";

function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— ไม่ระบุ —</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="form-label" style={{ marginBottom: 4 }}>{label}</label>{children}</div>;
}

export default function ProductsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ProductInput>(emptyProductInput());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const notify = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Costing/products is super-admin only.
  useEffect(() => {
    const r = readRole();
    if (!r) { router.replace("/login"); return; }
    if (r !== "super") { router.replace("/"); return; }
    setAuthed(true);
  }, [router]);

  const load = () => {
    setLoading(true);
    getProducts().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  };
  useEffect(() => { if (authed) load(); }, [authed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) =>
      [p.style_no, p.description, p.brand, p.product_type, p.product_category, p.product_group]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [rows, query]);

  const { page, setPage, totalPages, pageItems, rangeStart, rangeEnd, total } = usePagination(filtered, query);

  // Type-or-pick options: presets + every distinct value already saved in the catalog.
  const comboOpts = useMemo(() => buildComboOptions(rows), [rows]);

  const openAdd = () => { setEditing(null); setForm(emptyProductInput()); };
  const openEdit = (p: Product) => {
    setEditing(p);
    const { id, created_at, updated_at, ...rest } = p;
    setForm(rest);
  };
  const close = () => { setEditing(null); setForm(emptyProductInput()); setShowModal(false); };

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.style_no.trim() && !form.product_type.trim() && !form.description.trim()) {
      notify("ระบุอย่างน้อย Style no. / ชนิดสินค้า / รายละเอียด", "error");
      return;
    }
    setSaving(true);
    try {
      if (editing) await updateProduct(editing.id, form);
      else await addProduct(form);
      close();
      load();
      notify(editing ? "บันทึกการแก้ไขแล้ว" : "เพิ่มสินค้าแล้ว");
    } catch (e: any) {
      notify(e.message ?? "บันทึกไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Product) => {
    if (!confirm(`ลบสินค้า "${productLabel(p)}" ?`)) return;
    try {
      await deleteProduct(p.id);
      setRows((rs) => rs.filter((r) => r.id !== p.id));
      notify("ลบแล้ว");
    } catch (e: any) {
      notify(e.message ?? "ลบไม่สำเร็จ", "error");
    }
  };

  if (authed !== true) return null;

  return (
    <div className="costing-page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <Link href="/costing" style={{ fontSize: 14, color: "var(--text3)" }}>← กลับไปออเดอร์</Link>
          <h1 style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>สินค้า</h1>
        </div>
        <button className="primary" onClick={() => { openAdd(); setShowModal(true); }}>+ เพิ่มสินค้า</button>
      </div>

      <div className="card">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <SearchInput value={query} onChange={setQuery} placeholder="ค้นหา Style / ชนิดสินค้า / รายละเอียด / ยี่ห้อ…" leftIcon="🔍" style={{ maxWidth: 420 }} />
        </div>

        {loading ? (
          <div style={{ padding: 40, color: "var(--text3)", textAlign: "center" }}>กำลังโหลด…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, color: "var(--text3)", textAlign: "center" }}>
            {rows.length === 0 ? "ยังไม่มีสินค้า — กด “เพิ่มสินค้า” เพื่อเริ่ม" : "ไม่พบสินค้าที่ตรงกับคำค้นหา"}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead className="sticky-head">
                <tr>
                  <th>Style no.</th>
                  <th>ชนิดสินค้า</th>
                  <th>ประเภท</th>
                  <th>รายละเอียด</th>
                  <th>ยี่ห้อ</th>
                  <th>ผ้า</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => (
                  <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => { openEdit(p); setShowModal(true); }}>
                    <td style={{ fontWeight: 500 }}>{p.style_no || "—"}</td>
                    <td>{p.product_type || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{p.product_category || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{p.description || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{p.brand || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{p.fabric_type || "—"}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <button className="ghost" style={{ padding: "3px 8px", fontSize: 13 }} onClick={() => { openEdit(p); setShowModal(true); }}>แก้ไข</button>
                        <button className="ghost" style={{ padding: "3px 8px", fontSize: 13, color: "var(--red)" }} onClick={() => remove(p)}>ลบ</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar page={page} setPage={setPage} totalPages={totalPages} rangeStart={rangeStart} rangeEnd={rangeEnd} total={total} />
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontSize: 17, fontWeight: 500 }}>{editing ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}</div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={close}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid form-grid-3">
                <Field label="Style no."><input value={form.style_no} onChange={(e) => set("style_no", e.target.value)} /></Field>
                <Field label="ยี่ห้อ"><input value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
                <Field label="ประเภทสินค้า"><Combo value={form.product_category} onChange={(v) => set("product_category", v)} options={comboOpts.product_category} /></Field>
              </div>
              <div style={{ marginTop: 12 }}>
                <Field label="รายละเอียด"><input value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
              </div>
              <div className="form-grid form-grid-3" style={{ marginTop: 12 }}>
                <Field label="ชนิดสินค้า"><Combo value={form.product_type} onChange={(v) => set("product_type", v)} options={comboOpts.product_type} /></Field>
                <Field label="เพศ"><Combo value={form.gender} onChange={(v) => set("gender", v)} options={comboOpts.gender} /></Field>
                <Field label="กลุ่มสินค้า"><Combo value={form.product_group} onChange={(v) => set("product_group", v)} options={comboOpts.product_group} /></Field>
                <Field label="ประเภทผ้า"><Combo value={form.fabric_type} onChange={(v) => set("fabric_type", v)} options={comboOpts.fabric_type} /></Field>
                <Field label="ความยาว"><Combo value={form.length_type} onChange={(v) => set("length_type", v)} options={comboOpts.length_type} /></Field>
                <Field label="คอ"><Combo value={form.neck} onChange={(v) => set("neck", v)} options={comboOpts.neck} /></Field>
                <Field label="ปก"><Combo value={form.collar} onChange={(v) => set("collar", v)} options={comboOpts.collar} /></Field>
                <Field label="Fit"><Combo value={form.fit} onChange={(v) => set("fit", v)} options={comboOpts.fit} /></Field>
                <Field label="วิธีเปิด"><Combo value={form.opening} onChange={(v) => set("opening", v)} options={comboOpts.opening} /></Field>
                <Field label="มีหมวก"><Sel value={form.has_hood} onChange={(v) => set("has_hood", v)} options={PRODUCT_OPT.yesno} /></Field>
                <Field label="มีกระเป๋า"><Sel value={form.has_pocket} onChange={(v) => set("has_pocket", v)} options={PRODUCT_OPT.yesno} /></Field>
              </div>
              <div style={{ marginTop: 12 }}>
                <Field label="หมายเหตุ"><input value={form.note} onChange={(e) => set("note", e.target.value)} /></Field>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={close}>ยกเลิก</button>
              <button className="primary" onClick={save} disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
