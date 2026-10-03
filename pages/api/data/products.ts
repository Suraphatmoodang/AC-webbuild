import type { NextApiRequest, NextApiResponse } from "next";
import { requireSuper } from "@/lib/api-guard";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Server side of lib/product-store.ts — the reusable garment-spec catalogue.
// `products` is closed to the anon key by row level security; super-only, same gate
// as the /costing section it belongs to.

const PAGE = 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireSuper(req, res)) return;

  const db = supabaseAdmin();
  const { op, id, input, activeOnly } = (req.body ?? {}) as
    { op?: string; id?: string; input?: any; activeOnly?: boolean };

  try {
    switch (op) {
      case "list": {
        const all: any[] = [];
        for (let from = 0; ; from += PAGE) {
          let q = db.from("products").select("*")
            .order("style_no").order("product_type").order("id")   // unique tiebreaker → gap-free pagination
            .range(from, from + PAGE - 1);
          if (activeOnly) q = q.eq("is_active", true);
          const { data, error } = await q;
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
        }
        return res.status(200).json({ data: all });
      }

      case "add": {
        const { data, error } = await db.from("products").insert(input).select().single();
        if (error) throw error;
        return res.status(200).json({ data });
      }

      case "update": {
        const { data, error } = await db
          .from("products")
          .update({ ...input, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return res.status(200).json({ data });
      }

      case "delete": {
        const { error } = await db.from("products").delete().eq("id", id);
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
