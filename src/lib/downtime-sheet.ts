import { HOURS_PER_DAY, REASON_LABEL, MAINTENANCE_LABEL, type DowntimeReason } from "@/lib/downtime";

/**
 * The monthly downtime sheet: one photographed page, one line per stoppage.
 *
 * Downtime used to be a typed form filed every day. The floor keeps it on a
 * monthly sheet anyway, so the bot now takes a photo of that sheet once a
 * month, the model reads it into the block below, and the person checks the
 * block and sends it back — corrected where the read was wrong. What is saved
 * is the block as sent back, never the read itself.
 *
 *     DD | hours | reason | note
 *     05 | 2.5   | maintenance-mechanical | belt changed
 *     12 | 1     | power
 *
 * Pure — no `sql` — so the bot, the review card and the tests share it.
 */

export interface DowntimeRow {
  /** Day of the month, 1–31. */
  day: number;
  hours: number;
  reason: DowntimeReason;
  maintenanceKind: "mechanical" | "electrical" | "both" | null;
  note: string;
}

/** The header line on the block. Lines starting with "#" are never data. */
export const DOWNTIME_HEADER = "# DD | hours | reason | note";

/**
 * Every way a reason is written, onto the stored pair. Loose on purpose: the
 * sheet is handwritten and the model copies it as printed.
 */
const REASONS: [RegExp, DowntimeReason, DowntimeRow["maintenanceKind"]][] = [
  [/^(maintenance|maint|mnt|ጥገና)[\s\-_/]*(mech|mechanical|ሜካኒካል)/i, "maintenance", "mechanical"],
  [/^(maintenance|maint|mnt|ጥገና)[\s\-_/]*(elec|electrical|ኤሌክትሪካል)/i, "maintenance", "electrical"],
  [/^(maintenance|maint|mnt|ጥገና)[\s\-_/]*(both|ሁለቱም)/i, "maintenance", "both"],
  [/^(mech|mechanical|ሜካኒካል)$/i, "maintenance", "mechanical"],
  [/^(elec|electrical|ኤሌክትሪካል)$/i, "maintenance", "electrical"],
  [/^(maintenance|maint|mnt|ጥገና)$/i, "maintenance", null],
  [/^(power|power cut|power interruption|outage|electricity|መብራት|ኃይል|የኃይል መቋረጥ)$/i, "power", null],
  [/^(raw[\s\-_]*material|raw|material|ጥሬ ዕቃ|ጥሬ)$/i, "raw_material", null],
];

export function parseReason(text: string): { reason: DowntimeReason; maintenanceKind: DowntimeRow["maintenanceKind"] } | null {
  const t = text.trim();
  for (const [re, reason, kind] of REASONS) if (re.test(t)) return { reason, maintenanceKind: kind };
  return null;
}

/** The reason as written back on the block: "maintenance-mechanical", "power", "raw-material". */
export function reasonToken(row: Pick<DowntimeRow, "reason" | "maintenanceKind">): string {
  if (row.reason === "maintenance") return row.maintenanceKind ? `maintenance-${row.maintenanceKind}` : "maintenance";
  return row.reason === "raw_material" ? "raw-material" : row.reason;
}

/** "Maintenance (mechanical)" — for the review card. */
export function reasonLabel(row: Pick<DowntimeRow, "reason" | "maintenanceKind">): string {
  const base = REASON_LABEL[row.reason] || row.reason;
  return row.reason === "maintenance" && row.maintenanceKind
    ? `${base} (${MAINTENANCE_LABEL[row.maintenanceKind] || row.maintenanceKind})`
    : base;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The block for a set of rows — empty rows give just the header. */
export function downtimeBlock(rows: DowntimeRow[]): string {
  return [
    DOWNTIME_HEADER,
    ...rows
      .slice()
      .sort((a, b) => a.day - b.day)
      .map((r) =>
        [String(r.day).padStart(2, "0"), String(r.hours), reasonToken(r), r.note].filter((p, i) => i < 3 || p).join(" | ")
      ),
  ].join("\n");
}

export interface ParsedDowntimeSheet {
  rows: DowntimeRow[];
  /** Lines that could not be read, each with why. */
  bad: string[];
  /** True when the block says there were no stoppages ("-"). */
  none: boolean;
}

/**
 * Read the block back. A line that fails is reported with its reason and
 * nothing from the block is saved until every line reads — a month half
 * recorded looks exactly like a month with fewer stoppages.
 */
export function parseDowntimeSheet(text: string, month: string): ParsedDowntimeSheet {
  const trimmed = text.trim();
  if (/^(-|--|none|no|የለም|ምንም)$/i.test(trimmed)) return { rows: [], bad: [], none: true };

  const maxDay = /^\d{4}-\d{2}$/.test(month) ? daysInMonth(month) : 31;
  const rows: DowntimeRow[] = [];
  const bad: string[] = [];

  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3) {
      bad.push(`${line} — needs day | hours | reason`);
      continue;
    }
    const day = Number(parts[0].replace(/^0+(?=\d)/, ""));
    const hours = Number(parts[1].replace(/[^0-9.]/g, ""));
    const reason = parseReason(parts[2]);
    if (!Number.isInteger(day) || day < 1 || day > maxDay) {
      bad.push(`${line} — day must be 1–${maxDay}`);
      continue;
    }
    if (!(hours > 0) || hours > HOURS_PER_DAY) {
      bad.push(`${line} — hours must be above 0 and at most ${HOURS_PER_DAY}`);
      continue;
    }
    if (!reason) {
      bad.push(`${line} — reason must be power, maintenance(-mechanical/-electrical/-both) or raw-material`);
      continue;
    }
    rows.push({ day, hours: Math.round(hours * 100) / 100, ...reason, note: parts.slice(3).join(" | ").trim() });
  }

  if (rows.length === 0 && bad.length === 0) bad.push('No stoppage lines — send "-" if there were none this month.');
  return { rows, bad, none: false };
}

/** Total hours stopped, rounded for display. */
export function totalHours(rows: DowntimeRow[]): number {
  return Math.round(rows.reduce((a, r) => a + r.hours, 0) * 100) / 100;
}
