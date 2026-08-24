import { useEffect, useState } from "react";
import { daysOverdue, nowStamp, statusMeta, type Lead, type LeadLogEntry } from "./lead-store";

// The lead SUMMARY — what a click on a board card (or a table row) opens now.
// Reading a lead ("who is this, what did they want, when do we call back?") is the common
// case; editing is the rarer one, and dropping straight into a 20-field form made every
// glance feel like an edit. So the click lands here — a compact read-only card — and
// แก้ไข hands off to LeadDrawer for the actual editing.
//
// Shares the .lead-scrim / .lead-drawer chrome so both panels look like one thing; the
// .lead-summary modifier just makes the box narrower and height-fit-to-content.

function Row({ label, value, mono, color }: { label: string; value: React.ReactNode; mono?: boolean; color?: string }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--border)", alignItems: "baseline" }}>
      <span style={{ fontSize: 12, color: "var(--text3)", flex: "0 0 116px" }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, wordBreak: "break-word", color, fontFamily: mono ? "var(--mono)" : undefined }}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.12em", color: "var(--text3)", marginBottom: 4, textTransform: "uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function LeadSummary({
  lead, onClose, onEdit, onDelete, onLogChange, onSubcontractChange,
}: {
  lead: Lead | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: (id: string) => Promise<void>;
  onLogChange: (id: string, log: LeadLogEntry[]) => Promise<void>;
  onSubcontractChange: (id: string, value: boolean) => Promise<void>;
}) {
  const [logText, setLogText] = useState("");
  useEffect(() => { setLogText(""); }, [lead?.id]);

  useEffect(() => {
    if (!lead) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

  if (!lead) return null;

  // Notes save the moment you press เพิ่ม, same as in the editor — the popup keeps no draft,
  // so the parent refresh is what puts the new line on screen.
  const addLog = async () => {
    const text = logText.trim();
    if (!text) return;
    setLogText("");
    await onLogChange(lead.id, [{ ts: nowStamp(), text }, ...lead.log]);
  };

  const meta = statusMeta(lead.status);
  const overdue = daysOverdue(lead.follow_up_date);
  const followUp = lead.follow_up_date
    ? `${lead.follow_up_date}${overdue === null ? "" : overdue > 0 ? ` · ค้าง ${overdue} วัน` : overdue === 0 ? " · ต้องติดตามวันนี้" : ` · อีก ${-overdue} วัน`}`
    : "";

  return (
    <>
      <div className="lead-scrim" onClick={onClose} />
      <aside className="lead-drawer lead-summary" role="dialog" aria-label="สรุปข้อมูลลูกค้า">
        <div className="lead-drawer-h">
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
          <b style={{ flex: 1, fontSize: 16, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {lead.customer_name || lead.company || "ลูกค้าใหม่"}
          </b>
          {lead.lead_code && <span style={{ fontFamily: "var(--mono)", fontSize: 12, opacity: 0.7 }}>{lead.lead_code}</span>}
          <button className="ghost" onClick={onClose} style={{ fontSize: 20, lineHeight: 1, padding: "2px 6px", color: "#fff" }} title="ปิด">×</button>
        </div>

        <div className="lead-drawer-b">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
            <span className="lead-tag" style={{ background: meta.color, borderColor: meta.color, color: "#fff" }}>{meta.th}</span>
            {lead.priority && <span className={`lead-tag${lead.priority === "สูง" ? " hi" : ""}`}>ความสำคัญ {lead.priority}</span>}
            {lead.owner && <span className="lead-tag own">{lead.owner}</span>}
            {lead.channel && <span className="lead-tag">{lead.channel}</span>}
            {lead.subcontract && <span className="lead-tag sub">งานซับ</span>}
          </div>

          <Section title="ผู้ติดต่อ">
            <Row label="บริษัท / องค์กร" value={lead.company} />
            <Row label="ตำแหน่ง" value={lead.job_title} />
            <Row label="เบอร์โทร" value={lead.phone} mono />
            <Row label="LINE ID" value={lead.line_id} mono />
            <Row label="อีเมล" value={lead.email} />
            <Row label="Contact / Link" value={lead.contact_link} />
          </Section>

          <Section title="งานที่ต้องการ">
            <Row label="ประเภทสินค้า" value={lead.product_type} />
            <Row label="จำนวน (ตัว)" value={lead.qty} mono />
            <Row label="งบ/ราคาเป้าหมาย" value={lead.target_price ? `฿${lead.target_price}` : ""} mono />
            <Row label="รายละเอียด" value={lead.details && <span style={{ whiteSpace: "pre-wrap" }}>{lead.details}</span>} />
            {/* The one editable control in this read-only card — a subcontract flag is usually
                noticed while reading, and saves at once (same rule as a log line). */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, padding: "8px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={lead.subcontract}
                onChange={(ev) => onSubcontractChange(lead.id, ev.target.checked)}
                style={{ width: "auto", margin: 0, cursor: "pointer" }} />
              งานซับคอนแทรค
            </label>
          </Section>

          <Section title="การติดตาม">
            <Row label="วันที่รับเรื่อง" value={lead.received_date} mono />
            <Row label="ติดต่อล่าสุด" value={lead.last_contact_date} mono />
            <Row label="ติดตามครั้งถัดไป" value={followUp} mono
              color={overdue !== null && overdue >= 0 ? "var(--red)" : undefined} />
            <Row label="วันที่นัดหมาย" value={lead.appointment_date} mono />
            <Row label="Merchandiser" value={lead.merchandiser} />
            {lead.status === "lost" && <Row label="เหตุผลไม่ได้งาน" value={lead.lost_reason} />}
            <Row label="หมายเหตุ" value={lead.note && <span style={{ whiteSpace: "pre-wrap" }}>{lead.note}</span>} />
          </Section>

          {/* Only the latest few lines — the full history (and adding to it) lives in the editor. */}
          <Section title={`บันทึกการคุย${lead.log.length > 3 ? ` · ล่าสุด 3 จาก ${lead.log.length}` : ""}`}>
            <div style={{ display: "flex", gap: 7, alignItems: "flex-start", marginBottom: 10 }}>
              <textarea value={logText} onChange={(ev) => setLogText(ev.target.value)} rows={2}
                placeholder="คุยอะไรไปบ้าง เช่น โทรแล้วไม่รับ / ส่งราคาให้แล้ว" style={{ resize: "vertical" }} />
              <button onClick={addLog} style={{ flexShrink: 0, padding: "8px 14px" }}>เพิ่ม</button>
            </div>
            {lead.log.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text3)" }}>ยังไม่มีบันทึก — เพิ่มได้จากช่องด้านบน</div>
            ) : lead.log.slice(0, 3).map((e, i) => (
              <div key={i} style={{
                background: "var(--bg2)", border: "1px solid var(--border)", borderLeft: "3px solid var(--accent)",
                borderRadius: "var(--r)", padding: "7px 10px", marginBottom: 6,
              }}>
                <time style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)", display: "block", marginBottom: 2 }}>
                  {e.ts.replace("T", " ")}
                </time>
                <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{e.text}</p>
              </div>
            ))}
          </Section>
        </div>

        <div className="lead-drawer-f">
          <button className="danger" onClick={() => onDelete(lead.id)}>ลบ</button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}>ปิด</button>
          <button className="primary" onClick={onEdit}>แก้ไข</button>
        </div>
      </aside>
    </>
  );
}
