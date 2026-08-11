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
  "2EL": "2-EL",
  "1EL": "1-EL",
  EC15: "EC-15",
  EC90: "EC-90",
  Talk: "Talc",
};

/** Preferred column order for grids/tables (matches the company report layout). */
export const PRODUCT_ORDER = ["ETL15", "ETL9", "ETL6", "5EL", "3EL", "1EL", "2EL", "Talk", "EC15", "EC90"];

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
