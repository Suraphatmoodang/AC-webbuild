import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useRequireAccess } from "@/lib/auth";
import { getApprovedFabricImports, getFabricTransactions, getFabrics, getSuppliers,
  getFabricLotMap, valueFromLots,
  type FabricImportRow, type FabricTransaction, type Fabric, type Supplier, type FabricLot } from "@/lib/fabric-store";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";

type LogEvent = {
  id: string;
  kind: "added" | "transaction";
  at: string;
  label: string;        // fabric name
  detail: string;       // extra info (qty, variant, ref)
  txType?: FabricTransaction["transaction_type"];
};

const TX_LABELS: Record<string, { th: string; cls: string }> = {
  IN:     { th: "รับเข้า",   cls: "badge-in"     },
  OUT:    { th: "เบิกใช้",   cls: "badge-out"    },
  ADJUST: { th: "ปรับยอด",  cls: "badge-adjust" },
  RETURN: { th: "คืนสต็อค", cls: "badge-return"  },
};

export default function FabricAdminLogPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [approved, setApproved] = useState<FabricImportRow[]>([]);
  const [txns, setTxns] = useState<FabricTransaction[]>([]);
  const [fabs, setFabs] = useState<Fabric[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [lotMap, setLotMap] = useState<Map<string, FabricLot[]>>(new Map());

  // filters
  const [kindFilter, setKindFilter] = useState<"all" | "added" | "transaction">("all");
  const [txFilter, setTxFilter] = useState<"all" | "IN" | "OUT" | "ADJUST" | "RETURN">("all");
  const [search, setSearch] = useState("");

  const { authed } = useRequireAccess("fabric", "admin");

  useEffect(() => {
    if (!authed) return;
    Promise.all([getApprovedFabricImports(), getFabricTransactions(), getFabrics(), getSuppliers(), getFabricLotMap()])
      .then(([imp, tx, fa, su, lm]) => { setApproved(imp); setTxns(tx); setFabs(fa); setSuppliers(su); setLotMap(lm); })
      .finally(() => setLoading(false));
  }, [authed]);

  const fabMap = Object.fromEntries(fabs.map((f) => [f.id, f]));

  // Build unified log
  const events: LogEvent[] = [
    ...approved.map((r): LogEvent => ({
      id: "add-" + r.id,
      kind: "added",
      at: r.approved_at ?? r.created_at,
      label: r.fabric_type.trim(),
      detail: [r.color, r.width, r.fabric_code && `#${r.fabric_code}`].filter(Boolean).join(" · ") || "—",
    })),
    ...txns.map((t): LogEvent => {
      const f = fabMap[t.fabric_id];
      return {
        id: "tx-" + t.id,
        kind: "transaction",
        at: t.created_at,
        label: f ? f.fabric_type : "(ลบแล้ว)",
        detail: `${Math.abs(Number(t.quantity)).toLocaleString()} ${f?.unit ?? ""}${t.reference_no ? " · " + t.reference_no : ""}`,
        txType: t.transaction_type,
      };
    }),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const filteredEvents = events.filter((e) => {
    if (kindFilter !== "all" && e.kind !== kindFilter) return false;
    if (txFilter !== "all" && (e.kind !== "transaction" || e.txType !== txFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.label.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q);
    }
    return true;
  });

  const pg = usePagination(filteredEvents, `${kindFilter}|${txFilter}|${search}`);

  // ── Summary totals ──
  const totalValue = fabs.reduce((s, f) => s + valueFromLots(lotMap.get(f.id) ?? []), 0);
  const totalIn = txns.filter((t) => t.transaction_type === "IN" || t.transaction_type === "RETURN")
    .reduce((s, t) => s + Math.abs(Number(t.quantity)), 0);
  const totalOut = txns.filter((t) => t.transaction_type === "OUT")
    .reduce((s, t) => s + Math.abs(Number(t.quantity)), 0);

  const summary = [
    { label: "ผ้าทั้งหมด", val: fabs.length.toLocaleString(), en: "Fabrics" },
    { label: "ซัพพลายเออร์", val: suppliers.length.toLocaleString(), en: "Suppliers" },
    { label: "ชนิดผ้า", val: new Set(fabs.map((f) => f.fabric_type)).size.toLocaleString(), en: "Fabric types" },
    { label: "มูลค่าสต็อครวม", val: "฿" + totalValue.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), en: "Stock value", mono: true },
    { label: "เพิ่มเข้าระบบ", val: approved.length.toLocaleString(), en: "Added (approved)" },
    { label: "ธุรกรรมทั้งหมด", val: txns.length.toLocaleString(), en: "Transactions" },
    { label: "รับเข้ารวม", val: totalIn.toLocaleString(), en: "Total in", color: "var(--green)" },
    { label: "เบิกใช้รวม", val: totalOut.toLocaleString(), en: "Total out", color: "var(--red)" },
  ];

  if (!authed) return null;

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 16 }}>สรุปและบันทึกกิจกรรม — ผ้า</h2>

      {/* Summary cards */}
      <div className="stat-grid" style={{ marginBottom: 28 }}>
        {summary.map((s) => (
          <div key={s.label} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, fontFamily: (s as any).mono ? "var(--mono)" : "var(--font)", color: (s as any).color ?? "var(--text)" }}>{s.val}</div>
            <div style={{ fontSize: 10, color: "var(--text3)" }}>{s.en}</div>
          </div>
        ))}
      </div>

      {/* Log filters */}
      <h3 style={{ fontSize: 17, fontWeight: 500, marginBottom: 10 }}>บันทึกกิจกรรม</h3>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <SearchInput value={search} onChange={setSearch} placeholder="ค้นหา…" style={{ flex: "1 1 200px" }} />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)} style={{ width: "auto", minWidth: 150 }}>
          <option value="all">ทุกประเภท</option>
          <option value="added">รายการที่เพิ่ม</option>
          <option value="transaction">ธุรกรรม</option>
        </select>
        <select value={txFilter} onChange={(e) => setTxFilter(e.target.value as any)} style={{ width: "auto", minWidth: 150 }}
          disabled={kindFilter === "added"}>
          <option value="all">ทุกธุรกรรม</option>
          <option value="IN">รับเข้า</option>
          <option value="OUT">เบิกใช้</option>
          <option value="ADJUST">ปรับยอด</option>
          <option value="RETURN">คืนสต็อค</option>
        </select>
        <span style={{ alignSelf: "center", fontSize: 15, color: "var(--text3)" }}>{filteredEvents.length} รายการ</span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text3)" }}>กำลังโหลด…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ tableLayout: "fixed", minWidth: 760 }}>
              <colgroup>
                <col style={{ width: "16%" }} /><col style={{ width: "14%" }} />
                <col style={{ width: "38%" }} /><col style={{ width: "32%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>วันที่</th><th style={{ whiteSpace: "nowrap" }}>ประเภท</th><th style={{ whiteSpace: "nowrap" }}>ผ้า</th><th style={{ whiteSpace: "nowrap" }}>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>ไม่มีบันทึก</td></tr>
                )}
                {pg.pageItems.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text2)", whiteSpace: "nowrap" }}>
                      {new Date(e.at).toLocaleDateString("th-TH")}<br />
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>{new Date(e.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
                    </td>
                    <td>
                      {e.kind === "added"
                        ? <span className="badge" style={{ background: "#1e3a2a", color: "var(--green)" }}>เพิ่มรายการ</span>
                        : <span className={`badge ${TX_LABELS[e.txType!].cls}`}>{TX_LABELS[e.txType!].th}</span>}
                    </td>
                    <td style={{ wordBreak: "break-word", fontWeight: 500, fontSize: 15 }}>{e.label}</td>
                    <td style={{ wordBreak: "break-word", fontSize: 14, color: "var(--text2)" }}>{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar {...pg} />
      </div>
    </div>
  );
}
