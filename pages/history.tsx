import { useEffect, useState } from "react";
import { getAccessories, getTransactions, getTransactionsByAccessory, type Accessory, type Transaction } from "@/lib/store";

const TX_LABELS: Record<string, { th: string; cls: string }> = {
  IN:     { th: "รับเข้า",   cls: "badge-in"     },
  OUT:    { th: "เบิกใช้",   cls: "badge-out"    },
  ADJUST: { th: "ปรับยอด",  cls: "badge-adjust" },
  RETURN: { th: "คืนสต็อค", cls: "badge-return"  },
};

export default function HistoryPage() {
  const [txns, setTxns]   = useState<Transaction[]>([]);
  const [items, setItems] = useState<Accessory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]         = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [view, setView] = useState<"all" | "ledger">("all");

  useEffect(() => {
    Promise.all([getAccessories(), getTransactions()])
      .then(([accs, txs]) => { setItems(accs); setTxns(txs); })
      .finally(() => setLoading(false));
  }, []);

  const switchToLedger = async (id: string) => {
    setSelectedItem(id);
    setView("ledger");
    if (id) {
      setLoading(true);
      const rows = await getTransactionsByAccessory(id);
      setTxns(rows);
      setLoading(false);
    }
  };

  const switchToAll = async () => {
    setView("all");
    setSelectedItem("");
    setLoading(true);
    const rows = await getTransactions();
    setTxns(rows);
    setLoading(false);
  };

  const accMap = Object.fromEntries(items.map((i) => [i.id, i]));
  const types  = Array.from(new Set(items.map((i) => i.type))).sort();

  const filteredTxns = txns.filter((t) => {
    const acc = accMap[t.accessory_id];
    if (!acc) return false;
    if (filterType && acc.type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        acc.type.toLowerCase().includes(q) ||
        acc.description.toLowerCase().includes(q) ||
        t.reference_no.toLowerCase().includes(q) ||
        t.note.toLowerCase().includes(q) ||
        t.created_by.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedAcc = selectedItem ? accMap[selectedItem] : null;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input placeholder="ค้นหา…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 200px" }} />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: "auto", minWidth: 160 }}>
          <option value="">ทุกประเภท</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={selectedItem}
          onChange={(e) => e.target.value ? switchToLedger(e.target.value) : switchToAll()}
          style={{ width: "auto", minWidth: 200 }}>
          <option value="">ทุกรายการ</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.type} {i.description} {i.color} {i.size}
            </option>
          ))}
        </select>

        <span style={{ alignSelf: "center", fontSize: 15, color: "var(--text3)" }}>{filteredTxns.length} รายการ</span>
      </div>

      {/* Ledger header */}
      {view === "ledger" && selectedAcc && (
        <div className="card" style={{ padding: "16px 20px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>ใบแสดงสต็อคคงเหลือ-เบิกใช้</div>
              <div style={{ fontWeight: 500, fontSize: 18 }}>{selectedAcc.type}</div>
              <div style={{ fontSize: 16, color: "var(--text2)" }}>{selectedAcc.description}</div>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {[
                { label: "รหัสสินค้า",   val: selectedAcc.acc_code || "—" },
                { label: "สี",           val: selectedAcc.color    || "—" },
                { label: "ขนาด",         val: selectedAcc.size     || "—" },
                { label: "หน่วย",        val: selectedAcc.unit },
                { label: "ราคาซื้อ",     val: `฿${Number(selectedAcc.unit_cost).toFixed(2)}` },
                { label: "สต็อคปัจจุบัน", val: `${Number(selectedAcc.quantity).toLocaleString()} ${selectedAcc.unit}` },
              ].map((f) => (
                <div key={f.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 15, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{f.label}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 15 }}>{f.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text3)" }}>กำลังโหลด…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {view === "ledger" ? (
              <table>
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th className="num">รับเข้า</th>
                    <th className="num">เบิกใช้</th>
                    <th className="num">สต็อคคงเหลือ</th>
                    <th>หมายเหตุ / เลขที่อ้างอิง</th>
                    <th>ผู้บันทึก</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ยังไม่มีรายการ</td></tr>
                  )}
                  {filteredTxns.map((t) => {
                    const isIn = t.transaction_type === "IN" || t.transaction_type === "RETURN";
                    const isAdj = t.transaction_type === "ADJUST";
                    return (
                      <tr key={t.id}>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--text2)" }}>
                          {new Date(t.created_at).toLocaleDateString("th-TH")}
                        </td>
                        <td className="num">
                          {isIn ? <span style={{ color: "var(--green)", fontFamily: "var(--mono)", fontWeight: 500 }}>+{Math.abs(Number(t.quantity)).toLocaleString()}</span> : "—"}
                        </td>
                        <td className="num">
                          {!isIn && !isAdj
                            ? <span style={{ color: "var(--red)", fontFamily: "var(--mono)", fontWeight: 500 }}>{Math.abs(Number(t.quantity)).toLocaleString()}</span>
                            : isAdj ? <span style={{ color: "var(--blue)", fontFamily: "var(--mono)" }}>ปรับ</span>
                            : "—"}
                        </td>
                        <td className="num" style={{ fontFamily: "var(--mono)", fontWeight: 500 }}>{Number(t.quantity_after).toLocaleString()}</td>
                        <td style={{ color: "var(--text2)", fontSize: 15 }}>
                          {t.reference_no && <span style={{ fontFamily: "var(--mono)", marginRight: 8, color: "var(--text3)" }}>{t.reference_no}</span>}
                          {t.note}
                        </td>
                        <td style={{ fontSize: 15, color: "var(--text3)" }}>{t.created_by || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>วันที่</th><th>ประเภท</th><th>อุปกรณ์</th>
                    <th className="num">จำนวน</th><th className="num">ก่อน</th><th className="num">หลัง</th>
                    <th>อ้างอิง</th><th>หมายเหตุ</th><th>ผู้บันทึก</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ยังไม่มีรายการ</td></tr>
                  )}
                  {filteredTxns.map((t) => {
                    const acc   = accMap[t.accessory_id];
                    const label = TX_LABELS[t.transaction_type];
                    const isIn  = t.transaction_type === "IN" || t.transaction_type === "RETURN";
                    const isAdj = t.transaction_type === "ADJUST";
                    return (
                      <tr key={t.id}>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--text2)", whiteSpace: "nowrap" }}>
                          {new Date(t.created_at).toLocaleDateString("th-TH")}<br />
                          <span style={{ fontSize: 13, color: "var(--text3)" }}>
                            {new Date(t.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </td>
                        <td><span className={`badge ${label.cls}`}>{label.th}</span></td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 15 }}>{acc?.type}</div>
                          <div style={{ fontSize: 14, color: "var(--text2)" }}>{acc?.description} {acc?.color} {acc?.size}</div>
                        </td>
                        <td className="num" style={{ fontFamily: "var(--mono)", fontWeight: 500,
                          color: isIn ? "var(--green)" : isAdj ? "var(--blue)" : "var(--red)" }}>
                          {isIn ? "+" : isAdj ? "±" : "-"}{Math.abs(Number(t.quantity)).toLocaleString()}
                        </td>
                        <td className="num" style={{ fontFamily: "var(--mono)", color: "var(--text3)", fontSize: 15 }}>{Number(t.quantity_before).toLocaleString()}</td>
                        <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 15 }}>{Number(t.quantity_after).toLocaleString()}</td>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--text3)" }}>{t.reference_no || "—"}</td>
                        <td style={{ fontSize: 15, color: "var(--text2)" }}>{t.note || "—"}</td>
                        <td style={{ fontSize: 15, color: "var(--text3)" }}>{t.created_by || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
