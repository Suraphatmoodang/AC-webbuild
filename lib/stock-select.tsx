import { useEffect, useMemo, useRef, useState } from "react";
import { matchesTokens, searchTokens } from "./search-match";

// A searchable, id-based picker for large stock lists (อุปกรณ์ / ผ้า can be 5000+ rows —
// a native <select> is unusable there). Unlike Combo (which is string type-or-pick), this
// selects an item by id and returns that id; typing filters the list by label. It is NOT a
// free-text field — an unmatched query selects nothing. Picking the placeholder row returns "".
export type StockOption = { id: string; label: string; unit?: string; price?: number };
// Extra non-stock rows pinned to the TOP of the menu (above the real stock list). They let one
// picker choose between "a real stock item" and several kinds of placeholder — e.g. an อุปกรณ์
// that isn't in stock yet vs. a pure cost line (ค่าพิมพ์/ค่าย้อม) that will never be stock.
// Their ids are sentinels chosen by the caller; `hint` is dim helper text shown beside the label.
export type StockSpecial = { id: string; label: string; hint?: string };

// Render only this many matches at once — filtering 5000 strings is cheap, but painting
// 5000 rows is not. A footer tells the user to narrow the search when there are more.
const CAP = 60;

export function StockSelect({
  value,
  onChange,
  options,
  placeholder = "— เลือก —",
  formatRight,
  specials,
}: {
  value: string | null;
  onChange: (id: string) => void;       // "" clears back to the placeholder
  options: StockOption[];
  placeholder?: string;
  formatRight?: (o: StockOption) => string;   // e.g. a price/unit suffix
  specials?: StockSpecial[];            // pinned non-stock rows; replaces the single placeholder row
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // A special id selects like a stock row (so the closed box shows its label), but carries no item.
  const special = value ? specials?.find((s) => s.id === value) ?? null : null;
  const selected = value ? options.find((o) => o.id === value) ?? special ?? null : null;

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Tokenised match: every word of the query must appear in the label, in any order — so
  // "ซิป ดำ" finds "ซิป วีนัส · ซิปไนล่อนปิดท้าย #03 · สีดำ", which the old contiguous
  // includes() could not (the words aren't adjacent in the joined label).
  const { shown, total } = useMemo(() => {
    const tokens = searchTokens(query);
    const all = tokens.length ? options.filter((o) => matchesTokens(tokens, o.label)) : options;
    return { shown: all.slice(0, CAP), total: all.length };
  }, [query, options]);

  const pick = (id: string) => { onChange(id); setQuery(""); setOpen(false); };

  return (
    <div ref={wrapRef} className="combo" style={{ position: "relative" }}>
      {open ? (
        // Open = a search field. Auto-focused so you can type immediately; the current pick
        // shows as a grey hint.
        <input
          autoFocus
          value={query}
          placeholder={selected ? selected.label : placeholder}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          style={{ paddingRight: 30 }}
        />
      ) : (
        // Closed = a display box that WRAPS, so a long selected label is fully readable
        // instead of being truncated by a single-line <input>. Styled to match inputs. The
        // placeholder label itself shows as solid text when nothing is linked.
        <div
          role="button"
          tabIndex={0}
          title={selected ? selected.label : placeholder}
          onMouseDown={(e) => { e.preventDefault(); setQuery(""); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setQuery(""); setOpen(true); } }}
          style={{
            background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)",
            fontSize: 15, lineHeight: 1.4, padding: "7px 32px 7px 15px", borderRadius: "var(--r)",
            width: "100%", minHeight: 38, boxSizing: "border-box", cursor: "pointer",
            whiteSpace: "normal", wordBreak: "break-word",
          }}
        >
          {selected ? selected.label : placeholder}
        </div>
      )}
      <button
        type="button"
        tabIndex={-1}
        aria-label="เปิดรายการ"
        className="combo-caret"
        onMouseDown={(e) => { e.preventDefault(); setQuery(""); setOpen((o) => !o); }}
      >▾</button>

      {open && (
        <div className="combo-menu">
          {specials && specials.length ? (
            // Pinned placeholder rows — one per kind of non-stock line.
            specials.map((s) => (
              <div key={s.id} className={`combo-opt${s.id === value ? " sel" : ""}`}
                style={{ whiteSpace: "normal" }}
                onMouseDown={(e) => { e.preventDefault(); pick(s.id); }}>
                {s.label}
                {s.hint ? <span style={{ color: "var(--text3)", marginLeft: 6 }}>{s.hint}</span> : null}
              </div>
            ))
          ) : (
            <div className={`combo-opt${!value ? " sel" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(""); }}>
              {placeholder}
            </div>
          )}
          {shown.map((o) => (
            <div key={o.id} className={`combo-opt${o.id === value ? " sel" : ""}`}
              title={o.label}
              // Full label wraps instead of truncating with an ellipsis — stock names are long.
              style={{ whiteSpace: "normal" }}
              onMouseDown={(e) => { e.preventDefault(); pick(o.id); }}>
              {o.label}
              {formatRight && formatRight(o)
                ? <span style={{ color: "var(--text3)", marginLeft: 6 }}>{formatRight(o)}</span>
                : null}
            </div>
          ))}
          {total > shown.length && (
            <div className="combo-empty">แสดง {shown.length} จาก {total.toLocaleString()} — พิมพ์เพื่อค้นหาให้แคบลง</div>
          )}
          {total === 0 && <div className="combo-empty">ไม่พบรายการ</div>}
        </div>
      )}
    </div>
  );
}
