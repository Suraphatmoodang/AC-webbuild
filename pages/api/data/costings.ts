import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth, requireSuper } from "@/lib/api-guard";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Server side of lib/costing-store.ts' CRUD. `product_costings` is closed to the anon
// key by row level security (see lib/supabase-admin.ts) — it holds every order's cost,
// quoted price and real margin.
//
// TWO authorisation levels, and the split matters:
//   · everything that reads or writes a whole order → requireSuper, same as /costing.
//   · `activeOrders` → requireAuth (ANY logged-in role), because the order picker on
//     /transactions and /fabrics/transactions is used by the accessory and fabric
//     admins to tag a stock movement. Its projection is deliberately narrow — code,
//     customer, style/po, description, status, due date and NO cost or price column —
//     so an ops role can find an order without seeing what it earns.
//
// The other costing-store reads (getOrderFlows, getOrderActualMaterial,
// getPriceSources) only touch STOCK tables, which are not locked, so they stay on the
// browser's anon client and are not routed here.

const PAGE = 1000;

// ── Pre-migration resilience (moved here with the writes it protects) ───────
// `product_costings` has grown columns over time (actual_entries, images,
// actual_costing) and the ALTERs are applied BY HAND in Supabase (there is no sql/
// folder — see CLAUDE.md). Without this, every save breaks the moment code ships
// ahead of the migration. So: when Postgres rejects a write for an unknown column,
// drop that field from the payload and retry. The order still saves; only the
// not-yet-migrated field is lost. Bounded so it can't spin.
// The same failure reaches us worded two different ways, so match BOTH:
//   · PostgREST (PGRST204): Could not find the 'actual_costing' column of '…'
//   · Postgres (42703):     column "actual_costing" of relation "…" does not exist
function missingColumn(error: any): string | null {
  const msg = String(error?.message ?? "");
  const m = /could not find the '([^']+)' column/i.exec(msg)
    ?? /column "([^"]+)" of relation ".*" does not exist/i.exec(msg);
  return m ? m[1] : null;
}

async function writeCosting<T extends Record<string, any>>(
  payload: T,
  // PromiseLike, not Promise: a Supabase query builder is thenable but isn't a real Promise.
  run: (p: T) => PromiseLike<{ data: any; error: any }>,
): Promise<any> {
  let body = payload;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await run(body);
    if (!error) return data;
    const col = missingColumn(error);
    if (!col || !(col in body)) throw error;
    console.warn(`product_costings.${col} ยังไม่มีในฐานข้อมูล — บันทึกโดยข้ามคอลัมน์นี้ (ต้อง ALTER TABLE ก่อน)`);
    const { [col]: _drop, ...rest } = body as any;
    body = rest as T;
  }
  throw new Error("บันทึกไม่สำเร็จ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const op = (req.body ?? {}).op as string | undefined;

  // The picker op is the only one an ops role may call; everything else is super.
  const guard = op === "activeOrders" ? requireAuth(req, res) : requireSuper(req, res);
  if (!guard) return;

  const db = supabaseAdmin();
  const { id, input, inputs, images } = (req.body ?? {}) as
    { id?: string; input?: any; inputs?: any[]; images?: any };

  try {
    switch (op) {
      case "activeOrders": {
        // Narrow projection on purpose — see the header note. Status filtering and the
        // search label are built in the store, which is where they are read.
        const { data, error } = await db
          .from("product_costings")
          .select("id, code, customer, style_no, po_no, description, status, due_date")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return res.status(200).json({ data: data ?? [] });
      }

      case "list": {
        const all: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await db
            .from("product_costings")
            .select("*")
            .order("created_at", { ascending: false })
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
        const { data, error } = await db.from("product_costings").select("*").eq("id", id).single();
        // Matches the store's old behaviour: a miss is null, not an error.
        return res.status(200).json({ data: error ? null : data });
      }

      case "add": {
        const data = await writeCosting(input as Record<string, any>, (p) =>
          db.from("product_costings").insert(p).select().single());
        return res.status(200).json({ data });
      }

      case "addBulk": {
        const rows = inputs ?? [];
        if (rows.length === 0) return res.status(200).json({ data: 0 });
        const CHUNK = 500;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const slice = rows.slice(i, i + CHUNK);
          const { error } = await db.from("product_costings").insert(slice);
          if (error) throw error;
          inserted += slice.length;
        }
        return res.status(200).json({ data: inserted });
      }

      case "update": {
        const data = await writeCosting(
          { ...input, updated_at: new Date().toISOString() } as Record<string, any>,
          (p) => db.from("product_costings").update(p).eq("id", id).select().single());
        return res.status(200).json({ data });
      }

      case "setImages": {
        // Kept a separate op so a photo added mid-edit persists on its own and is never
        // overwritten by a form save (same reasoning as the store it replaces).
        const { error } = await db.from("product_costings").update({ images }).eq("id", id);
        if (error) {
          throw new Error(/images/i.test(error.message)
            ? "ยังไม่ได้เพิ่มคอลัมน์ images ในฐานข้อมูล — ติดต่อผู้ดูแลระบบ"
            : error.message);
        }
        return res.status(200).json({ data: null });
      }

      case "delete": {
        const { error } = await db.from("product_costings").delete().eq("id", id);
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
