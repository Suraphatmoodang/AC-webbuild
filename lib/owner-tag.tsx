import { SELF_OWNER } from "./fabric-store";

// Ownership chip for the เจ้าของ column, shared by every fabric table so the styling
// stays identical across stock / manage / import / updater.
//
// Design intent — make "not ours" jump out:
//   · OUR stock (blank owner)  → a quiet neutral pill with the company name (SELF_OWNER).
//     It's the common case, so it stays low-contrast and doesn't add visual noise.
//   · CONSIGNMENT stock (owner) → a filled violet pill with a dot and the factory name,
//     clearly distinct from the blue accents used elsewhere in the app. The tooltip
//     spells out that it's held stock.
export function OwnerTag({ owner, size = "sm" }: { owner: string; size?: "sm" | "md" }) {
  const external = owner.trim() !== "";
  const pad = size === "md" ? "3px 10px" : "1px 8px";
  const font = size === "md" ? 13 : 12;

  if (!external) {
    return (
      <span style={{
        display: "inline-block", fontSize: font, padding: pad, borderRadius: 999,
        background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text3)",
        whiteSpace: "nowrap", letterSpacing: "0.02em",
      }}>
        {SELF_OWNER}
      </span>
    );
  }

  return (
    <span title={`ฝากเก็บ · เจ้าของ: ${owner}`} style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontSize: font, padding: pad,
      borderRadius: 999, background: "#f3e8ff", border: "1px solid #d8b4fe", color: "#7c3aed",
      whiteSpace: "nowrap", fontWeight: 500, maxWidth: "100%",
    }}>
      <span style={{ fontSize: 8, lineHeight: 1, flexShrink: 0 }}>●</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{owner}</span>
    </span>
  );
}
