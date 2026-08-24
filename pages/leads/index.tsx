import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SearchInput } from "@/lib/search";
import { LeadDrawer } from "@/lib/lead-drawer";
import { LeadSummary } from "@/lib/lead-summary";
import {
  getLeads, addLead, updateLead, deleteLead,
  LEAD_STATUSES, LEAD_CHANNELS, LEAD_OWNERS,
  statusMeta, daysOverdue, isDue, isClosed, emptyLeadInput, nextLeadCode, nowStamp, todayISO,
  findLeadDuplicates, duplicateSummary,
  type Lead, type LeadInput, type LeadLogEntry,
} from "@/lib/lead-store";

// กระดานลีดลูกค้า — the sales pipeline board. Replaces a browser-local prototype + the
// factory's Excel sheet with one shared, Supabase-backed board.
//
// UNGATED, and deliberately separate from the stock/order sections: leads are their own
// standalone site area, reached by URL only (no card on the landing page). No readRole /
// redirect here — anyone with the link gets the board.
//
// Two views over the same filtered set: a KANBAN board (drag a card to change its stage, which
// writes an automatic log line) and a TABLE for scanning/exporting. Editing happens in a
// slide-over drawer so the board never loses its place.
//
// A click on a card/row opens a read-only SUMMARY first (openId); the editor (editId) is one
// button away from there. Reading a lead is far more common than changing one, and dropping
// straight into the full form made every glance look like an edit in progress.

function StatCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="card" style={{ padding: "10px 14px", minWidth: 118 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 20, lineHeight: 1.15, color: warn && value > 0 ? "var(--red)" : "var(--text)" }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}</div>
    </div>
  );
}

export default function LeadsPage() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const notify = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000);
  };

  // Filters / view state
  const [view, setView] = useState<"board" | "table">("board");
  const [query, setQuery] = useState("");
  const [fChannel, setFChannel] = useState("");
  const [fOwner, setFOwner] = useState("");
  const [fStatus, setFStatus] = useState("");     // set by clicking the pipeline bar
  const [dueOnly, setDueOnly] = useState(false);
  const [fSub, setFSub] = useState<"" | "yes" | "no">("");   // งานซับคอนแทรค
  const [openId, setOpenId] = useState<string | null>(null);   // summary popup
  const [editId, setEditId] = useState<string | null>(null);   // editor drawer
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [qName, setQName] = useState("");
  const [qChannel, setQChannel] = useState(LEAD_CHANNELS[0]);

  const load = () => {
    setLoading(true);
    getLeads().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((d) => {
      if (fChannel && d.channel !== fChannel) return false;
      if (fOwner && d.owner !== fOwner) return false;
      if (fStatus && d.status !== fStatus) return false;
      if (dueOnly && !isDue(d)) return false;
      if (fSub === "yes" && !d.subcontract) return false;
      if (fSub === "no" && d.subcontract) return false;
      if (!q) return true;
      return [d.lead_code, d.customer_name, d.company, d.phone, d.line_id, d.email,
        d.details, d.product_type, d.note, d.contact_link, d.merchandiser]
        .concat(d.log.map((l) => l.text))
        .join(" ").toLowerCase().includes(q);
    });
  }, [rows, query, fChannel, fOwner, fStatus, dueOnly, fSub]);

  const stats = useMemo(() => {
    const t = todayISO();
    const wk = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    return {
      all: rows.length,
      today: rows.filter((d) => d.received_date === t).length,
      week: rows.filter((d) => (d.received_date ?? "") >= wk).length,
      due: rows.filter(isDue).length,
      open: rows.filter((d) => !isClosed(d.status)).length,
      won: rows.filter((d) => d.status === "won").length,
    };
  }, [rows]);

  // ── Mutations ──
  const patchLead = async (id: string, patch: Partial<LeadInput>, msg?: string) => {
    try {
      const saved = await updateLead(id, patch);
      setRows((rs) => rs.map((r) => (r.id === id ? saved : r)));
      if (msg) notify(msg);
    } catch (e: any) { notify(e.message ?? "บันทึกไม่สำเร็จ", "error"); }
  };

  // Dragging a card to another column changes the stage AND records why the board moved,
  // so the conversation log stays a complete history without anyone typing it.
  const moveTo = async (id: string, status: string) => {
    const d = rows.find((r) => r.id === id);
    if (!d || d.status === status) return;
    const entry: LeadLogEntry = { ts: nowStamp(), text: `เปลี่ยนสถานะ: ${statusMeta(d.status).th} → ${statusMeta(status).th}` };
    await patchLead(id, { status, log: [entry, ...d.log], last_contact_date: todayISO() }, `ย้ายไป “${statusMeta(status).th}” แล้ว`);
  };

  // ── Grab-to-pan the board ──
  // The columns overflow sideways, and a plain mouse has no horizontal wheel. Holding the board
  // BACKGROUND (column padding, header strip, the gaps) and dragging scrolls it; a press that
  // starts on a card is left alone, because a card already owns the HTML5 drag that moves a lead
  // between stages. Touch is untouched — the native scroll already works there.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [panning, setPanning] = useState(false);

  const startPan = (e: React.MouseEvent) => {
    const el = boardRef.current;
    if (!el || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".lead-card, button, a, input, select, textarea")) return;
    const startX = e.clientX;
    const startLeft = el.scrollLeft;
    setPanning(true);
    const move = (ev: MouseEvent) => { el.scrollLeft = startLeft - (ev.clientX - startX); };
    const up = () => {
      setPanning(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Typing a name that is already OPEN on the board is flagged, not blocked — usually it means
  // the existing card should be reopened instead. (Only the name is available here; the editor
  // also checks เบอร์/LINE. Closed leads are skipped, so a returning customer is silent.)
  const qDups = useMemo(() => findLeadDuplicates(rows, { customer_name: qName }), [rows, qName]);

  const quickAdd = async () => {
    const name = qName.trim();
    if (!name) return;
    if (qDups.length > 0 &&
      !confirm(`มีลูกค้าชื่อ “${name}” ที่ยังเปิดอยู่ ${qDups.length} รายการ:\n\n${duplicateSummary(qDups)}\n\nเพิ่มเป็นลีดใหม่อีกรายการหรือไม่?`)) return;
    try {
      const input = emptyLeadInput({
        customer_name: name, channel: qChannel, lead_code: nextLeadCode(rows),
        log: [{ ts: nowStamp(), text: "ลูกค้าติดต่อเข้ามา" }],
      });
      const saved = await addLead(input);
      setRows((rs) => [saved, ...rs]);
      setQName("");
      setEditId(saved.id);
      notify("บันทึกแล้ว");
    } catch (e: any) { notify(e.message ?? "บันทึกไม่สำเร็จ", "error"); }
  };

  const removeLead = async (id: string) => {
    const d = rows.find((r) => r.id === id);
    if (!confirm(`ลบ “${d?.customer_name || d?.company || "รายการนี้"}” ออกจากกระดาน?`)) return;
    try {
      await deleteLead(id);
      setRows((rs) => rs.filter((r) => r.id !== id));
      setOpenId(null);
      setEditId(null);
      notify("ลบแล้ว");
    } catch (e: any) { notify(e.message ?? "ลบไม่สำเร็จ", "error"); }
  };

  const exportCsv = () => {
    const COLS: [string, (d: Lead) => string][] = [
      ["Lead ID", (d) => d.lead_code], ["วันที่รับเรื่อง", (d) => d.received_date ?? ""],
      ["ชื่อลูกค้า", (d) => d.customer_name], ["บริษัท/องค์กร", (d) => d.company],
      ["ช่องทาง", (d) => d.channel], ["Contact / Link", (d) => d.contact_link],
      ["ID: LINE", (d) => d.line_id], ["โทรศัพท์", (d) => d.phone], ["อีเมล", (d) => d.email],
      ["ตำแหน่ง", (d) => d.job_title], ["ประเภทสินค้า", (d) => d.product_type], ["จำนวน (ตัว)", (d) => d.qty],
      ["รายละเอียดเบื้องต้น", (d) => d.details], ["สถานะ", (d) => statusMeta(d.status).th],
      ["ผู้รับผิดชอบ", (d) => d.owner], ["วันที่ติดต่อล่าสุด", (d) => d.last_contact_date ?? ""],
      ["วันที่ติดตามครั้งถัดไป", (d) => d.follow_up_date ?? ""],
      ["วันค้างติดตาม", (d) => { const n = daysOverdue(d.follow_up_date); return n === null || n < 0 ? "" : String(n); }],
      ["Priority", (d) => d.priority], ["วันที่นัดหมาย", (d) => d.appointment_date ?? ""],
      ["Merchandiser", (d) => d.merchandiser], ["งบ/ราคาเป้าหมาย", (d) => d.target_price],
      ["เหตุผลไม่ได้งาน", (d) => d.lost_reason], ["งานซับคอนแทรค", (d) => (d.subcontract ? "ใช่" : "")],
      ["หมายเหตุ", (d) => d.note],
      ["บันทึกการคุย", (d) => d.log.map((l) => `[${l.ts}] ${l.text}`).join("\n")],
    ];
    const cq = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + [COLS.map((c) => cq(c[0])).join(",")]
      .concat(filtered.map((d) => COLS.map((c) => cq(c[1](d))).join(","))).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `ลีดลูกค้า_${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify("ส่งออกแล้ว — เปิดใน Excel ได้เลย");
  };

  const openLead = rows.find((r) => r.id === openId) ?? null;
  const editLead = rows.find((r) => r.id === editId) ?? null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500 }}>กระดานลีดลูกค้า</h1>
          <div style={{ fontSize: 14, color: "var(--text3)" }}>ติดตามลูกค้าที่ติดต่อเข้ามา ตั้งแต่รับเรื่องจนปิดการขาย</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={exportCsv}>ส่งออก CSV</button>
          <Link href="/leads/import"><button>นำเข้า Excel</button></Link>
        </div>
      </div>

      {/* Pipeline bar — each stage's width is its share of the board; click to filter. */}
      <div style={{ marginBottom: 14 }}>
        <div className="lead-seam">
          {LEAD_STATUSES.map((st) => {
            const n = rows.filter((d) => d.status === st.key).length;
            const dim = fStatus && fStatus !== st.key;
            return (
              <button key={st.key} className="lead-seg" title={`${st.th} · ${n}`}
                onClick={() => setFStatus(fStatus === st.key ? "" : st.key)}
                style={{ flex: Math.max(n, 0.35), background: st.color, opacity: dim ? 0.28 : 1 }}>
                {n || ""}
              </button>
            );
          })}
        </div>
        <div className="lead-seam-lab">
          {LEAD_STATUSES.map((st) => {
            const n = rows.filter((d) => d.status === st.key).length;
            return <span key={st.key} style={{ flex: Math.max(n, 0.35) }}>{st.th}</span>;
          })}
        </div>
      </div>

      <div className="stat-grid" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        <StatCard label="ลูกค้าทั้งหมด" value={stats.all} />
        <StatCard label="ลีดใหม่วันนี้" value={stats.today} />
        <StatCard label="7 วันล่าสุด" value={stats.week} />
        <StatCard label="ต้องติดตาม" value={stats.due} warn />
        <StatCard label="ยังเปิดอยู่" value={stats.open} />
        <StatCard label="ได้งาน" value={stats.won} />
      </div>

      {/* Quick add — the fast path when a message comes in; opens the drawer to fill the rest. */}
      <div className="card" style={{ padding: 10, marginBottom: 12, borderLeft: "4px solid var(--accent)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 500, fontSize: 14, whiteSpace: "nowrap" }}>ลีดใหม่</span>
        <input value={qName} onChange={(e) => setQName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") quickAdd(); }}
          placeholder="ชื่อลูกค้า / ชื่อในแชท"
          style={{ flex: 2, minWidth: 170, ...(qDups.length ? { borderColor: "var(--red)" } : null) }} />
        {/* Both fields grow (2:1) so they fill the middle of the bar between the ลีดใหม่ label
            and the button, instead of the dropdown sitting shrink-to-fit against the button. */}
        <select value={qChannel} onChange={(e) => setQChannel(e.target.value)} style={{ flex: 1, minWidth: 130 }}>
          {LEAD_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="primary" onClick={quickAdd} style={{ whiteSpace: "nowrap" }}>บันทึก</button>
        {qDups.length > 0 && (
          <div style={{ flexBasis: "100%", fontSize: 12, color: "var(--red)" }}>
            ชื่อนี้ยังเปิดอยู่ในกระดาน {qDups.length} รายการ —{" "}
            {qDups.slice(0, 3).map((d) => (
              <button key={d.lead.id} className="ghost" onClick={() => setOpenId(d.lead.id)}
                style={{ padding: "0 4px", fontSize: 12, color: "var(--red)", textDecoration: "underline" }}>
                {d.lead.lead_code || "(ไม่มีรหัส)"} · {statusMeta(d.lead.status).th}
              </button>
            ))}
            {qDups.length > 3 ? ` …อีก ${qDups.length - 3}` : ""}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <SearchInput value={query} onChange={setQuery} placeholder="ค้นหา ชื่อ / บริษัท / เบอร์ / LINE / รายละเอียด" leftIcon="🔍" style={{ flex: "1 1 240px", maxWidth: 420 }} />
        <select value={fChannel} onChange={(e) => setFChannel(e.target.value)} style={{ width: "auto", minWidth: 130 }}>
          <option value="">ทุกช่องทาง</option>
          {LEAD_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fOwner} onChange={(e) => setFOwner(e.target.value)} style={{ width: "auto", minWidth: 140 }}>
          <option value="">ผู้รับผิดชอบทุกคน</option>
          {LEAD_OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={fSub} onChange={(e) => setFSub(e.target.value as "" | "yes" | "no")} style={{ width: "auto", minWidth: 140 }}>
          <option value="">ทุกประเภทงาน</option>
          <option value="yes">เฉพาะงานซับ</option>
          <option value="no">ไม่ใช่งานซับ</option>
        </select>
        <button onClick={() => setDueOnly(!dueOnly)}
          style={dueOnly ? { background: "var(--red)", borderColor: "var(--red)", color: "#fff" } : undefined}>
          ต้องติดตาม{stats.due > 0 ? ` (${stats.due})` : ""}
        </button>
        {(fStatus || fChannel || fOwner || dueOnly || fSub || query) && (
          <button className="ghost" onClick={() => { setFStatus(""); setFChannel(""); setFOwner(""); setDueOnly(false); setFSub(""); setQuery(""); }}>
            ล้างตัวกรอง
          </button>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
          {(["board", "table"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              style={{
                border: "none", borderRadius: 0, padding: "7px 14px",
                background: view === v ? "var(--text)" : "var(--bg2)", color: view === v ? "#fff" : "var(--text3)",
              }}>
              {v === "board" ? "บอร์ด" : "ตาราง"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>กำลังโหลด…</div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
          <b style={{ display: "block", fontSize: 16, color: "var(--text)", marginBottom: 5 }}>ยังไม่มีลูกค้าในกระดาน</b>
          เริ่มจากช่อง “ลีดใหม่” ด้านบน หรือกด “นำเข้า Excel”
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
          ไม่พบลูกค้าที่ตรงกับตัวกรอง — ลองล้างคำค้นหรือเลือกตัวกรองใหม่
        </div>
      ) : view === "board" ? (
        <div ref={boardRef} className={`lead-board${panning ? " panning" : ""}`} onMouseDown={startPan}>
          {LEAD_STATUSES.map((st) => {
            const items = filtered.filter((d) => d.status === st.key);
            return (
              <section key={st.key}
                className={`lead-col${overCol === st.key ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOverCol(st.key); }}
                onDragLeave={() => setOverCol((c) => (c === st.key ? null : c))}
                onDrop={(e) => { e.preventDefault(); setOverCol(null); if (dragId) moveTo(dragId, st.key); }}>
                <div className="lead-col-h">
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: st.color, flexShrink: 0 }} />
                  <b style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.th}</b>
                  <i style={{ fontFamily: "var(--mono)", fontStyle: "normal", fontSize: 12, color: "var(--text2)" }}>{items.length}</i>
                </div>
                {items.map((d) => {
                  const od = daysOverdue(d.follow_up_date);
                  const due = isDue(d);
                  const sub = [d.company, d.product_type].filter(Boolean).join(" · ");
                  return (
                    <article key={d.id} className={`lead-card${dragId === d.id ? " dragging" : ""}`}
                      draggable onDragStart={() => setDragId(d.id)} onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      onClick={() => setOpenId(d.id)} style={{ borderLeft: `3px solid ${st.color}` }}>
                      <div style={{ fontWeight: 500, fontSize: 14, lineHeight: 1.3 }}>{d.customer_name || "(ไม่มีชื่อ)"}</div>
                      {sub && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 1 }}>{sub}</div>}
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                        {d.received_date && <span className="lead-tag mono">{d.received_date.slice(5)}</span>}
                        {d.channel && <span className="lead-tag">{d.channel}</span>}
                        {d.subcontract && <span className="lead-tag sub">งานซับ</span>}
                        {d.qty && <span className="lead-tag">{d.qty} ตัว</span>}
                        {d.target_price && <span className="lead-tag mono">฿{d.target_price}</span>}
                        {d.priority === "สูง" && <span className="lead-tag hi">ด่วน</span>}
                        {d.owner && <span className="lead-tag own">{d.owner}</span>}
                        {due && <span className="lead-tag due">{od! > 0 ? `ค้าง ${od} วัน` : "ติดตามวันนี้"}</span>}
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%" }}>
            <thead className="sticky-head">
              <tr>
                <th>Lead ID</th><th>วันที่รับ</th><th>ชื่อลูกค้า</th><th>บริษัท</th><th>ช่องทาง</th>
                <th>สินค้า</th><th className="num">จำนวน</th><th className="num">งบ/ตัว</th>
                <th>สถานะ</th><th>ผู้รับผิดชอบ</th><th>ติดตาม</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const st = statusMeta(d.status);
                const od = daysOverdue(d.follow_up_date);
                const due = isDue(d);
                return (
                  <tr key={d.id} onClick={() => setOpenId(d.id)} style={{ cursor: "pointer" }}>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{d.lead_code}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{d.received_date ?? "—"}</td>
                    <td style={{ fontWeight: 500 }}>
                      {d.customer_name || "—"}
                      {d.phone && <div style={{ color: "var(--text3)", fontFamily: "var(--mono)", fontSize: 11 }}>{d.phone}</div>}
                    </td>
                    <td>{d.company}</td>
                    <td>{d.channel}</td>
                    <td>
                      {d.product_type}
                      {d.subcontract && <span className="lead-tag sub" style={{ marginLeft: d.product_type ? 6 : 0 }}>งานซับ</span>}
                    </td>
                    <td className="num">{d.qty}</td>
                    <td className="num">{d.target_price}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: st.color }} />{st.th}
                      </span>
                    </td>
                    <td>{d.owner}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 12, color: due ? "var(--red)" : undefined, fontWeight: due ? 600 : undefined }}>
                      {d.follow_up_date ?? ""}{due && od! > 0 ? ` (${od})` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <LeadSummary
        lead={editLead ? null : openLead}
        onClose={() => setOpenId(null)}
        onEdit={() => { setEditId(openId); setOpenId(null); }}
        onDelete={removeLead}
        onLogChange={async (id, log) => { await patchLead(id, { log }); }}
        onSubcontractChange={async (id, subcontract) => { await patchLead(id, { subcontract }); }}
      />

      <LeadDrawer
        lead={editLead}
        allLeads={rows}
        onClose={() => setEditId(null)}
        onSave={async (id, patch) => { await patchLead(id, patch, "บันทึกแล้ว"); setEditId(null); }}
        onDelete={removeLead}
        onLogChange={async (id, log) => { await patchLead(id, { log }); }}
      />

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
