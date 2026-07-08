import { CSSProperties } from "react";

// Search input with a ✕ clear button (shows only when there is text).
// Big enough tap target for tablet/mobile use. `style` goes on the wrapper
// (use it for flex sizing), `leftIcon` renders a decorative icon inside.
export function SearchInput({ value, onChange, placeholder, style, leftIcon }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: CSSProperties;
  leftIcon?: string;
}) {
  return (
    <div style={{ position: "relative", ...style }}>
      {leftIcon && (
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text3)", pointerEvents: "none" }}>
          {leftIcon}
        </span>
      )}
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", paddingRight: 38, ...(leftIcon ? { paddingLeft: 32 } : {}) }}
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="ล้างคำค้นหา"
          onClick={() => onChange("")}
          style={{
            position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
            padding: "6px 10px", fontSize: 16, lineHeight: 1,
            background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
