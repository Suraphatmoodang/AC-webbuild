import { useEffect, useState } from "react";
import { getAccessories, addTransaction, type Accessory } from "@/lib/store";

type TxType = "IN" | "OUT" | "ADJUST" | "RETURN";

const TX_LABELS: Record<TxType, { th: string; en: string; cls: string }> = {
  IN:     { th: "รับเข้า",    en: "Receive",    cls: "badge-in" },
  OUT:    { th: "เบิกใช้",    en: "Issue",      cls: "badge-out" },
  ADJUST: { th: "ปรับยอด",   en: "Adjust",     cls: "badge-adjust" },
  RETURN: { th: "คืนสต็อค",  en: "Return",     cls: "badge-return" },
};

export default function TransactionsPage() {
  const [items, setItems] = useState<Accessory[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Accessory | null>(null);
  const [txType, setTxType] = useState<TxType>("IN");
  const [qty, setQty] = useState("");
  const [refNo, setRefNo] = useState("");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => { setItems(getAccessories()); }, []);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
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

  const handleSubmit = () => {
    if (!selected) return;
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) { showToast("กรุณาระบุจำนวนที่ถูกต้อง", "error"); return; }
    const result = addTransaction(selected.id, txType, q, refNo, note, by);
    if ("error" in result) { showToast(result.error, "error"); return; }
    showToast(`✓ บันทึกแล้ว — ${selected.type} ${selected.description} ${TX_LABELS[txType].th} ${q} ${selected.unit}`, "success");
    setItems(getAccessories());
    const updated = getAccessories().find((a) => a.id === selected.id);
    if (updated) setSelected(updated);
    setQty("");
    setRefNo("");
    setNote("");
  };

  const afterQty = () => {
    if (!selected) return null;
    const q = parseFloat(qty) || 0;
    if (txType === "IN" || txType === "RETURN") return selected.quantity + q;
    if (txType === "OUT") return selected.quantity - q;
    if (txType === "ADJUST") return q;
    return null;
  };

  const after = afterQty();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "start" }}>
      {/* left: item picker */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <input
            placeholder="ค้นหาอุปกรณ์ที่ต้องการบันทึก…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>ประเภท / รายละเอียด</th>
                  <th>สี / ขนาด</th>
                  <th className="num">สต็อคปัจจุบัน</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const isSelected = selected?.id === item.id;
                  const isLow = item.quantity <= item.min_quantity;
                  return (
                    <tr
                      key={item.id}
                      style={{ cursor: "pointer", background: isSelected ? "var(--bg4)" : undefined }}
                      onClick={() => { setSelected(item); setQty(""); }}
                    >
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{item.type}</div>
                        <div style={{ fontSize: 12, color: "var(--text2)" }}>{item.description}{item.acc_code ? ` · ${item.acc_code}` : ""}</div>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text2)" }}>
                        {item.color && <div>{item.color}</div>}
                        {item.size && <div>{item.size}</div>}
                        {item.row && <div style={{ color: "var(--text3)" }}>แถว {item.row}</div>}
                      </td>
                      <td className="num">
                        <span style={{ color: isLow ? "var(--accent)" : "var(--text)", fontFamily: "var(--mono)", fontWeight: 500 }}>
                          {item.quantity.toLocaleString()}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>{item.unit}</span>
                      </td>
                      <td>
                        {isSelected && <span style={{ color: "var(--accent)", fontSize: 16 }}>▶</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* right: transaction form */}
      <div>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              บันทึกรายการ · Transaction Entry
            </div>
            {selected ? (
              <div>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{selected.type}</div>
                <div style={{ fontSize: 13, color: "var(--text2)" }}>{selected.description}</div>
                {(selected.color || selected.size) && (
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                    {[selected.color, selected.size, selected.acc_code].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: "var(--text3)", fontSize: 13 }}>← เลือกรายการจากตาราง</div>
            )}
          </div>

          {/* type selector */}
          <div className="form-row">
            <label className="form-label">ประเภทรายการ · Type</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {(Object.keys(TX_LABELS) as TxType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTxType(t)}
                  style={txType === t ? {
                    background: t === "IN" || t === "RETURN" ? "var(--green2)" : t === "OUT" ? "var(--red2)" : "var(--bg4)",
                    borderColor: t === "IN" || t === "RETURN" ? "var(--green)" : t === "OUT" ? "var(--red)" : "var(--blue)",
                    color: "var(--text)"
                  } : {}}
                >
                  <span style={{ fontWeight: 500 }}>{TX_LABELS[t].th}</span>
                  <span style={{ fontSize: 10, color: "var(--text3)", display: "block" }}>{TX_LABELS[t].en}</span>
                </button>
              ))}
            </div>
          </div>

          {/* quantity */}
          <div className="form-row">
            <label className="form-label">
              จำนวน{txType === "ADJUST" ? " (ยอดใหม่)" : ""} · {selected?.unit || "หน่วย"}
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              style={{ fontSize: 20, fontFamily: "var(--mono)", padding: "10px 12px" }}
            />
            {selected && qty && after !== null && (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--text2)", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "var(--mono)" }}>{selected.quantity}</span>
                <span style={{ color: "var(--text3)" }}>→</span>
                <span style={{
                  fontFamily: "var(--mono)", fontWeight: 500,
                  color: after < 0 ? "var(--red)" : after <= selected.min_quantity ? "var(--accent)" : "var(--green)"
                }}>{after.toLocaleString()}</span>
                <span style={{ color: "var(--text3)" }}>{selected.unit}</span>
              </div>
            )}
          </div>

          {/* date */}
          <div className="form-row">
            <label className="form-label">วันที่ · Date</label>
            <input type="date" defaultValue={new Date().toISOString().split("T")[0]} />
          </div>

          {/* reference */}
          <div className="form-row">
            <label className="form-label">เลขที่อ้างอิง · Reference no.</label>
            <input placeholder="เลขที่ใบสั่งซื้อ / Job no. …" value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </div>

          {/* note */}
          <div className="form-row">
            <label className="form-label">หมายเหตุ · Note</label>
            <input placeholder="ลูกค้า / ผู้รับ / แหล่งที่มา…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {/* by */}
          <div className="form-row">
            <label className="form-label">ผู้บันทึก · Created by</label>
            <input placeholder="ชื่อ…" value={by} onChange={(e) => setBy(e.target.value)} />
          </div>

          {/* summary line */}
          {selected && (
            <div style={{
              background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "var(--r)",
              padding: "12px 14px", marginBottom: 14, fontSize: 13
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "var(--text2)" }}>ต้นทุนคงเหลือ</span>
                <span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>
                  ฿{(selected.quantity * selected.unit_cost).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text2)" }}>ราคาซื้อปัจจุบัน</span>
                <span style={{ fontFamily: "var(--mono)" }}>
                  ฿{selected.unit_cost.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {selected.unit}
                </span>
              </div>
            </div>
          )}

          <button
            className="primary"
            style={{ width: "100%", padding: "10px", fontSize: 14 }}
            onClick={handleSubmit}
            disabled={!selected}
          >
            บันทึกรายการ
          </button>
        </div>
      </div>

      {toast && (
        <div className={`toast ${toast.type}`} style={{ gridColumn: "1/-1" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
