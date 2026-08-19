// QC scan station (ตรวจ QC) — MOCKUP DATA + RULES.
//
// The next phase: every QC workstation gets ONE barcode scanner and ONE fixed sheet of
// barcodes. The operator scans exactly once per garment examined; the only thing a barcode
// carries is WHICH STATUS it means (ผ่าน / ตำหนิ 1..n / ย้อนรายการ). Everything else —
// which order, which station, who is inspecting, what the fault labels mean, how many pieces
// the run is — is defined HERE ON THE WEBSITE, in the run preset. So the same physical
// barcode sheet works for every order forever; only the website mapping changes.
//
// This file is deliberately Supabase-free for now: the page is a mock-up, all state lives in
// the browser. The shapes below are the ones the real store would expose, and the proposed
// tables are sketched at the bottom so wiring it up later is a swap of the data source, not a
// rewrite of the page.
//
// Derive-don't-store, the same rule as stock/value and the costing price:
//   · totals, fault counts, pace and % complete are ALL derived from the scan log (`tally`),
//     never kept as counters — so a revert is just another log line and nothing drifts.

// ── What a barcode can mean ──────────────────────────────────────────
// Stored as a KEY, never the Thai label (same reason as LEAD_STATUSES): renaming a label
// must never orphan a recorded scan.
export const QC_ACTIONS = [
  { key: "pass",   th: "ผ่าน",             en: "QC PASS",  color: "#16a34a" },
  { key: "fault",  th: "พบตำหนิ",          en: "QC FAULT", color: "#dc2626" },
  { key: "revert", th: "ย้อนรายการล่าสุด", en: "REVERT",   color: "#7c3aed" },
] as const;
export type QcAction = (typeof QC_ACTIONS)[number]["key"];
export function actionMeta(key: string) {
  return QC_ACTIONS.find((a) => a.key === key) ?? QC_ACTIONS[0];
}

// ── The fixed barcode sheet ──────────────────────────────────────────
// One row per printed barcode. `code` is what the scanner types; `action` (+ `slot` for a
// fault) is the website-defined meaning. The sheet is IDENTICAL at every station — the last
// barcode is the mistake-fixer (ย้อน 1 รายการ) from the flow sketch.
export type BarcodeSlot = { code: string; action: QcAction; slot?: number };

export const DEFAULT_BARCODES: BarcodeSlot[] = [
  { code: "AC-QC-PASS", action: "pass" },
  { code: "AC-QC-F1",   action: "fault", slot: 0 },
  { code: "AC-QC-F2",   action: "fault", slot: 1 },
  { code: "AC-QC-F3",   action: "fault", slot: 2 },
  { code: "AC-QC-UNDO", action: "revert" },
];

// Default fault names. They stay filled in on every run unless the preset changes them —
// most orders fail the same three ways, so nobody should have to retype them.
export const DEFAULT_FAULTS = ["ตะเข็บ/ด้ายหลุด", "เย็บไม่เรียบร้อย", "คราบ/รอยเปื้อน"];

export const QC_STATIONS = ["สถานี 1", "สถานี 2", "สถานี 3", "สถานี 4"];
export const QC_INSPECTORS = ["อี่อี๊", "แอ๋ม", "เหลง", "ยุ้ย", "เอม"];

// When the target is reached the run does NOT close itself. Two modes, per the planned flow:
//   preliminary — records the numbers, keeps the run open (over-count keeps counting)
//   manual      — the operator closes the run; that is what writes to the database
export const RECORD_MODES = [
  { key: "prelim", th: "บันทึกเบื้องต้น", note: "บันทึกยอด แต่ยังไม่ปิดงาน — สแกนต่อได้" },
  { key: "manual", th: "ปิดงาน/บันทึกจริง", note: "ปิดงานและบันทึกลงฐานข้อมูล" },
] as const;
export type RecordMode = (typeof RECORD_MODES)[number]["key"];

// ── A run ────────────────────────────────────────────────────────────
// The preset = the "set specifications / scheduled preset" box in the flow. `target_rate`
// is pieces/hour expected; the colour coding compares the live rate against it.
export type QcPreset = {
  station: string;
  inspector: string;
  order_code: string;
  product: string;
  color: string;
  size: string;
  target: number;        // จำนวนที่ต้องตรวจ (ตัว)
  target_rate: number;   // เป้าหมาย ตัว/ชม.
  faults: string[];      // ชื่อตำหนิ ตามช่องบาร์โค้ด F1..Fn
};

export type QcScan = {
  id: string;
  ts: number;            // epoch ms — a scan is only "offline" until it syncs, never lost
  code: string;
  action: QcAction;
  slot?: number;         // fault index for action="fault"
  voided?: boolean;      // undone by a REVERT scan
  synced: boolean;
};

export const emptyPreset = (over: Partial<QcPreset> = {}): QcPreset => ({
  station: QC_STATIONS[0],
  inspector: QC_INSPECTORS[0],
  order_code: "",
  product: "",
  color: "",
  size: "",
  target: 0,
  target_rate: 60,
  faults: [...DEFAULT_FAULTS],
  ...over,
});

// Scheduled presets — what the station would pull from today's plan instead of typing.
export const DEMO_PRESETS: QcPreset[] = [
  emptyPreset({ order_code: "OD-2408-014", product: "เสื้อโปโล คอปก", color: "กรมท่า", size: "M", target: 500, target_rate: 70 }),
  emptyPreset({ order_code: "OD-2408-019", product: "เสื้อยืดคอกลม", color: "ดำ", size: "L", target: 320, target_rate: 90, station: QC_STATIONS[1] }),
  emptyPreset({ order_code: "OD-2408-021", product: "กางเกงขายาว", color: "เทา", size: "32", target: 180, target_rate: 40, station: QC_STATIONS[2] }),
];

// ── Derived numbers (never stored) ───────────────────────────────────
export type QcTally = {
  total: number;         // ตัวที่ตรวจแล้ว = ผ่าน + พบตำหนิ
  pass: number;
  faultTotal: number;
  byFault: number[];     // นับตามช่องตำหนิ (index = slot)
};

export function tally(scans: QcScan[], faultCount: number): QcTally {
  const byFault = new Array(faultCount).fill(0);
  let pass = 0, faultTotal = 0;
  for (const s of scans) {
    if (s.voided || s.action === "revert") continue;
    if (s.action === "pass") pass += 1;
    else if (s.action === "fault") {
      faultTotal += 1;
      const i = s.slot ?? 0;
      if (i < byFault.length) byFault[i] += 1;
    }
  }
  return { total: pass + faultTotal, pass, faultTotal, byFault };
}

// Look up what a scanned string means. Unknown codes are rejected loudly rather than
// guessed at — a mis-scan must never silently count as a good piece.
export function resolveCode(raw: string, sheet: BarcodeSlot[]): BarcodeSlot | null {
  const code = raw.trim().toUpperCase();
  return sheet.find((b) => b.code.toUpperCase() === code) ?? null;
}

// REVERT undoes the most recent scan that still counts.
export function lastLiveIndex(scans: QcScan[]): number {
  for (let i = scans.length - 1; i >= 0; i--) {
    const s = scans[i];
    if (!s.voided && s.action !== "revert") return i;
  }
  return -1;
}

// ── Pace colour coding ───────────────────────────────────────────────
// The three bands from the sketch (NORMAL / AVERAGE / SLOW), measured as the live rate
// against the preset's target rate.
export const PACE_LEVELS = [
  { key: "normal",  th: "ปกติ",   en: "NORMAL",  color: "#16a34a", min: 0.9 },
  { key: "average", th: "พอใช้",  en: "AVERAGE", color: "#d97706", min: 0.7 },
  { key: "slow",    th: "ช้า",    en: "SLOW",    color: "#dc2626", min: 0 },
] as const;
export type PaceLevel = (typeof PACE_LEVELS)[number];

export function paceMeta(rate: number, targetRate: number): PaceLevel {
  if (targetRate <= 0) return PACE_LEVELS[0];
  const ratio = rate / targetRate;
  return PACE_LEVELS.find((p) => ratio >= p.min) ?? PACE_LEVELS[2];
}

/** ตัว/ชม. from the elapsed run time. 0 until a full 30s has passed, so the first scan
 *  doesn't read as an absurd 3600/hr. */
export function ratePerHour(total: number, elapsedSec: number): number {
  if (elapsedSec < 30 || total === 0) return 0;
  return (total / elapsedSec) * 3600;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

export const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// ── Proposed backing tables (NOT created yet — this page is a mock-up) ────────────────
// Following the repo convention (DDL lives with the store, no sql/ folder):
//
//   create table if not exists qc_runs (
//     id uuid primary key default gen_random_uuid(),
//     station text not null default '',
//     inspector text not null default '',
//     order_id uuid,                              -- ผูกกับ product_costings เมื่อมี
//     order_code text not null default '',
//     product text not null default '',
//     color text not null default '',
//     size text not null default '',
//     target int not null default 0,
//     target_rate int not null default 0,
//     faults jsonb not null default '[]',         -- ชื่อตำหนิตามช่องบาร์โค้ด
//     started_at timestamptz,
//     closed_at timestamptz,                      -- null = ยังไม่ปิดงาน
//     record_mode text not null default '',       -- prelim | manual
//     created_at timestamptz not null default now()
//   );
//   create table if not exists qc_scans (
//     id uuid primary key default gen_random_uuid(),
//     run_id uuid not null references qc_runs(id) on delete cascade,
//     scanned_at timestamptz not null,            -- เวลาที่สแกนจริง (ไม่ใช่เวลาที่ซิงค์)
//     code text not null,
//     action text not null,                       -- pass | fault | revert
//     slot int,
//     voided boolean not null default false
//   );
//   create index if not exists qc_scans_run_idx on qc_scans (run_id, scanned_at);
