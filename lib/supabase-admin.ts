import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Service-role Supabase client (SERVER ONLY — never import from a page) ────
//
// Companion to lib/supabase.ts. That one uses the ANON key, which ships inside the
// client bundle and is therefore public; this one uses the SERVICE ROLE key, which
// BYPASSES row level security and must never reach the browser.
//
// WHY IT EXISTS — three tables are locked at the database level:
//
//     alter table public.customer_leads   enable row level security;
//     alter table public.product_costings enable row level security;
//     alter table public.products         enable row level security;
//
// …with NO policies created for them. RLS on + no policy = the anon key can read
// nothing and write nothing, so leads (customer names, phone numbers, LINE IDs),
// order costings (quoted prices, real margins) and the product catalogue are no
// longer readable by anyone who opens devtools on the public /stock page. Every
// access to them now goes through pages/api/data/* using this client, authorised
// by the signed login token (lib/upload-token.ts).
//
// Rolling it back is `disable row level security` on the same three tables.
//
// The STOCK tables (accessories, fabrics, *_lots, *_transactions, *_imports,
// suppliers, fabric_suppliers) are deliberately NOT locked yet: their writes still
// go through the browser's anon key, so RLS there would need fully permissive
// policies — no gain. That is the next step, not this one.
//
// Requires env var SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API →
// service_role). NOT prefixed NEXT_PUBLIC_ — that would publish it and undo all
// of the above. With it unset we fail CLOSED: the API routes return 503 with a
// clear Thai message rather than silently falling back to the anon key.

let _admin: SupabaseClient | undefined;

export function adminConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function supabaseAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
      // No session to persist or refresh — this client is per-request and server-side.
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _admin;
}
