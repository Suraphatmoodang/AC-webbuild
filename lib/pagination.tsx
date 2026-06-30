import { useState, useEffect } from "react";

export const PAGE_SIZE = 100;

// Slices a filtered array into pages and resets to page 0 when the filter changes.
export function usePagination<T>(items: T[], resetKey: string) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = items.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min((safePage + 1) * PAGE_SIZE, items.length);

  return { page: safePage, setPage, totalPages, pageItems, rangeStart, rangeEnd, total: items.length };
}

export function PaginationBar({ page, setPage, totalPages, rangeStart, rangeEnd, total }: {
  page: number; setPage: (p: number) => void; totalPages: number;
  rangeStart: number; rangeEnd: number; total: number;
}) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
      <span style={{ fontSize: 14, color: "var(--text3)" }}>
        แสดง {rangeStart}–{rangeEnd} จาก {total}
      </span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button onClick={() => setPage(0)} disabled={page === 0} style={{ padding: "4px 10px" }}>«</button>
        <button onClick={() => setPage(page - 1)} disabled={page === 0} style={{ padding: "4px 10px" }}>‹</button>
        <span style={{ fontSize: 14, color: "var(--text2)", minWidth: 90, textAlign: "center" }}>หน้า {page + 1} / {totalPages}</span>
        <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1} style={{ padding: "4px 10px" }}>›</button>
        <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} style={{ padding: "4px 10px" }}>»</button>
      </div>
    </div>
  );
}
