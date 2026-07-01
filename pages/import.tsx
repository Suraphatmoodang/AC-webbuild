import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import * as XLSX from "xlsx";
import { createImportBatch } from "@/lib/store";
import { usePagination, PaginationBar } from "@/lib/pagination";

// Maps sheet columns to fields by HEADER NAME (not position), so the importer
// is robust to columns being reordered. Each field lists the accepted header
// text(s); the first header that matches (after whitespace-normalizing) wins.
type ParsedRow = {
  type: string; acc_code: string; description: string; row: number | null;
  color: string; size: string; quantity: number; min_quantity: number; unit: string; unit_cost: number;
  supplier_name: string; contact_person: string; contact_number: string;
  contact_email: string; address: string; city: string; country: string;
  postal_code: string; lead_time: string; payment_term: string; tax_id: string;
};

// field → list of accepted header labels (normalized on both sides when matching)
const HEADER_MAP: Record<string, string[]> = {
  type:           ["ชนิดอุปกรณ์"],
  acc_code:       ["รหัสสินค้า"],
  description:    ["รายละเอียด"],
  row:            ["แถว (เฉพาะด้าย)", "แถว"],
  color:          ["สี"],
  size:           ["ขนาด"],
  quantity:       ["สต็อคคงเหลือ", "สต็อค"],
  unit:           ["หน่วย"],
  unit_cost:      ["ราคาซื้อ"],
  min_quantity:   ["ขั้นต่ำ"],
  supplier_name:  ["ชื่อบริษัทซัพ", "ชื่อบริษัทซัพพลายเออร์", "ซัพพลายเออร์"],
  contact_person: ["ผู้ติดต่อ"],
  contact_number: ["เบอร์ติดต่อ"],
  contact_email:  ["อีเมล"],
  address:        ["ที่อยู่"],
  city:           ["จังหวัด"],
  country:        ["ประเทศ"],
  postal_code:    ["รหัสไปรษณีย์"],
  lead_time:      ["ระยะเวลาส่ง(วัน)", "ระยะเวลาส่ง"],
  payment_term:   ["เทอมจ่ายเงิน"],
  tax_id:         ["เลขผู้เสียภาษี"],
};

const normHeader = (v: any) => String(v ?? "").trim().replace(/\s+/g, " ");
const str = (v: any) => (v === undefined || v === null ? "" : String(v).trim());
const num = (v: any) => { const n = parseFloat(String(v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };

// Build a map of field → column index from the header row.
function resolveColumns(headerRow: any[]): { index: Record<string, number>; missing: string[] } {
  const normalized = headerRow.map(normHeader);
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const [field, labels] of Object.entries(HEADER_MAP)) {
    const idx = normalized.findIndex((h) => labels.some((l) => normHeader(l) === h));
    if (idx === -1) {
      // Only type and unit are truly required; others can be absent
      if (field === "type" || field === "unit") missing.push(labels[0]);
      index[field] = -1;
    } else {
      index[field] = idx;
    }
  }
  return { index, missing };
}

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
      if (raw.length < 2) { showToast("ไฟล์ว่างเปล่าหรือไม่มีข้อมูล", "error"); setRows([]); return; }

      // Resolve columns by header name (robust to reordering).
      const { index, missing } = resolveColumns(raw[0]);
      if (missing.length > 0) {
        showToast("ไม่พบคอลัมน์ที่จำเป็น: " + missing.join(", "), "error");
        setRows([]);
        return;
      }
      const g = (r: any[], field: string) => {
        const i = index[field];
        return i >= 0 ? r[i] : undefined;
      };

      const parsed: ParsedRow[] = raw.slice(1)
        .filter((r) => str(g(r, "type")) || str(g(r, "description"))) // need type or description
        .map((r) => ({
          type: str(g(r, "type")), acc_code: str(g(r, "acc_code")), description: str(g(r, "description")),
          row: str(g(r, "row")) ? parseInt(str(g(r, "row"))) || null : null,
          color: str(g(r, "color")), size: str(g(r, "size")),
          quantity: num(g(r, "quantity")), min_quantity: num(g(r, "min_quantity")),
          unit: str(g(r, "unit")), unit_cost: num(g(r, "unit_cost")),
          supplier_name: str(g(r, "supplier_name")), contact_person: str(g(r, "contact_person")),
          contact_number: str(g(r, "contact_number")), contact_email: str(g(r, "contact_email")),
          address: str(g(r, "address")), city: str(g(r, "city")), country: str(g(r, "country")),
          postal_code: str(g(r, "postal_code")), lead_time: str(g(r, "lead_time")),
          payment_term: str(g(r, "payment_term")), tax_id: str(g(r, "tax_id")),
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
