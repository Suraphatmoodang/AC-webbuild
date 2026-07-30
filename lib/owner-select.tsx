import { useState } from "react";
import { SELF_OWNER } from "./fabric-store";

// Dropdown for the เจ้าของ (owner) field. A blank value = our own stock; the control
// shows and offers it as SELF_OWNER (AC) at the top, and picking it clears back to blank
// — so "AC" and "blank" are the same thing, exactly as intended.
//
// `options` are factory names already used on other rows, so they come back as
// clickable choices (no retyping). A genuinely new factory can be typed once and
// picked via the "+ ใช้ …" row; next time it'll be in `options` on its own.
export function OwnerSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const external = value.trim() !== "";
  const display = open ? query : (external ? value : SELF_OWNER);
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));
  const q = query.trim();
  const canAddNew = q !== "" && !options.some((o) => o.toLowerCase() === q.toLowerCase());
  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(""); };

  const rowStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 12px", fontSize: 13, cursor: "pointer",
    background: active ? "var(--bg4)" : "transparent",
    color: active ? "var(--accent)" : "var(--text)",
  });

  return (
    <div style={{ position: "relative" }}>
      <input
        value={display}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={`${SELF_OWNER} (ของเรา) — หรือเลือกโรงงาน`}
        autoComplete="off"
        style={external ? { color: "#7c3aed", fontWeight: 500 } : undefined}
      />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg3)", border: "1px solid var(--border2)",
          borderRadius: "var(--r)", zIndex: 200, maxHeight: 240, overflowY: "auto",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          {/* AC / ours — clears to blank */}
          <div onMouseDown={() => pick("")}
            style={{ ...rowStyle(!external), borderBottom: "1px solid var(--border)",
              color: !external ? "var(--accent)" : "var(--text2)" }}>
            {SELF_OWNER} · ของเรา
          </div>
          {filtered.map((opt) => (
            <div key={opt} onMouseDown={() => pick(opt)}
              style={rowStyle(opt === value)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg4)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = opt === value ? "var(--bg4)" : "transparent")}>
              {opt}
            </div>
          ))}
          {canAddNew && (
            <div onMouseDown={() => pick(q)}
              style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", color: "var(--accent)", borderTop: "1px solid var(--border)" }}>
              + ใช้ "{q}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
