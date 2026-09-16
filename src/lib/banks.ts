/**
 * The banks a sale's money can land in.
 *
 * A FIXED list, on purpose. The sales analytics compare takings by bank, and a
 * grouping is only as good as its spelling: "CBE", "Commercial Bank" and
 * "commercial bank of ethiopia" typed on three different days would be three
 * banks on the chart. So the bot offers this list as buttons, the receipt reader
 * is told to answer from it, and a pasted or read name is matched onto it here.
 * "Other" stays open for the bank nobody thought of, with the name typed in.
 *
 * Client-safe: no `sql` import, so the dashboard can render the same names.
 */

export const BANK_OTHER = "Other";

export const BANKS: readonly string[] = [
  "CBE",
  "Awash",
  "Dashen",
  "Abyssinia",
  "Zemen",
  "Wegagen",
  "Nib",
  "Hibret",
  "Coop Oromia",
  "Berhan",
  "Enat",
  "Abay",
  "Bunna",
  "Amhara",
  "Siinqee",
  "Tsehay",
  "ZamZam",
  "Hijra",
  BANK_OTHER,
];

/** The names a person or a receipt might use for each entry, lower-cased. */
const ALIASES: Record<string, string[]> = {
  CBE: ["cbe", "commercial bank", "commercial bank of ethiopia", "የኢትዮጵያ ንግድ ባንክ", "ንግድ ባንክ"],
  Awash: ["awash", "awash bank", "awash international", "አዋሽ"],
  Dashen: ["dashen", "dashen bank", "ዳሽን"],
  Abyssinia: ["abyssinia", "bank of abyssinia", "boa", "አቢሲኒያ"],
  Zemen: ["zemen", "zemen bank", "ዘመን"],
  Wegagen: ["wegagen", "wegagen bank", "ወጋገን"],
  Nib: ["nib", "nib international", "nib bank", "ንብ"],
  Hibret: ["hibret", "hibret bank", "united bank", "ህብረት"],
  "Coop Oromia": ["coop", "coop oromia", "cooperative bank of oromia", "cbo", "oromia", "ኦሮሚያ"],
  Berhan: ["berhan", "berhan bank", "ብርሃን"],
  Enat: ["enat", "enat bank", "እናት"],
  Abay: ["abay", "abay bank", "አባይ"],
  Bunna: ["bunna", "bunna bank", "buna", "ቡና"],
  Amhara: ["amhara", "amhara bank", "አማራ"],
  Siinqee: ["siinqee", "sinqee", "siinqee bank"],
  Tsehay: ["tsehay", "tsehay bank", "ፀሐይ", "ጸሐይ"],
  ZamZam: ["zamzam", "zam zam", "zamzam bank"],
  Hijra: ["hijra", "hijra bank"],
  [BANK_OTHER]: ["other", "ሌላ"],
};

/** Loose form for matching: case, spaces, punctuation and the word "bank" are noise. */
function loose(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\b(bank|s\.?c\.?|share company|international)\b/g, "")
    .replace(/[\s\-_.,()'"]/g, "");
}

const LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const bank of BANKS) m.set(loose(bank), bank);
  for (const [bank, names] of Object.entries(ALIASES)) for (const n of names) m.set(loose(n), bank);
  return m;
})();

/**
 * The list entry a typed or read name refers to, or null.
 *
 * Exact after normalisation first; then containment either way, so "Awash Bank
 * S.C. Bole branch" still finds Awash. Null means the caller should ask — never
 * default to a bank on a guess, since the wrong bank is worse than a question.
 */
export function matchBank(text: string): string | null {
  const key = loose(text);
  if (!key) return null;
  const exact = LOOKUP.get(key);
  if (exact) return exact;
  // Longest alias first, so "coop oromia" wins over "oromia" and "cbe" cannot
  // be found inside an unrelated word by accident.
  const candidates = [...LOOKUP.entries()].filter(([k]) => k.length >= 3).sort((a, b) => b[0].length - a[0].length);
  for (const [k, bank] of candidates) {
    if (key.includes(k)) return bank;
  }
  return null;
}
