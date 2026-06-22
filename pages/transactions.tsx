import { useEffect, useState } from "react";
import { getAccessories, addTransaction, type Accessory } from "@/lib/store";

type TxType = "IN" | "OUT" | "ADJUST" | "RETURN";

const TX_LABELS: Record<TxType, { th: string; en: string }> = {
  IN:     { th: "รับเข้า",   en: "Receive" },
  OUT:    { th: "เบิกใช้",   en: "Issue"   },
  ADJUST: { th: "ปรับยอด",  en: "Adjust"  },
  RETURN: { th: "คืนสต็อค", en: "Return"  },
};

export default function TransactionsPage() {
  const [items, setItems] = useState<Accessory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selected, setSelected] = useState<Accessory | null>(null);
  const [txType, setTxType] = useState<TxType>("IN");
  const [qty, setQty] = useState("");
  const [refNo, setRefNo] = useState("");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    getAccessories().then(setItems).finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const filtered = items.filter((i) => {
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

  const searching = search.trim().length > 0;

  // Build the list of types with item counts (for the first drilldown step)
  const typeGroups = (() => {
    const map = new Map<string, { count: number; low: number }>();
    for (const i of items) {
      const g = map.get(i.type) ?? { count: 0, low: 0 };
      g.count += 1;
      if (Number(i.quantity) <= Number(i.min_quantity)) g.low += 1;
      map.set(i.type, g);
    }
    return Array.from(map.entries())
      .map(([type, g]) => ({ type, ...g }))
      .sort((a, b) => a.type.localeCompare(b.type, "th"));
  })();

  // Variants belonging to the chosen type (for the second drilldown step)
  const variantsOfType = selectedType
    ? items.filter((i) => i.type === selectedType)
    : [];

  const handleSubmit = async () => {
    if (!selected) return;
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) { showToast("กรุณาระบุจำนวนที่ถูกต้อง", "error"); return; }
    setSaving(true);
    const result = await addTransaction(selected.id, txType, q, refNo, note, by);
    setSaving(false);
    if ("error" in result) { showToast(result.error, "error"); return; }
    showToast(`✓ บันทึกแล้ว — ${TX_LABELS[txType].th} ${q} ${selected.unit}`, "success");
    // Refresh list and update selected
    const fresh = await getAccessories();
    setItems(fresh);
    setSelected(fresh.find((a) => a.id === selected.id) ?? null);
    setQty(""); setRefNo(""); setNote("");
  };

  const afterQty = () => {
    if (!selected) return null;
    const q = parseFloat(qty) || 0;
    if (txType === "IN" || txType === "RETURN") return Number(selected.quantity) + q;
    if (txType === "OUT") return Number(selected.quantity) - q;
    if (txType === "ADJUST") return q;
    return null;
  };
  const after = afterQty();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "start" }}>
      {/* Item picker */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <input placeholder="ค้นหาอุปกรณ์ที่ต้องการบันทึก…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {/* Breadcrumb / back bar — only when drilled into a type and not searching */}
        {!searching && selectedType && (
          <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setSelectedType(null)} style={{ padding: "6px 12px", fontSize: 15 }}>
              ← ประเภททั้งหมด
            </button>
            <span style={{ fontSize: 16, color: "var(--text2)" }}>
              <span style={{ color: "var(--text3)" }}>ประเภท:</span> <strong style={{ color: "var(--accent)" }}>{selectedType}</strong>
            </span>
          </div>
        )}

        <div className="card" style={{ overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text3)" }}>กำลังโหลด…</div>
          ) : searching ? (
            /* ── SEARCH MODE: flat results across everything ── */
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ประเภท / รายละเอียด</th><th>สี / ขนาด</th><th className="num">สต็อคปัจจุบัน</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่พบรายการ</td></tr>
                  )}
                  {filtered.map((item) => {
                    const isSel = selected?.id === item.id;
                    const isLow = Number(item.quantity) <= Number(item.min_quantity);
                    return (
                      <tr key={item.id} style={{ cursor: "pointer", background: isSel ? "var(--bg4)" : undefined }}
                        onClick={() => { setSelected(item); setQty(""); }}>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 17 }}>{item.type}</div>
                          <div style={{ fontSize: 14, color: "var(--text2)" }}>{item.description}{item.acc_code ? ` · ${item.acc_code}` : ""}</div>
                        </td>
                        <td style={{ fontSize: 15, color: "var(--text2)" }}>
                          {item.color && <div>{item.color}</div>}
                          {item.size  && <div>{item.size}</div>}
                          {item.row   && <div style={{ color: "var(--text3)" }}>แถว {item.row}</div>}
                        </td>
                        <td className="num">
                          <span style={{ color: isLow ? "var(--accent)" : "var(--text)", fontFamily: "var(--mono)", fontWeight: 500 }}>
                            {Number(item.quantity).toLocaleString()}
                          </span>
                          <span style={{ fontSize: 15, color: "var(--text3)", marginLeft: 4 }}>{item.unit}</span>
                        </td>
                        <td>{isSel && <span style={{ color: "var(--accent)" }}>▶</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : !selectedType ? (
            /* ── STEP 1: pick a type ── */
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ประเภทอุปกรณ์</th><th className="num">จำนวนรายการ</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {typeGroups.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่มีอุปกรณ์</td></tr>
                  )}
                  {typeGroups.map((g) => (
                    <tr key={g.type} style={{ cursor: "pointer" }}
                      onClick={() => { setSelectedType(g.type); }}>
                      <td style={{ fontWeight: 500, fontSize: 17 }}>{g.type}</td>
                      <td className="num" style={{ color: "var(--text2)" }}>
                        {g.count} รายการ
                        {g.low > 0 && <span className="badge badge-low" style={{ marginLeft: 8 }}>ต่ำ {g.low}</span>}
                      </td>
                      <td><span style={{ color: "var(--text3)" }}>›</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* ── STEP 2: pick a variant (size / color) within the type ── */
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 240px)", overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>รายละเอียด</th><th>สี / ขนาด</th><th className="num">สต็อคปัจจุบัน</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {variantsOfType.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่มีรายการ</td></tr>
                  )}
                  {variantsOfType.map((item) => {
                    const isSel = selected?.id === item.id;
                    const isLow = Number(item.quantity) <= Number(item.min_quantity);
                    return (
                      <tr key={item.id} style={{ cursor: "pointer", background: isSel ? "var(--bg4)" : undefined }}
                        onClick={() => { setSelected(item); setQty(""); }}>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 16 }}>{item.description || "—"}</div>
                          {item.acc_code && <div style={{ fontSize: 14, color: "var(--text3)" }}>{item.acc_code}</div>}
                        </td>
                        <td style={{ fontSize: 15, color: "var(--text2)" }}>
                          {item.color && <div>{item.color}</div>}
                          {item.size  && <div>{item.size}</div>}
                          {item.row   && <div style={{ color: "var(--text3)" }}>แถว {item.row}</div>}
                          {!item.color && !item.size && !item.row && <span style={{ color: "var(--text3)" }}>—</span>}
                        </td>
                        <td className="num">
                          <span style={{ color: isLow ? "var(--accent)" : "var(--text)", fontFamily: "var(--mono)", fontWeight: 500 }}>
                            {Number(item.quantity).toLocaleString()}
                          </span>
                          <span style={{ fontSize: 15, color: "var(--text3)", marginLeft: 4 }}>{item.unit}</span>
                        </td>
                        <td>{isSel && <span style={{ color: "var(--accent)" }}>▶</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Form */}
      <div>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 15, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              บันทึกรายการ · Transaction Entry
            </div>
            {selected ? (
              <div>
                <div style={{ fontWeight: 500, fontSize: 18 }}>{selected.type}</div>
                <div style={{ fontSize: 15, color: "var(--text2)" }}>{selected.description}</div>
                {(selected.color || selected.size) && (
                  <div style={{ fontSize: 14, color: "var(--text3)", marginTop: 2 }}>
                    {[selected.color, selected.size, selected.acc_code].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: "var(--text3)", fontSize: 16 }}>← เลือกรายการจากตาราง</div>
            )}
          </div>

          <div className="form-row">
            <label className="form-label">ประเภทรายการ · Type</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {(Object.keys(TX_LABELS) as TxType[]).map((t) => (
                <button key={t} onClick={() => setTxType(t)} style={txType === t ? {
                  background: t === "IN" || t === "RETURN" ? "var(--green2)" : t === "OUT" ? "var(--red2)" : "var(--bg4)",
                  borderColor: t === "IN" || t === "RETURN" ? "var(--green)" : t === "OUT" ? "var(--red)" : "var(--blue)",
                  color: "var(--text)",
                } : {}}>
                  <span style={{ fontWeight: 500 }}>{TX_LABELS[t].th}</span>
                  <span style={{ fontSize: 15, color: "var(--text3)", display: "block" }}>{TX_LABELS[t].en}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <label className="form-label">จำนวน{txType === "ADJUST" ? " (ยอดใหม่)" : ""} · {selected?.unit || "หน่วย"}</label>
            <input type="number" min="0" step="any" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)}
              style={{ fontSize: 20, fontFamily: "var(--mono)", padding: "10px 12px" }} />
            {selected && qty && after !== null && (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--text2)", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "var(--mono)" }}>{Number(selected.quantity)}</span>
                <span style={{ color: "var(--text3)" }}>→</span>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 500,
                  color: after < 0 ? "var(--red)" : after <= Number(selected.min_quantity) ? "var(--accent)" : "var(--green)" }}>
                  {after.toLocaleString()}
                </span>
                <span style={{ color: "var(--text3)" }}>{selected.unit}</span>
              </div>
            )}
          </div>

          <div className="form-row">
            <label className="form-label">วันที่ · Date</label>
            <input type="date" defaultValue={new Date().toISOString().split("T")[0]} />
          </div>
          <div className="form-row">
            <label className="form-label">เลขที่อ้างอิง · Reference no.</label>
            <input placeholder="เลขที่ใบสั่งซื้อ / Job no. …" value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label">หมายเหตุ · Note</label>
            <input placeholder="ลูกค้า / ผู้รับ / แหล่งที่มา…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label">ผู้บันทึก · Created by</label>
            <input placeholder="ชื่อ…" value={by} onChange={(e) => setBy(e.target.value)} />
          </div>

          {selected && (
            <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "12px 14px", marginBottom: 14, fontSize: 15 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "var(--text2)" }}>ต้นทุนคงเหลือ</span>
                <span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>
                  ฿{(Number(selected.quantity) * Number(selected.unit_cost)).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text2)" }}>ราคาซื้อปัจจุบัน</span>
                <span style={{ fontFamily: "var(--mono)" }}>฿{Number(selected.unit_cost).toFixed(2)} / {selected.unit}</span>
              </div>
            </div>
          )}

          <button className="primary" style={{ width: "100%", padding: "10px", fontSize: 16, opacity: (!selected || saving) ? 0.6 : 1 }}
            onClick={handleSubmit} disabled={!selected || saving}>
            {saving ? "กำลังบันทึก…" : "บันทึกรายการ"}
          </button>
        </div>
      </div>

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
