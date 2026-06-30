import { DailyOpsReport, type IDailyOpsReport } from "@/lib/models";

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
    // Check for date
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

    // Detect section headers
    const lower = line.toLowerCase();
    if (/^delivered/i.test(line)) { section = "delivered"; continue; }
    if (/^received/i.test(line)) { section = "received"; continue; }
    if (/^stock/i.test(line)) { section = "stock"; continue; }
    if (/25\s*kg\s*bag/i.test(line)) { section = "bags25"; continue; }
    if (/40\s*kg\s*bag/i.test(line)) { section = "bags40"; continue; }

    // Parse key=value pairs in current section
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

export async function ingestOpsReport(
  text: string,
  reportedBy: string
): Promise<{ saved: number; updated: number; entries: ParsedDayEntry[] }> {
  const entries = parseOpsReportText(text);
  let saved = 0;
  let updated = 0;

  for (const entry of entries) {
    const existing = await DailyOpsReport.findOne({ dateLabel: entry.dateLabel });
    if (existing) {
      // Merge: only overwrite sections that are present in the new entry
      if (Object.keys(entry.delivered).length) existing.delivered = { ...(existing.delivered || {}), ...entry.delivered };
      if (Object.keys(entry.received).length) existing.received = { ...(existing.received || {}), ...entry.received };
      if (Object.keys(entry.stock).length) existing.stock = { ...(existing.stock || {}), ...entry.stock };
      if (Object.keys(entry.bags.kg25).length) {
        existing.bags = existing.bags || {};
        existing.bags.kg25 = { ...(existing.bags.kg25 || {}), ...entry.bags.kg25 };
      }
      if (Object.keys(entry.bags.kg40).length) {
        existing.bags = existing.bags || {};
        existing.bags.kg40 = { ...(existing.bags.kg40 || {}), ...entry.bags.kg40 };
      }
      existing.markModified("delivered");
      existing.markModified("received");
      existing.markModified("stock");
      existing.markModified("bags");
      await existing.save();
      updated++;
    } else {
      await DailyOpsReport.create({
        dateLabel: entry.dateLabel,
        date: entry.date,
        reportedBy,
        delivered: Object.keys(entry.delivered).length ? entry.delivered : undefined,
        received: Object.keys(entry.received).length ? entry.received : undefined,
        stock: Object.keys(entry.stock).length ? entry.stock : undefined,
        bags:
          Object.keys(entry.bags.kg25).length || Object.keys(entry.bags.kg40).length
            ? entry.bags
            : undefined,
        rawText: text.slice(0, 500),
        source: "telegram",
      });
      saved++;
    }
  }

  return { saved, updated, entries };
}
