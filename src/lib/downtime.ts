/**
 * Downtime: the working day, the reasons, and their wording.
 *
 * Lives apart from asset-flows.ts for the usual reason — that module imports
 * the Postgres client, and a dashboard panel asking only for a label would drag
 * the whole driver into the browser bundle.
 */

/**
 * The working day, in hours.
 *
 * Every percentage on the production tab and in the alert bar divides by this,
 * so it lives in one place: "4 hours down" means nothing until it is read
 * against the day it was lost from.
 */
export const HOURS_PER_DAY = 12;

export type DowntimeReason = "power" | "maintenance" | "raw_material";

/** The bot's buttons, bilingual like every other choice list. */
export const DOWNTIME_REASONS: { label: string; value: DowntimeReason }[] = [
  { label: "⚡ የኃይል መቋረጥ (Power)", value: "power" },
  { label: "🔧 ጥገና (Maintenance)", value: "maintenance" },
  { label: "🧱 ጥሬ ዕቃ (Raw material)", value: "raw_material" },
];

export const MAINTENANCE_KINDS = [
  { label: "⚙️ ሜካኒካል (Mechanical)", value: "mechanical" },
  { label: "⚡ ኤሌክትሪካል (Electrical)", value: "electrical" },
  { label: "🔁 ሁለቱም (Both)", value: "both" },
];

export const REASON_LABEL: Record<string, string> = {
  power: "Power interruption",
  maintenance: "Maintenance",
  raw_material: "Raw material",
};

export const MAINTENANCE_LABEL: Record<string, string> = {
  mechanical: "mechanical",
  electrical: "electrical",
  both: "mechanical and electrical",
};

/** "4.5 h · 38% of the day" — the one phrasing, used by the panel and the alert. */
export function downtimeShare(hours: number): string {
  const share = Math.round((hours / HOURS_PER_DAY) * 1000) / 10;
  return `${Math.round(hours * 100) / 100} h · ${share}% of the ${HOURS_PER_DAY}-hour day`;
}

/** "Maintenance (mechanical)" — the reason as a reader sees it. */
export function reasonText(reason: string, maintenanceKind?: string | null): string {
  const base = REASON_LABEL[reason] || reason;
  if (reason !== "maintenance" || !maintenanceKind) return base;
  return `${base} (${MAINTENANCE_LABEL[maintenanceKind] || maintenanceKind})`;
}
