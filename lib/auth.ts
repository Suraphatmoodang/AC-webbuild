import { useEffect, useState } from "react";
import { useRouter } from "next/router";

// ── Roles ────────────────────────────────────────────────────────────
// Three accounts, defined by env vars (see pages/api/auth/login.ts):
//   acc    → the accessory system only
//   fabric → the fabric system only
//   super  → both
// "super" currently means exactly "can enter both sections" and nothing more —
// section admins have the same powers inside their own section. If you later want
// super-only abilities (deleting, managing users, …), add checks against
// `role === "super"` at those call sites; nothing else here needs to change.
//
// SECURITY NOTE: the session lives in sessionStorage, so a user with devtools can
// set their own role. This is a convenience gate, not a security boundary — the
// Supabase anon key is in the client bundle regardless, so anyone determined can
// reach the data directly. To make this real you'd move to signed HttpOnly cookies
// AND Supabase Auth + RLS policies. Everything below is deliberately confined to
// this file so that swap only touches one place.

export type Role = "acc" | "fabric" | "super";
export type Section = "acc" | "fabric";

const KEY_AUTH = "manage_auth";   // kept as-is so old sessions//pages don't break
const KEY_ROLE = "manage_role";

export const ROLE_LABELS: Record<Role, { th: string; en: string }> = {
  acc:    { th: "แอดมินอุปกรณ์", en: "Accessories admin" },
  fabric: { th: "แอดมินผ้า",     en: "Fabric admin" },
  super:  { th: "แอดมินสูงสุด",  en: "Super admin" },
};

// Landing page after login: a section admin goes straight into their section,
// the super admin gets the picker since they have a choice to make.
export const HOME_FOR: Record<Role, string> = {
  acc: "/manage",
  fabric: "/fabrics/manage",
  super: "/",
};

export function readRole(): Role | null {
  if (typeof window === "undefined") return null;
  if (sessionStorage.getItem(KEY_AUTH) !== "1") return null;
  const r = sessionStorage.getItem(KEY_ROLE);
  // A session from before roles existed has no role stored. Treat it as super so
  // an already-logged-in user isn't silently locked out mid-session.
  if (r === "acc" || r === "fabric" || r === "super") return r;
  return "super";
}

export function isAuthed(): boolean {
  return readRole() !== null;
}

// Can this role administer that section? Super can do both; a section admin only
// its own. Note the public pages (stock, history) don't call this at all.
export function roleCanAccess(role: Role | null, section: Section): boolean {
  if (role === null) return false;
  return role === "super" || role === section;
}

export function startSession(role: Role): void {
  sessionStorage.setItem(KEY_AUTH, "1");
  sessionStorage.setItem(KEY_ROLE, role);
}

export function endSession(): void {
  sessionStorage.removeItem(KEY_AUTH);
  sessionStorage.removeItem(KEY_ROLE);
}

// Gate for a protected page. Returns `authed` — render nothing until it's true.
//   not logged in           → /login
//   logged in, wrong section → /  (the picker, which explains what they can open)
// `authed` stays false during the redirect so the page never flashes its content.
export function useRequireRole(section: Section): { authed: boolean; role: Role | null } {
  const router = useRouter();
  const [state, setState] = useState<{ authed: boolean; role: Role | null }>({ authed: false, role: null });

  useEffect(() => {
    const role = readRole();
    if (role === null) { router.replace("/login"); return; }
    if (!roleCanAccess(role, section)) { router.replace("/?denied=" + section); return; }
    setState({ authed: true, role });
  }, [router, section]);

  return state;
}

// Gate for a page any logged-in admin may use, regardless of section.
// CURRENTLY UNUSED: suppliers was the only such page, but accessory and fabric
// suppliers are now separate tables and each page is section-scoped via
// useRequireRole. Kept for the next genuinely cross-section page; delete if none
// appears.
export function useRequireAuth(): { authed: boolean; role: Role | null } {
  const router = useRouter();
  const [state, setState] = useState<{ authed: boolean; role: Role | null }>({ authed: false, role: null });

  useEffect(() => {
    const role = readRole();
    if (role === null) { router.replace("/login"); return; }
    setState({ authed: true, role });
  }, [router]);

  return state;
}

// Read-only view of the session for pages that merely adapt their UI to it
// (e.g. the stock pages showing an "edit in manage" button). Re-reads on every
// route change so it updates right after login/logout.
export function useSession(): { role: Role | null; authed: boolean } {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    const check = () => setRole(readRole());
    check();
    router.events.on("routeChangeComplete", check);
    return () => router.events.off("routeChangeComplete", check);
  }, [router.events]);

  return { role, authed: role !== null };
}
