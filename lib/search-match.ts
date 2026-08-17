// ── Tokenised search matching ────────────────────────────────────────
// Every search box in the app used to be a single contiguous `field.includes(query)`, which
// means the typed string had to appear verbatim, in order, inside ONE field. That fails on
// the app's own labels, which are built by joining spec parts with " · ":
//   "ซิป ดำ"  vs  "ซิป วีนัส · ซิปไนล่อนปิดท้าย #03 · สีดำ · 7นิ้ว"   → no match
//
// Instead, split the query on whitespace and require EVERY token to appear somewhere in the
// row. Tokens are order-independent and may land in different fields ("ซิป" in the name,
// "ดำ" in the colour), which is how people actually search.
//
// Cost: one lowercase + join per row per keystroke, same order as the old single includes().
// At the app's worst case (~5000 stock rows) this is well under a frame, and StockSelect still
// caps how many matches it paints. Nothing here touches the DB — all searches filter in memory.

// Split a raw query into lowercase tokens. Empty query → [] (meaning "match everything").
export function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

// True when every token appears in at least one of the fields. Fields are joined with "\n",
// which no token can contain (tokens are whitespace-split), so a token can never match by
// straddling two fields.
export function matchesTokens(tokens: string[], ...fields: (string | null | undefined)[]): boolean {
  if (tokens.length === 0) return true;
  const hay = fields.map((f) => String(f ?? "").toLowerCase()).join("\n");
  return tokens.every((t) => hay.includes(t));
}

// Convenience for one-off call sites: matchesQuery("ซิป ดำ", a, b, c).
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  return matchesTokens(searchTokens(query), ...fields);
}
