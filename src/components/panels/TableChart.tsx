"use client";

import { ResponsiveContainer } from "recharts";

/**
 * The chart frame and the bounded scrolling table shared by the production and
 * stock panels.
 *
 * They were one component until the stock section moved to Asset Management,
 * and these four pieces went with it. Copied they would have been two sets of
 * axis ticks and two table chromes that drift apart a tweak at a time — the
 * same trap as the four hand-maintained copies of the department labels.
 */

/* Validated against the light chart surface: tick contrast, and axes that
   recede far enough not to compete with the series. */
export const AXIS = {
  tick: { fontSize: 10, fill: "#a8a29e" },
  tickLine: false,
  axisLine: false,
} as const;

export const TOOLTIP = {
  borderRadius: 12,
  border: "1px solid #f3e3dd",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(62,22,13,0.12)",
} as const;

export function Chart({
  empty,
  emptyLabel,
  children,
}: {
  empty: boolean;
  emptyLabel: string;
  children: React.ReactElement;
}) {
  if (empty) return <p className="card p-6 text-center text-sm text-stone-400">{emptyLabel}</p>;
  return (
    <div className="card p-3">
      <div className="-ml-2 h-52">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * A table that scrolls in both directions inside a bounded box, so a long period
 * never stretches the page. The header and the totals row stay put while the
 * rows move between them.
 */
export function ScrollTable({
  minWidth,
  empty,
  emptyLabel,
  children,
}: {
  minWidth: number;
  empty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  if (empty) return <p className="card p-4 text-sm text-stone-400">{emptyLabel}</p>;
  return (
    <div className="card max-h-[26rem] overflow-auto p-0">
      <table className="w-full text-right text-xs" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}
