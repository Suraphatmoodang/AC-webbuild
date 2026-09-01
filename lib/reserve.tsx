import { useState } from "react";

// ── Stock lock (ล็อกสต็อค) — shared by อุปกรณ์ and ผ้า ───────────────────────
//
// The problem this solves: stock that is physically already spoken for by an order
// kept getting issued to something else. A lock pins a FLOOR under an item's stock:
//   · stock ABOVE the locked value  → free to issue as normal (the surplus)
//   · stock AT the locked value     → OUT/ปรับยอด is refused until someone unlocks
//
// The lock is a plain number on the item row (`reserved_qty`) plus a free-text note
// saying who/what it's for (`reserved_note` — usually an order code or customer).
// It is NOT lot-based and NOT part of item identity: it's an operational flag, so a
// single number is enough and no lot bookkeeping has to stay in sync. The floor is
// enforced in the STORES (addTransaction / addFabricTransaction), not in page code,
// so nothing can slip past by using a different screen.
//
// Deliberately NOT enforced on: รับเข้า/คืนสต็อค (they only add), the manage page's
// stock overwrite, and the bulk updater — those are admin-level corrections that
// rewrite the lot history outright, and blocking them would trap a wrong number.

export type Reservable = { reserved_qty?: number | null; reserved_note?: string | null };

export const reservedOf = (i?: Reservable | null): number => {
  const n = Number(i?.reserved_qty ?? 0);
  return isNaN(n) || n <= 0 ? 0 : n;
};
export const reserveNoteOf = (i?: Reservable | null): string => (i?.reserved_note ?? "").trim();

// What can actually be issued right now. Never negative: if stock has already
// fallen below the lock (an admin overwrite, an import), available is simply 0.
export const availableOf = (stock: number, reserved: number): number => Math.max(0, stock - reserved);

// How much stock the lock is still WAITING FOR. Locking MORE than you hold is a
// supported, deliberate move: the lock is the order's commitment, so it's set once at
// full order quantity and incoming รับเข้า counts toward it on its own (the store's
// floor is on absolute stock, and IN is never checked against it) — nobody has to
// remember to raise the lock as goods arrive. This number is what turns that from an
// opaque "เบิกได้ 0" into "ยังขาดอีก X", i.e. how much the order still needs.
export const shortfallOf = (stock: number, reserved: number): number => Math.max(0, reserved - stock);

// Shown wherever a locked item appears in a list, so the lock is visible without
// opening anything. Amber (not red) — a lock is a normal state, not an error.
export function LockChip({ qty, unit, note, size = "sm" }: {
  qty: number; unit?: string; note?: string; size?: "sm" | "md";
}) {
  if (qty <= 0) return null;
  const pad = size === "md" ? "3px 10px" : "1px 8px";
  const font = size === "md" ? 13 : 12;
  return (
    <span title={`ล็อกไว้ ${qty.toLocaleString()}${unit ? ` ${unit}` : ""}${note ? ` · ${note}` : ""} — ต้องปลดล็อกก่อนเบิก`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, fontSize: font, padding: pad,
        borderRadius: 999, background: "#fef3c7", border: "1px solid #fcd34d", color: "#b45309",
        whiteSpace: "nowrap", fontWeight: 500, maxWidth: "100%",
      }}>
      <span style={{ flexShrink: 0 }}>🔒</span>
      <span style={{ fontFamily: "var(--mono)" }}>{qty.toLocaleString()}</span>
      {note && <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontWeight: 400 }}>· {note}</span>}
    </span>
  );
}

// Small button that opens the lock modal. Reads its own state from the item so
// every table can drop it in without duplicating the "locked?" logic.
export function LockButton({ reserved, onClick, style }: {
  reserved: number; onClick: () => void; style?: React.CSSProperties;
}) {
  const locked = reserved > 0;
  return (
    <button className="ghost" onClick={onClick} title={locked ? "แก้ไข / ปลดล็อกจำนวนที่กันไว้" : "ล็อกจำนวนไว้สำหรับออเดอร์"}
      style={{ padding: "4px 8px", fontSize: 15, whiteSpace: "nowrap",
        color: locked ? "#b45309" : "var(--text2)", ...(style ?? {}) }}>
      {locked ? "🔒 ล็อกอยู่" : "🔓 ล็อก"}
    </button>
  );
}

// The lock editor. One modal covers all three actions — set, change, unlock —
// because they're the same decision seen from different states.
//
// Unlocking is the dangerous direction (it re-opens stock someone is counting on),
// so it is a SEPARATE red screen inside the modal that needs an explicit tick before
// the button enables. A single mis-click can't clear a lock.
export function ReserveModal({
  title, subtitle, unit, stock, reserved, note, saving, onClose, onSave, onUnlock,
}: {
  title: string;
  subtitle?: string;
  unit: string;
  stock: number;
  reserved: number;
  note: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (qty: number, note: string) => void;
  onUnlock: () => void;
}) {
  const [qty, setQty] = useState(reserved > 0 ? String(reserved) : "");
  const [text, setText] = useState(note);
  const [unlockMode, setUnlockMode] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const q = parseFloat(qty);
  const valid = !isNaN(q) && q > 0;
  const overStock = valid && q > stock;
  const target = valid ? q : reserved;              // the lock as it will stand after saving
  const available = availableOf(stock, target);
  const shortfall = shortfallOf(stock, target);

  // ONE lock per item: saving REPLACES whatever was there. Two ways that quietly takes
  // stock away from whoever had it, both worth saying out loud before the save:
  //   · a different order/customer taking the item over (the note changed)
  //   · lowering the amount (the difference goes back into free stock)
  const takenOver = reserved > 0 && note.trim() !== "" && text.trim() !== note.trim();
  const lowering = reserved > 0 && valid && q < reserved;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 500, color: unlockMode ? "var(--red)" : "#b45309" }}>
            {unlockMode ? "ปลดล็อกสต็อค" : reserved > 0 ? "แก้ไขจำนวนที่ล็อกไว้" : "ล็อกจำนวนไว้สำหรับออเดอร์"}
          </div>
          <button className="ghost" style={{ padding: "4px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 500 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 14, color: "var(--text2)" }}>{subtitle}</div>}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, background: "var(--bg3)", borderRadius: "var(--r)", padding: "8px 12px" }}>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>สต็อคปัจจุบัน</div>
              <div style={{ fontFamily: "var(--mono)", fontWeight: 500 }}>{stock.toLocaleString()} {unit}</div>
            </div>
            {/* Locking more than you hold is normal (see shortfallOf) — when that's the case
                the useful number isn't "เบิกได้ 0", it's how much the order is still short. */}
            {shortfall > 0 ? (
              <div style={{ flex: 1, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "var(--r)", padding: "8px 12px" }}>
                <div style={{ fontSize: 12, color: "#92400e" }}>ยังขาดอีก</div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 500, color: "#b45309" }}>
                  {shortfall.toLocaleString()} {unit}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, background: "var(--bg3)", borderRadius: "var(--r)", padding: "8px 12px" }}>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>เบิกได้ (หลังล็อก)</div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 500, color: available <= 0 ? "var(--red)" : "var(--green)" }}>
                  {available.toLocaleString()} {unit}
                </div>
              </div>
            )}
          </div>

          {unlockMode ? (
            /* ── UNLOCK: deliberate, two-step, and spells out the consequence ── */
            <>
              <div style={{ background: "var(--red2)", border: "1px solid var(--red)", borderRadius: "var(--r)", padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontWeight: 500, color: "var(--red)", marginBottom: 4 }}>⚠ กำลังจะปลดล็อก {reserved.toLocaleString()} {unit}</div>
                <div style={{ fontSize: 14, color: "var(--text2)" }}>
                  {note ? <>จำนวนนี้ถูกกันไว้สำหรับ <strong style={{ color: "var(--text)" }}>{note}</strong> — </> : null}
                  เมื่อปลดแล้ว ใครก็เบิกของจำนวนนี้ออกไปใช้กับงานอื่นได้ทันที
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 14, color: "var(--text2)" }}>
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)}
                  style={{ width: "auto", marginTop: 4 }} />
                <span>ยืนยันว่าของจำนวนนี้ไม่ได้ถูกกันไว้ให้ออเดอร์ใดแล้ว และต้องการปลดล็อก</span>
              </label>
            </>
          ) : (
            /* ── SET / EDIT the locked amount ── */
            <>
              <div className="form-row">
                <label className="form-label">จำนวนที่ล็อกไว้ · {unit}</label>
                <input type="number" min="0" step="any" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)}
                  style={{ fontSize: 20, fontFamily: "var(--mono)", padding: "10px 12px",
                    ...(overStock ? { borderColor: "#fcd34d" } : {}) }} />
                {/* Over-locking is a supported move, not an error — amber, and it explains the
                    payoff: รับเข้า counts toward the lock by itself, so set it once and forget it. */}
                <div style={{ fontSize: 12, color: overStock ? "#b45309" : "var(--text3)", marginTop: 4 }}>
                  {overStock
                    ? `มากกว่าสต็อคที่มีตอนนี้ (${stock.toLocaleString()} ${unit}) — ล็อกได้ตามจำนวนที่ออเดอร์ต้องใช้จริง `
                      + `ของที่รับเข้ามาใหม่จะนับเข้าการล็อกนี้เอง ไม่ต้องมาแก้ตัวเลขอีก (ระหว่างนี้เบิกไม่ได้)`
                    : "สต็อคส่วนที่เกินจำนวนนี้ยังเบิกได้ตามปกติ · เมื่อลดลงถึงจำนวนนี้ต้องปลดล็อกก่อนจึงจะเบิกได้"}
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">กันไว้ให้ · ออเดอร์ / ลูกค้า</label>
                <input placeholder="เช่น AC-0142 / คุณนัน" value={text} onChange={(e) => setText(e.target.value)} />
              </div>

              {/* One lock per item — say plainly what this save takes away from whoever had it. */}
              {(takenOver || lowering) && (
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "var(--r)", padding: "8px 12px", fontSize: 14, color: "#92400e" }}>
                  ⚠ จะแทนที่การล็อกเดิม — <strong>{reserved.toLocaleString()} {unit}</strong>
                  {note ? <> ที่กันไว้ให้ <strong>{note}</strong></> : null}
                  {takenOver && <div style={{ marginTop: 3 }}>ของจำนวนนี้จะไม่ถูกกันไว้ให้ {note} อีกต่อไป</div>}
                  {lowering && !takenOver && (
                    <div style={{ marginTop: 3 }}>
                      ปล่อยคืนเข้าสต็อคที่เบิกได้ {(reserved - q).toLocaleString()} {unit}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          {unlockMode ? (
            <>
              <button onClick={() => { setUnlockMode(false); setUnderstood(false); }}>ย้อนกลับ</button>
              <button className="danger" disabled={!understood || saving} onClick={onUnlock}
                style={{ opacity: !understood || saving ? 0.5 : 1 }}>
                {saving ? "กำลังปลดล็อก…" : "ยืนยันปลดล็อก"}
              </button>
            </>
          ) : (
            <>
              {reserved > 0 && (
                <button onClick={() => setUnlockMode(true)}
                  style={{ marginRight: "auto", color: "var(--red)", borderColor: "var(--red2)" }}>
                  🔓 ปลดล็อก
                </button>
              )}
              <button onClick={onClose}>ยกเลิก</button>
              <button className="primary" disabled={!valid || saving} onClick={() => onSave(q, text.trim())}
                style={{ opacity: !valid || saving ? 0.5 : 1 }}>
                {saving ? "กำลังบันทึก…" : reserved > 0 ? "บันทึกการล็อก" : "ล็อกจำนวนนี้"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
