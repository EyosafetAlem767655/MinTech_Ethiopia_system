"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Brief", icon: "☀️" },
  { href: "/departments/production", label: "Prod", icon: "🏭" },
  { href: "/departments/asset_management", label: "Assets", icon: "📦" },
  { href: "/departments/sales", label: "Sales", icon: "🤝" },
  { href: "/departments/finance", label: "Finance", icon: "💵" },
  { href: "/chat", label: "AI", icon: "💬" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function BottomNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 glass border-t border-clay-100 pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-lg mx-auto grid grid-cols-7">
        {items.map((it) => {
          const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href));
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-all duration-300 ${
                active ? "text-clay-700 scale-105" : "text-stone-400 hover:text-clay-500"
              }`}
            >
              <span className={`text-base leading-none ${active ? "drop-shadow-[0_2px_6px_rgba(198,77,48,0.4)]" : ""}`}>
                {it.icon}
              </span>
              {it.label}
              <span
                className={`h-1 w-1 rounded-full bg-clay-600 transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
