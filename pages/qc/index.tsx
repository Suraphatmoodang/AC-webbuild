import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { readRole, type Role } from "@/lib/auth";
import {
  QC_ACTIONS, QC_STATIONS, QC_INSPECTORS, DEFAULT_BARCODES, RECORD_MODES,
  DEMO_PRESETS, emptyPreset, tally, resolveCode, lastLiveIndex,
  paceMeta, ratePerHour, actionMeta, fmtClock, fmtTime,
  type QcPreset, type QcScan, type RecordMode,
} from "@/lib/qc-store";

// สถานีตรวจ QC — the scan station screen (MOCK-UP).
//
// One station = one scanner + one fixed sheet of barcodes. The operator scans ONCE per
// garment; the barcode only says which status it is (ผ่าน / ตำหนิ 1-3 / ย้อนรายการ) and the
// run preset here supplies everything else. A USB/BT scanner behaves as a keyboard, so the
// page listens for keystrokes globally and treats "characters then Enter" as a scan — no
// focused input to lose, which is what breaks scanning on a shop floor.
//
// Nothing is persisted yet: state is in the browser and the offline queue is simulated, so
// this can be walked through without any migration. See lib/qc-store.ts for the proposed
// tables and the derived-numbers rules.

const SCAN_GAP_MS = 60;     // a human types slower than this between keys; a scanner does not

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: 12, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 26, lineHeight: 1.25, color: color ?? "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text3)" }}>{sub}</div>}
    </div>
  );
}

export default function QcStationPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const notify = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2600);
  };

  // ── Run state ──
  const [preset, setPreset] = useState<QcPreset>(DEMO_PRESETS[0]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [scans, setScans] = useState<QcScan[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [recordMode, setRecordMode] = useState<RecordMode | null>(null);
  const [lastScan, setLastScan] = useState<{ code: string; ok: boolean; msg: string; ts: number } | null>(null);
  const [askMode, setAskMode] = useState(false);      // "ครบตามจำนวน" modal
  const [offline, setOffline] = useState(false);      // simulated: scans queue, sync on reconnect
  const [now, setNow] = useState(Date.now());

  const sheet = DEFAULT_BARCODES;
  const closed = closedAt !== null;

  useEffect(() => {
    const r: Role | null = readRole();
    if (!r) { router.replace("/login"); return; }
    setAuthed(true);
  }, [router]);

  // Run clock — starts on the FIRST scan (the flow's "timer starts / waits for end"),
  // freezes once the run is closed.
  useEffect(() => {
    if (startedAt === null || closed) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, closed]);

  const t = useMemo(() => tally(scans, preset.faults.length), [scans, preset.faults.length]);
  const elapsedSec = startedAt === null ? 0 : ((closedAt ?? now) - startedAt) / 1000;
  const rate = ratePerHour(t.total, elapsedSec);
  const pace = paceMeta(rate, preset.target_rate);
  const pct = preset.target > 0 ? Math.min(100, (t.total / preset.target) * 100) : 0;
  const pending = scans.filter((s) => !s.synced).length;
  const remaining = Math.max(0, preset.target - t.total);
  const etaSec = rate > 0 ? (remaining / rate) * 3600 : 0;

  // ── The one entry point for every scan (wedge keystrokes AND the on-screen demo keys) ──
  const handleScan = useCallback((raw: string) => {
    const hit = resolveCode(raw, sheet);
    if (!hit) {
      setLastScan({ code: raw, ok: false, msg: "ไม่รู้จักบาร์โค้ดนี้", ts: Date.now() });
      notify(`ไม่รู้จักบาร์โค้ด “${raw}”`, "error");
      return;
    }
    if (closedAt !== null) {
      setLastScan({ code: raw, ok: false, msg: "งานปิดแล้ว — เปิดงานใหม่ก่อน", ts: Date.now() });
      notify("งานนี้ปิดแล้ว สแกนไม่ได้", "error");
      return;
    }

    const ts = Date.now();
    setStartedAt((s) => s ?? ts);

    setScans((prev) => {
      const entry: QcScan = { id: `${ts}-${prev.length}`, ts, code: hit.code, action: hit.action, slot: hit.slot, synced: !offline };
      if (hit.action !== "revert") return [...prev, entry];
      // REVERT: void the most recent scan that still counts, and keep the revert in the log
      // so the history stays a complete record of what the operator actually did.
      const i = lastLiveIndex(prev);
      if (i < 0) return [...prev, entry];
      const next = prev.slice();
      next[i] = { ...next[i], voided: true };
      return [...next, entry];
    });

    const meta = actionMeta(hit.action);
    const label = hit.action === "fault" ? `${meta.th} · ${preset.faults[hit.slot ?? 0] ?? `ตำหนิ ${(hit.slot ?? 0) + 1}`}` : meta.th;
    setLastScan({ code: hit.code, ok: true, msg: label, ts });
  }, [sheet, closedAt, offline, preset.faults]);

  // Keyboard-wedge capture: a scanner "types" its payload fast and ends with Enter. Keys
  // arriving slower than SCAN_GAP_MS apart are a human at the keyboard and are ignored, so
  // typing in the setup form never registers as a scan.
  const buf = useRef<{ chars: string; last: number }>({ chars: "", last: 0 });
  useEffect(() => {
    if (!authed || setupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      const nowMs = Date.now();
      if (e.key === "Enter") {
        const code = buf.current.chars;
        buf.current.chars = "";
        if (code.length >= 3) handleScan(code);
        return;
      }
      if (e.key.length !== 1) return;
      if (nowMs - buf.current.last > SCAN_GAP_MS) buf.current.chars = "";
      buf.current.chars += e.key;
      buf.current.last = nowMs;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authed, setupOpen, handleScan]);

  // Reaching the target does NOT close the run — it asks which of the two record modes to use.
  const askedRef = useRef(false);
  useEffect(() => {
    if (preset.target > 0 && t.total >= preset.target && !askedRef.current && !closed) {
      askedRef.current = true;
      setAskMode(true);
    }
  }, [t.total, preset.target, closed]);

  const record = (mode: RecordMode) => {
    setRecordMode(mode);
    setAskMode(false);
    if (mode === "manual") { setClosedAt(Date.now()); notify("ปิดงานและบันทึกแล้ว"); }
    else notify("บันทึกเบื้องต้นแล้ว — ยังสแกนต่อได้");
  };

  const syncNow = () => {
    setScans((prev) => prev.map((s) => ({ ...s, synced: true })));
    setOffline(false);
    notify(pending > 0 ? `ซิงค์ ${pending} รายการแล้ว` : "ข้อมูลตรงกับเซิร์ฟเวอร์แล้ว");
  };

  const newRun = () => {
    setScans([]); setStartedAt(null); setClosedAt(null); setRecordMode(null);
    setLastScan(null); askedRef.current = false;
    notify("เริ่มงานใหม่");
  };

  if (authed === null) return <div style={{ color: "var(--text3)" }}>กำลังตรวจสอบสิทธิ์…</div>;

  return (
    <div className="qc-page">
      {/* ── Run header: which preset this station is running ── */}
      <div className="card" style={{ padding: "14px 16px", marginBottom: 14, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 18, color: "var(--accent)" }}>{preset.order_code || "— ยังไม่เลือกออเดอร์ —"}</span>
            <span style={{ fontSize: 17 }}>{preset.product}</span>
            {preset.color && <span className="tag">{preset.color}</span>}
            {preset.size && <span className="tag">ไซซ์ {preset.size}</span>}
          </div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 3 }}>
            {preset.station} · ผู้ตรวจ {preset.inspector} · เป้าหมาย {preset.target_rate} ตัว/ชม.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className={`qc-dot ${offline ? "off" : "on"}`} />
          <span style={{ fontSize: 13, color: offline ? "var(--red)" : "var(--green)" }}>
            {offline ? `ออฟไลน์ · ค้าง ${pending}` : "ออนไลน์"}
          </span>
          <button className="ghost" onClick={() => setOffline((o) => !o)} style={{ fontSize: 13 }}>
            {offline ? "จำลอง: ต่อเน็ตแล้ว" : "จำลอง: ตัดเน็ต"}
          </button>
          <button onClick={syncNow} disabled={pending === 0}>ซิงค์ตอนนี้</button>
          <button onClick={() => setSetupOpen(true)}>ตั้งค่างาน</button>
          <button className="ghost" onClick={newRun}>เริ่มงานใหม่</button>
        </div>
      </div>

      <div className="qc-grid">
        <div>
          {/* ── CURRENT GARMENT: the big board the operator actually looks at ── */}
          <div className="card" style={{ padding: 18, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 17, letterSpacing: "0.04em" }}>ตัวที่กำลังตรวจ <span style={{ color: "var(--text3)", fontSize: 13 }}>CURRENT GARMENT</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: "var(--text3)" }}>จังหวะงาน</span>
                <span className="qc-pace" style={{ background: pace.color }}>{pace.th} · {pace.en}</span>
              </div>
            </div>

            <div className="qc-count" style={{ color: t.total > 0 ? pace.color : "var(--text3)" }}>
              {t.total.toLocaleString()} <span style={{ color: "var(--text3)" }}>/ {preset.target.toLocaleString()}</span>
            </div>
            <div className="qc-bar"><span style={{ width: `${pct}%`, background: pace.color }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text3)", marginTop: 6 }}>
              <span>{pct.toFixed(1)}% · เหลืออีก {remaining.toLocaleString()} ตัว</span>
              <span style={{ fontFamily: "var(--mono)" }}>
                {startedAt === null ? "ยังไม่เริ่มจับเวลา" : `เวลา ${fmtClock(elapsedSec)}`}
                {rate > 0 && ` · ${Math.round(rate)} ตัว/ชม.`}
                {rate > 0 && remaining > 0 && ` · เสร็จอีก ~${fmtClock(etaSec)}`}
              </span>
            </div>

            <div className="stat-grid" style={{ marginTop: 16 }}>
              <Tile label="ผ่าน" value={t.pass.toLocaleString()} color="var(--green)" sub="QC PASS" />
              <Tile label="ตำหนิรวม" value={t.faultTotal.toLocaleString()} color={t.faultTotal ? "var(--red)" : undefined}
                sub={t.total > 0 ? `${((t.faultTotal / t.total) * 100).toFixed(1)}% ของที่ตรวจ` : "FAULT TOTAL"} />
              <Tile label="สแกนทั้งหมด" value={scans.length.toLocaleString()} sub={`ย้อนแล้ว ${scans.filter((s) => s.voided).length} ครั้ง`} />
              <Tile label="รอซิงค์" value={pending.toLocaleString()} color={pending ? "var(--red)" : undefined} sub="เก็บออฟไลน์ไว้ก่อน" />
            </div>
          </div>

          {/* ── QC ISSUES: one tile per fault barcode, labels come from the preset ── */}
          <div className="card" style={{ padding: 18, marginBottom: 14 }}>
            <div style={{ fontSize: 16, marginBottom: 12 }}>ตำหนิที่พบ <span style={{ color: "var(--text3)", fontSize: 13 }}>QC ISSUES</span></div>
            <div className="qc-faults">
              {preset.faults.map((f, i) => {
                const n = t.byFault[i] ?? 0;
                return (
                  <div key={i} className="card" style={{ padding: "12px 14px" }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text3)" }}>FAULT {i + 1}</div>
                    <div style={{ fontSize: 15, minHeight: 44 }}>{f}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 26, color: n ? "var(--red)" : "var(--text3)" }}>{n.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 10 }}>
              ชื่อตำหนิเป็นค่าตั้งต้น ใช้ซ้ำทุกงาน — เปลี่ยนได้ที่ “ตั้งค่างาน” เท่านั้น บาร์โค้ดที่พิมพ์แล้วไม่ต้องเปลี่ยน
            </div>
          </div>

          {/* ── Scan log ── */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 16 }}>ประวัติการสแกน</span>
              <span style={{ fontSize: 13, color: "var(--text3)" }}>{scans.length.toLocaleString()} รายการ</span>
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto" }}>
              <table>
                <thead className="sticky-head">
                  <tr>
                    <th>เวลา</th><th>บาร์โค้ด</th><th>สถานะ</th><th>ตำหนิ</th><th className="num">ลำดับ</th><th>ซิงค์</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.length === 0 && (
                    <tr><td colSpan={6} style={{ color: "var(--text3)", padding: 18 }}>ยังไม่มีการสแกน — ยิงบาร์โค้ด “ผ่าน” เพื่อเริ่มจับเวลา</td></tr>
                  )}
                  {scans.slice().reverse().map((s, idx) => {
                    const meta = actionMeta(s.action);
                    return (
                      <tr key={s.id} style={{ opacity: s.voided ? 0.45 : 1 }}>
                        <td style={{ fontFamily: "var(--mono)" }}>{fmtTime(s.ts)}</td>
                        <td style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>{s.code}</td>
                        <td>
                          <span className="badge" style={{ background: `${meta.color}1a`, color: meta.color }}>{meta.th}</span>
                          {s.voided && <span className="tag" style={{ marginLeft: 6 }}>ถูกย้อน</span>}
                        </td>
                        <td>{s.action === "fault" ? preset.faults[s.slot ?? 0] ?? "—" : "—"}</td>
                        <td className="num">{scans.length - idx}</td>
                        <td style={{ color: s.synced ? "var(--green)" : "var(--red)" }}>{s.synced ? "✓" : "รอ"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Side rail: scanner state, the barcode sheet, closing the run ── */}
        <div>
          <div className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>เครื่องสแกน</div>
            <div className="qc-echo" style={{ borderColor: lastScan ? (lastScan.ok ? "var(--green)" : "var(--red)") : "var(--border)" }}>
              {lastScan ? (
                <>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--text2)" }}>{lastScan.code}</div>
                  <div style={{ fontSize: 19, color: lastScan.ok ? "var(--green)" : "var(--red)" }}>{lastScan.msg}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", fontFamily: "var(--mono)" }}>{fmtTime(lastScan.ts)}</div>
                </>
              ) : (
                <div style={{ color: "var(--text3)", fontSize: 15 }}>พร้อมรับการสแกน…<br />1 ตัว = 1 สแกน</div>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
              เครื่องสแกนทำงานเหมือนคีย์บอร์ด — ไม่ต้องคลิกช่องไหนก่อน ยิงได้เลย
            </div>
          </div>

          {/* The printed sheet, as it maps today. Same codes at every station; only the meaning
              on this screen changes per order. */}
          <div className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 16 }}>ชุดบาร์โค้ดประจำสถานี</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>กดเพื่อจำลองการยิง</span>
            </div>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {sheet.map((b) => {
                const meta = actionMeta(b.action);
                const label = b.action === "fault" ? preset.faults[b.slot ?? 0] ?? `ตำหนิ ${(b.slot ?? 0) + 1}` : meta.th;
                return (
                  <button key={b.code} onClick={() => handleScan(b.code)} disabled={closed} className="qc-key" style={{ borderColor: meta.color }}>
                    <span className="qc-bars" aria-hidden="true" />
                    <span style={{ textAlign: "left", flex: 1 }}>
                      <span style={{ display: "block", fontSize: 15, color: meta.color }}>{label}</span>
                      <span style={{ display: "block", fontFamily: "var(--mono)", fontSize: 12, color: "var(--text3)" }}>{b.code}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>ปิดงาน</div>
            {closed ? (
              <div style={{ fontSize: 14, color: "var(--green)" }}>
                ปิดงานแล้วเมื่อ {fmtTime(closedAt!)} · ตรวจ {t.total.toLocaleString()} ตัว · ตำหนิ {t.faultTotal.toLocaleString()}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 10 }}>
                  ครบตามจำนวนแล้วระบบจะถามเอง — หรือกดเองได้ทุกเมื่อ
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {RECORD_MODES.map((m) => (
                    <button key={m.key} className={m.key === "manual" ? "primary" : ""} onClick={() => record(m.key)}
                      style={{ textAlign: "left", padding: "9px 12px" }}>
                      <span style={{ display: "block" }}>{m.th}</span>
                      <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>{m.note}</span>
                    </button>
                  ))}
                </div>
                {recordMode === "prelim" && (
                  <div style={{ fontSize: 13, color: "var(--accent)", marginTop: 10 }}>บันทึกเบื้องต้นไว้แล้ว — งานยังเปิดอยู่</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── "ครบตามจำนวน" — the two-mode decision from the planned flow ── */}
      {askMode && (
        <>
          <div className="modal-overlay" onClick={() => setAskMode(false)} />
          <div className="modal">
            <div className="modal-header">
              <span style={{ fontSize: 17 }}>ครบ {preset.target.toLocaleString()} ตัวแล้ว</span>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 14 }}>
                ตรวจแล้ว {t.total.toLocaleString()} ตัว · ผ่าน {t.pass.toLocaleString()} · ตำหนิ {t.faultTotal.toLocaleString()} · ใช้เวลา {fmtClock(elapsedSec)}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {RECORD_MODES.map((m) => (
                  <button key={m.key} className={m.key === "manual" ? "primary" : ""} onClick={() => record(m.key)}
                    style={{ textAlign: "left", padding: "10px 12px" }}>
                    <span style={{ display: "block" }}>{m.th}</span>
                    <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>{m.note}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="ghost" onClick={() => setAskMode(false)}>ยังไม่ตัดสินใจ</button>
            </div>
          </div>
        </>
      )}

      {/* ── Setup: the "set specifications / scheduled preset" step ── */}
      {setupOpen && (
        <SetupModal
          preset={preset}
          started={scans.length > 0}
          onClose={() => setSetupOpen(false)}
          onSave={(p) => { setPreset(p); setSetupOpen(false); askedRef.current = false; notify("บันทึกการตั้งค่างานแล้ว"); }}
        />
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}

// ── Setup modal ────────────────────────────────────────────────────────
// Everything the barcode does NOT carry lives here: which order, station, inspector, how many
// pieces, the expected rate, and what each fault barcode means. Fault names default from the
// store and stay filled in — they're only retyped when this order genuinely fails differently.
function SetupModal({ preset, started, onClose, onSave }: {
  preset: QcPreset; started: boolean; onClose: () => void; onSave: (p: QcPreset) => void;
}) {
  const [d, setD] = useState<QcPreset>(preset);
  const set = (patch: Partial<QcPreset>) => setD((x) => ({ ...x, ...patch }));
  const setFault = (i: number, v: string) => setD((x) => ({ ...x, faults: x.faults.map((f, j) => (j === i ? v : f)) }));

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <span style={{ fontSize: 17 }}>ตั้งค่างานตรวจ</span>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <div className="form-row">
            <label className="form-label">งานที่วางแผนไว้วันนี้</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {DEMO_PRESETS.map((p) => (
                <button key={p.order_code} onClick={() => setD({ ...p })} style={{ fontSize: 13 }}>
                  {p.order_code} · {p.product} · {p.target.toLocaleString()} ตัว
                </button>
              ))}
              <button className="ghost" onClick={() => setD(emptyPreset({ station: d.station, inspector: d.inspector }))} style={{ fontSize: 13 }}>
                ล้าง
              </button>
            </div>
          </div>

          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="form-row">
              <label className="form-label">สถานี</label>
              <select value={d.station} onChange={(e) => set({ station: e.target.value })}>
                {QC_STATIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">ผู้ตรวจ</label>
              <select value={d.inspector} onChange={(e) => set({ inspector: e.target.value })}>
                {QC_INSPECTORS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">เลขที่ออเดอร์</label>
              <input value={d.order_code} onChange={(e) => set({ order_code: e.target.value })} placeholder="OD-2408-014" />
            </div>
            <div className="form-row">
              <label className="form-label">สินค้า</label>
              <input value={d.product} onChange={(e) => set({ product: e.target.value })} placeholder="เสื้อโปโล คอปก" />
            </div>
            <div className="form-row">
              <label className="form-label">สี</label>
              <input value={d.color} onChange={(e) => set({ color: e.target.value })} placeholder="กรมท่า" />
            </div>
            <div className="form-row">
              <label className="form-label">ไซซ์</label>
              <input value={d.size} onChange={(e) => set({ size: e.target.value })} placeholder="M" />
            </div>
            <div className="form-row">
              <label className="form-label">จำนวนที่ต้องตรวจ (ตัว)</label>
              <input inputMode="numeric" value={d.target || ""} onChange={(e) => set({ target: Number(e.target.value) || 0 })} placeholder="500" />
            </div>
            <div className="form-row">
              <label className="form-label">เป้าหมาย (ตัว/ชม.)</label>
              <input inputMode="numeric" value={d.target_rate || ""} onChange={(e) => set({ target_rate: Number(e.target.value) || 0 })} placeholder="70" />
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 4 }}>
            <div style={{ fontSize: 15, marginBottom: 4 }}>ความหมายของบาร์โค้ดตำหนิ</div>
            <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 10 }}>
              บาร์โค้ดที่พิมพ์ไว้คงเดิมเสมอ — เปลี่ยนแค่ชื่อตำหนิที่ผูกไว้ในเว็บ
            </div>
            {d.faults.map((f, i) => (
              <div key={i} className="form-row" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--text3)", width: 96, flexShrink: 0 }}>
                  {DEFAULT_BARCODES.find((b) => b.action === "fault" && b.slot === i)?.code ?? `F${i + 1}`}
                </span>
                <input value={f} onChange={(e) => setFault(i, e.target.value)} />
              </div>
            ))}
          </div>

          {started && (
            <div style={{ fontSize: 13, color: "var(--red)" }}>
              งานนี้เริ่มสแกนไปแล้ว — การแก้ชื่อตำหนิจะมีผลกับยอดที่นับไว้แล้วด้วย
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="ghost" onClick={onClose}>ยกเลิก</button>
          <button className="primary" onClick={() => onSave(d)}>บันทึก</button>
        </div>
      </div>
    </>
  );
}
