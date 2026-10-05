/**
 * The spare-parts store, as the managers wrote it down.
 *
 * 153 items in three blocks and fourteen groups. Nothing in the system recorded any
 * of this before; the count that fills it arrives from the bot one block at a
 * time (src/lib/store-count-paste.ts) and is displayed on the asset tab.
 *
 * Three rules govern this file:
 *
 *  1. **The key is the identity of a shelf position and is permanent.** Every
 *     count ever filed stores its figures under these strings. Editing one
 *     orphans its history silently — the item simply appears to have never been
 *     counted. Retire an item by marking it, never by renaming its key.
 *  2. **Names are verbatim from the managers' list**, misspellings included
 *     ("Coper wire", "Igneter", "Temprature sensor", "Electrod", "disck",
 *     "Tyere"). The storekeeper recognises their own sheet, and a tidied name is
 *     a name they have to translate back while standing in front of the shelf.
 *  3. **The group is part of the identity.** The list genuinely repeats names:
 *     16A is both a three-phase and a single-phase breaker, 13-18A is both an
 *     overload relay and a motor protection, 37-50A likewise, 63A is a fuse
 *     twice (one of them R022), and 80A is a contactor twice (one of them a 24 V
 *     coil). A flat lookup by name would merge four pairs of different parts.
 *
 * Pure — no `sql`, no React — so the bot, the parser and the panel all read one
 * list.
 */

/**
 * `roll` and `pak` arrived with the opening count: cable comes on a roll and
 * electrodes in a packet, and counting either in pieces would mean nothing.
 */
export type StoreUnit = "pcs" | "l" | "m" | "roll" | "pak";

export interface StoreItem {
  /** Permanent. See rule 1 above. */
  key: string;
  /** Group key — see STORE_GROUPS. */
  group: string;
  /** As written on the managers' list. */
  name: string;
  unit: StoreUnit;
}

export interface StoreGroup {
  key: string;
  /** The heading inside the paste block, and on the panel. */
  label: string;
  /** Which block it is filed in. */
  block: StoreBlockKey;
}

export type StoreBlockKey = "mechanical" | "electrical" | "workshop";

export interface StoreBlock {
  key: StoreBlockKey;
  label: string;
  icon: string;
}

/**
 * The three blocks are exactly the three lists the managers sent.
 *
 * Not an arbitrary split: it is how the store is organised in their heads, and
 * a count is often partial ("the bearings today, the electrics on Thursday"),
 * so the unit somebody files in has to match the unit they count in.
 */
export const STORE_BLOCKS: StoreBlock[] = [
  { key: "mechanical", label: "Mechanical", icon: "🔧" },
  { key: "electrical", label: "Electrical", icon: "⚡" },
  { key: "workshop", label: "Oils & workshop", icon: "🛢" },
];

export const STORE_GROUPS: StoreGroup[] = [
  { key: "belt", label: "V.belt", block: "mechanical" },
  { key: "brg", label: "BEARING", block: "mechanical" },
  { key: "olr", label: "Over load relay", block: "electrical" },
  { key: "mpb", label: "Motor protection", block: "electrical" },
  { key: "brk", label: "BREAKER", block: "electrical" },
  { key: "brk1p", label: "BREAKER single phase", block: "electrical" },
  { key: "con", label: "Contactor", block: "electrical" },
  { key: "fus", label: "FUSE", block: "electrical" },
  { key: "fsh", label: "Feus holder", block: "electrical" },
  { key: "elc", label: "Electrical other", block: "electrical" },
  // Added with the opening count: the fittings and consumables the store
  // actually holds, which the managers' original list did not reach.
  { key: "elec2", label: "Electrical fittings", block: "electrical" },
  { key: "oil", label: "Oils", block: "workshop" },
  { key: "wsh", label: "Work shop item", block: "workshop" },
  { key: "cons", label: "Consumables", block: "workshop" },
];

/** Shorthand so the list below reads like the list it came from. */
const it = (key: string, group: string, name: string, unit: StoreUnit = "pcs"): StoreItem => ({
  key,
  group,
  name,
  unit,
});

export const STORE_ITEMS: StoreItem[] = [
  /* ── 🔧 Mechanical ─────────────────────────────────────────────────────── */

  // V.belt — 12
  it("belt:A50", "belt", "A50"),
  it("belt:A52", "belt", "A52"),
  it("belt:A54", "belt", "A54"),
  it("belt:A58", "belt", "A58"),
  it("belt:A59", "belt", "A59"),
  it("belt:A65", "belt", "A65"),
  it("belt:B72", "belt", "B72"),
  it("belt:C83", "belt", "C83"),
  it("belt:C150", "belt", "C150"),
  it("belt:C98", "belt", "C98"),
  it("belt:D165", "belt", "D165"),
  it("belt:9.5x650", "belt", "9.5*650"),

  // BEARING — 33
  it("brg:6210", "brg", "6210"),
  it("brg:6216", "brg", "6216"),
  it("brg:6313", "brg", "6313"),
  it("brg:6212", "brg", "6212"),
  it("brg:6205", "brg", "6205"),
  it("brg:6213", "brg", "6213"),
  it("brg:6013", "brg", "6013"),
  it("brg:1208", "brg", "1208"),
  it("brg:2311", "brg", "2311"),
  it("brg:6311", "brg", "6311"),
  it("brg:1210", "brg", "1210"),
  it("brg:6204", "brg", "6204"),
  it("brg:6312", "brg", "6312"),
  it("brg:6219", "brg", "6219"),
  it("brg:UCF204", "brg", "UCF204"),
  it("brg:1209", "brg", "1209"),
  it("brg:22213", "brg", "22213"),
  it("brg:6222", "brg", "6222"),
  it("brg:6209", "brg", "6209"),
  it("brg:6203", "brg", "6203"),
  it("brg:206", "brg", "206"),
  it("brg:6306", "brg", "6306"),
  it("brg:6315", "brg", "6315"),
  it("brg:6206", "brg", "6206"),
  it("brg:1211", "brg", "1211"),
  it("brg:6211", "brg", "6211"),
  it("brg:6010", "brg", "6010"),
  it("brg:6228", "brg", "6228"),
  it("brg:6308", "brg", "6308"),
  it("brg:QJ307", "brg", "QJ307"),
  it("brg:NU307", "brg", "NU307"),
  it("brg:2205", "brg", "2205"),
  it("brg:6310", "brg", "6310"),

  /* ── ⚡ Electrical ─────────────────────────────────────────────────────── */

  // Over load relay — 12. The last one (30-40A) was listed separately on the
  // managers' second page; it is the same kind of part, so it joins this group
  // rather than becoming a group of one.
  it("olr:37-50A", "olr", "37-50A"),
  it("olr:12-18A", "olr", "12-18A"),
  it("olr:28-42A", "olr", "28-42A"),
  // Written this way round on the list. Kept verbatim — see rule 2 — but it is
  // almost certainly 0.4-0.63A and worth confirming with the store.
  it("olr:0.63-0.4A", "olr", "0.63-0.4A"),
  it("olr:13-18A", "olr", "13-18A"),
  it("olr:12.5-20A", "olr", "12.5-20A"),
  it("olr:2.8-4.2A", "olr", "2.8-4.2A"),
  it("olr:45-65A", "olr", "45-65A"),
  it("olr:48-65A", "olr", "48-65A"),
  it("olr:1-1.6A", "olr", "1-1.6A"),
  it("olr:70-100A", "olr", "70-100A"),
  it("olr:30-40A", "olr", "30-40A"),

  // Motor protection — 9
  it("mpb:13-18A", "mpb", "13-18A"),
  it("mpb:2.5-4A", "mpb", "2.5-4A"),
  it("mpb:2.8-4A", "mpb", "2.8-4A"),
  it("mpb:4-6.3A", "mpb", "4-6.3A"),
  it("mpb:9-14A", "mpb", "9-14A"),
  it("mpb:6-10A", "mpb", "6-10A"),
  it("mpb:37-50A", "mpb", "37-50A"),
  it("mpb:40-63A", "mpb", "40-63A"),
  it("mpb:80-140A", "mpb", "80-140A"),

  // BREAKER — 11
  it("brk:250A", "brk", "250A"),
  it("brk:160A", "brk", "160A"),
  it("brk:16A", "brk", "16A"),
  it("brk:10A", "brk", "10A"),
  it("brk:40A", "brk", "40A"),
  it("brk:80A", "brk", "80A"),
  it("brk:25A", "brk", "25A"),
  it("brk:63A", "brk", "63A"),
  it("brk:32A", "brk", "32A"),
  it("brk:100A", "brk", "100A"),
  it("brk:125A", "brk", "125A"),

  // BREAKER, single phase — 2. Its own group because 16A and 10A appear above.
  it("brk1p:16A", "brk1p", "16A"),
  it("brk1p:10A", "brk1p", "10A"),

  // Contactor — 12
  it("con:45A", "con", "45A"),
  it("con:55A", "con", "55A"),
  it("con:20A", "con", "20A"),
  it("con:160A", "con", "160A"),
  it("con:40A", "con", "40A"),
  it("con:125A", "con", "125A"),
  it("con:25A", "con", "25A"),
  it("con:50A", "con", "50A"),
  it("con:80A", "con", "80A"),
  // A different part from the one above: same rating, 24 V coil.
  it("con:80A-24v", "con", "80A.24v"),
  it("con:260A", "con", "260A"),
  it("con:32A", "con", "32A"),

  // FUSE — 10
  it("fus:1A", "fus", "1A"),
  it("fus:63A", "fus", "63A"),
  it("fus:80A", "fus", "80A"),
  it("fus:250A", "fus", "250A"),
  it("fus:200A", "fus", "200A"),
  it("fus:100A", "fus", "100A"),
  it("fus:160A", "fus", "160A"),
  it("fus:300A", "fus", "300A"),
  it("fus:25A", "fus", "25A"),
  // Again a different part from the 63A above, not a duplicate of it.
  it("fus:63A-R022", "fus", "63A R022"),

  // Feus holder — 2
  it("fsh:400A", "fsh", "400A"),
  it("fsh:80A", "fsh", "80A"),

  // Everything else electrical — 8
  it("elc:copper-wire", "elc", "Coper wire", "m"),
  it("elc:igniter", "elc", "Igneter"),
  it("elc:temp-sensor", "elc", "Temprature sensor"),
  it("elc:self-timer", "elc", "Self timer"),
  it("elc:digital-timer", "elc", "Digital Timer"),
  it("elc:mechanical-timer", "elc", "Mechanical Timer"),
  it("elc:volt-meter", "elc", "Analog Volt meter"),
  it("elc:selector-switch", "elc", "Selected swith"),

  /* ── 🛢 Oils & workshop ────────────────────────────────────────────────── */

  // Oils — 4, counted in litres.
  it("oil:engine-15w40", "oil", "Engine OIL 15W40", "l"),
  it("oil:gas", "oil", "Gas OIL", "l"),
  it("oil:industrial-320", "oil", "INDUSTRIAL OIL 320", "l"),
  it("oil:compressor-46", "oil", "Compress OIL No 46", "l"),

  // Work shop item. The bars are counted in PIECES — one 6 m length is one
  // piece, which is how the store counts them and how they are priced on the
  // opening count sheet (3 × 25,652 for a 30*30*6). They were briefly
  // catalogued in metres; a count of "3" against that unit read as 3 metres.
  it("wsh:electrod-3.2", "wsh", "Electrod 3.2 mm"),
  it("wsh:electrod-2.5", "wsh", "Electrod 2.5 mm"),
  it("wsh:ok48-3.2", "wsh", "OK48 Electrod 3.2mm2"),
  it("wsh:ok67.46-3.2", "wsh", "Ok 67.46 Electrod 3.2mm2"),
  it("wsh:ok67.60-3.2", "wsh", "Ok 67.60.E309L-17 3.2mm2"),
  it("wsh:electrod-holder", "wsh", "Electrod Holder"),
  it("wsh:cut-180x1.6x22", "wsh", "Cutting disck 180*1.6*22"),
  it("wsh:cut-230x2x22.2", "wsh", "Cutting disck 230*2*22.2"),
  it("wsh:cut-350x3.2x25.4", "wsh", "Cutting disck 350*3.2*25.4"),
  it("wsh:grind-180x5.5x22.2", "wsh", "Grinding disck 180*5.5*22.2"),
  it("wsh:cut-180x3.2x22.23", "wsh", "Cutting disck 180*3.2*22.23"),
  it("wsh:sqbar-40", "wsh", "Square bar 40*40*6m"),
  it("wsh:sqbar-30", "wsh", "Square bar 30*30*6m"),
  it("wsh:sqbar-10", "wsh", "Square bar 10*10*6m"),
  it("wsh:rbar-40", "wsh", "Round bar #40mm"),
  it("wsh:rbar-30", "wsh", "Round bar #30mm"),
  it("wsh:tyre-loader", "wsh", "Tyere for Loader"),

  /* ── Added with the opening count (October 2026) ───────────────────────── */

  // ⚡ Electrical fittings — 11
  it("elec2:led-18w", "elec2", "Led 18W"),
  it("elec2:lamp", "elec2", "Lamp"),
  it("elec2:lamp-holder", "elec2", "Lamp holder"),
  it("elec2:cable-2.5", "elec2", "Electric cable #2.5", "roll"),
  it("elec2:on-off-switch", "elec2", "On Off swich"),
  it("elec2:conduit", "elec2", "conduet"),
  it("elec2:limit-switch", "elec2", "Limite swich"),
  it("elec2:socket", "elec2", "socket"),
  it("elec2:capacitor", "elec2", "Capaciter"),
  it("elec2:cable-lag-35", "elec2", "Cable lag #35"),
  it("elec2:cable-lag-25", "elec2", "Cable lag #25"),

  // 🛢 Consumables — 10. "China electrod #3.2" is kept apart from the
  // "Electrod 3.2 mm" above: they are priced and bought as different products,
  // and merging two things that turn out to be one is recoverable where
  // splitting one that turns out to be two is not.
  it("cons:silicone", "cons", "silcone sealant"),
  it("cons:epoxy", "cons", "Epoxy"),
  it("cons:grease-nipple", "cons", "Greas Nipple"),
  it("cons:sewing-thread", "cons", "Sewing theared"),
  it("cons:leather-glove", "cons", "Lather vglove"),
  it("cons:hammer-6kg", "cons", "Hammer 6kg"),
  it("cons:broom", "cons", "plastic broom"),
  it("cons:mop", "cons", "Mop"),
  it("cons:china-electrod-3.2", "cons", "China electrod #3.2", "pak"),
  it("cons:rbar-25", "cons", "Round bar #25"),
];

/* ──────────────────────────────── lookups ─────────────────────────────────── */

export const STORE_ITEM_BY_KEY = new Map(STORE_ITEMS.map((i) => [i.key, i]));

export const GROUP_BY_KEY = new Map(STORE_GROUPS.map((g) => [g.key, g]));

/** The groups of one block, in list order. */
export function groupsOfBlock(block: StoreBlockKey): StoreGroup[] {
  return STORE_GROUPS.filter((g) => g.block === block);
}

/** The items of one group, in list order. */
export function itemsOfGroup(group: string): StoreItem[] {
  return STORE_ITEMS.filter((i) => i.group === group);
}

/** The items of one block, in list order. */
export function itemsOfBlock(block: StoreBlockKey): StoreItem[] {
  const groups = new Set(groupsOfBlock(block).map((g) => g.key));
  return STORE_ITEMS.filter((i) => groups.has(i.group));
}

/** "4 pcs", "12 l" — the figure with the unit it was counted in. */
export function withUnit(qty: number, unit: StoreUnit): string {
  return `${qty.toLocaleString()} ${unit}`;
}
