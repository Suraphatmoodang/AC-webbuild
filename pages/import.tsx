import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import * as XLSX from "xlsx";
import { createImportBatch } from "@/lib/store";
import { usePagination, PaginationBar } from "@/lib/pagination";

// Maps the Thai column headers in the import sheet to our fields.
// Column order (0-indexed) based on the provided template:
// 0 ชนิดอุปกรณ์ 1 รหัสสินค้า 2 รายละเอียด 3 แถว 4 สี 5 ขนาด 6 สต็อค 7 หน่วย 8 ราคาซื้อ
// 9 ชื่อบริษัทซัพ 10 ผู้ติดต่อ 11 เบอร์ติดต่อ 12 อีเมล 13 (blank) 14 ที่อยู่ 15 จังหวัด
// 16 ประเทศ 17 รหัสไปรษณีย์ 18 ระยะเวลาส่ง 19 เทอมจ่ายเงิน 20 เลขผู้เสียภาษี

type ParsedRow = {
  type: string; acc_code: string; description: string; row: number | null;
  color: string; size: string; quantity: number; unit: string; unit_cost: number;
  supplier_name: string; contact_person: string; contact_number: string;
  contact_email: string; address: string; city: string; country: string;
  postal_code: string; lead_time: string; payment_term: string; tax_id: string;
};

const str = (v: any) => (v === undefined || v === null ? "" : String(v).trim());
const num = (v: any) => { const n = parseFloat(String(v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };

export default function ImportPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("manage_auth") !== "1") router.replace("/login");
    else setAuthed(true);
  }, [router]);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      // raw[0] is the header row — skip it
      const parsed: ParsedRow[] = raw.slice(1)
        .filter((r) => str(r[0]) || str(r[2])) // must have a type or description
        .map((r) => ({
          type: str(r[0]), acc_code: str(r[1]), description: str(r[2]),
          row: str(r[3]) ? parseInt(str(r[3])) || null : null,
          color: str(r[4]), size: str(r[5]), quantity: num(r[6]),
          unit: str(r[7]), unit_cost: num(r[8]),
          supplier_name: str(r[9]), contact_person: str(r[10]), contact_number: str(r[11]),
          contact_email: str(r[12]), address: str(r[14]), city: str(r[15]),
          country: str(r[16]), postal_code: str(r[17]), lead_time: str(r[18]),
          payment_term: str(r[19]), tax_id: str(r[20]),
        }));
      setRows(parsed);
      showToast(`อ่านไฟล์สำเร็จ — ${parsed.length} รายการ`, "success");
    } catch (err: any) {
      showToast("อ่านไฟล์ไม่สำเร็จ: " + (err.message ?? ""), "error");
      setRows([]);
    }
  };

  const handleUpload = async () => {
    if (rows.length === 0) return;
    setSaving(true);
    try {
      const { count, skipped } = await createImportBatch(rows);
      const msg = skipped > 0
        ? `นำเข้า ${count} รายการ · ข้ามรายการซ้ำ ${skipped} รายการ`
        : `นำเข้า ${count} รายการเข้าสู่รายการรอตรวจสอบแล้ว`;
      showToast(msg, "success");
      setRows([]);
      setFileName("");
      if (count > 0) setTimeout(() => router.push("/import-review"), 1200);
    } catch (e: any) {
      showToast("บันทึกไม่สำเร็จ: " + (e.message ?? ""), "error");
    } finally {
      setSaving(false);
    }
  };

  const pg = usePagination(rows, fileName + rows.length);

  if (!authed) return null;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>นำเข้าอุปกรณ์จาก Excel</h2>
        <p style={{ color: "var(--text2)", fontSize: 16 }}>
          อัปโหลดไฟล์ตามรูปแบบที่กำหนด รายการจะถูกเก็บไว้รอการตรวจสอบก่อนเพิ่มเข้าระบบจริง
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
            <button className="primary" onClick={handleUpload} disabled={saving}
              style={{ marginLeft: "auto" }}>
              {saving ? "กำลังบันทึก…" : `นำเข้า ${rows.length} รายการ`}
            </button>
          )}
        </div>
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, color: "var(--text2)" }}>
            ตัวอย่างก่อนนำเข้า · {rows.length} รายการ
          </div>
          <div style={{ overflowX: "auto", maxHeight: "60vh", overflowY: "auto" }}>
            <table style={{ tableLayout: "fixed", minWidth: 900 }}>
              <colgroup>
                <col style={{ width: "16%" }} /><col style={{ width: "10%" }} /><col style={{ width: "20%" }} />
                <col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} />
                <col style={{ width: "24%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>ประเภท</th><th style={{ whiteSpace: "nowrap" }}>รหัส</th><th style={{ whiteSpace: "nowrap" }}>รายละเอียด</th><th style={{ whiteSpace: "nowrap" }}>สี/ขนาด</th><th style={{ whiteSpace: "nowrap" }}>หน่วย</th><th className="num" style={{ whiteSpace: "nowrap" }}>ราคา</th><th style={{ whiteSpace: "nowrap" }}>ซัพพลายเออร์</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500, wordBreak: "break-word" }}>{r.type}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text2)" }}>{r.acc_code || "—"}</td>
                    <td style={{ wordBreak: "break-word" }}>{r.description || "—"}</td>
                    <td style={{ fontSize: 14, color: "var(--text2)" }}>{[r.color, r.size].filter(Boolean).join(" / ") || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{r.unit || "—"}</td>
                    <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.unit_cost ? `฿${r.unit_cost.toFixed(2)}` : "—"}</td>
                    <td style={{ fontSize: 14, color: "var(--text2)", wordBreak: "break-word" }}>{r.supplier_name || "—"}</td>
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
