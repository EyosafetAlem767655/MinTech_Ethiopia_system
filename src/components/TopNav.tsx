"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActive } from "@/lib/nav";

/**
 * The desktop navigation: a top bar, shown only from `lg` up.
 *
 * The app was built for a phone and is used on one by everyone who files a
 * report. But it is read on a PC — and there the bottom tab bar is a strip
 * stranded at the foot of a 27-inch screen with a thumb nowhere near it. This
 * takes over above 1024px, where `BottomNav` hides itself.
 *
 * Deliberately the SAME seven destinations from the same list (src/lib/nav.ts),
 * so the two bars can never offer different answers about what the app contains.
 */
export default function TopNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav className="sticky top-0 z-40 hidden border-b border-clay-100 glass lg:block">
      <div className="app-shell flex items-center gap-6 px-6 py-2.5">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="font-display text-sm font-bold tracking-tight text-clay-900">MinTech</span>
        </Link>

        <div className="flex flex-1 items-center justify-end gap-1">
          {NAV_ITEMS.map((it) => {
            const active = isActive(pathname, it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all duration-300 ${
                  active ? "bg-white text-clay-800 shadow-sm" : "text-stone-500 hover:bg-white/60 hover:text-clay-700"
                }`}
              >
                <span className="text-sm leading-none">{it.icon}</span>
                {it.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
