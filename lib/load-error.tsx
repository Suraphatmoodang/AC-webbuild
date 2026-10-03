// ── Load-failure strip ──────────────────────────────────────────────────────
// The leads and costing lists used to `.catch(() => setRows([]))`, which was fine when
// the only way a load could fail was "the table isn't migrated yet" — an empty screen
// said as much as anything else would.
//
// It stopped being fine once those three tables moved behind pages/api/data/*: a load
// can now fail because the server is missing SUPABASE_SERVICE_ROLE_KEY, or because the
// 12h login token expired, and in both cases the API returns a precise Thai message
// that the old catch threw away. An empty board looked like "no leads yet" instead of
// "nobody is talking to the database", which is a very different thing to debug.
//
// So: show the message, and offer a retry where the page has a loader to call.

export function LoadError({ msg, onRetry }: { msg: string | null; onRetry?: () => void }) {
  if (!msg) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        background: "var(--red2)", border: "1px solid var(--red)", borderRadius: 8,
        padding: "10px 14px", marginBottom: 14, fontSize: 14, lineHeight: 1.6,
      }}
    >
      <span style={{ flex: 1, minWidth: 220 }}>⚠ {msg}</span>
      {onRetry && (
        <button onClick={onRetry} style={{ fontSize: 13, padding: "4px 12px" }}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}
