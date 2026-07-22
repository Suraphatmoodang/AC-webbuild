import { useEffect, useState } from "react";
import { useRouter } from "next/router";

// ── Roles ────────────────────────────────────────────────────────────
// Four accounts, defined by env vars (see pages/api/auth/login.ts):
//   acc    → day-to-day ops on the ACCESSORY side only
//   fabric → day-to-day ops on the FABRIC side only
//   audit  → ops on BOTH sides (for stock auditing), but no admin duties
//   super  → everything
//
// Access is decided on TWO axes, not one — a role alone is not enough:
//   section: "acc" | "fabric"   — which inventory the page belongs to
//   area:    "ops" | "admin"    — what kind of work the page does
//     ops   = transactions + suppliers  (daily stock work)
//     admin = manage, import, import-review, stock-update, admin-log
//
// Public pages (/, /stock, /history, /fabrics, /fabrics/history) declare NO area
// and are never gated — viewing stock must stay open to non-admin staff, and the
// login prompt should only appear when someone opens a gated page.
//
// SECURITY NOTE: the session lives in sessionStorage, so a user with devtools can
// set their own role. This is a convenience gate, not a security boundary — the
// Supabase anon key is in the client bundle regardless, so anyone determined can
// reach the data directly. To make this real you'd move to signed HttpOnly cookies
// AND Supabase Auth + RLS policies. Everything below is deliberately confined to
// this file so that swap only touches one place.

export type Role = "acc" | "fabric" | "audit" | "super";
export type Section = "acc" | "fabric";
export type Area = "ops" | "admin";

const KEY_AUTH = "manage_auth";   // kept as-is so old sessions//pages don't break
const KEY_ROLE = "manage_role";
const KEY_VER  = "manage_session_v";

// ── SESSION FLUSH ────────────────────────────────────────────────────
// BUMP THIS NUMBER to force EVERY open session to log in again.
//
// Why it's needed: a session is just a flag in sessionStorage and is never
// re-validated against the server, so changing the env-var passwords only blocks
// NEW logins — anyone already signed in stays signed in until they close the tab.
// Bumping this stamps a new version that old sessions don't carry, so readRole()
// rejects them on the very next page load.
//
// Use when a password leaks or an account is shared. Deploy after bumping —
// the flush takes effect as users load the new bundle.
//
// History:
//   1 → original (implicit; sessions before this feature carry no version)
//   2 → 2026-07-22, shared-account password reset
const SESSION_VERSION = "2";

export const ROLE_LABELS: Record<Role, { th: string; en: string }> = {
  acc:    { th: "แอดมินอุปกรณ์", en: "Accessories admin" },
  fabric: { th: "แอดมินผ้า",     en: "Fabric admin" },
  audit:  { th: "ผู้ตรวจสอบ",     en: "Auditor" },
  super:  { th: "แอดมินสูงสุด",  en: "Super admin" },
};

// Landing page after login. Section admins go straight to their own transactions
// page (their main daily job); audit spans both sides and super has a choice, so
// both get the picker. NOTE: manage/ is super-only now, so no role lands there
// except super, who picks from the home page anyway.
export const HOME_FOR: Record<Role, string> = {
  acc: "/transactions",
  fabric: "/fabrics/transactions",
  audit: "/",
  super: "/",
};

export function readRole(): Role | null {
  if (typeof window === "undefined") return null;
  if (sessionStorage.getItem(KEY_AUTH) !== "1") return null;
  // Session flush: anything stamped with an older SESSION_VERSION (or none at all,
  // i.e. issued before this check existed) is dead. Clear it so the user lands on
  // the login page cleanly instead of half-authenticated.
  if (sessionStorage.getItem(KEY_VER) !== SESSION_VERSION) {
    endSession();
    return null;
  }
  const r = sessionStorage.getItem(KEY_ROLE);
  // Version matches but the role is unreadable — treat as super rather than lock
  // someone out mid-session. (Can only happen if storage was hand-edited.)
  if (r === "acc" || r === "fabric" || r === "audit" || r === "super") return r;
  return "super";
}

export function isAuthed(): boolean {
  return readRole() !== null;
}

// THE access rule — every gate goes through here.
//   super            → everything
//   admin area       → super ONLY (manage / import / import-review / updater / log)
//   ops + audit      → both sections (auditing spans the whole factory)
//   ops + acc|fabric → own section only
export function roleCan(role: Role | null, section: Section, area: Area): boolean {
  if (role === null) return false;
  if (role === "super") return true;
  if (area === "admin") return false;
  if (role === "audit") return true;
  return role === section;
}


export function startSession(role: Role): void {
  sessionStorage.setItem(KEY_AUTH, "1");
  sessionStorage.setItem(KEY_ROLE, role);
  sessionStorage.setItem(KEY_VER, SESSION_VERSION);   // stamp, so a later bump kills it
}

export function endSession(): void {
  sessionStorage.removeItem(KEY_AUTH);
  sessionStorage.removeItem(KEY_ROLE);
  sessionStorage.removeItem(KEY_VER);
}

// Gate for a protected page. Returns `authed` — render nothing until it's true.
//   not logged in                → /login   (this is the ONLY auto-prompt; public
//                                            pages never call this, so viewing
//                                            stock never asks anyone to log in)
//   logged in, insufficient role → /?denied=<section>  (the picker explains it)
// `authed` stays false during the redirect so the page never flashes its content.
export function useRequireAccess(section: Section, area: Area): { authed: boolean; role: Role | null } {
  const router = useRouter();
  const [state, setState] = useState<{ authed: boolean; role: Role | null }>({ authed: false, role: null });

  useEffect(() => {
    const role = readRole();
    if (role === null) { router.replace("/login"); return; }
    if (!roleCan(role, section, area)) { router.replace("/?denied=" + section); return; }
    setState({ authed: true, role });
  }, [router, section, area]);

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
