"use client";

import { DEPARTMENT_KEYS, DEPARTMENTS, type DepartmentKey } from "@/lib/departments";

/** Top-level view: the owner brief, or one of the four departments. */
export type TopView = "brief" | DepartmentKey;

/**
 * The primary navigation for the home screen: the owner brief plus the four
 * departments. Department-first, with the brief kept as the landing overview.
 */
export default function DepartmentTabs({
  value,
  onChange,
}: {
  value: TopView;
  onChange: (view: TopView) => void;
}) {
  const items: { key: TopView; label: string; icon: string; accent?: string }[] = [
    { key: "brief", label: "Brief", icon: "☀️" },
    ...DEPARTMENT_KEYS.map((k) => ({
      key: k,
      label: DEPARTMENTS[k].name.split(" ")[0], // "Asset Management" → "Asset"
      icon: DEPARTMENTS[k].icon,
      accent: DEPARTMENTS[k].accent,
    })),
  ];

  return (
    <nav className="flex gap-1 rounded-2xl bg-white/95 p-1 shadow-[0_4px_24px_rgba(62,22,13,0.06)] animate-scale-in">
      {items.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            aria-current={active ? "page" : undefined}
            className={`flex-1 rounded-xl py-2 text-[10px] font-bold transition-all ${
              active
                ? t.key === "brief"
                  ? "bg-clay-700 text-white shadow-md shadow-clay-200"
                  : `${t.accent} text-white shadow-md`
                : "text-clay-500 hover:bg-clay-50"
            }`}
          >
            <span className="block text-sm leading-none mb-0.5">{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
