import { supabase } from "./supabase";

// Customer leads (ลีดลูกค้า) — a FOURTH standalone section beside อุปกรณ์ / ผ้า / ต้นทุน.
// It is a sales pipeline, not inventory: one row per inbound enquiry (Facebook / Instagram /
// TikTok / LINE / Website / walk-in), moved through the shop's 8 stages until it is either
// won (ได้งาน) or lost (ไม่ได้งาน, with a reason kept for later analysis).
//
// The field set comes from the factory's own sheet (Customer_Lead_Tracking_Garment_Factory.xlsx)
// plus a conversation log (บันทึกการคุย) carried over from the lead-tracker prototype, stored
// as JSONB so notes need no extra table.
//
// "วันค้างติดตาม" (days overdue) is NOT a column — it is DERIVED from follow_up_date by
// daysOverdue(), the same "derive, don't store" rule used for stock/value and the costing price.
//
// Backing table — run in Supabase BEFORE deploying (no sql/ folder; see CLAUDE.md):
//
//   create extension if not exists "pgcrypto";
//   create table if not exists customer_leads (
//     id uuid primary key default gen_random_uuid(),
//     lead_code text not null default '',          -- LD-0001 (คงเลขจากชีตเดิม)
//     received_date date,                          -- วันที่รับเรื่อง
//     customer_name text not null default '',      -- ชื่อลูกค้า
//     company text not null default '',            -- บริษัท/องค์กร
//     channel text not null default '',            -- ช่องทาง
//     contact_link text not null default '',       -- Contact / Link (m.me/…, @ig)
//     line_id text not null default '',
//     phone text not null default '',
//     email text not null default '',
//     job_title text not null default '',          -- ตำแหน่ง
//     product_type text not null default '',       -- ประเภทสินค้า
//     qty text not null default '',                -- จำนวน (ตัว) — text: ชีตมีทั้ง "300" และ "300-500"
//     details text not null default '',            -- รายละเอียดเบื้องต้น
//     status text not null default 'new',          -- ดู LEAD_STATUSES
//     owner text not null default '',              -- ผู้รับผิดชอบ
//     last_contact_date date,                      -- วันที่ติดต่อล่าสุด
//     follow_up_date date,                         -- วันที่ติดตามครั้งถัดไป
//     priority text not null default '',           -- สูง | กลาง | ต่ำ
//     appointment_date date,                       -- วันที่นัดหมาย
//     merchandiser text not null default '',
//     target_price text not null default '',       -- งบ/ราคาเป้าหมาย (ต่อตัว)
//     lost_reason text not null default '',        -- เหตุผลไม่ได้งาน
//     subcontract boolean not null default false,  -- งานซับคอนแทรค (รับช่วงผลิตต่อ)
//     note text not null default '',               -- หมายเหตุ
//     log jsonb not null default '[]',             -- บันทึกการคุย [{ts,text}]
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now()
//   );
//   create index if not exists customer_leads_status_idx on customer_leads (status);
//   create index if not exists customer_leads_follow_idx on customer_leads (follow_up_date);
//
// If the table was already created before งานซับคอนแทรค existed, add just the column:
//   alter table customer_leads add column if not exists subcontract boolean not null default false;

// ── Pipeline stages ──────────────────────────────────────────────────
// The shop's stages, in board order (คู่มือใช้งาน sheet, minus ประเมินราคา which they don't use):
//   ลูกค้าใหม่ → รอติดต่อกลับ → กำลังคุย → นัดหมาย → ส่งต่อเมอร์ → ได้งาน / ไม่ได้งาน
// `key` is what's stored; `th` is what's shown. Stored as a key (not the Thai label) so renaming
// a label later never orphans existing rows.
export const LEAD_STATUSES = [
  { key: "new",       th: "ลูกค้าใหม่",   color: "#64748b" },
  { key: "callback",  th: "รอติดต่อกลับ", color: "#d97706" },
  { key: "talking",   th: "กำลังคุย",     color: "#2563eb" },
  { key: "appointed", th: "นัดหมาย",      color: "#7c3aed" },
  { key: "handoff",   th: "ส่งต่อเมอร์",  color: "#0f766e" },
  { key: "won",       th: "ได้งาน",       color: "#16a34a" },
  { key: "lost",      th: "ไม่ได้งาน",    color: "#dc2626" },
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number]["key"];
export function statusMeta(key: string) {
  return LEAD_STATUSES.find((s) => s.key === key) ?? LEAD_STATUSES[0];
}
// Stages that are finished — excluded from "ยังเปิดอยู่" counts and the follow-up warning.
export const CLOSED_STATUSES: string[] = ["won", "lost"];
export const isClosed = (status: string) => CLOSED_STATUSES.includes(status);

// ── Dropdown lists ───────────────────────────────────────────────────
// Fixed constants for now (user's choice). They live HERE and nowhere else — every page reads
// these — so moving them into a config table later is a change to this file plus a loader,
// not a hunt through JSX. Values match the xlsx's "Lists" sheet.
export const LEAD_CHANNELS = ["Facebook", "Instagram", "TikTok", "LINE", "Website", "โทรศัพท์", "Walk-in", "อื่นๆ"];
export const LEAD_OWNERS = ["อี่อี๊", "แอ๋ม", "เหลง", "ยุ้ย", "เอม"];
export const LEAD_PRIORITIES = ["สูง", "กลาง", "ต่ำ"];
export const LEAD_PRODUCT_TYPES = ["เสื้อโปโล", "เสื้อยืด", "เสื้อเชิ้ต", "กางเกง", "ชุดยูนิฟอร์ม", "ชุดเด็ก", "ชุดกีฬา", "อื่นๆ"];
export const LOST_REASONS = ["ราคา", "MOQ ไม่ถึง", "Lead time ไม่ทัน", "แบบผลิตไม่ได้", "ลูกค้าเงียบ", "คู่แข่ง", "ยกเลิกโครงการ", "อื่นๆ"];

// ── Types ────────────────────────────────────────────────────────────
// One entry in บันทึกการคุย. `ts` is a local "YYYY-MM-DDTHH:mm" stamp (matching the prototype),
// newest first.
export type LeadLogEntry = { ts: string; text: string };

export type Lead = {
  id: string;
  lead_code: string;
  received_date: string | null;
  customer_name: string;
  company: string;
  channel: string;
  contact_link: string;
  line_id: string;
  phone: string;
  email: string;
  job_title: string;
  product_type: string;
  qty: string;
  details: string;
  status: string;
  owner: string;
  last_contact_date: string | null;
  follow_up_date: string | null;
  priority: string;
  appointment_date: string | null;
  merchandiser: string;
  target_price: string;
  lost_reason: string;
  subcontract: boolean;      // งานซับคอนแทรค — เรารับช่วงผลิตต่อจากโรงงาน/แบรนด์อื่น
  note: string;
  log: LeadLogEntry[];
  created_at: string;
  updated_at: string;
};

export type LeadInput = Omit<Lead, "id" | "created_at" | "updated_at">;

export const todayISO = () => new Date().toISOString().slice(0, 10);
// Local (not UTC) "YYYY-MM-DDTHH:mm" — a log stamped 01:00 Bangkok must not read as the day before.
export function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function emptyLeadInput(over: Partial<LeadInput> = {}): LeadInput {
  return {
    lead_code: "", received_date: todayISO(), customer_name: "", company: "",
    channel: LEAD_CHANNELS[0], contact_link: "", line_id: "", phone: "", email: "", job_title: "",
    product_type: "", qty: "", details: "", status: LEAD_STATUSES[0].key, owner: "",
    last_contact_date: todayISO(), follow_up_date: null, priority: "", appointment_date: null,
    merchandiser: "", target_price: "", lost_reason: "", subcontract: false, note: "", log: [],
    ...over,
  };
}

// ── Derived follow-up state (never stored) ───────────────────────────
// วันค้างติดตาม = whole days between the follow-up date and today. >0 overdue, 0 due today,
// <0 still upcoming. Closed leads never count as due — they need no chasing.
export function daysOverdue(date: string | null): number | null {
  if (!date) return null;
  const due = Date.parse(date + "T00:00:00");
  if (isNaN(due)) return null;
  const today = Date.parse(todayISO() + "T00:00:00");
  return Math.round((today - due) / 86400000);
}
export function isDue(lead: { follow_up_date: string | null; status: string }): boolean {
  if (isClosed(lead.status)) return false;
  const d = daysOverdue(lead.follow_up_date);
  return d !== null && d >= 0;
}

// Next lead code, continuing the sheet's LD-0001 series. Derived from the highest existing
// number so imported rows and hand-added ones share one sequence.
export function nextLeadCode(leads: { lead_code: string }[]): string {
  const max = leads.reduce((m, l) => {
    const n = /^LD-(\d+)$/.exec((l.lead_code || "").trim());
    return n ? Math.max(m, parseInt(n[1], 10)) : m;
  }, 0);
  return `LD-${String(max + 1).padStart(4, "0")}`;
}

// ── Duplicate leads ──────────────────────────────────────────────────
// The same person often messages twice (a second FB thread, a re-enquiry a week later), and the
// board silently ends up with two cards nobody links. Duplicates are NOT blocked — sometimes they
// are legitimate — only flagged: a red outline while typing and a confirm that can be waved past.
//
// Matched on ชื่อ OR เบอร์โทร OR LINE ID. The name alone is weak evidence (two customers really
// are both "คุณเมย์") while a repeated phone/LINE is near-proof, so all three are checked and the
// warning names which one hit.
//
// CLOSED leads are skipped entirely: a customer who came back months after ได้งาน/ไม่ได้งาน is a
// NEW enquiry, not a mistake, and warning about it every time would train everyone to ignore the
// warning that matters.
export const normName = (v: string) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
// Digits only — 08-1234-5678, 081 234 5678 and 0812345678 are one number. Short/partial entries
// are ignored (a stray "08" must not match every phone on the board).
const normPhone = (v: string) => (v ?? "").replace(/\D/g, "");
const normId = (v: string) => (v ?? "").trim().toLowerCase().replace(/^@/, "");

export type DupField = "name" | "phone" | "line";
export const DUP_FIELD_TH: Record<DupField, string> = { name: "ชื่อ", phone: "เบอร์โทร", line: "LINE ID" };
export type LeadDup<T> = { lead: T; on: DupField[] };

type DupProbe = { customer_name?: string; phone?: string; line_id?: string };
type DupRow = { id?: string; customer_name: string; phone: string; line_id: string; status: string };

export function findLeadDuplicates<T extends DupRow>(
  leads: T[], probe: DupProbe, exceptId?: string | null,
): LeadDup<T>[] {
  const name = normName(probe.customer_name ?? "");
  const phone = normPhone(probe.phone ?? "");
  const line = normId(probe.line_id ?? "");
  const hits: LeadDup<T>[] = [];
  for (const l of leads) {
    if (l.id === exceptId || isClosed(l.status)) continue;
    const on: DupField[] = [];
    if (name && normName(l.customer_name) === name) on.push("name");
    if (phone.length >= 8 && normPhone(l.phone) === phone) on.push("phone");
    if (line.length >= 3 && normId(l.line_id) === line) on.push("line");
    if (on.length) hits.push({ lead: l, on });
  }
  return hits;
}

// The confirm dialog's body: which leads, where they sit, and what matched.
export function duplicateSummary(dups: LeadDup<{ lead_code: string; status: string }>[]): string {
  return dups
    .slice(0, 4)
    .map((d) => `• ${d.lead.lead_code || "(ไม่มีรหัส)"} — ${statusMeta(d.lead.status).th} (ตรงกันที่${d.on.map((f) => DUP_FIELD_TH[f]).join(" / ")})`)
    .join("\n") + (dups.length > 4 ? `\n• …อีก ${dups.length - 4} รายการ` : "");
}

// ── CRUD ─────────────────────────────────────────────────────────────
// Stores throw; pages catch and notify (the convention across this app).

export async function getLeads(): Promise<Lead[]> {
  const all: Lead[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("customer_leads")
      .select("*")
      .order("received_date", { ascending: false })
      .order("id", { ascending: false })   // unique tiebreaker → gap-free pagination
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Lead[]).map(normalize));
    if (data.length < PAGE) break;
  }
  return all;
}

// `log` is JSONB — guard against null/garbage so the UI can always map over it.
// `subcontract` is coerced too: rows inserted before the column existed read back as null.
function normalize(row: any): Lead {
  return { ...row, log: Array.isArray(row.log) ? row.log : [], subcontract: !!row.subcontract } as Lead;
}

export async function getLead(id: string): Promise<Lead | null> {
  const { data, error } = await supabase.from("customer_leads").select("*").eq("id", id).single();
  if (error) return null;
  return normalize(data);
}

export async function addLead(input: LeadInput): Promise<Lead> {
  const { data, error } = await supabase.from("customer_leads").insert(input).select().single();
  if (error) throw error;
  return normalize(data);
}

export async function addLeadsBulk(inputs: LeadInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < inputs.length; i += CHUNK) {
    const slice = inputs.slice(i, i + CHUNK);
    const { error } = await supabase.from("customer_leads").insert(slice);
    if (error) throw error;
    inserted += slice.length;
  }
  return inserted;
}

export async function updateLead(id: string, input: Partial<LeadInput>): Promise<Lead> {
  const { data, error } = await supabase
    .from("customer_leads")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return normalize(data);
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase.from("customer_leads").delete().eq("id", id);
  if (error) throw error;
}
