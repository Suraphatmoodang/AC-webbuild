import type { NextApiRequest, NextApiResponse } from "next";
import { requireLeads } from "@/lib/api-guard";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Server side of lib/lead-store.ts. `customer_leads` is closed to the anon key by
// row level security (see lib/supabase-admin.ts), so every read and write lands here.
// Open to super AND the dedicated `leads` sales account, enforced by requireLeads — and to
// nobody else: leads hold customer names, phone numbers and LINE IDs, the most sensitive
// data in the app. An accessory or fabric admin gets a 403 here even though they hold a
// perfectly valid login token.
//
// Rows are returned RAW; lead-store's normalize() still shapes them on the client, so
// the JSONB/null guards stay in one visible place.

const PAGE = 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireLeads(req, res)) return;

  const db = supabaseAdmin();
  const { op, id, input, inputs } = (req.body ?? {}) as
    { op?: string; id?: string; input?: any; inputs?: any[] };

  try {
    switch (op) {
      case "list": {
        // Paged here rather than on the client so a big board is one request.
        const all: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await db
            .from("customer_leads")
            .select("*")
            .order("received_date", { ascending: false })
            .order("id", { ascending: false })   // unique tiebreaker → gap-free pagination
            .range(from, from + PAGE - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
        }
        return res.status(200).json({ data: all });
      }

      case "get": {
        const { data, error } = await db.from("customer_leads").select("*").eq("id", id).single();
        // Matches the store's old behaviour: a miss is null, not an error.
        return res.status(200).json({ data: error ? null : data });
      }

      case "add": {
        const { data, error } = await db.from("customer_leads").insert(input).select().single();
        if (error) throw error;
        return res.status(200).json({ data });
      }

      case "addBulk": {
        const rows = inputs ?? [];
        if (rows.length === 0) return res.status(200).json({ data: 0 });
        const CHUNK = 500;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const slice = rows.slice(i, i + CHUNK);
          const { error } = await db.from("customer_leads").insert(slice);
          if (error) throw error;
          inserted += slice.length;
        }
        return res.status(200).json({ data: inserted });
      }

      case "update": {
        const { data, error } = await db
          .from("customer_leads")
          .update({ ...input, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return res.status(200).json({ data });
      }

      case "delete": {
        const { error } = await db.from("customer_leads").delete().eq("id", id);
        if (error) throw error;
        return res.status(200).json({ data: null });
      }

      default:
        return res.status(400).json({ error: "op ไม่ถูกต้อง" });
    }
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "ดำเนินการไม่สำเร็จ" });
  }
}
