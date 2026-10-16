/**
 * The monthly Production Hours Report — one photographed sheet, one row per
 * production line.
 *
 * This is the plant's own sheet ("Min-Tech p.l.c · Production Hours Report ·
 * August 2026"), so the system reads it in its own shape: for each line, the
 * hours (h:mm) and days spent working, stopped by a power interruption, stopped
 * for mechanical or electrical maintenance, stopped for want of raw material,
 * and the month's total. On a filled sheet the parts add up to the total —
 * 538:50 + 125:05 + 56:35 + 23:30 = 744:00, which is 31 days × 24 hours.
 *
 * The bot photographs the sheet, the model reads it into the block below, and
 * the person checks the block and sends it back. What is saved is the block as
 * sent back, never the read itself.
 *
 *     # Line | Working | Power | Mechanical | Electrical | Raw material | Total
 *     1 | 538:50 / 22.5 | 125:05 / 5.2 | 56:35 / 2.4 | 23:30 / 1 | - | 744 / 31
 *
 * Pure — no `sql` — so the bot, the review card, the panel and the tests share it.
 */

export const HOURS_KINDS = ["working", "power", "mech", "elec", "raw", "total"] as const;
export type HoursKind = (typeof HOURS_KINDS)[number];

/** The sheet's column headings. */
export const HOURS_LABEL: Record<HoursKind, string> = {
  working: "Working",
  power: "Power",
  mech: "Mechanical",
  elec: "Electrical",
  raw: "Raw material",
  total: "Total",
};

/** The four ways a line loses time — everything but working and the total. */
export const LOST_KINDS = ["power", "mech", "elec", "raw"] as const;

export interface HoursCell {
  minutes: number;
  days: number;
}

export interface ProductionHoursRow {
  line: number;
  cells: Record<HoursKind, HoursCell>;
}

/** The header line on the block. Lines starting with "#" are never data. */
export const HOURS_HEADER = `# Line | ${HOURS_KINDS.map((k) => HOURS_LABEL[k]).join(" | ")}`;

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const EMPTY = /^(-+|—|–|none|nil|0|)$/i;

/**
 * Hours as printed, in minutes: "538:50" → 32330, "744" → 44640, "12.5" → 750,
 * "-" → 0. Null when it is not a time at all.
 */
export function parseHours(raw: string): number | null {
  const t = String(raw ?? "").trim().replace(/\s+/g, "").replace(/h$/i, "");
  if (EMPTY.test(t)) return 0;
  const hm = t.match(/^(\d+)[:.;](\d{1,2})$/);
  // "125:05" is h:mm. "12.5" is ambiguous on paper; the sheet writes minutes
  // with a colon, so a dot followed by ONE digit is read as decimal hours.
  if (hm && (t.includes(":") || t.includes(";") || hm[2].length === 2)) {
    const m = Number(hm[2]);
    if (m >= 60) return null;
    return Number(hm[1]) * 60 + m;
  }
  if (/^\d*\.?\d+$/.test(t)) return Math.round(Number(t) * 60);
  return null;
}

/** Minutes back to the sheet's h:mm; "-" for none. */
export function fmtHours(minutes: number): string {
  if (!minutes) return "-";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}:${String(m).padStart(2, "0")}` : String(h);
}

const parseDays = (raw: string): number | null => {
  const t = String(raw ?? "").trim();
  if (EMPTY.test(t)) return 0;
  return /^\d*\.?\d+$/.test(t) ? Math.round(Number(t) * 100) / 100 : null;
};

/** "538:50 / 22.5", "744/31", "-" → a cell; null if unreadable. */
export function parseCell(raw: string): HoursCell | null {
  const t = String(raw ?? "").trim();
  if (EMPTY.test(t)) return { minutes: 0, days: 0 };
  const [h, d = ""] = t.split("/").map((p) => p.trim());
  const minutes = parseHours(h);
  const days = parseDays(d);
  if (minutes === null || days === null) return null;
  return { minutes, days };
}

export function cellText(c: HoursCell): string {
  if (!c.minutes && !c.days) return "-";
  return `${fmtHours(c.minutes)} / ${c.days || 0}`;
}

const emptyCells = (): Record<HoursKind, HoursCell> =>
  Object.fromEntries(HOURS_KINDS.map((k) => [k, { minutes: 0, days: 0 }])) as Record<HoursKind, HoursCell>;

export function emptyRow(line: number): ProductionHoursRow {
  return { line, cells: emptyCells() };
}

/** The block for a set of rows; no rows gives the header and three blank lines. */
export function hoursBlock(rows: ProductionHoursRow[]): string {
  const list = rows.length ? rows.slice().sort((a, b) => a.line - b.line) : [1, 2, 3].map(emptyRow);
  return [HOURS_HEADER, ...list.map((r) => [String(r.line), ...HOURS_KINDS.map((k) => cellText(r.cells[k]))].join(" | "))].join("\n");
}

/** Minutes lost: power + mechanical + electrical + raw material. */
export function lostMinutes(row: ProductionHoursRow): number {
  return LOST_KINDS.reduce((a, k) => a + row.cells[k].minutes, 0);
}

export interface ParsedHoursBlock {
  rows: ProductionHoursRow[];
  /** Lines that could not be read, each with why. Nothing is saved while any remain. */
  bad: string[];
  /** Figures that read but do not add up — shown on the card, not refused. */
  warnings: string[];
}

/** How far the parts may be from the total before it is pointed out. */
const SLACK_MINUTES = 30;

/**
 * Read the block back. Every line has to read before anything is saved: a
 * month with one line silently missing looks exactly like a smaller plant.
 * Figures that read but do not add up are WARNINGS, because the sheet itself
 * is the authority and it is the person holding it who can say which is right.
 */
export function parseHoursBlock(text: string, month: string): ParsedHoursBlock {
  const rows: ProductionHoursRow[] = [];
  const bad: string[] = [];
  const warnings: string[] = [];
  const monthMinutes = /^\d{4}-\d{2}$/.test(month) ? daysInMonth(month) * 24 * 60 : null;

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^line\s*\|/i.test(line)) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length !== HOURS_KINDS.length + 1) {
      bad.push(`${line} — needs ${HOURS_KINDS.length + 1} columns: line | ${HOURS_KINDS.map((k) => HOURS_LABEL[k]).join(" | ")}`);
      continue;
    }
    const n = Number(parts[0].replace(/^line\s*/i, ""));
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      bad.push(`${line} — the first column is the line number`);
      continue;
    }
    if (rows.some((r) => r.line === n)) {
      bad.push(`${line} — line ${n} is listed twice`);
      continue;
    }
    const cells = emptyCells();
    let broken = "";
    HOURS_KINDS.forEach((k, i) => {
      const c = parseCell(parts[i + 1]);
      if (!c) broken ||= `${HOURS_LABEL[k]} "${parts[i + 1]}"`;
      else cells[k] = c;
    });
    if (broken) {
      bad.push(`${line} — ${broken} is not "h:mm / days"`);
      continue;
    }
    const row: ProductionHoursRow = { line: n, cells };
    rows.push(row);

    const parts4 = cells.working.minutes + lostMinutes(row);
    if (cells.total.minutes && Math.abs(parts4 - cells.total.minutes) > SLACK_MINUTES) {
      warnings.push(`Line ${n}: the parts add up to ${fmtHours(parts4)} h, the total says ${fmtHours(cells.total.minutes)} h`);
    }
    if (monthMinutes && cells.total.minutes && Math.abs(cells.total.minutes - monthMinutes) > SLACK_MINUTES) {
      warnings.push(`Line ${n}: the total is ${fmtHours(cells.total.minutes)} h — the month has ${fmtHours(monthMinutes)} h`);
    }
  }

  if (rows.length === 0 && bad.length === 0) bad.push("No line rows — one row per production line is needed.");
  return { rows: rows.sort((a, b) => a.line - b.line), bad, warnings };
}

/* ───────────────────── the read, held cell by cell in the draft ───────────── */

/**
 * One draft key per cell: "ph:1:working" → "538:50 / 22.5".
 *
 * The read is shown on the review card and confirmed or corrected there, one
 * numbered field at a time ("4 = 540:00 / 22.5") — never as a block to copy,
 * edit and paste back. No ":" problem here: these are never tick-list step ids.
 */
export const cellKey = (line: number, kind: HoursKind) => `ph:${line}:${kind}`;

const CELL_KEY = /^ph:(\d+):(working|power|mech|elec|raw|total)$/;

export const isCellKey = (key: string) => CELL_KEY.test(key);

/** "Line 1 · Working (h / days)" — the field's name in the editor. */
export function cellKeyLabel(key: string): string | null {
  const m = key.match(CELL_KEY);
  return m ? `Line ${m[1]} · ${HOURS_LABEL[m[2] as HoursKind]} (h / days)` : null;
}

export function hasHoursCells(draft: Record<string, string | number>): boolean {
  return Object.keys(draft).some(isCellKey);
}

/** Write rows into the draft as cells, replacing any already there. */
export function setHoursCells(draft: Record<string, string | number>, rows: ProductionHoursRow[]): void {
  for (const k of Object.keys(draft)) if (isCellKey(k)) delete draft[k];
  for (const r of rows) for (const k of HOURS_KINDS) draft[cellKey(r.line, k)] = cellText(r.cells[k]);
}

/**
 * The rows the cells describe, and any cell that no longer reads (an edit
 * gone wrong is caught here, named, before anything is saved).
 */
export function rowsFromDraft(draft: Record<string, string | number>): { rows: ProductionHoursRow[]; bad: string[] } {
  const byLine = new Map<number, ProductionHoursRow>();
  const bad: string[] = [];
  for (const [key, value] of Object.entries(draft)) {
    const m = key.match(CELL_KEY);
    if (!m) continue;
    const line = Number(m[1]);
    const row = byLine.get(line) ?? emptyRow(line);
    const cell = parseCell(String(value));
    if (cell) row.cells[m[2] as HoursKind] = cell;
    else bad.push(`${cellKeyLabel(key)}: "${value}"`);
    byLine.set(line, row);
  }
  return { rows: [...byLine.values()].sort((a, b) => a.line - b.line), bad };
}

/** Validate one edited cell: the value to store, or why not. */
export function normaliseCell(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const c = parseCell(raw);
  return c ? { ok: true, value: cellText(c) } : { ok: false, error: 'ሰዓት / ቀን መሆን አለበት — ለምሳሌ "540:00 / 22.5" ወይም "-"' };
}

/** The same checks as the block (parts vs total, total vs month), on rows. */
export function hoursWarnings(rows: ProductionHoursRow[], month: string): string[] {
  return parseHoursBlock(hoursBlock(rows), month).warnings;
}
