// Suppliers are the one thing the accessory and fabric systems share, so this
// route renders the exact same page as /suppliers. It exists purely so the
// fabric section's nav can link to a /fabrics/* URL and stay highlighted —
// without it, opening Suppliers would flip the header back to the ACC nav.
export { default } from "../suppliers";
