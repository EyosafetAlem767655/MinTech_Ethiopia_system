import sql from "@/lib/sql";

/**
 * The machines and cars things are taken out of the store for (migration 0043).
 *
 * Not a list anyone keeps: whatever was typed before is offered as a button,
 * most recent first, so the names settle into one spelling without a setup
 * screen. A new name is simply typed.
 */

/** Draft key the recent names are carried in, so the keyboards stay synchronous. */
export const MACHINES_KEY = "_machines";

/** "No machine" on a purchase request — PP bags and oil. */
export const NO_MACHINE = "none";

/** The names used most recently, across the store issues and the purchase requests. */
export async function recentMachines(limit = 12): Promise<string[]> {
  try {
    const rows = await sql<{ machine: string }[]>`
      select machine from (
        select machine, max(at) as at from (
          select trim(i.machine) as machine, i.created_at as at
            from store_issue_items i where coalesce(trim(i.machine), '') <> ''
          union all
          select trim(r.machine), r.created_at
            from purchase_requests r where coalesce(trim(r.machine), '') <> ''
        ) u group by machine
      ) m order by at desc limit ${limit}`;
    // One spelling per name, case aside.
    const seen = new Set<string>();
    return rows
      .map((r) => r.machine)
      .filter((m) => {
        const k = m.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") return [];
    throw e;
  }
}

export function decodeMachines(draft: Record<string, string | number>): string[] {
  try {
    const raw = draft[MACHINES_KEY];
    const parsed = typeof raw === "string" && raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** A typed name tidied: trimmed, spaces collapsed, and matched to a known spelling. */
export function normaliseMachine(raw: string, known: string[] = []): string {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  return known.find((k) => k.toLowerCase() === s.toLowerCase()) ?? s;
}
