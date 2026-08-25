import { useEffect, useState } from "react";
import { Combo } from "./combo";
import {
  LEAD_STATUSES, LEAD_CHANNELS, LEAD_OWNERS, LEAD_PRIORITIES, LEAD_PRODUCT_TYPES, LOST_REASONS,
  daysOverdue, nowStamp, statusMeta, findLeadDuplicates, duplicateSummary, DUP_FIELD_TH,
  type Lead, type LeadInput, type LeadLogEntry,
} from "./lead-store";

// The lead detail editor — a right-hand slide-over so the board stays visible behind it
// (clicking a card must not lose your place on the board, which a full-page editor would).
// It owns a DRAFT copy of the lead: nothing is written until บันทึก, except log entries,
// which save immediately (a note you typed should never be lost by closing the panel).
//
// Lives in lib/ because that is where this app keeps shared UI (combo, stock-select, search).

const s = (v: string | null | undefined) => v ?? "";

function Field({ label, children, full, hint }: { label: string; children: React.ReactNode; full?: boolean; hint?: string }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined, minWidth: 0 }}>
      <label className="form-label" style={{ marginBottom: 4, display: "block" }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.12em", color: "var(--text3)", marginBottom: 8, textTransform: "uppercase" }}>
        {title}
      </div>
      <div className="form-grid form-grid-2" style={{ gap: 10 }}>{children}</div>
    </div>
  );
}

export function LeadDrawer({
  lead, allLeads, onClose, onSave, onDelete, onLogChange,
}: {
  lead: Lead | null;
  allLeads: Lead[];              // the whole board — only to warn about duplicate ชื่อลูกค้า
  onClose: () => void;
  onSave: (id: string, patch: Partial<LeadInput>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLogChange: (id: string, log: LeadLogEntry[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Lead | null>(lead);
  const [saving, setSaving] = useState(false);
  const [logText, setLogText] = useState("");

  // Re-seed the draft only when a DIFFERENT lead is opened — deliberately keyed on the id, not on
  // the row object. Adding a log line writes to Supabase at once, which hands this component a
  // fresh `lead`; re-seeding on that would throw away every unsaved edit in the other fields (you
  // type a phone number, add a note, and the phone number is gone). The draft's own copy of the
  // log is kept in step by addLog/delLog instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(lead); setLogText(""); }, [lead?.id]);

  // Esc closes, matching the prototype.
  useEffect(() => {
    if (!lead) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

  if (!lead || !draft) return null;
  const set = <K extends keyof Lead>(k: K, v: Lead[K]) => setDraft({ ...draft, [k]: v });
  const overdue = daysOverdue(draft.follow_up_date);
  const meta = statusMeta(draft.status);
  // Open leads matching this one by ชื่อ / เบอร์ / LINE — flagged, never blocked (see lead-store).
  // `hit` says which fields collided, so only those fields turn red.
  const dups = findLeadDuplicates(allLeads, draft, lead.id);
  const hit = new Set(dups.flatMap((d) => d.on));
  const dupRed = (f: "name" | "phone" | "line") => (hit.has(f) ? { borderColor: "var(--red)" } : undefined);

  const save = async () => {
    if (dups.length > 0 &&
      !confirm(`ข้อมูลนี้ซ้ำกับลูกค้าที่ยังเปิดอยู่ ${dups.length} รายการ:\n\n${duplicateSummary(dups)}\n\nบันทึกต่อไปหรือไม่?`)) return;
    setSaving(true);
    try {
      const { id, created_at, updated_at, ...patch } = draft;
      await onSave(lead.id, patch);
    } finally { setSaving(false); }
  };

  const addLog = async () => {
    const text = logText.trim();
    if (!text) return;
    const next = [{ ts: nowStamp(), text }, ...draft.log];
    setDraft({ ...draft, log: next });
    setLogText("");
    await onLogChange(lead.id, next);      // logs persist immediately
  };
  const delLog = async (i: number) => {
    const next = draft.log.filter((_, j) => j !== i);
    setDraft({ ...draft, log: next });
    await onLogChange(lead.id, next);
  };

  return (
    <>
      <div className="lead-scrim" onClick={onClose} />
      <aside className="lead-drawer" role="dialog" aria-label="รายละเอียดลูกค้า">
        <div className="lead-drawer-h">
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
          <b style={{ flex: 1, fontSize: 16, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {draft.customer_name || draft.company || "ลูกค้าใหม่"}
          </b>
          {draft.lead_code && <span style={{ fontFamily: "var(--mono)", fontSize: 12, opacity: 0.7 }}>{draft.lead_code}</span>}
          <button className="ghost" onClick={onClose} style={{ fontSize: 20, lineHeight: 1, padding: "2px 6px", color: "#fff" }} title="ปิด">×</button>
        </div>

        <div className="lead-drawer-b">
          {/* One strip for every kind of collision — the matching fields below are outlined red.
              Closed leads are never counted, so a returning customer raises nothing. */}
          {dups.length > 0 && (
            <div style={{
              background: "var(--red2)", border: "1px solid #edbdb6", borderRadius: "var(--r)",
              padding: "8px 11px", marginBottom: 14, fontSize: 13, color: "var(--red)",
            }}>
              <b>ซ้ำกับลูกค้าที่ยังเปิดอยู่ {dups.length} รายการ</b>
              <div style={{ marginTop: 3, color: "var(--text2)" }}>
                {dups.slice(0, 3).map((d) => (
                  <div key={d.lead.id}>
                    {d.lead.lead_code || "(ไม่มีรหัส)"} · {d.lead.customer_name || "—"} · {statusMeta(d.lead.status).th}
                    <span style={{ color: "var(--text3)" }}> — ตรงกันที่{d.on.map((f) => DUP_FIELD_TH[f]).join(" / ")}</span>
                  </div>
                ))}
                {dups.length > 3 && <div>…อีก {dups.length - 3} รายการ</div>}
              </div>
            </div>
          )}
          <Group title="ผู้ติดต่อ">
            <Field label="ชื่อลูกค้า" full>
              <input value={draft.customer_name} onChange={(e) => set("customer_name", e.target.value)} placeholder="เช่น คุณเมย์"
                style={dupRed("name")} />
            </Field>
            <Field label="บริษัท / องค์กร" full>
              <input value={draft.company} onChange={(e) => set("company", e.target.value)} />
            </Field>
            <Field label="ช่องทาง">
              <Combo value={draft.channel} onChange={(v) => set("channel", v)} options={LEAD_CHANNELS} />
            </Field>
            <Field label="Contact / Link" hint="m.me/… หรือ @ig">
              <input value={draft.contact_link} onChange={(e) => set("contact_link", e.target.value)} />
            </Field>
            <Field label="LINE ID"><input value={draft.line_id} onChange={(e) => set("line_id", e.target.value)} style={dupRed("line")} /></Field>
            <Field label="เบอร์โทร"><input value={draft.phone} onChange={(e) => set("phone", e.target.value)} style={dupRed("phone")} /></Field>
            <Field label="อีเมล"><input value={draft.email} onChange={(e) => set("email", e.target.value)} /></Field>
            <Field label="ตำแหน่ง"><input value={draft.job_title} onChange={(e) => set("job_title", e.target.value)} /></Field>
          </Group>

          <Group title="งานที่ต้องการ">
            <Field label="ประเภทสินค้า">
              <Combo value={draft.product_type} onChange={(v) => set("product_type", v)} options={LEAD_PRODUCT_TYPES} />
            </Field>
            <Field label="จำนวน (ตัว)" hint="ใส่ช่วงได้ เช่น 300-500">
              <input value={draft.qty} onChange={(e) => set("qty", e.target.value)} />
            </Field>
            <Field label="งบ/ราคาเป้าหมาย (ต่อตัว)">
              <input className="num" value={draft.target_price} onChange={(e) => set("target_price", e.target.value)} />
            </Field>
            <Field label="วันที่นัดหมาย">
              <input type="date" value={s(draft.appointment_date)} onChange={(e) => set("appointment_date", e.target.value || null)} />
            </Field>
            {/* งานซับคอนแทรค — a plain flag, not a stage: it says WHERE the work comes from
                (we produce for another factory/brand), which cuts across every pipeline stage. */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                <input type="checkbox" checked={draft.subcontract} onChange={(e) => set("subcontract", e.target.checked)}
                  style={{ width: "auto", margin: 0, cursor: "pointer" }} />
                งานซับคอนแทรค
              </label>
            </div>
            <Field label="รายละเอียดเบื้องต้น" full>
              <textarea value={draft.details} onChange={(e) => set("details", e.target.value)} rows={3} style={{ resize: "vertical" }} />
            </Field>
          </Group>

          <Group title="การติดตาม">
            <Field label="สถานะ">
              <select value={draft.status} onChange={(e) => set("status", e.target.value)}>
                {LEAD_STATUSES.map((st) => <option key={st.key} value={st.key}>{st.th}</option>)}
              </select>
            </Field>
            <Field label="ความสำคัญ">
              <select value={draft.priority} onChange={(e) => set("priority", e.target.value)}>
                <option value="">— ไม่ระบุ —</option>
                {LEAD_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="ผู้รับผิดชอบ">
              <Combo value={draft.owner} onChange={(v) => set("owner", v)} options={LEAD_OWNERS} />
            </Field>
            <Field label="Merchandiser" hint="เมื่อส่งต่อเมอร์">
              <Combo value={draft.merchandiser} onChange={(v) => set("merchandiser", v)} options={LEAD_OWNERS} />
            </Field>
            <Field label="วันที่รับเรื่อง">
              <input type="date" value={s(draft.received_date)} onChange={(e) => set("received_date", e.target.value || null)} />
            </Field>
            <Field label="ติดต่อล่าสุด">
              <input type="date" value={s(draft.last_contact_date)} onChange={(e) => set("last_contact_date", e.target.value || null)} />
            </Field>
            <Field label="ติดตามครั้งถัดไป" full
              hint={overdue === null ? undefined : overdue > 0 ? `ค้าง ${overdue} วัน` : overdue === 0 ? "ต้องติดตามวันนี้" : `อีก ${-overdue} วัน`}>
              <input type="date" value={s(draft.follow_up_date)}
                onChange={(e) => set("follow_up_date", e.target.value || null)}
                style={overdue !== null && overdue >= 0 ? { borderColor: "var(--red)" } : undefined} />
            </Field>
            {/* Only meaningful once the lead is lost — hidden otherwise to keep the form short. */}
            {draft.status === "lost" && (
              <Field label="เหตุผลไม่ได้งาน" full>
                <select value={draft.lost_reason} onChange={(e) => set("lost_reason", e.target.value)}>
                  <option value="">— ไม่ระบุ —</option>
                  {LOST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            )}
            <Field label="หมายเหตุ" full>
              <textarea value={draft.note} onChange={(e) => set("note", e.target.value)} rows={2} style={{ resize: "vertical" }} />
            </Field>
          </Group>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.12em", color: "var(--text3)", marginBottom: 8, textTransform: "uppercase" }}>
              บันทึกการคุย
            </div>
            <div style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
              <textarea value={logText} onChange={(e) => setLogText(e.target.value)} rows={2}
                placeholder="คุยอะไรไปบ้าง เช่น โทรแล้วไม่รับ / ส่งราคาให้แล้ว" style={{ resize: "vertical" }} />
              <button onClick={addLog} style={{ flexShrink: 0, padding: "8px 14px" }}>เพิ่ม</button>
            </div>
            <div style={{ marginTop: 10 }}>
              {draft.log.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>ยังไม่มีบันทึก — เพิ่มได้จากช่องด้านบน</div>
              ) : draft.log.map((e, i) => (
                <div key={i} style={{
                  background: "var(--bg2)", border: "1px solid var(--border)", borderLeft: "3px solid var(--accent)",
                  borderRadius: "var(--r)", padding: "8px 10px", marginBottom: 7, position: "relative",
                }}>
                  <time style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)", display: "block", marginBottom: 2 }}>
                    {e.ts.replace("T", " ")}
                  </time>
                  <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", paddingRight: 18 }}>{e.text}</p>
                  <button className="cl-x" onClick={() => delLog(i)} title="ลบบันทึก"
                    style={{ position: "absolute", top: 4, right: 5 }}>×</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lead-drawer-f">
          <button className="danger" onClick={() => onDelete(lead.id)}>ลบ</button>
          <button className="primary" onClick={save} disabled={saving} style={{ flex: 1 }}>
            {saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </aside>
    </>
  );
}
