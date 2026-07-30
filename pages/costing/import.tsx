import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import * as XLSX from "xlsx";
import { readRole, type Role } from "@/lib/auth";
import { addCostingsBulk } from "@/lib/costing-store";
import { parseCostingSheet, sheetRowToCostingInput, EXPECTED_HEADERS, type CostingSheetRow } from "@/lib/costing-sheet";
import { usePagination, PaginationBar } from "@/lib/pagination";

export default function CostingImport() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<CostingSheetRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const r = readRole();
    if (!r) { router.replace("/login"); return; }
    if (r !== "super") { router.replace("/"); return; }   // orders: super-admin only
    setRole(r);
    setAuthed(true);
  }, [router]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      if (raw.length < 2) { showToast("ไฟล์ว่างเปล่าหรือไม่มีข้อมูล", "error"); setRows([]); return; }

      const { rows: parsed, cols } = parseCostingSheet(raw);
      if (cols.missing.length > 0) {
        showToast("ไม่พบคอลัมน์ที่จำเป็น: " + cols.missing.join(", "), "error");
        setRows([]);
        return;
      }
      if (parsed.length === 0) {
        showToast("ไม่พบแถวออเดอร์ (แถวที่มีลูกค้า / Style / PO / จำนวนสั่ง)", "error");
        setRows([]);
        return;
      }
      setRows(parsed);
      showToast(`อ่านไฟล์สำเร็จ — ${parsed.length} ออเดอร์`, "success");
    } catch (err: any) {
      showToast("อ่านไฟล์ไม่สำเร็จ: " + (err.message ?? ""), "error");
      setRows([]);
    }
  };

  const handleUpload = async () => {
    if (rows.length === 0) return;
    setSaving(true);
    try {
      const inputs = rows.map((r) => sheetRowToCostingInput(r, role ?? ""));
      const count = await addCostingsBulk(inputs);
      showToast(`นำเข้า ${count} ออเดอร์แล้ว`, "success");
      setRows([]);
      setFileName("");
      setTimeout(() => router.push("/costing"), 1000);
    } catch (e: any) {
      showToast("บันทึกไม่สำเร็จ: " + (e.message ?? ""), "error");
    } finally {
      setSaving(false);
    }
  };

  const pg = usePagination(rows, fileName + rows.length);

  if (authed !== true) return null;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link href="/costing" style={{ fontSize: 14, color: "var(--text3)" }}>← กลับไปรายการ</Link>
        <h1 style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>นำเข้าออเดอร์จาก Excel</h1>
        <p style={{ color: "var(--text2)", fontSize: 15, marginTop: 2 }}>
          อัปโหลดไฟล์ตามฟอร์ม “add product” — แต่ละแถวจะกลายเป็นออเดอร์ใหม่ (สถานะเริ่มต้น “ใบเสนอราคา”, ยังไม่คิดต้นทุน)
        </p>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "inline-block" }}>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
            <span style={{ display: "inline-block", padding: "10px 20px", background: "var(--bg3)",
              border: "1px solid var(--border2)", borderRadius: "var(--r)", cursor: "pointer", fontSize: 16 }}>
              เลือกไฟล์ Excel…
            </span>
          </label>
          {fileName && <span style={{ color: "var(--text2)", fontSize: 16 }}>{fileName}</span>}
          {rows.length > 0 && (
            <button className="primary" onClick={handleUpload} disabled={saving} style={{ marginLeft: "auto" }}>
              {saving ? "กำลังบันทึก…" : `นำเข้า ${rows.length} ออเดอร์`}
            </button>
          )}
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 8 }}>คอลัมน์ที่รองรับ (แถวแรกของไฟล์ต้องเป็นชื่อคอลัมน์)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {EXPECTED_HEADERS.map((c, i) => <span key={i} className="tag" style={{ fontSize: 13 }}>{c}</span>)}
          </div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 10, lineHeight: 1.7 }}>
            · จับคู่คอลัมน์จาก<strong style={{ color: "var(--text2)" }}>ชื่อหัวคอลัมน์</strong> — สลับตำแหน่งคอลัมน์ได้<br />
            · นับเป็นออเดอร์เฉพาะแถวที่มี <strong style={{ color: "var(--text2)" }}>ลูกค้า / Style no. / PO no. / จำนวนสั่ง</strong> (แถวรายการ dropdown ในฟอร์มจะถูกข้าม)<br />
            · <strong style={{ color: "var(--text2)" }}>สี · S · M · L · XL</strong> ในแต่ละแถวจะกลายเป็นตารางไซส์ 1 แถวของออเดอร์นั้น<br />
            · ต้นทุน (ผ้า/ค่าแรง/ราคาขาย) เว้นว่างไว้ก่อน — เพิ่มภายหลังในหน้าออเดอร์
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, color: "var(--text2)" }}>
            ตัวอย่างก่อนนำเข้า · {rows.length} ออเดอร์
          </div>
          <div style={{ overflowX: "auto", maxHeight: "60vh", overflowY: "auto" }}>
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>Style / PO</th>
                  <th style={{ whiteSpace: "nowrap" }}>ลูกค้า</th>
                  <th style={{ whiteSpace: "nowrap" }}>ชนิดสินค้า</th>
                  <th style={{ whiteSpace: "nowrap" }}>สี/ไซส์</th>
                  <th className="num" style={{ whiteSpace: "nowrap" }}>จำนวนสั่ง</th>
                  <th style={{ whiteSpace: "nowrap" }}>วันที่ผลิต</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.style_no || r.po_no || "—"}</td>
                    <td style={{ fontSize: 14, color: "var(--text2)" }}>{r.customer || "—"}</td>
                    <td style={{ fontSize: 14, color: "var(--text2)" }}>{r.product_type || "—"}</td>
                    <td style={{ fontSize: 14, color: "var(--text2)" }}>
                      {r.size_breakdown.length > 0
                        ? `${r.size_breakdown[0].color || "—"} (${r.size_breakdown[0].s}/${r.size_breakdown[0].m}/${r.size_breakdown[0].l}/${r.size_breakdown[0].xl})`
                        : "—"}
                    </td>
                    <td className="num" style={{ fontFamily: "var(--mono)" }}>{r.order_qty.toLocaleString()}</td>
                    <td style={{ fontSize: 14, color: "var(--text2)" }}>{r.release_date || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar {...pg} />
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
