/**
 * Charts in assistant answers.
 *
 * The assistant answers analytical questions with a fenced block:
 *
 *     ```chart
 *     {"type":"bar","title":"Sales by month","unit":"ETB",
 *      "series":["Cash","Credit"],
 *      "data":[{"label":"Sep","Cash":120,"Credit":40},{"label":"Oct","Cash":90,"Credit":60}]}
 *     ```
 *
 * One series may use "value" instead of naming it. Pure and apart from the page,
 * so the parser is testable, and so a bad block degrades to a table rather than
 * breaking the reply: model output is untrusted text.
 */

export interface ChartSpec {
  type: "bar" | "line";
  title: string;
  unit: string;
  /** The value keys, in legend order. */
  series: string[];
  data: { label: string; values: Record<string, number> }[];
}

export type Segment = { kind: "text"; text: string } | { kind: "chart"; spec: ChartSpec } | { kind: "bad"; raw: string };

/** At most this many points and series are drawn; more is a table's job. */
const MAX_POINTS = 60;
const MAX_SERIES = 4;

export function parseChart(raw: string): ChartSpec | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const rows = Array.isArray(o.data) ? o.data : [];
  if (rows.length === 0) return null;

  const named = Array.isArray(o.series) ? o.series.map(String).filter(Boolean) : [];
  const series = (named.length ? named : ["value"]).slice(0, MAX_SERIES);

  const data = rows.slice(0, MAX_POINTS).flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const row = r as Record<string, unknown>;
    const values: Record<string, number> = {};
    for (const s of series) {
      const v = Number(row[s]);
      values[s] = Number.isFinite(v) ? v : 0;
    }
    return [{ label: String(row.label ?? row.name ?? ""), values }];
  });
  if (data.length === 0) return null;

  // Pie and anything else draw as bars: a part-of-whole read as lengths is the clearer chart.
  const type = o.type === "line" ? "line" : "bar";
  return { type, title: String(o.title ?? ""), unit: String(o.unit ?? ""), series, data };
}

/** Split an answer into its prose and its charts, in order. */
export function splitAnswer(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /```chart\s*\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    const spec = parseChart(m[1].trim());
    out.push(spec ? { kind: "chart", spec } : { kind: "bad", raw: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.filter((s) => s.kind !== "text" || s.text.trim());
}

/** What the system prompt teaches the model, kept beside the parser it must match. */
export const CHART_INSTRUCTIONS =
  "When an answer compares figures or shows a trend (by month, by customer, by product), also draw it: " +
  "after one or two sentences, add a fenced block that starts with ```chart and holds JSON like " +
  '{"type":"bar","title":"Sales by month","unit":"ETB","series":["Cash","Credit"],' +
  '"data":[{"label":"Sep","Cash":120000,"Credit":40000}]}. ' +
  'Use "line" for a trend over time and "bar" otherwise; at most 4 series and 60 points; ' +
  "numbers only, taken from the tool results. Never draw a chart for a single number.";
