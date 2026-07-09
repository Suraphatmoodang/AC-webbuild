import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/router";
import { getAccessories, addTransaction, revertTransaction, getTransactionsByAccessory, getLotMap, stockFromLots, valueFromLots, type Accessory, type Lot, type Transaction } from "@/lib/store";
import { SearchInput } from "@/lib/search";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { compareAccessory } from "@/lib/sort";

type TxType = "IN" | "OUT" | "ADJUST" | "RETURN";

const TX_LABELS: Record<TxType, { th: string; en: string }> = {
  IN:     { th: "รับเข้า",   en: "Receive" },
  OUT:    { th: "เบิกใช้",   en: "Issue"   },
  ADJUST: { th: "ปรับยอด",  en: "Adjust"  },
  RETURN: { th: "คืนสต็อค", en: "Return"  },
};

// Toggleable "revert last transaction" affordance — scaffolding for undoing a
// mistaken entry. Gated by `txRevertEnabled` below (off until revertTransaction is
// implemented in the store). Same gate pattern as manage's StockEditor.
function RevertLastButton({ disabled, onRevert }: { disabled?: boolean; onRevert: () => void }) {
  return (
    <button onClick={onRevert} disabled={disabled}
      style={{ width: "100%", marginTop: 8, padding: "9px", fontSize: 15, color: "var(--red)", borderColor: "var(--red2)" }}>
      ↺ ย้อนรายการล่าสุด
    </button>
  );
}

// Who recorded the transaction. Currently ONE fixed user, but structured so it can
// later become a dropdown (extend RECORDERS) or a free-text field — flip
// `recorderPickerEnabled` to true. Same gate pattern as StockEditor / txRevert.
const RECORDERS = ["เดือน"];             // roster of possible recorders (currently one)
const recorderPickerEnabled = false;     // false → fixed read-only; true → dropdown

function RecordedByField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  if (!recorderPickerEnabled) {
    return (
      <div style={{ padding: "10px 12px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text2)" }}>
        {value}
      </div>
    );
  }
  // Future: pick from the roster. Swap this <select> for an <input> for free text.
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {RECORDERS.map((r) => <option key={r} value={r}>{r}</option>)}
    </select>
  );
}

export default function TransactionsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [items, setItems] = useState<Accessory[]>([]);
  const [lotMap, setLotMap] = useState<Map<string, Lot[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selected, setSelected] = useState<Accessory | null>(null);
  const [txType, setTxType] = useState<TxType>("IN");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");           // IN / RETURN
  const [lotId, setLotId] = useState("");           // OUT (optional) / ADJUST (required)
  const [manualLot, setManualLot] = useState(false); // OUT: opt-in to pick a lot
  const [returnPos, setReturnPos] = useState<"front" | "back" | "date">("back");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split("T")[0]);
  const [refNo, setRefNo] = useState("");
  const [note, setNote] = useState("");
  // Recorder for "ผู้บันทึก" — fixed to the single user for now (see RecordedByField).
  const [by, setBy] = useState(RECORDERS[0]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Auth gate — transactions is now protected
  useEffect(() => {
    if (sessionStorage.getItem("manage_auth") !== "1") { router.replace("/login"); return; }
    setAuthed(true);
  }, [router]);

  useEffect(() => {
    if (!authed) return;
    Promise.all([getAccessories(), getLotMap()])
      .then(([accs, lm]) => { setItems(accs); setLotMap(lm); })
      .finally(() => setLoading(false));
  }, [authed]);

  const lotsOf = (id: string) => lotMap.get(id) ?? [];
  const stockOf = (id: string) => stockFromLots(lotsOf(id));
  const valueOf = (id: string) => valueFromLots(lotsOf(id));

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Gate for the "revert last transaction" feature. A future admin-auth page will
  // drive this (same pattern as manage's stockEditEnabled). Flip to false to hide.
  const txRevertEnabled = true;
  const [revertTx, setRevertTx] = useState<Transaction | null>(null); // pending confirm
  const [reverting, setReverting] = useState(false);

  // Open the confirm modal for the latest transaction of the selected item.
  const handleRevertLast = async () => {
    if (!selected) { showToast("เลือกอุปกรณ์ก่อน", "error"); return; }
    try {
      const txs = await getTransactionsByAccessory(selected.id); // ascending
      const latest = txs[txs.length - 1];
      if (!latest) { showToast("ไม่มีรายการให้ย้อนสำหรับอุปกรณ์นี้", "error"); return; }
      setRevertTx(latest);
    } catch (e: any) {
      showToast(e.message ?? "เกิดข้อผิดพลาด", "error");
    }
  };

  const confirmRevert = async () => {
    if (!revertTx) return;
    setReverting(true);
    const res = await revertTransaction(revertTx.id);
    setReverting(false);
    if ("error" in res) { showToast(res.error, "error"); return; }
    setRevertTx(null);
    const [fresh, lm] = await Promise.all([getAccessories(), getLotMap()]);
    setItems(fresh); setLotMap(lm);
    setSelected(fresh.find((a) => a.id === selected?.id) ?? null);
    showToast("ย้อนรายการล่าสุดแล้ว ✓", "success");
  };

  const matchSearch = (i: Accessory) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.type.toLowerCase().includes(q) ||
      i.acc_code.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.color.toLowerCase().includes(q) ||
      i.size.toLowerCase().includes(q)
    );
  };
  // type → color → size, memoized (can be the full catalog).
  const filtered = useMemo(() => items.filter(matchSearch).sort(compareAccessory), [items, search]);

  const searching = search.trim().length > 0;
  // Global (cross-type) search only applies at the top level. Once drilled into
  // a type, the search box filters within that type's variants instead.
  const globalSearch = searching && !selectedType;

  // Build the list of types with item counts (for the first drilldown step)
  const typeGroups = (() => {
    const map = new Map<string, { count: number; low: number }>();
    for (const i of items) {
      const g = map.get(i.type) ?? { count: 0, low: 0 };
      g.count += 1;
      if (stockOf(i.id) <= Number(i.min_quantity)) g.low += 1;
      map.set(i.type, g);
    }
    return Array.from(map.entries())
      .map(([type, g]) => ({ type, ...g }))
      .sort((a, b) => a.type.localeCompare(b.type, "th"));
  })();

  // Variants of the chosen type (second drilldown step), filtered by the search
  // box so search is scoped to the selected type. Sorted color → size (same type).
  const variantsOfType = useMemo(
    () => selectedType ? items.filter((i) => i.type === selectedType && matchSearch(i)).sort(compareAccessory) : [],
    [items, selectedType, search]
  );

  // Both lists can run into the thousands (e.g. ด้าย / ยาง), so page them —
  // rendering every match at once locks the main thread and freezes the page.
  const searchPg = usePagination(filtered, `search|${search}`);
  const variantPg = usePagination(variantsOfType, `type|${selectedType ?? ""}|${search}`);

  const handleSubmit = async () => {
    if (!selected) return;
    const q = parseFloat(qty);
    if (isNaN(q) || (txType !== "ADJUST" && q <= 0)) { showToast("กรุณาระบุจำนวนที่ถูกต้อง", "error"); return; }
    if (txType === "ADJUST" && q < 0) { showToast("จำนวนต้องไม่ติดลบ", "error"); return; }
    if ((txType === "IN" || txType === "RETURN")) {
      const p = parseFloat(price);
      if (isNaN(p) || p < 0) { showToast("กรุณาระบุราคาซื้อ", "error"); return; }
    }
    if (txType === "ADJUST" && !lotId) { showToast("กรุณาเลือกล็อตที่ต้องการปรับ", "error"); return; }

    setSaving(true);
    const result = await addTransaction({
      accessory_id: selected.id,
      type: txType,
      qty: q,
      unit_cost: (txType === "IN" || txType === "RETURN") ? parseFloat(price) || 0 : undefined,
      lot_id: txType === "ADJUST" ? lotId : (txType === "OUT" && manualLot && lotId ? lotId : undefined),
      return_position: txType === "RETURN" ? returnPos : undefined,
      return_date: txType === "RETURN" && returnPos === "date" ? returnDate : undefined,
      reference_no: refNo, note, created_by: by,
    });
    setSaving(false);
    if ("error" in result) { showToast(result.error, "error"); return; }
    showToast(`✓ บันทึกแล้ว — ${TX_LABELS[txType].th} ${q} ${selected.unit}`, "success");
    // Refresh lots + items and update selected
    const [fresh, lm] = await Promise.all([getAccessories(), getLotMap()]);
    setItems(fresh); setLotMap(lm);
    setSelected(fresh.find((a) => a.id === selected.id) ?? null);
    setQty(""); setPrice(""); setRefNo(""); setNote(""); setLotId(""); setManualLot(false);
  };

  const afterQty = () => {
    if (!selected) return null;
    const cur = stockOf(selected.id);
    const q = parseFloat(qty) || 0;
    if (txType === "IN" || txType === "RETURN") return cur + q;
    if (txType === "OUT") return cur - q;
    if (txType === "ADJUST") {
      const lot = lotsOf(selected.id).find((l) => l.id === lotId);
      if (!lot) return null;
      return cur - Number(lot.quantity_remaining) + q; // replace that lot's qty
    }
    return null;
  };
  const after = afterQty();

  if (!authed) return null;

  return (
    <div className="tx-grid">
      {/* Item picker */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <SearchInput value={search} onChange={setSearch} placeholder={selectedType ? `ค้นหาใน ${selectedType}…` : "ค้นหาอุปกรณ์ที่ต้องการบันทึก…"} />
        </div>

        {/* Breadcrumb / back bar — whenever drilled into a type (incl. while searching within it) */}
        {selectedType && (
          <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => { setSelectedType(null); setSearch(""); }} style={{ padding: "6px 12px", fontSize: 15 }}>
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
          ) : globalSearch ? (
            /* ── GLOBAL SEARCH (no type selected): flat results across everything ── */
            <>
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ประเภท / รายละเอียด</th><th>สี</th><th>ขนาด</th><th className="num">สต็อคปัจจุบัน</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่พบรายการ</td></tr>
                  )}
                  {searchPg.pageItems.map((item) => {
                    const isSel = selected?.id === item.id;
                    const isLow = stockOf(item.id) <= Number(item.min_quantity);
                    return (
                      <tr key={item.id} style={{ cursor: "pointer", background: isSel ? "var(--bg4)" : undefined }}
                        onClick={() => { setSelected(item); setQty(""); }}>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 17 }}>{item.type}</div>
                          <div style={{ fontSize: 14, color: "var(--text2)" }}>{item.description}{item.acc_code ? ` · ${item.acc_code}` : ""}</div>
                        </td>
                        <td style={{ fontSize: 15, color: "var(--text2)" }}>{item.color || "—"}</td>
                        <td style={{ fontSize: 15, color: "var(--text2)" }}>
                          {item.size || (item.row ? "" : "—")}
                          {item.row && <div style={{ color: "var(--text3)", fontSize: 13 }}>แถว {item.row}</div>}
                        </td>
                        <td className="num">
                          <span style={{ color: isLow ? "var(--accent)" : "var(--text)", fontFamily: "var(--mono)", fontWeight: 500 }}>
                            {stockOf(item.id).toLocaleString()}
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
            <PaginationBar {...searchPg} />
            </>
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
            <>
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 240px)", overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>รายละเอียด</th><th>สี</th><th>ขนาด</th><th className="num">สต็อคปัจจุบัน</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {variantsOfType.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่มีรายการ</td></tr>
                  )}
                  {variantPg.pageItems.map((item) => {
                    const isSel = selected?.id === item.id;
                    const isLow = stockOf(item.id) <= Number(item.min_quantity);
                    return (
                      <tr key={item.id} style={{ cursor: "pointer", background: isSel ? "var(--bg4)" : undefined }}
                        onClick={() => { setSelected(item); setQty(""); }}>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 16 }}>{item.description || "—"}</div>
                          {item.acc_code && <div style={{ fontSize: 14, color: "var(--text3)" }}>{item.acc_code}</div>}
                        </td>
                        <td style={{ fontSize: 15, color: "var(--text2)" }}>{item.color || "—"}</td>
                        <td style={{ fontSize: 15, color: "var(--text2)" }}>
                          {item.size || (item.row ? "" : "—")}
                          {item.row && <div style={{ color: "var(--text3)", fontSize: 13 }}>แถว {item.row}</div>}
                        </td>
                        <td className="num">
                          <span style={{ color: isLow ? "var(--accent)" : "var(--text)", fontFamily: "var(--mono)", fontWeight: 500 }}>
                            {stockOf(item.id).toLocaleString()}
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
            <PaginationBar {...variantPg} />
            </>
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
            <label className="form-label">จำนวน{txType === "ADJUST" ? " (ยอดใหม่ของล็อต)" : ""} · {selected?.unit || "หน่วย"}</label>
            <input type="number" min="0" step="any" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)}
              style={{ fontSize: 20, fontFamily: "var(--mono)", padding: "10px 12px" }} />
            {selected && qty && after !== null && (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--text2)", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "var(--mono)" }}>{stockOf(selected.id).toLocaleString()}</span>
                <span style={{ color: "var(--text3)" }}>→</span>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 500,
                  color: after < 0 ? "var(--red)" : after <= Number(selected.min_quantity) ? "var(--accent)" : "var(--green)" }}>
                  {after.toLocaleString()}
                </span>
                <span style={{ color: "var(--text3)" }}>{selected.unit}</span>
              </div>
            )}
          </div>

          {/* Price — for IN and RETURN (creates a lot at this cost) */}
          {(txType === "IN" || txType === "RETURN") && (
            <div className="form-row">
              <label className="form-label">ราคาซื้อ/หน่วย · Unit cost (฿)</label>
              <input type="number" min="0" step="0.0001" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)}
                style={{ fontFamily: "var(--mono)" }} />
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>สร้างล็อตใหม่ที่ราคานี้</div>
            </div>
          )}

          {/* RETURN positioning */}
          {txType === "RETURN" && (
            <div className="form-row">
              <label className="form-label">ตำแหน่งในคิว · Queue position</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {([["front","ใช้ก่อน"],["back","ใช้ทีหลัง"],["date","ตามวันที่"]] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setReturnPos(val)} style={{ fontSize: 13, padding: "8px 4px",
                    ...(returnPos === val ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}) }}>
                    {label}
                  </button>
                ))}
              </div>
              {returnPos === "date" && (
                <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} style={{ marginTop: 6 }} />
              )}
            </div>
          )}

          {/* OUT: optional manual lot selection (default auto FIFO/LIFO) */}
          {txType === "OUT" && selected && (
            <div className="form-row">
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "var(--text2)" }}>
                <input type="checkbox" checked={manualLot} onChange={(e) => { setManualLot(e.target.checked); setLotId(""); }} style={{ width: "auto" }} />
                เลือกล็อตเอง (ไม่ใช้ {selected.valuation_method === "lifo" ? "LIFO" : "FIFO"} อัตโนมัติ)
              </label>
              {manualLot && (
                <select value={lotId} onChange={(e) => setLotId(e.target.value)} style={{ marginTop: 6 }}>
                  <option value="">— เลือกล็อต —</option>
                  {lotsOf(selected.id).filter((l) => Number(l.quantity_remaining) > 0).map((l) => (
                    <option key={l.id} value={l.id}>
                      {new Date(l.effective_date).toLocaleDateString("th-TH")} · เหลือ {Number(l.quantity_remaining)} · ฿{Number(l.unit_cost).toFixed(2)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* ADJUST: required lot selection */}
          {txType === "ADJUST" && selected && (
            <div className="form-row">
              <label className="form-label">เลือกล็อตที่ปรับ · Lot</label>
              <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">— เลือกล็อต —</option>
                {lotsOf(selected.id).map((l) => (
                  <option key={l.id} value={l.id}>
                    {new Date(l.effective_date).toLocaleDateString("th-TH")} · เหลือ {Number(l.quantity_remaining)} · ฿{Number(l.unit_cost).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
          )}

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
            <RecordedByField value={by} onChange={setBy} />
          </div>

          {selected && (
            <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "12px 14px", marginBottom: 14, fontSize: 15 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "var(--text2)" }}>สต็อคคงเหลือ</span>
                <span style={{ fontFamily: "var(--mono)" }}>{stockOf(selected.id).toLocaleString()} {selected.unit}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text2)" }}>มูลค่าคงเหลือ (รวมทุกล็อต)</span>
                <span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>
                  ฿{valueOf(selected.id).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                {lotsOf(selected.id).filter((l) => Number(l.quantity_remaining) > 0).length} ล็อต · วิธี {selected.valuation_method === "lifo" ? "LIFO" : "FIFO"}
              </div>
            </div>
          )}

          <button className="primary" style={{ width: "100%", padding: "10px", fontSize: 16, opacity: (!selected || saving) ? 0.6 : 1 }}
            onClick={handleSubmit} disabled={!selected || saving}>
            {saving ? "กำลังบันทึก…" : "บันทึกรายการ"}
          </button>

          {txRevertEnabled && <RevertLastButton disabled={saving || !selected} onRevert={handleRevertLast} />}
        </div>
      </div>

      {/* Revert-last-transaction confirmation */}
      {revertTx && (
        <div className="modal-overlay" onClick={() => setRevertTx(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500, color: "var(--red)" }}>ย้อนรายการล่าสุด</div>
              <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setRevertTx(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: "var(--text2)" }}>
                จะย้อน (ยกเลิก) รายการล่าสุดของ <strong style={{ color: "var(--text)" }}>{selected?.type} {selected?.description}</strong>:
              </p>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg3)", borderRadius: "var(--r)", margin: "10px 0", fontSize: 15 }}>
                <span><strong>{TX_LABELS[revertTx.transaction_type].th}</strong> · {Math.abs(Number(revertTx.quantity)).toLocaleString()}</span>
                <span style={{ fontFamily: "var(--mono)", color: "var(--text3)" }}>
                  {new Date(revertTx.created_at).toLocaleDateString("th-TH")} {new Date(revertTx.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p style={{ fontSize: 14, color: "var(--text3)" }}>
                ล็อตจะถูกคืนสู่สภาพก่อนรายการนี้ และรายการนี้จะถูกลบออกจากประวัติ — ย้อนได้เฉพาะรายการล่าสุดของอุปกรณ์นี้เท่านั้น
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setRevertTx(null)}>ยกเลิก</button>
              <button className="danger" onClick={confirmRevert} disabled={reverting}>
                {reverting ? "กำลังย้อน…" : "ยืนยันการย้อน"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
