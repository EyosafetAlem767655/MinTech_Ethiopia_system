/**
 * The seven places the app goes.
 *
 * One list, two navigations: a bottom tab bar on a phone and a top bar on a
 * desktop. They are the same destinations in the same order, and keeping the
 * list here is what stops them drifting into two different answers to "what can
 * this app do" — which is exactly what happens when a second nav is added by
 * copying the first.
 *
 * Client-safe: no `sql`, no server imports.
 */

export interface NavItem {
  href: string;
  /** Full label, used by the top bar. */
  label: string;
  /** Abbreviated label for the phone's seven-across tab bar. */
  short: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Brief", short: "Brief", icon: "☀️" },
  { href: "/departments/production", label: "Production", short: "Prod", icon: "🏭" },
  { href: "/departments/asset_management", label: "Assets", short: "Assets", icon: "📦" },
  { href: "/departments/sales", label: "Sales", short: "Sales", icon: "🤝" },
  { href: "/departments/finance", label: "Finance", short: "Finance", icon: "💵" },
  { href: "/chat", label: "AI", short: "AI", icon: "💬" },
  { href: "/settings", label: "Settings", short: "Settings", icon: "⚙️" },
];

/**
 * Is this the section being viewed?
 *
 * "/" matches only itself — every path starts with it, so a prefix test would
 * light up Brief on every screen in the app.
 */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}
