// Reports which tables exist and how many rows each holds.
//   node scripts/check-schema.mjs
//
// Uses a real SELECT rather than a head-only count: a head request against a
// missing table comes back with count:null and NO error, which reads as success
// and hides the very problem this script exists to find.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const TABLES = [
  ["shared",    "suppliers"],
  ["accessory", "accessories"],
  ["accessory", "accessory_lots"],
  ["accessory", "accessory_transactions"],
  ["accessory", "accessory_imports"],
  ["fabric",    "fabrics"],
  ["fabric",    "fabric_lots"],
  ["fabric",    "fabric_transactions"],
  ["fabric",    "fabric_imports"],
];

let missing = 0;
for (const [group, t] of TABLES) {
  const probe = await db.from(t).select("id").limit(1);
  if (probe.error) {
    missing += 1;
    const gone = /Could not find the table|does not exist/i.test(probe.error.message);
    console.log(group.padEnd(10), t.padEnd(24), gone ? "MISSING" : "ERROR: " + probe.error.message);
    continue;
  }
  const { count } = await db.from(t).select("*", { count: "exact", head: true });
  console.log(group.padEnd(10), t.padEnd(24), `ok · ${count ?? "?"} rows`);
}

console.log(missing === 0
  ? "\nAll tables present."
  : `\n${missing} table(s) missing — run sql/fabric-schema.sql in the Supabase SQL editor.`);
