import { useEffect, useRef, useState } from "react";

// A "type-or-pick" dropdown for the garment-spec fields on /costing/products and
// /costing/[id]. Behaves like a normal <select> — click to see the full option list
// and pick one — but the box is also a text input, so you can type a brand-new value
// that isn't in the list (matching the guideline sheet's "drop down สามารถเพิ่มได้").
// New values typed here get folded back into the option list next time (buildComboOptions).
export function Combo({
  value,
  onChange,
  options,
  placeholder = "— เลือกหรือพิมพ์เพิ่ม —",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  // null = show the whole list (opened via the caret/focus); a string = filter as typed.
  const [filter, setFilter] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = (filter ?? "").trim().toLowerCase();
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const isNew = q.length > 0 && !options.some((o) => o.toLowerCase() === q);

  const pick = (v: string) => { onChange(v); setFilter(null); setOpen(false); };

  return (
    <div ref={wrapRef} className="combo" style={{ position: "relative" }}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setFilter(e.target.value); setOpen(true); }}
        onFocus={() => { setFilter(null); setOpen(true); }}
        autoComplete="off"
        style={{ paddingRight: 30 }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="เปิดรายการ"
        className="combo-caret"
        onMouseDown={(e) => { e.preventDefault(); setFilter(null); setOpen((o) => !o); }}
      >▾</button>

      {open && (
        <div className="combo-menu">
          {shown.map((o) => (
            <div
              key={o}
              className={`combo-opt${o === value ? " sel" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
            >{o}</div>
          ))}
          {isNew && (
            <div className="combo-add" onMouseDown={(e) => { e.preventDefault(); pick((filter ?? "").trim()); }}>
              + เพิ่ม “{(filter ?? "").trim()}”
            </div>
          )}
          {shown.length === 0 && !isNew && (
            <div className="combo-empty">พิมพ์เพื่อเพิ่มรายการใหม่</div>
          )}
        </div>
      )}
    </div>
  );
}
