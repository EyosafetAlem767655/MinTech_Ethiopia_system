import sql, { jsonb } from "@/lib/sql";

export interface ParsedDayEntry {
  dateLabel: string;
  date: Date;
  delivered: Record<string, number>;
  received: Record<string, number>;
  stock: Record<string, number>;
  bags: { kg25: Record<string, number>; kg40: Record<string, number> };
}

type Section = "delivered" | "received" | "stock" | "bags25" | "bags40" | null;

function parseDateLabel(raw: string): { label: string; date: Date } | null {
  const cleaned = raw.trim();
  // Range like "13-14/4/2026" → use first day
  const rangeMatch = cleaned.match(/^(\d{1,2})-\d{1,2}\/(\d{1,2})\/(\d{4})$/);
  if (rangeMatch) {
    const [, day, month, year] = rangeMatch;
    return {
      label: cleaned,
      date: new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))),
    };
  }
  // Single date "31/3/2026"
  const singleMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (singleMatch) {
    const [, day, month, year] = singleMatch;
    return {
      label: cleaned,
      date: new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))),
    };
  }
  return null;
}

function extractKV(line: string): [string, number][] {
  const pairs: [string, number][] = [];
  // Match digit-prefixed codes (2EL, 3EL, 5EL) AND standard codes (ETL9, EC15, White)
  const re = /([A-Za-z0-9]+)\s*=\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const key = m[1].trim();
    if (!/[A-Za-z]/.test(key)) continue; // skip pure-numeric keys
    const val = parseFloat(m[2]);
    if (!isNaN(val)) pairs.push([key, val]);
  }
  return pairs;
}

export function parseOpsReportText(text: string): ParsedDayEntry[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entriesMap = new Map<string, ParsedDayEntry>();
  let currentLabel: string | null = null;
  let section: Section = null;

  for (const line of lines) {
    const dateInfo = parseDateLabel(line);
    if (dateInfo) {
      currentLabel = dateInfo.label;
      if (!entriesMap.has(currentLabel)) {
        entriesMap.set(currentLabel, {
          dateLabel: currentLabel,
          date: dateInfo.date,
          delivered: {},
          received: {},
          stock: {},
          bags: { kg25: {}, kg40: {} },
        });
      }
      section = null;
      continue;
    }

    if (!currentLabel) continue;
    const entry = entriesMap.get(currentLabel)!;

    if (/^delivered/i.test(line)) { section = "delivered"; continue; }
    if (/^received/i.test(line)) { section = "received"; continue; }
    if (/^stock/i.test(line)) { section = "stock"; continue; }
    if (/25\s*kg\s*bag/i.test(line)) { section = "bags25"; continue; }
    if (/40\s*kg\s*bag/i.test(line)) { section = "bags40"; continue; }

    const pairs = extractKV(line);
    if (pairs.length === 0 || section === null) continue;

    for (const [key, val] of pairs) {
      switch (section) {
        case "delivered": entry.delivered[key] = val; break;
        case "received": entry.received[key] = val; break;
        case "stock": entry.stock[key] = val; break;
        case "bags25": entry.bags.kg25[key] = val; break;
        case "bags40": entry.bags.kg40[key] = val; break;
      }
    }
  }

  return Array.from(entriesMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function isOpsReportText(text: string): boolean {
  const hasDate = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(text);
  const hasSection = /\b(Delivered|Received|Stock)\s*[-–]?/i.test(text);
  const hasProduct = /(?:\b|\d)(ETL|EL|EC|Talk)\w*\s*=/i.test(text);
  return hasDate && (hasSection || hasProduct);
}

/**
 * The canonical `date_label` for a day: d/m/yyyy with NO leading zeros.
 *
 * Must match what `parseDateLabel` produces from a pasted report, or the guided
 * production flow and the paste would land on different sides of the unique
 * index and create two rival rows for the same day.
 */
export function opsDateLabel(date: Date): string {
  return `${date.getUTCDate()}/${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`;
}

/**
 * Merge one day's figures into its `daily_ops_reports` row.
 *
 * Shared by the pasted ops report and the guided production flow, so both write
 * the day the same way. Any section passed as `{}` leaves the stored one
 * untouched, which is what lets the guided flow contribute stock and bags
 * without disturbing delivered/received that only the paste carries.
 */
export async function upsertOpsDay(entry: {
  dateLabel: string;
  date: Date;
  reportedBy: string;
  delivered?: Record<string, number>;
  received?: Record<string, number>;
  stock?: Record<string, number>;
  bags?: Record<string, Record<string, number>>;
  rawText?: string;
}): Promise<{ inserted: boolean }> {
  // The Mongo version did findOne → merge in JS → markModified ×4 → save,
  // a check-then-act race guarded only by the unique index. Here the merge is
  // a single atomic statement: `||` concatenates jsonb, so a section absent
  // from this paste ('{}') leaves the stored one untouched, which reproduces
  // the old "only overwrite sections present in the new entry" rule.
  const bags: Record<string, unknown> = {};
  for (const [size, inner] of Object.entries(entry.bags || {})) {
    if (inner && Object.keys(inner).length) bags[size] = inner;
  }

  const [row] = await sql<{ inserted: boolean }[]>`
    insert into daily_ops_reports
      (date_label, date, reported_by, delivered, received, stock, bags, raw_text, source)
    values
      (${entry.dateLabel}, ${entry.date}, ${entry.reportedBy},
       ${jsonb(entry.delivered || {})}, ${jsonb(entry.received || {})}, ${jsonb(entry.stock || {})},
       ${jsonb(bags)}, ${(entry.rawText || "").slice(0, 500)}, 'telegram')
    on conflict (date_label) do update set
      -- These three are flat maps, so a shallow jsonb merge is exactly right:
      -- keys absent from this paste keep their stored values.
      delivered = daily_ops_reports.delivered || excluded.delivered,
      received  = daily_ops_reports.received  || excluded.received,
      stock     = daily_ops_reports.stock     || excluded.stock,
      -- bags is nested one level deeper. A shallow merge would let a paste
      -- containing only 25kg figures replace the whole kg25 object (dropping
      -- previously-recorded product codes), so merge each weight class.
      bags = jsonb_build_object(
        'kg25', coalesce(daily_ops_reports.bags -> 'kg25', '{}'::jsonb)
                  || coalesce(excluded.bags -> 'kg25', '{}'::jsonb),
        'kg40', coalesce(daily_ops_reports.bags -> 'kg40', '{}'::jsonb)
                  || coalesce(excluded.bags -> 'kg40', '{}'::jsonb)
      ),
      updated_at = now()
    returning (xmax = 0) as inserted
  `;
  return { inserted: row.inserted };
}

export async function ingestOpsReport(
  text: string,
  reportedBy: string
): Promise<{ saved: number; updated: number; entries: ParsedDayEntry[] }> {
  const entries = parseOpsReportText(text);
  let saved = 0;
  let updated = 0;

  for (const entry of entries) {
    const { inserted } = await upsertOpsDay({
      dateLabel: entry.dateLabel,
      date: entry.date,
      reportedBy,
      delivered: entry.delivered,
      received: entry.received,
      stock: entry.stock,
      bags: entry.bags,
      rawText: text,
    });
    if (inserted) saved++;
    else updated++;
  }

  return { saved, updated, entries };
}

/**
 * Default window is a full year, so the dashboard's range selector (up to 1Y)
 * always has data to filter down from. The ops report is a slow-moving stock
 * ledger, so a year of daily rows is small.
 */
export async function recentOpsReports(days = 365) {
  const cutoff = new Date(Date.now() - days * 86400000);
  return sql`
    select id as _id, date_label as "dateLabel", date, reported_by as "reportedBy",
           delivered, received, stock, bags, source, created_at as "createdAt"
      from daily_ops_reports
     where date >= ${cutoff}
     order by date asc
  `;
}
