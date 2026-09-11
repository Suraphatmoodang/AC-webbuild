import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { readRole, type Role } from "@/lib/auth";
import {
  getCostings, deleteCosting, computeCosting, hasCosting, statusMeta, ORDER_STATUSES,
  showsActualCosting, normalizeActualCosting, actualCostTotal, type ProductCosting,
} from "@/lib/costing-store";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";
import { matchesTokens, searchTokens } from "@/lib/search-match";

function StatusChip({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 12, whiteSpace: "nowrap",
      color: m.color, background: `${m.color}1a`, border: `1px solid ${m.color}55`,
    }}>{m.th}</span>
  );
}

const fmt0 = (v: number) => (isFinite(v) ? v : 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const fmt2 = (v: number) => (isFinite(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 13, color: "var(--text3)" }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: "var(--mono)", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function CostingList() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ProductCosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  // Which basis the numeric columns are on. "estimate" is the original view (unchanged);
  // "actual" swaps every number for what the order REALLY cost vs what was quoted, and
  // narrows the list to orders that can have actuals at all (กำลังผลิต onwards — the same
  // gate as the actuals card on /costing/[id], so the two screens never disagree).
  const [view, setView] = useState<"estimate" | "actual">("estimate");

  useEffect(() => {
    const r = readRole();
    if (!r) { router.replace("/login"); return; }
    if (r !== "super") { router.replace("/"); return; }   // orders: super-admin only
    setRole(r);
    setAuthed(true);
  }, [router]);

  const load = () => {
    setLoading(true);
    getCostings()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (authed) load(); }, [authed]);

  // Precompute both bases per row once — the estimate (computeCosting) and the close-out
  // actual. `actual` is the order-level figure from whichever mode the order is in
  // (แบบรวม / แบบแยกรายการ), so this list never needs to know which one was used.
  const priced = useMemo(
    () => rows.map((c) => {
      const qty = Number(c.order_qty) || 0;
      const offer = Number(c.offer_price) || 0;
      const actual = actualCostTotal(normalizeActualCosting(c.actual_costing));
      return {
        c, bd: computeCosting(c), costed: hasCosting(c), qty, offer, actual,
        actualPerPc: qty > 0 ? actual / qty : 0,
        // Profit only means anything with BOTH sides present: a price that was quoted and a
        // cost that was actually keyed. Missing either → no profit figure, never a fake 0.
        hasProfit: offer > 0 && actual > 0,
        profit: offer * qty - actual,
      };
    }),
    [rows]
  );

  // In the actual view the list is restricted to orders that CAN carry an actual cost, so the
  // status counts below and the rows in the table stay in step with one another.
  const inView = useMemo(
    () => (view === "actual" ? priced.filter(({ c }) => showsActualCosting(c.status || "quote")) : priced),
    [priced, view]
  );

  // Count per status (over the search-filtered set, ignoring the status filter itself).
  const searched = useMemo(() => {
    const tokens = searchTokens(query);
    if (!tokens.length) return inView;
    return inView.filter(({ c }) =>
      matchesTokens(tokens, c.style_no, c.po_no, c.pn_no, c.customer, c.product_type, c.description, c.brand, c.code, c.tags)
    );
  }, [inView, query]);

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const { c } of searched) m[c.status || "quote"] = (m[c.status || "quote"] ?? 0) + 1;
    return m;
  }, [searched]);

  const filtered = useMemo(
    () => (statusFilter ? searched.filter(({ c }) => (c.status || "quote") === statusFilter) : searched),
    [searched, statusFilter]
  );

  // Pipeline totals. Cancelled orders don't count. `value` is on the OFFER basis to match the
  // table's ราคาเสนอ/มูลค่าออเดอร์ columns — the offered price per garment × จำนวนสั่ง, falling
  // back to the computed ราคาขาย for orders with no offer entered yet. `offered` counts how many
  // rows carried a real offer, so the card can say how much of the figure is quoted vs. computed.
  const totals = useMemo(() => {
    let pieces = 0, cost = 0, value = 0, offered = 0, valued = 0;
    for (const { c, bd, costed } of priced) {
      if ((c.status || "quote") === "cancelled") continue;
      const qty = Number(c.order_qty) || 0;
      const offer = Number(c.offer_price) || 0;
      pieces += qty;
      if (costed) cost += bd.totalCost * qty;
      if (offer > 0) { value += offer * qty; offered++; valued++; }
      else if (costed) { value += bd.sellingPrice * qty; valued++; }
    }
    return { pieces, cost, value, offered, valued };
  }, [priced]);

  // Actual-view totals — the same set the actual table lists (กำลังผลิต onwards, cancelled
  // excluded by that gate already). `missing` counts orders still waiting for someone to key
  // their close-out cost; those contribute nothing to ต้นทุนจริง or กำไร rather than a zero.
  const actualTotals = useMemo(() => {
    let orders = 0, pieces = 0, cost = 0, profit = 0, missing = 0;
    for (const p of priced) {
      if (!showsActualCosting(p.c.status || "quote")) continue;
      orders++;
      pieces += p.qty;
      if (p.actual > 0) { cost += p.actual; if (p.hasProfit) profit += p.profit; }
      else missing++;
    }
    return { orders, pieces, cost, profit, missing };
  }, [priced]);

  // Switching view resets a status filter that can't exist there (e.g. ใบเสนอราคา in the
  // actual view), otherwise the table would just render empty with no obvious reason.
  const switchView = (v: "estimate" | "actual") => {
    if (v === "actual" && statusFilter && !showsActualCosting(statusFilter)) setStatusFilter("");
    setView(v);
  };

  const { page, setPage, totalPages, pageItems, rangeStart, rangeEnd, total } = usePagination(filtered, view + "|" + query + "|" + statusFilter);

  const remove = async (c: ProductCosting) => {
    if (role !== "super") return;
    const label = c.style_no || c.po_no || c.customer || "รายการนี้";
    if (!confirm(`ลบต้นทุน "${label}" ?`)) return;
    setBusy(c.id);
    try {
      await deleteCosting(c.id);
      setRows((rs) => rs.filter((r) => r.id !== c.id));
    } catch (e: any) {
      alert(e.message ?? "ลบไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  if (authed !== true) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500 }}>ออเดอร์</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Trends button hidden for now (page kept at /costing/trends):
          <Link href="/costing/trends"><button>📈 แนวโน้ม</button></Link> */}
          {/* Excel import hidden for now — no real import template yet, and this is live
              so we don't want anyone importing example data. Page kept at /costing/import,
              but it redirects back until re-enabled here.
          <Link href="/costing/import"><button>นำเข้า Excel</button></Link> */}
          <Link href="/costing/new"><button className="primary">+ เพิ่มออเดอร์</button></Link>
        </div>
      </div>

      {/* Stat cards follow the active view, so the headline numbers are never on a different
          basis from the table underneath them. */}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {view === "estimate" ? (
          <>
            <StatCard label="ออเดอร์ทั้งหมด" value={rows.length.toLocaleString()} />
            <StatCard label="จำนวนตัวรวม" value={fmt0(totals.pieces)} sub="ไม่รวมที่ยกเลิก" />
            <StatCard label="ต้นทุนรวม" value={`฿${fmt0(totals.cost)}`} sub="เฉพาะที่คิดต้นทุนแล้ว" />
            <StatCard label="มูลค่าเสนอรวม" value={`฿${fmt0(totals.value)}`}
              sub={totals.offered < totals.valued ? `ราคาเสนอ ${totals.offered}/${totals.valued} ออเดอร์ · ที่เหลือใช้ราคาขายที่คำนวณ` : "ตามราคาเสนอ"} />
          </>
        ) : (
          <>
            <StatCard label="ออเดอร์ที่ผลิตแล้ว" value={actualTotals.orders.toLocaleString()}
              sub={actualTotals.missing > 0 ? `ยังไม่ได้ลงต้นทุนจริง ${actualTotals.missing} ออเดอร์` : "ลงต้นทุนจริงครบแล้ว"} />
            <StatCard label="จำนวนตัวรวม" value={fmt0(actualTotals.pieces)} sub="ตั้งแต่กำลังผลิตขึ้นไป" />
            <StatCard label="ต้นทุนจริงรวม" value={`฿${fmt0(actualTotals.cost)}`} sub="เฉพาะที่ลงต้นทุนจริงแล้ว" />
            <div className="card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)" }}>กำไรจริงรวม</div>
              <div style={{ fontSize: 22, fontFamily: "var(--mono)", marginTop: 4,
                color: actualTotals.profit >= 0 ? "var(--green)" : "var(--red)" }}>
                {actualTotals.profit >= 0 ? "+" : "−"}฿{fmt0(Math.abs(actualTotals.profit))}
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>ราคาเสนอ − ต้นทุนจริง</div>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <SearchInput value={query} onChange={setQuery} placeholder="ค้นหา Style / PO / ลูกค้า / ชนิดสินค้า…" leftIcon="🔍" style={{ maxWidth: 420, flex: "1 1 260px" }} />
            {/* Basis switch. ประมาณการ is the planning view; จริง is the close-out view —
                what the finished orders actually cost against what was quoted. */}
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {([["estimate", "ประมาณการ"], ["actual", "จริง"]] as const).map(([k, th]) => {
                const on = view === k;
                return (
                  <button key={k} onClick={() => switchView(k)}
                    style={{ padding: "5px 14px", fontSize: 13, fontWeight: on ? 600 : 400,
                      borderColor: on ? "var(--accent)" : undefined,
                      color: on ? "var(--accent)" : "var(--text2)",
                      background: on ? "var(--bg3)" : undefined }}>
                    {th}
                  </button>
                );
              })}
            </div>
          </div>
          {view === "actual" && (
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              แสดงเฉพาะออเดอร์ตั้งแต่ <b style={{ color: "var(--text2)" }}>กำลังผลิต</b> ขึ้นไป — ก่อนหน้านั้นยังไม่มีต้นทุนจริง · ลงต้นทุนจริงได้ในหน้าออเดอร์ (“ราคาจริงของออเดอร์”)
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setStatusFilter("")}
              style={{ padding: "4px 12px", fontSize: 13, borderColor: statusFilter === "" ? "var(--accent)" : undefined, color: statusFilter === "" ? "var(--accent)" : undefined }}>
              ทั้งหมด ({searched.length})
            </button>
            {ORDER_STATUSES.filter((st) => view === "estimate" || showsActualCosting(st.key)).map((st) => (
              <button key={st.key} onClick={() => setStatusFilter(statusFilter === st.key ? "" : st.key)}
                style={{ padding: "4px 12px", fontSize: 13,
                  borderColor: statusFilter === st.key ? st.color : undefined,
                  color: statusFilter === st.key ? st.color : "var(--text2)" }}>
                {st.th} ({statusCounts[st.key] ?? 0})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, color: "var(--text3)", textAlign: "center" }}>กำลังโหลด…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, color: "var(--text3)", textAlign: "center" }}>
            {rows.length === 0 ? "ยังไม่มีออเดอร์ — กด “เพิ่มออเดอร์” เพื่อเริ่ม"
              : view === "actual" && inView.length === 0 ? "ยังไม่มีออเดอร์ที่ถึงขั้นกำลังผลิต — ยังไม่มีต้นทุนจริงให้เทียบ"
              : "ไม่พบรายการที่ตรงกับคำค้นหา"}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead className="sticky-head">
                <tr>
                  <th>สถานะ</th>
                  <th>Style / PO</th>
                  <th>ลูกค้า</th>
                  <th>ชนิดสินค้า</th>
                  <th>กำหนดส่ง</th>
                  {view === "estimate" ? (
                    <>
                      <th className="num">จำนวนสั่ง</th>
                      <th className="num">ต้นทุน/ตัว</th>
                      <th className="num">ราคาเสนอ/ตัว</th>
                      <th className="num">มูลค่าออเดอร์</th>
                    </>
                  ) : (
                    <>
                      <th className="num">ต้นทุนจริง/ตัว</th>
                      <th className="num">ราคาเสนอ/ตัว</th>
                      <th className="num">กำไร/ตัว</th>
                      <th className="num">กำไรรวม</th>
                    </>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageItems.map(({ c, bd, costed, qty, offer, actual, actualPerPc, hasProfit, profit }) => (
                  <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/costing/${c.id}`)}>
                    <td><StatusChip status={c.status} /></td>
                    <td>
                      <div style={{ color: "var(--text)" }}>{c.style_no || c.po_no || "—"}</div>
                      {c.style_no && c.po_no && <div style={{ fontSize: 12, color: "var(--text3)" }}>PO {c.po_no}</div>}
                    </td>
                    <td>{c.customer || "—"}</td>
                    <td>{c.product_type || "—"}</td>
                    <td style={{ color: c.due_date ? "var(--text2)" : "var(--text3)" }}>{c.due_date || "—"}</td>
                    {view === "estimate" ? (
                      <>
                        <td className="num">{fmt0(qty)}</td>
                        <td className="num">{costed ? fmt2(bd.totalCost) : "—"}</td>
                        {/* The offered price (per ตัว) drives both columns — that's the figure actually
                            quoted to the customer. Falls back to the computed ราคาขาย when no offer has
                            been entered yet, shown dimmed so the two bases stay tellable apart. */}
                        {(() => {
                          const per = offer > 0 ? offer : (costed ? bd.sellingPrice : 0);
                          const has = offer > 0 || costed;
                          return (
                            <>
                              <td className="num" style={{ color: offer > 0 ? "var(--accent)" : "var(--text3)", fontWeight: offer > 0 ? 500 : 400 }}
                                title={offer > 0 ? "ราคาเสนอที่กรอกไว้" : "ยังไม่ได้กรอกราคาเสนอ — แสดงราคาขายที่คำนวณได้"}>
                                {has ? fmt2(per) : "—"}
                              </td>
                              <td className="num" style={{ color: offer > 0 ? "var(--text)" : "var(--text3)" }}>
                                {has ? `฿${fmt0(per * qty)}` : "—"}
                              </td>
                            </>
                          );
                        })()}
                      </>
                    ) : (() => {
                      // Actual view. A missing figure is shown as — with the reason, never as a
                      // fallback to the estimate: a stale estimate sitting in a column headed
                      // "จริง" would read as the real result and quietly mislead.
                      const col = profit >= 0 ? "var(--green)" : "var(--red)";
                      const sign = (v: number) => (v >= 0 ? "+" : "−");
                      return (
                        <>
                          <td className="num">
                            {actual > 0 ? fmt2(actualPerPc) : (
                              <span style={{ fontSize: 11, whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 999,
                                background: "#fef3c7", color: "#b45309" }} title="เปิดออเดอร์แล้วกรอกใน “ราคาจริงของออเดอร์”">
                                ยังไม่ได้ลงต้นทุนจริง
                              </span>
                            )}
                          </td>
                          <td className="num" style={{ color: offer > 0 ? "var(--accent)" : "var(--text3)", fontWeight: offer > 0 ? 500 : 400 }}
                            title={offer > 0 ? "ราคาเสนอที่กรอกไว้" : "ยังไม่ได้กรอกราคาเสนอ"}>
                            {offer > 0 ? fmt2(offer) : "—"}
                          </td>
                          <td className="num" style={{ color: hasProfit ? col : "var(--text3)" }}
                            title={hasProfit ? "" : "ต้องมีทั้งราคาเสนอและต้นทุนจริง"}>
                            {hasProfit && qty > 0 ? `${sign(profit)}${fmt2(Math.abs(profit / qty))}` : "—"}
                          </td>
                          <td className="num" style={{ color: hasProfit ? col : "var(--text3)", fontWeight: hasProfit ? 600 : 400 }}>
                            {hasProfit ? `${sign(profit)}฿${fmt0(Math.abs(profit))}` : "—"}
                          </td>
                        </>
                      );
                    })()}
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <Link href={`/costing/${c.id}`}><button className="ghost" style={{ padding: "3px 8px", fontSize: 13 }}>แก้ไข</button></Link>
                        {role === "super" && (
                          <button className="ghost" style={{ padding: "3px 8px", fontSize: 13, color: "var(--red)" }}
                            disabled={busy === c.id} onClick={() => remove(c)}>ลบ</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar page={page} setPage={setPage} totalPages={totalPages} rangeStart={rangeStart} rangeEnd={rangeEnd} total={total} />
      </div>
    </div>
  );
}
