"use client";

import { RANGES, type RangeKey } from "@/lib/ranges";

/**
 * "These reports arrived, they are just dated elsewhere."
 *
 * The one line that closes the gap between Settings → Submissions (sorted by
 * arrival) and a department panel (filtered by the date the work happened). It
 * names the dates rather than only counting them, because the first question
 * anyone asks of it is "which day did they put it on", and it carries the tap
 * that widens the window instead of making somebody guess which range to try.
 */
export default function LateReportsNotice({
  dates,
  widenTo,
  onWiden,
  noun = "report",
}: {
  /** The report dates, already outside the window on screen. */
  dates: string[];
  /** The range that would show them all. */
  widenTo: RangeKey;
  onWiden: () => void;
  noun?: string;
}) {
  if (dates.length === 0) return null;

  // At most four dates spelled out; past that the count carries it and the list
  // would be longer than the sentence it is inside.
  const shown = dates.slice(0, 4).map((d) =>
    new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  );
  const more = dates.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
      <span aria-hidden>⏳</span>
      <span>
        <b>
          {dates.length} {noun}
          {dates.length === 1 ? "" : "s"}
        </b>{" "}
        filed recently {dates.length === 1 ? "is" : "are"} dated outside this period — {shown.join(", ")}
        {more > 0 ? ` +${more} more` : ""}.
      </span>
      <button
        type="button"
        onClick={onWiden}
        className="rounded-full border border-amber-300 bg-white px-2 py-0.5 font-bold text-amber-800 transition hover:bg-amber-100"
      >
        Show in {RANGES[widenTo].label}
      </button>
    </div>
  );
}
