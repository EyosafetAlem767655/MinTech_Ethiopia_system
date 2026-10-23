/**
 * The three dashboard roles, and what each may do.
 *
 * Client-safe (no database): the middleware, the API routes and the panels all
 * read the same rules from here, so a button hidden in the UI is a request the
 * server would refuse anyway — never the other way round.
 */

export type Role = "super" | "chief" | "hr";

export const ROLE_LABEL: Record<Role, string> = {
  super: "Super Admin",
  chief: "Chief Manager",
  hr: "HR Manager",
};

export const isRole = (v: unknown): v is Role => v === "super" || v === "chief" || v === "hr";

/** Changes data at all: edit, decide, record, register. HR is view-only. */
export const canEdit = (role: Role) => role !== "hr";

/** Deletes a submission, a payment, a bot user — or purges. Super Admin only. */
export const canDelete = (role: Role) => role === "super";

/** Creates, revokes and resets dashboard accounts. Super Admin only. */
export const canManageWebUsers = (role: Role) => role === "super";

/** The system pages: Errors, Devices, purge and the admin tools. Super Admin only. */
export const canSeeSystem = (role: Role) => role === "super";

/**
 * Write requests a view-only HR Manager may still make: asking the AI,
 * exporting, logging out. Matched as path prefixes.
 */
export const HR_WRITE_ALLOWED = ["/api/chat", "/api/export", "/api/logout"];

/** API paths only the Super Admin may reach, whatever the method. */
export const SUPER_ONLY_API = ["/api/web-users", "/api/web-sessions", "/api/errors", "/api/admin"];

/**
 * What a role may not do, as the reason to show — or null when allowed.
 *
 * Enforced HERE, on every request, so a button hidden in the UI is never the
 * only thing standing between a view-only account and a change.
 */
export function roleDenies(role: Role, method: string, pathname: string): string | null {
  if (role === "super") return null;
  if (SUPER_ONLY_API.some((p) => pathname.startsWith(p))) return "Only the Super Admin can do that.";
  const write = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (!write || !pathname.startsWith("/api/")) return null;
  if (!canEdit(role) && !HR_WRITE_ALLOWED.some((p) => pathname.startsWith(p))) {
    return "This account is view-only.";
  }
  if (method === "DELETE" && !canDelete(role)) return "Only the Super Admin can delete.";
  return null;
}
