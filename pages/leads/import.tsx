import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import * as XLSX from "xlsx";
import { readRole } from "@/lib/auth";
import { parseLeadSheet, EXPECTED_HEADERS } from "@/lib/lead-sheet";
import { addLeadsBulk, getLeads, statusMeta, type LeadInput } from "@/lib/lead-store";

// Import the factory's lead sheet (Customer_Lead_Tracking_Garment_Factory.xlsx).
// Nothing is written until the user confirms — the file is parsed, previewed, and only then
// inserted. Rows whose Lead ID already exists are skipped by default so re-importing an
// updated sheet doesn't duplicate the board.

export default function LeadImportPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<LeadInput[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());
  const [skipDup, setSkipDup] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const r = readRole();
    if (!r) { router.replace("/login"); return; }
    if (r !== "super") { router.replace("/"); return; }
    setAuthed(true);
  }, [router]);

  // Existing lead codes power the duplicate check in the preview.
  useEffect(() => {
    if (!authed) return;
    getLeads()
      .then((ls) => setExistingCodes(new Set(ls.map((l) => l.lead_code.trim()).filter(Boolean))))
      .catch(() => setExistingCodes(new Set()));
  }, [authed]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      // Prefer the "Leads" tab; fall back to the first sheet for a trimmed export.
      const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "leads") ?? wb.SheetNames[0];
      // `raw: false` gives each cell's FORMATTED text — the "10/08/2026" the user sees in Excel —
      // instead of a date serial. Avoids SheetJS's serial→Date rounding shifting dates a day
      // (see dateStr in lib/lead-sheet.ts); every field here is text anyway.
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, raw: false }) as any[][];
      if (raw.length < 2) { showToast("ไฟล์ว่าง หรือไม่มีข้อมูลใต้หัวคอลัมน์", "error"); setRows([]); return; }
      const { rows: parsed, cols } = parseLeadSheet(raw);
      if (cols.missing.length) {
        showToast(`ไม่พบคอลัมน์: ${cols.missing.join(", ")} — ตรวจแถวหัวตาราง`, "error");
        setRows([]); return;
      }
      if (parsed.length === 0) { showToast("ไม่พบแถวลูกค้าในไฟล์", "error"); setRows([]); return; }
      setRows(parsed);
      showToast(`อ่านได้ ${parsed.length} รายการ จากชีต “${sheetName}”`);
    } catch {
      showToast("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ .xlsx", "error");
      setRows([]);
    }
  };

  const dupCount = rows.filter((r) => r.lead_code.trim() && existingCodes.has(r.lead_code.trim())).length;
  const toImport = skipDup ? rows.filter((r) => !(r.lead_code.trim() && existingCodes.has(r.lead_code.trim()))) : rows;

  const handleUpload = async () => {
    if (toImport.length === 0) return;
    setSaving(true);
    try {
      const n = await addLeadsBulk(toImport);
      showToast(`นำเข้า ${n} รายการแล้ว`);
      setRows([]); setFileName("");
      setTimeout(() => router.push("/leads"), 1000);
    } catch (e: any) {
      showToast(e.message ?? "นำเข้าไม่สำเร็จ", "error");
      setSaving(false);
    }
  };

  if (authed !== true) return null;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link href="/leads" style={{ fontSize: 14, color: "var(--text3)" }}>← กลับไปกระดาน</Link>
        <h1 style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>นำเข้าลูกค้าจาก Excel</h1>
        <p style={{ color: "var(--text2)", fontSize: 15, marginTop: 2 }}>
          อัปโหลดไฟล์ตามฟอร์ม “Customer Lead Tracking” — แต่ละแถวจะกลายเป็นลูกค้า 1 รายบนกระดาน
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
            <button className="primary" onClick={handleUpload} disabled={saving || toImport.length === 0} style={{ marginLeft: "auto" }}>
              {saving ? "กำลังบันทึก…" : `นำเข้า ${toImport.length} รายการ`}
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
            · วันที่รองรับทั้งแบบ <strong style={{ color: "var(--text2)" }}>วว/ดด/ปปปป</strong> และ ปปปป-ดด-วว<br />
            · <strong style={{ color: "var(--text2)" }}>วันค้างติดตาม</strong> ไม่ต้องนำเข้า — ระบบคำนวณจากวันที่ติดตามครั้งถัดไปให้เอง<br />
            · <strong style={{ color: "var(--text2)" }}>หมายเหตุ</strong> จะถูกบันทึกเป็นบันทึกการคุยรายการแรกให้ด้วย
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, color: "var(--text2)",
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>ตัวอย่างก่อนนำเข้า · {rows.length} รายการ</span>
            {dupCount > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--text3)" }}>
                <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} style={{ width: "auto" }} />
                ข้าม Lead ID ที่มีอยู่แล้ว ({dupCount})
              </label>
            )}
          </div>
          <div style={{ overflowX: "auto", maxHeight: "60vh", overflowY: "auto" }}>
            <table style={{ minWidth: 900 }}>
              <thead className="sticky-head">
                <tr>
                  <th>Lead ID</th><th>วันที่รับ</th><th>ชื่อลูกค้า</th><th>บริษัท</th><th>ช่องทาง</th>
                  <th>สินค้า</th><th className="num">จำนวน</th><th>สถานะ</th><th>ผู้รับผิดชอบ</th><th>ติดตาม</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const dup = !!r.lead_code.trim() && existingCodes.has(r.lead_code.trim());
                  return (
                    <tr key={i} style={dup && skipDup ? { opacity: 0.45 } : undefined}>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                        {r.lead_code}{dup && <span style={{ color: "var(--red)", marginLeft: 5 }}>ซ้ำ</span>}
                      </td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{r.received_date ?? "—"}</td>
                      <td>{r.customer_name}</td>
                      <td>{r.company}</td>
                      <td>{r.channel}</td>
                      <td>{r.product_type}</td>
                      <td className="num">{r.qty}</td>
                      <td>{statusMeta(r.status).th}</td>
                      <td>{r.owner}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{r.follow_up_date ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
