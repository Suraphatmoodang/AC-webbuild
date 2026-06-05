import { useEffect, useState } from "react";
import { getAccessories, type Accessory } from "@/lib/store";

export default function StockPage() {
  const [items, setItems] = useState<Accessory[]>([]);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [showLow, setShowLow] = useState(false);

  useEffect(() => { setItems(getAccessories()); }, []);

  const types = Array.from(new Set(items.map((i) => i.type))).sort();

  const filtered = items.filter((i) => {
    if (showLow && i.quantity > i.min_quantity) return false;
    if (filterType && i.type !== filterType) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.type.toLowerCase().includes(q) ||
      i.acc_code.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.color.toLowerCase().includes(q) ||
      i.size.toLowerCase().includes(q)
    );
  });

  const totalValue = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
  const lowCount = items.filter((i) => i.quantity <= i.min_quantity).length;

  return (
    <div>
      {/* stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "รายการทั้งหมด", en: "Total items", val: items.length, mono: false },
          { label: "มูลค่าสต็อค (฿)", en: "Stock value", val: "฿" + totalValue.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), mono: true },
          { label: "สต็อคต่ำ", en: "Low stock", val: lowCount, mono: false, warn: lowCount > 0 },
          { label: "ประเภท", en: "Types", val: types.length, mono: false },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 500, fontFamily: s.mono ? "var(--mono)" : "var(--font)", color: s.warn ? "var(--accent)" : "var(--text)" }}>{s.val}</div>
            <div style={{ fontSize: 10, color: "var(--text3)" }}>{s.en}</div>
          </div>
        ))}
      </div>

      {/* filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text3)", fontSize: 14 }}>🔍</span>
          <input
            placeholder="ค้นหาชื่อ รหัส สี ขนาด…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 32 }}
          />
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: "auto", minWidth: 160 }}>
          <option value="">ทุกประเภท</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => setShowLow(!showLow)}
          style={showLow ? { background: "#3a2a1e", borderColor: "var(--accent)", color: "var(--accent)" } : {}}
        >
          ⚠ สต็อคต่ำ
        </button>
        <span style={{ alignSelf: "center", fontSize: 12, color: "var(--text3)" }}>{filtered.length} รายการ</span>
      </div>

      {/* table */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>ประเภท</th>
                <th>รหัส</th>
                <th>รายละเอียด</th>
                <th>สี</th>
                <th>ขนาด</th>
                <th>แถว</th>
                <th className="num">สต็อค</th>
                <th>หน่วย</th>
                <th className="num">ราคา/หน่วย</th>
                <th className="num">มูลค่า</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่พบรายการ</td></tr>
              )}
              {filtered.map((item) => {
                const isLow = item.quantity <= item.min_quantity;
                return (
                  <tr key={item.id}>
                    <td><span className="tag">{item.type}</span></td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text2)" }}>{item.acc_code || "—"}</td>
                    <td>{item.description || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{item.color || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{item.size || "—"}</td>
                    <td style={{ fontFamily: "var(--mono)", color: "var(--text3)" }}>{item.row ?? "—"}</td>
                    <td className="num" style={{ color: isLow ? "var(--accent)" : "var(--text)", fontWeight: isLow ? 500 : 400 }}>
                      {item.quantity.toLocaleString()}
                    </td>
                    <td style={{ color: "var(--text2)" }}>{item.unit}</td>
                    <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                      ฿{item.unit_cost.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text2)" }}>
                      ฿{(item.quantity * item.unit_cost).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td>
                      {isLow
                        ? <span className="badge badge-low">ต่ำ</span>
                        : <span style={{ fontSize: 11, color: "var(--green)" }}>✓ ปกติ</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
