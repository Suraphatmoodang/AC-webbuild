import { useEffect, useState } from "react";
import { getFabrics, getFabricTransactions, getFabricTransactionsByFabric, getFabricLotMap,
  stockFromLots, valueFromLots, type Fabric, type FabricTransaction, type FabricLot } from "@/lib/fabric-store";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";

const TX_LABELS: Record<string, { th: string; cls: string }> = {
  IN:     { th: "รับเข้า",   cls: "badge-in"     },
  OUT:    { th: "เบิกใช้",   cls: "badge-out"    },
  ADJUST: { th: "ปรับยอด",  cls: "badge-adjust" },
  RETURN: { th: "คืนสต็อค", cls: "badge-return"  },
};

// Searchable dropdown. Options are { value, label } pairs.
function Combobox({ value, onChange, options, placeholder, minWidth = 200 }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";
  // When closed, show the selected label; when open/typing, show the query
  const display = open ? query : selectedLabel;

  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  const select = (v: string) => { onChange(v); setOpen(false); setQuery(""); };

  return (
    <div style={{ position: "relative", minWidth }}>
      <input
        value={display}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg3)", border: "1px solid var(--border2)",
          borderRadius: "var(--r)", zIndex: 200, maxHeight: 260, overflowY: "auto",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{ padding: "8px 12px", fontSize: 15, color: "var(--text3)", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
            onMouseDown={() => select("")}>
            {placeholder}
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 15, color: "var(--text3)" }}>ไม่พบรายการ</div>
          )}
          {filtered.map((o) => (
            <div key={o.value} onMouseDown={() => select(o.value)}
              style={{ padding: "8px 12px", fontSize: 15, cursor: "pointer",
                background: o.value === value ? "var(--bg4)" : "transparent",
                color: o.value === value ? "var(--accent)" : "var(--text)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg4)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = o.value === value ? "var(--bg4)" : "transparent")}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FabricHistoryPage() {
  const [txns, setTxns]   = useState<FabricTransaction[]>([]);
  const [items, setItems] = useState<Fabric[]>([]);
  const [lotMap, setLotMap] = useState<Map<string, FabricLot[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch]         = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [view, setView] = useState<"all" | "ledger">("all");

  useEffect(() => {
    Promise.all([getFabrics(), getFabricTransactions(), getFabricLotMap()])
      .then(([fabs, txs, lm]) => { setItems(fabs); setTxns(txs); setLotMap(lm); })
      .finally(() => setLoading(false));
  }, []);

  const switchToLedger = async (id: string) => {
    setSelectedItem(id);
    setView("ledger");
    setSearch("");      // clear so the ledger always shows the full item history
    setFilterType("");  // clear type filter so it can't hide the clicked item
    if (id) {
      setLoading(true);
      const rows = await getFabricTransactionsByFabric(id);
      setTxns(rows);
      setLoading(false);
    }
  };

  const switchToAll = async () => {
    setView("all");
    setSelectedItem("");
    setLoading(true);
    const rows = await getFabricTransactions();
    setTxns(rows);
    setLoading(false);
  };

  const fabMap = Object.fromEntries(items.map((i) => [i.id, i]));
  const types  = Array.from(new Set(items.map((i) => i.fabric_type))).sort();

  const filteredTxns = txns.filter((t) => {
    const fab = fabMap[t.fabric_id];
    if (!fab) return false;
    // In ledger view, show every transaction for the item — no search/type filtering
    if (view === "ledger") return true;
    if (filterType && fab.fabric_type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        fab.fabric_type.toLowerCase().includes(q) ||
        fab.color.toLowerCase().includes(q) ||
        fab.construction.toLowerCase().includes(q) ||
        fab.fabric_code.toLowerCase().includes(q) ||
        t.reference_no.toLowerCase().includes(q) ||
        t.note.toLowerCase().includes(q) ||
        t.created_by.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedFab = selectedItem ? fabMap[selectedItem] : null;

  // Pagination only for the all-transactions view (ledger is per-item, small)
  const pg = usePagination(filteredTxns, `${view}|${search}|${filterType}|${selectedItem}`);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {view === "all" && (
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="ค้นหา…" style={{ flex: "1 1 200px" }} />
            <Combobox
              value={filterType}
              onChange={setFilterType}
              options={types.map((t) => ({ value: t, label: t }))}
              placeholder="ทุกชนิดผ้า"
              minWidth={180}
            />
          </>
        )}
        <Combobox
          value={selectedItem}
          onChange={(v) => v ? switchToLedger(v) : switchToAll()}
          options={items.map((i) => ({
            value: i.id,
            label: [i.fabric_type, i.color, i.width, i.fabric_code && `#${i.fabric_code}`].filter(Boolean).join(" "),
          }))}
          placeholder="ทุกรายการ"
          minWidth={240}
        />

        <span style={{ alignSelf: "center", fontSize: 15, color: "var(--text3)" }}>{filteredTxns.length} รายการ</span>
      </div>

      {/* Ledger header */}
      {view === "ledger" && selectedFab && (
        <div className="card" style={{ padding: "16px 20px", marginBottom: 16 }}>
          <div style={{ marginBottom: 14 }}>
            <button onClick={switchToAll} style={{ padding: "6px 14px", fontSize: 15 }}>
              ← กลับไปดูทั้งหมด
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>ใบแสดงสต็อคคงเหลือ-เบิกใช้</div>
              <div style={{ fontWeight: 500, fontSize: 18 }}>{selectedFab.fabric_type}</div>
              <div style={{ fontSize: 16, color: "var(--text2)" }}>{[selectedFab.construction, selectedFab.composition].filter(Boolean).join(" · ")}</div>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {[
                { label: "เลขที่",       val: selectedFab.fabric_code || "—" },
                { label: "สี",           val: selectedFab.color       || "—" },
                { label: "หน้าผ้า",      val: selectedFab.width       || "—" },
                { label: "แถว",          val: selectedFab.row_label   || "—" },
                { label: "หน่วย",        val: selectedFab.unit },
                { label: "ราคาเฉลี่ย",   val: (() => { const s = stockFromLots(lotMap.get(selectedFab.id) ?? []); const v = valueFromLots(lotMap.get(selectedFab.id) ?? []); return `฿${(s > 0 ? v / s : 0).toFixed(2)}`; })() },
                { label: "สต็อคปัจจุบัน", val: `${stockFromLots(lotMap.get(selectedFab.id) ?? []).toLocaleString()} ${selectedFab.unit}` },
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
          <div style={{ height: "72vh", overflowY: "auto", overflowX: "auto" }}>
            {view === "ledger" ? (
              <table>
                <thead className="sticky-head">
                  <tr>
                    <th>วันที่</th><th className="num">สต็อคเดิม</th><th className="num">รับเข้า</th><th className="num">เบิกใช้</th><th className="num">คงเหลือ</th><th>เลขที่ใบสั่งซื้อ</th><th>ผู้บันทึก</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ยังไม่มีรายการ</td></tr>
                  )}
                  {filteredTxns.map((t) => {
                    const isIn = t.transaction_type === "IN" || t.transaction_type === "RETURN";
                    const isAdj = t.transaction_type === "ADJUST";
                    return (
                      <tr key={t.id}>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--text2)" }}>
                          {new Date(t.created_at).toLocaleDateString("th-TH")}
                        </td>
                        <td className="num" style={{ fontFamily: "var(--mono)", color: "var(--text3)" }}>{Number(t.quantity_before).toLocaleString()}</td>
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
                          {isIn && t.reference_no
                            ? <span style={{ fontFamily: "var(--mono)" }}>{t.reference_no}</span>
                            : <span style={{ color: "var(--text3)" }}>—</span>}
                        </td>
                        <td style={{ fontSize: 15, color: "var(--text3)" }}>{t.created_by || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table>
                <thead className="sticky-head">
                  <tr>
                    <th>วันที่</th><th>ประเภท</th><th>ผ้า</th>
                    <th>สต็อคเดิม</th><th>รับเข้า</th><th>เบิกใช้</th><th>คงเหลือ</th>
                    <th>เลขที่ใบสั่งซื้อ</th><th>ผู้บันทึก</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ยังไม่มีรายการ</td></tr>
                  )}
                  {pg.pageItems.map((t) => {
                    const fab   = fabMap[t.fabric_id];
                    const label = TX_LABELS[t.transaction_type];
                    const isIn  = t.transaction_type === "IN" || t.transaction_type === "RETURN";
                    const isAdj = t.transaction_type === "ADJUST";
                    return (
                      <tr key={t.id} style={{ cursor: "pointer" }}
                        onClick={() => switchToLedger(t.fabric_id)}
                        title="คลิกเพื่อดูประวัติของรายการนี้">
                        <td style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--text2)", whiteSpace: "nowrap" }}>
                          {new Date(t.created_at).toLocaleDateString("th-TH")}<br />
                          <span style={{ fontSize: 13, color: "var(--text3)" }}>
                            {new Date(t.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </td>
                        <td><span className={`badge ${label.cls}`}>{label.th}</span></td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 15 }}>{fab?.fabric_type}</div>
                          <div style={{ fontSize: 14, color: "var(--text2)" }}>{[fab?.color, fab?.width, fab?.fabric_code && `#${fab.fabric_code}`].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="num" style={{ fontFamily: "var(--mono)", color: "var(--text3)", fontSize: 15 }}>{Number(t.quantity_before).toLocaleString()}</td>
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
                        <td style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--text3)" }}>
                          {isIn && t.reference_no ? t.reference_no : "—"}
                        </td>
                        <td style={{ fontSize: 15, color: "var(--text3)" }}>{t.created_by || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {view === "all" && <PaginationBar {...pg} />}
      </div>
    </div>
  );
}
