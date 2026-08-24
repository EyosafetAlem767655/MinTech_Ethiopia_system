/**
 * Single source of truth for product codes → display names, colours, and the
 * canonical ordering used across the ops charts and the department report tables.
 *
 * Codes are the raw keys stored in the report jsonb (ETL9, 2EL, Talk, …). Display
 * names match the company's sheets (ETL-9, 2-EL, Talc, …).
 */

export const PRODUCT_LABEL: Record<string, string> = {
  ETL15: "ETL-15",
  ETL9: "ETL-9",
  ETL6: "ETL-6",
  "5EL": "5-EL",
  "3EL": "3-EL",
  // Wollega-2-EL. Written with both hyphens so it cannot be misread as 2-EL,
  // which is a different brand sitting right beside it in every table.
  W2EL: "W-2-EL",
  "2EL": "2-EL",
  "1EL": "1-EL",
  EC15: "EC-15",
  EC90: "EC-90",
  Talk: "Talc",
};

/**
 * Preferred column order for grids/tables (matches the company report layout).
 *
 * 1EL keeps its label above but is deliberately absent here: it is not produced,
 * so it sorts after the canonical columns via orderProducts' alphabetical tail
 * rather than holding a slot nothing fills. Historic rows carrying it still
 * render with a proper name instead of a raw code.
 */
export const PRODUCT_ORDER = ["ETL15", "ETL9", "ETL6", "5EL", "3EL", "W2EL", "2EL", "Talk", "EC15", "EC90"];

/**
 * Production, delivery and the daily stock count all report the same ten
 * products, so they share one list.
 *
 * These are ALIASES, not copies — editing PRODUCT_ORDER adds or removes a
 * question from every guided flow and a column from every table at once. That is
 * the intent, but it means the constant is load-bearing well beyond the grid it
 * is named for.
 */
export const DELIVERY_PRODUCTS = PRODUCT_ORDER;
export const PRODUCTION_PRODUCTS = PRODUCT_ORDER;

/**
 * Empty-bag inventory, as size → colours.
 *
 * Matches the shape `daily_ops_reports.bags` has always used
 * ({ kg25: { Yellow: n, … }, kg40: { … } }), so the guided stock step and the
 * pasted ops report write the same structure.
 */
export const BAG_SIZES = ["kg25", "kg40"] as const;
export type BagSize = (typeof BAG_SIZES)[number];

export const BAG_STOCK: Record<BagSize, readonly string[]> = {
  kg25: ["Yellow", "White", "Beige"],
  kg40: ["Yellow", "Green", "Beige"],
};

export const BAG_SIZE_LABEL: Record<BagSize, string> = { kg25: "25KG", kg40: "40KG" };

/** "25KG Yellow" — the column heading and the paste-template key. */
export function bagLabel(size: BagSize, colour: string): string {
  return `${BAG_SIZE_LABEL[size]} ${colour}`;
}

/**
 * The raw-material intake columns, in sheet order.
 *
 * Lives here rather than in asset-flows.ts so the dashboard panels can import it
 * without dragging the Postgres client into the browser bundle.
 */
export const RAW_MATERIALS = ["Talc", "Kuni", "Chips", "Guji", "Lime Stone"] as const;

/**
 * The same raw materials as finance accounts for them.
 *
 * Asset management receives Kuni, Chips and Guji as three separate materials and
 * will keep reporting them that way. Finance values them identically, so they are
 * summed into one Dolomite line. The mapping lives here rather than in the report
 * so the intake tables never have to know about it.
 */
export const FINANCE_RAW_MATERIALS = ["Dolomite", "Lime Stone", "Talc"] as const;
export type FinanceRawMaterial = (typeof FINANCE_RAW_MATERIALS)[number];

const DOLOMITE_SOURCES = ["Kuni", "Chips", "Guji"] as const;

/** Which finance line an asset-management raw material rolls up into. */
export function financeMaterial(assetMaterial: string): FinanceRawMaterial | null {
  if ((DOLOMITE_SOURCES as readonly string[]).includes(assetMaterial)) return "Dolomite";
  if (assetMaterial === "Lime Stone") return "Lime Stone";
  if (assetMaterial === "Talc") return "Talc";
  return null;
}

/**
 * Roll an asset-management `{ material: tons }` map up into finance's three lines.
 *
 * Note that "Talc" is a raw material here and a FINISHED BRAND elsewhere (product
 * code `Talk`, sold as Micro Talc). They are genuinely different things and never
 * share a figure — one is received and consumed, the other produced and sold.
 */
export function rollUpMaterials(assetMaterials: Record<string, number> | null | undefined) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(assetMaterials || {})) {
    const target = financeMaterial(k);
    if (!target) continue;
    out[target] = (out[target] || 0) + (Number(v) || 0);
  }
  return out;
}

/**
 * Product colours — a palette validated as a set (lightness band, chroma floor,
 * CVD + normal-vision separation, contrast). The ordering keeps neighbouring
 * stacked-bar segments apart, so keep it aligned with the alphabetical order the
 * API returns. Talc is stock-only and always directly labelled, so it takes the
 * neutral.
 */
export const PRODUCT_COLOR: Record<string, string> = {
  "2EL": "#2a78d6", // blue
  "3EL": "#008300", // green
  "5EL": "#e87ba4", // magenta
  EC15: "#eda100", // yellow
  EC90: "#1baf7a", // aqua
  ETL15: "#eb6834", // orange
  ETL6: "#4a3aa7", // violet
  ETL9: "#e34948", // red
  W2EL: "#00868b", // teal — sits between the blue (2EL) and aqua (EC90) bands
  Talk: "#6b6a66", // neutral — stock-only, always directly labelled
};

export const BAG_COLORS: Record<string, string> = {
  Yellow: "#eab308",
  White: "#a8a29e",
  Beige: "#d4b896",
  Green: "#16a34a",
};

/** Display name for a product code, falling back to the raw code. */
export function productLabel(code: string): string {
  return PRODUCT_LABEL[code] || code;
}

/**
 * Orders a set of product codes by the canonical PRODUCT_ORDER, with any unknown
 * codes appended alphabetically after.
 */
export function orderProducts(codes: string[]): string[] {
  const known = PRODUCT_ORDER.filter((c) => codes.includes(c));
  const extra = codes.filter((c) => !PRODUCT_ORDER.includes(c)).sort();
  return [...known, ...extra];
}
