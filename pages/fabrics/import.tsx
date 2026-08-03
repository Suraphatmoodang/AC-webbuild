import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useRequireAccess } from "@/lib/auth";
import * as XLSX from "xlsx";
import { createFabricImportBatch } from "@/lib/fabric-store";
import { parseFabricSheet, resolveFabricColumns, type FabricSheetRow } from "@/lib/fabric-sheet";
import { OwnerTag } from "@/lib/owner-tag";
import { usePagination, PaginationBar } from "@/lib/pagination";

// Column labels shown in the "expected format" hint, in sheet order.
const EXPECTED = [
  "ชนิดผ้า", "เส้นใย (Composition)", "โครงสร้าง (Construction)", "สี", "หน้าผ้า",
  "น้ำหนัก", "หน่วย", "แถว", "เลขที่", "สต็อคคงเหลือ", "หน่วย", "ราคาต่อหน่วย", "หน่วย", "ขั้นต่ำ",
  "เจ้าของ", "ชื่อบริษัทซัพ", "ผู้ติดต่อ", "เบอร์ติดต่อ", "อีเมล", "ที่อยู่", "จังหวัด", "ประเทศ",
  "รหัสไปรษณีย์", "ระยะเวลาส่ง(วัน)", "เทอมจ่ายเงิน", "เลขผู้เสียภาษี",
];

export default function FabricImportPage() {
  const router = useRouter();
  const [rows, setRows] = useState<FabricSheetRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { authed } = useRequireAccess("fabric", "admin");

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Clear the input's value so picking the SAME file again still fires onChange —
    // otherwise a second selection of the same path does nothing and looks frozen.
    e.target.value = "";
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      // Pick the first worksheet that actually carries the required headers, not just
      // SheetNames[0] — the first tab may be a cover/instructions sheet with no data.
      let picked: { raw: any[][]; name: string } | null = null;
      let firstNonEmpty: { raw: any[][]; name: string } | null = null;
      for (const name of wb.SheetNames) {
        const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, blankrows: false });
        if (raw.length === 0) continue;
        if (!firstNonEmpty) firstNonEmpty = { raw, name };
        if (resolveFabricColumns(raw[0]).missing.length === 0) { picked = { raw, name }; break; }
      }
      const chosen = picked ?? firstNonEmpty;
      if (!chosen || chosen.raw.length < 2) { showToast("ไฟล์ว่างเปล่าหรือไม่มีข้อมูล", "error"); setRows([]); return; }

      // Displayed-text pass so เลขที่ is read as shown (leading zeros / long codes kept).
      const shown = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[chosen.name], { header: 1, blankrows: false, raw: false });
      const { rows: parsed, cols } = parseFabricSheet(chosen.raw, shown);
      if (cols.missing.length > 0) {
        showToast("ไม่พบคอลัมน์ที่จำเป็น: " + cols.missing.join(", "), "error");
        setRows([]);
        return;
      }
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
      const { count, skipped } = await createFabricImportBatch(rows);
      const msg = count === 0 && skipped > 0
        ? `ทุกรายการอยู่ในคิวตรวจสอบอยู่แล้ว — กำลังไปที่หน้าตรวจสอบ…`
        : `นำเข้าเข้าสู่รายการรอตรวจสอบแล้ว`;
      showToast(msg, "success");
      setRows([]);
      setFileName("");
      // Redirect whenever anything from this file is now staged — newly inserted
      // (count) or already pending from a prior upload (skipped) — so the user sees
      // the staged rows instead of a bare "0".
      if (count > 0 || skipped > 0) setTimeout(() => router.push("/fabrics/import-review"), 1200);
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
        <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>นำเข้าผ้าจาก Excel</h2>
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
            <button className="primary" onClick={handleUpload} disabled={saving} style={{ marginLeft: "auto" }}>
              {saving ? "กำลังบันทึก…" : `นำเข้า ${rows.length} รายการ`}
            </button>
          )}
        </div>

        {/* Format hint — the sheet has three columns literally headed "หน่วย"; the
            parser assigns each to the measurement on its left, so column ORDER
            around those three matters even though every other column is
            matched by name and may be moved freely. */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 8 }}>คอลัมน์ที่รองรับ (แถวแรกของไฟล์ต้องเป็นชื่อคอลัมน์)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {EXPECTED.map((c, i) => (
              <span key={i} className="tag" style={{ fontSize: 13 }}>{c}</span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 10, lineHeight: 1.7 }}>
            · จำเป็นต้องมี: <strong style={{ color: "var(--text2)" }}>ชนิดผ้า</strong> และ <strong style={{ color: "var(--text2)" }}>หน่วย</strong> (ของสต็อค) — คอลัมน์อื่นขาดได้<br />
            · คอลัมน์ <strong style={{ color: "var(--text2)" }}>หน่วย</strong> มีได้ 3 จุด ระบบจะจับคู่กับตัวเลขที่อยู่ทางซ้าย (น้ำหนัก · สต็อคคงเหลือ · ราคาต่อหน่วย) จึงควรวางไว้หลังคอลัมน์นั้น ๆ<br />
            · <strong style={{ color: "var(--text2)" }}>หน้าผ้า</strong> และ <strong style={{ color: "var(--text2)" }}>เลขที่</strong> รับได้ทั้งตัวเลขและตัวอักษร (เช่น 73.5, 32T, 35 1/2T)<br />
            · ซัพพลายเออร์จับคู่จากชื่อบริษัทที่มีอยู่แล้วเท่านั้น — ระบบจะไม่สร้างซัพพลายเออร์ใหม่
          </div>
        </div>
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, color: "var(--text2)" }}>
            ตัวอย่างก่อนนำเข้า · {rows.length} รายการ
          </div>
          <div style={{ overflowX: "auto", maxHeight: "60vh", overflowY: "auto" }}>
            <table style={{ tableLayout: "fixed", minWidth: 1080 }}>
              <colgroup>
                <col style={{ width: "18%" }} /><col style={{ width: "7%" }} /><col style={{ width: "13%" }} />
                <col style={{ width: "9%" }} /><col style={{ width: "7%" }} /><col style={{ width: "8%" }} />
                <col style={{ width: "8%" }} /><col style={{ width: "7%" }} /><col style={{ width: "10%" }} /><col style={{ width: "15%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>ชนิดผ้า</th><th style={{ whiteSpace: "nowrap" }}>เลขที่</th><th style={{ whiteSpace: "nowrap" }}>โครงสร้าง</th><th style={{ whiteSpace: "nowrap" }}>สี</th><th style={{ whiteSpace: "nowrap" }}>หน้าผ้า</th><th className="num" style={{ whiteSpace: "nowrap" }}>น้ำหนัก</th><th className="num" style={{ whiteSpace: "nowrap" }}>สต็อค</th><th className="num" style={{ whiteSpace: "nowrap" }}>ราคา</th><th style={{ whiteSpace: "nowrap" }}>เจ้าของ</th><th style={{ whiteSpace: "nowrap" }}>ซัพพลายเออร์</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500, wordBreak: "break-word" }}>{r.fabric_type}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text2)" }}>{r.fabric_code || "—"}</td>
                    <td style={{ wordBreak: "break-word", fontSize: 14, color: "var(--text2)" }}>{r.construction || "—"}</td>
                    <td style={{ fontSize: 14, color: "var(--text2)" }}>{r.color || "—"}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text2)" }}>{r.width || "—"}</td>
                    <td className="num" style={{ fontSize: 14, color: "var(--text2)" }}>{r.weight ? `${r.weight} ${r.weight_unit}` : "—"}</td>
                    <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.quantity.toLocaleString()} {r.unit}</td>
                    <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{r.unit_cost ? `฿${r.unit_cost.toFixed(2)}` : "—"}</td>
                    <td><OwnerTag owner={r.owner} /></td>
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
