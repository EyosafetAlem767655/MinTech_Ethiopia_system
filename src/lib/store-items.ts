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
export type StoreUnit = "pcs" | "l" | "m" | "roll" | "pak" | "kg" | "set" | "bottle" | "drum" | "tin" | "berga";

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
  // Added with the owner's full store list (October 2026). Each is a heading
  // on the bot's group step, so a department never needs more tick-buttons
  // than Telegram allows on one keyboard.
  { key: "seal", label: "Seals & sleeves", block: "mechanical" },
  { key: "comp", label: "Compressor parts", block: "mechanical" },
  { key: "plant", label: "Plant parts", block: "mechanical" },
  { key: "veh", label: "Vehicle parts", block: "mechanical" },
  { key: "ctl", label: "Controls & switches", block: "electrical" },
  { key: "lug", label: "Cable lugs & connectors", block: "electrical" },
  { key: "mot", label: "Motors & pumps", block: "electrical" },
  { key: "filt", label: "Filters", block: "workshop" },
  { key: "steel", label: "Steel, pipe & sheet", block: "workshop" },
  { key: "safety", label: "Safety & tools", block: "workshop" },
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

  // Everything else electrical — 8. Copper wire is counted by the roll since
  // the October 2026 list (it was metres before).
  it("elc:copper-wire", "elc", "Coper wire", "roll"),
  it("elc:igniter", "elc", "Igneter"),
  it("elc:temp-sensor", "elc", "Temprature sensor"),
  it("elc:self-timer", "elc", "Self timer"),
  it("elc:digital-timer", "elc", "Digital Timer"),
  it("elc:mechanical-timer", "elc", "Mechanical Timer"),
  it("elc:volt-meter", "elc", "Analog Volt meter"),
  it("elc:selector-switch", "elc", "Selected swith"),

  /* ── 🛢 Oils & workshop ────────────────────────────────────────────────── */

  // Oils — counted in litres, except the two the October 2026 list counts by
  // the drum (industrial 320, engine 15W40), which switched with it.
  it("oil:engine-15w40", "oil", "Engine OIL 15W40", "drum"),
  it("oil:gas", "oil", "Gas OIL", "l"),
  it("oil:industrial-320", "oil", "INDUSTRIAL OIL 320", "drum"),
  it("oil:compressor-46", "oil", "Compress OIL No 46", "l"),

  // Work shop item. The bars are counted in PIECES — one 6 m length is one
  // piece, which is how the store counts them and how they are priced on the
  // opening count sheet (3 × 25,652 for a 30*30*6). They were briefly
  // catalogued in metres; a count of "3" against that unit read as 3 metres.
  // The OK48, OK 67.46 and 2.5 mm electrodes are counted by the PACK since the
  // October 2026 list, which is how the store holds them.
  it("wsh:electrod-3.2", "wsh", "Electrod 3.2 mm"),
  it("wsh:electrod-2.5", "wsh", "Electrod 2.5 mm", "pak"),
  it("wsh:ok48-3.2", "wsh", "OK48 Electrod 3.2mm2", "pak"),
  it("wsh:ok67.46-3.2", "wsh", "Ok 67.46 Electrod 3.2mm2", "pak"),
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

  /* ── Added with the owner's full store list (October 2026) ─────────────────
     Everything below is new. Items the list shares with the entries above kept
     their keys (and their names and units — see rule 1); the row-by-row
     mapping lives in scripts/store-base-count.ts. Names are as written on the
     list, with the part number folded in where it is what tells two apart.
     Rows the list repeats are separate items, suffixed "(2)", as the owner
     asked: their counts differ and merging is reversible where splitting is
     not. */

  // 🔧 Bearings, V-belts
  it("brg:6309", "brg", "6309"),
  it("belt:B78", "belt", "B78"),
  it("belt:B78-2", "belt", "B78 (2)"),
  it("belt:A51-loader", "belt", "A51 (loader fan)"),

  // 🔧 Seals & sleeves
  it("seal:shaft-60x80x10", "seal", "Shaft seal 60*80*10mm"),
  it("seal:shaft-60x80x10-2", "seal", "Shaft seal 60*80*10mm (2)"),
  it("seal:shaft-80x100x10", "seal", "Shaft seal 80*100*10mm"),
  it("seal:shaft-80x110x12", "seal", "Shaft seal 80*110*12mm"),
  it("seal:shaft-70x95x12", "seal", "Shaft seal 70*95*12mm"),
  it("seal:shaft-37.5x47x7", "seal", "Shaft seal 37*5*47*7mm"),
  it("seal:shaft-30x62x7", "seal", "Shaft seal 30*62*7mm"),
  it("seal:shaft-40x65x10", "seal", "Shaft seal 40*65*10mm"),
  it("seal:shaft-100x70x10", "seal", "Shaft seal 100*70*10"),
  it("seal:shaft-90x70x10", "seal", "Shaft seal 90*70*10"),
  it("seal:shaft-42x62x10", "seal", "Shaft seal 42*62*10"),
  it("seal:seal-30x50x10", "seal", "seal 30*50*10"),
  it("seal:oil-150x180x15", "seal", "Oil seal 150*180*15"),
  it("seal:oil-35x47x10", "seal", "Oil Seal 35x47x10 mm"),
  it("seal:oil-50x70x10", "seal", "Oil Seal 50x70x10 mm"),
  it("seal:oil-25x42x10", "seal", "Oil Seal 25x42x10 mm"),
  it("seal:sleeve-h09", "seal", "Sleeve H 09"),
  it("seal:sleeve-h08", "seal", "Sleeve H 08"),
  it("seal:sleeve-h213", "seal", "Sleeve H213"),
  it("seal:sleeve-h2313", "seal", "Sleeve H 2313"),
  it("seal:sleeve-1211", "seal", "Sleeve 1211"),
  it("seal:sleeve-1210", "seal", "Sleeve 1210"),

  // 🔧 Compressor parts (KAESER / Atlas Copco / Keashan)
  it("comp:oil-separator", "comp", "Oil separator (KAESER)"),
  it("comp:oil-filter", "comp", "Oil filter"),
  it("comp:air-filter-insert", "comp", "Air filter insert"),
  it("comp:filter-mat", "comp", "Filter matt"),
  it("comp:condensate-drain", "comp", "Condenset drain service unite (KAESER)"),
  it("comp:oil-regulator-valve", "comp", "Oil Regulator valve (KAESER)"),
  it("comp:vc-valve", "comp", "VC valve (KAESER)"),
  it("comp:overflow-valve", "comp", "Over flow valve (KAESER)"),
  it("comp:air-inlet-valve", "comp", "Air inlet valve (KAESER)"),
  it("comp:venting-valve", "comp", "Venting valve (KAESER)"),
  it("comp:kit-thermo-valve", "comp", "Maintenance kit thermo valve (KAESER)"),
  it("comp:kit-bypass-valve", "comp", "Maintenance kit Bypass valve (KAESER)"),
  it("comp:atlas-maint-kit", "comp", "Maintenance kit (Atlas copco)", "set"),
  it("comp:air-regulator-half", "comp", "Air tag (air regulator) 1/2 inch"),
  it("comp:air-regulator-3-8", "comp", "Air tag (air regulator) 3/8 inch"),
  it("comp:air-cleaner-piston", "comp", "Air cleaner piston type"),
  it("comp:separator-filter-keashan", "comp", "Sparater filter (Keashan)"),
  it("comp:oil-filter-keashan", "comp", "Oil filter (Keashan)"),

  // 🔧 Plant parts
  it("plant:fixed-jaw", "plant", "Fixed Jaw 70*40mm"),
  it("plant:movable-jaw", "plant", "Movable Jaw 63*40mm"),
  it("plant:rotary-valve-300", "plant", "Rotary valve 300*250mm"),
  it("plant:rotary-valve-250", "plant", "Rotary valve 250*200mm"),
  it("plant:hammer-mill-liner", "plant", "Plate for hammer mill (Linner)"),
  it("plant:steel-shaft", "plant", "Steel shaft"),
  it("plant:air-bucket-elbow", "plant", "Air buckt elebow (Pos no.15)"),
  it("plant:flanged-pipe-lined", "plant", "Flangeed pip with cement (Linning)"),
  it("plant:gear-box", "plant", "Gear box"),
  it("plant:bucket-line12", "plant", "Bucket for B. elevator (Line 1,2)"),
  it("plant:bucket-line3", "plant", "Bucket for B. elevator (Line 3)"),
  it("plant:bucket-old-line12", "plant", "Bucket for B. elevator (old line 1,2)"),
  it("plant:packing-seal", "plant", "Packing machine seal (Flex pinch valve)"),
  it("plant:plumber-block-510", "plant", "Plumber block (housing) 510"),
  it("plant:belt-fastener", "plant", "Belt fastner", "set"),
  it("plant:ball-mill-liner", "plant", "Liner for Ball mill"),
  it("plant:solid-coupling", "plant", "Solid Coupling"),
  it("plant:rubber-coupling", "plant", "Rubber Coupling"),
  it("plant:rubber-bushing", "plant", "Rubber Bushing"),
  it("plant:aluminium-pulley", "plant", "Alluminium pully"),
  it("plant:ball-mill-rubber-coupling", "plant", "Ball mill rubber coupling"),
  it("plant:flat-belt-65cm", "plant", "Flat belt 65cm*10mm*30m"),
  it("plant:flat-belt-400", "plant", "Flat belt 400*10mm (Bucket elevator)", "roll"),
  it("plant:toothed-belt", "plant", "Toother belt (1307042A)"),
  it("plant:hex-nuts", "plant", "Hexagonal nuts"),
  it("plant:classifier-cone", "plant", "Con for classifier wheel (Ms3)"),
  it("plant:classifier-ring", "plant", "Angle rinsing tin ring (Ms3)"),
  it("plant:diaphragm-1", "plant", "Diaphraim 1 inch"),
  it("plant:diaphragm-1.5", "plant", "Diaphraim 1 inch & half"),
  it("plant:diaphragm-valve-1-housing", "plant", "Diaphram valve 1\" (housing)"),

  // 🔧 Vehicle parts (loader, Toyota, Mazda)
  it("veh:loader-starter", "veh", "Starter moter (Loader)"),
  it("veh:loader-wear-plates", "veh", "Wear plats for van (Loader)"),
  it("veh:tyre-6.50-10", "veh", "Tyre with tube 6.50-10"),
  it("veh:tyre-28x9-15", "veh", "Tyre with tube 28*9.15/8.15-15"),
  it("veh:brake-pad-toyota", "veh", "Brake pad (TOYOTA)", "set"),
  it("veh:shock-absorber-toyota", "veh", "Shock absorber (TOYOTA)"),
  it("veh:ujoint-bearing-mazda", "veh", "Universal joint Bearing (MAZDA)"),
  it("veh:ujoint-48x120", "veh", "Universal joint 48x120"),
  it("veh:clutch-disc", "veh", "clutch disc"),
  it("veh:clutch-cover", "veh", "clutch cover"),
  it("veh:release-bearing", "veh", "Realized Bearing"),
  it("veh:feeding-pump", "veh", "Feeding pump"),

  // ⚡ Over load relay, motor protection, breakers, contactors, fuses
  it("olr:80-110A", "olr", "80-110A"),
  it("mpb:8-12A", "mpb", "8-12A"),
  it("mpb:unrated", "mpb", "Moter protection"),
  it("brk:10A-2", "brk", "10A (2)"),
  it("brk:4A", "brk", "4A"),
  it("brk1p:45A", "brk1p", "45A"),
  it("con:32-55A", "con", "32/55A"),
  it("con:95A", "con", "95A"),
  it("fus:5W", "fus", "5W"),
  it("fus:63-6-10A", "fus", "63 (6-10A)"),
  it("fsh:fuse-box-holder", "fsh", "Fusee box holder"),

  // ⚡ Electrical other
  it("elc:copper-round", "elc", "Copper round"),
  it("elc:copper-bar", "elc", "Copper bar"),
  it("elc:soldering-iron", "elc", "Soldering iron with lead"),
  it("elc:clamp-meter", "elc", "Digital clamp meter"),
  it("elc:carbon-brush-makita", "elc", "Carbon brush (Makita)"),
  it("elc:carbon-brush-bosch", "elc", "Carbon brush (Bocsh)"),
  it("elc:load-cell-30t", "elc", "Load Cell 30 Ton"),

  // ⚡ Controls & switches
  it("ctl:selected-by-power", "ctl", "Selected by power 110-220V"),
  it("ctl:light-indicator", "ctl", "Light indicator AC/DC"),
  it("ctl:emergency-contactor", "ctl", "Emergency contactor"),
  it("ctl:aux-contactor", "ctl", "Auxillary contactor"),
  it("ctl:change-over-switch", "ctl", "Change over switch"),
  it("ctl:change-over-switch-big", "ctl", "Change over switch big"),
  it("ctl:current-transformer", "ctl", "Current transformer 600/5A"),
  it("ctl:push-button", "ctl", "on/off push button 220V-10(6)A"),
  it("ctl:emergency-button", "ctl", "Emerjenciy push putten"),
  it("ctl:stop-switch", "ctl", "Stop switch (break)"),
  it("ctl:pressure-switch", "ctl", "Presure switch"),
  it("ctl:temp-controller", "ctl", "Temprature controller"),
  it("ctl:pneumatic-valve", "ctl", "Pneumatic valve"),
  it("ctl:solenoid-valve-1", "ctl", "Solenoid valve 1\""),
  it("ctl:solenoid-valve-1.5", "ctl", "Solonoid valve 1 & 1/2\""),
  it("ctl:solenoid-coil-220", "ctl", "Solonid valve coil 220V-Ac"),
  it("ctl:solenoid-coil-dc24", "ctl", "Salonid valve call DC24SNS"),
  it("ctl:relay-24vac", "ctl", "contact relay 24VAC"),
  it("ctl:relay-24vdc", "ctl", "contact relay 24 VDC"),
  it("ctl:relay-220vac", "ctl", "contact relay 220 VAC"),
  it("ctl:classifier-sensor", "ctl", "Clasifail sencer"),

  // ⚡ Cable lugs & connectors
  it("lug:16", "lug", "Cable lag 16"),
  it("lug:70", "lug", "Cable lag 70"),
  it("lug:95-bolt", "lug", "Cable lag 95 (bolted)"),
  it("lug:95-press", "lug", "Cable lag 95 (pressing)"),
  it("lug:120", "lug", "Cable lag 120"),
  it("lug:150", "lug", "Cable lag 150"),
  it("lug:185", "lug", "Cable lag 185"),
  it("lug:240", "lug", "Cable lag 240"),
  it("lug:500", "lug", "Cable lag 500"),
  it("lug:630", "lug", "Cable lag 630"),
  it("lug:conn-50", "lug", "Cable connector 50"),
  it("lug:conn-70", "lug", "Cable connector 70"),
  it("lug:conn-95", "lug", "Connector 95"),
  it("lug:conn-120", "lug", "Cable connector 120"),
  it("lug:conn-150", "lug", "Connector 150"),
  it("lug:conn-185", "lug", "Cable connector 185"),
  it("lug:terminal-connector", "lug", "Terminal connector"),

  // ⚡ Fittings and lamps
  it("elec2:bulb-toyota", "elec2", "Bulb Toyota 2E"),
  it("elec2:industrial-socket-16a", "elec2", "Indestrial socket 16A"),
  it("elec2:sodium-lamp", "elec2", "Sodium lamp"),
  it("elec2:lamp-h4", "elec2", "Lamp H4 12"),
  it("elec2:cable", "elec2", "Cable", "m"),
  it("elec2:cable-2", "elec2", "Cable (2)", "m"),

  // ⚡ Motors & pumps — as the list describes them; two rows read the same
  // ("Electrical motor, 3 phase") and are kept apart as (2).
  it("mot:blue", "mot", "Electrical motor (Blue color)"),
  it("mot:1470-22kw", "mot", "Electrical motor 1470RPM 22kw"),
  it("mot:1470-22kw-2", "mot", "Electrical moter 1470 22kw (2)"),
  it("mot:1475-45kw", "mot", "Electrical motor 1475RPM 45kw"),
  it("mot:2880-30kw", "mot", "Electrical motor 2880 30kw"),
  it("mot:2950-30kw", "mot", "Electrical motor 2950 30kw"),
  it("mot:2950rpm-30kw", "mot", "Electrical motor 2950RPM 30kw"),
  it("mot:oil-pump-1.1kw", "mot", "Electrical motor & oil pump 1.1kw"),
  it("mot:oil-pump-45kw", "mot", "Electrical motor & oil pump 45kw"),
  it("mot:1450-1725rpm", "mot", "Electrical motor 1450RPM/1725RPM"),
  it("mot:985-75kw", "mot", "Electrical motor 985RPM 75kw"),
  it("mot:1465-60kw", "mot", "Electrical motor 1465RPM 60kw"),
  it("mot:2890", "mot", "Electrical motor 2890RPM"),
  it("mot:2950-5.5kw", "mot", "Electrical motor 2950RPM 5.5kw 3phase"),
  it("mot:2930-7.5kw", "mot", "Electrical motor 2930RPM 7.5kw 3phase"),
  it("mot:15.2a-7.5kw", "mot", "Electrical motor 15.2A 7.5kw"),
  it("mot:1450-3kw", "mot", "Electrical motor 1450RPM 3kw"),
  it("mot:1460-15hp", "mot", "Electrical motor 1460RPM 15HP"),
  it("mot:1ph-0.37kw", "mot", "Single phase electrical motor 0.37kw"),
  it("mot:1470-18.5kw", "mot", "3phase electrical motor 1470RPM 18.5kw"),
  it("mot:geared-3ph", "mot", "Gread electric motor 3phase"),
  it("mot:geared-1400-1.5kw", "mot", "Gread electrical motor 1400RPM 1.5kw"),
  it("mot:geared-1460-1.5kw", "mot", "Gread electrical motor 1460RPM 1.5kw"),
  it("mot:3ph", "mot", "Electrical motor 3 phase"),
  it("mot:3ph-2", "mot", "Electrical motor 3 phase (2)"),
  it("mot:water-pump-2.2kw", "mot", "Water pump with e.motor 2.2kw"),
  it("mot:submersible-pump", "mot", "Semersabll water pump"),
  it("mot:gearbox-sprocket", "mot", "Gear box with sprocket"),
  it("mot:vibrator", "mot", "Vibrator motor"),
  it("mot:vibrator-electric", "mot", "Vibrator electric motor"),

  // 🛢 Oils & lubricants
  it("oil:sigma-fluid", "oil", "Sigma fluid", "l"),
  it("oil:grease-ncg3", "oil", "Greas NCG-3", "kg"),
  it("oil:hipersyn-46", "oil", "Hipersyn oil 46/208L"),
  it("oil:engine-20w50", "oil", "Engin oil 20w50", "l"),
  it("oil:transmission", "oil", "Transmition oil AFT", "l"),
  it("oil:dacsin-46", "oil", "Dacsin oil 46 (Compressor)"),
  it("oil:coolant", "oil", "Coolant (Anti corrosive)"),
  it("oil:stop-leak", "oil", "Stop leak"),

  // 🛢 Filters
  it("filt:bag-3475", "filt", "Filter bags 3475mm -160m (Emirates)"),
  it("filt:bag-2600", "filt", "Filter bags 2600mm -110m (Emirates)"),
  it("filt:bag-3710", "filt", "Filter bags 3710mm -160m (Emirates)"),
  it("filt:loader-fuel-5020", "filt", "Fule filter Loader 5020"),
  it("filt:loader-fuel-5030", "filt", "Fule filter Loader 5030"),
  it("filt:loader-oil-640", "filt", "Oil Filter Loader 640"),
  it("filt:oil-c6509", "filt", "Oil Filter C-6509"),
  it("filt:lube-3338", "filt", "Lubricant oil filter 3338"),
  it("filt:lube-6269", "filt", "Lubricant oil filter 6269"),
  it("filt:air-mann-1081", "filt", "Air filter Mann-1081"),
  it("filt:air-mann-811", "filt", "Air filter Mann-811"),
  it("filt:air-forklift", "filt", "Air cleaner (Fork lift) 16546 FK300"),
  it("filt:air-toyota-minibus", "filt", "Air Cleaner (Toyota min-bus) 17801-30050"),
  it("filt:fuel-16405", "filt", "Fule filter 16405T9005"),
  it("filt:oil-90915", "filt", "Oil filter 90915-YzzD2"),
  it("filt:oil-23390-64480", "filt", "Oil filter 23390-64480"),
  it("filt:oil-15208", "filt", "Oil filter 15208-65011"),
  it("filt:air-wl81", "filt", "Air cleaner WL81-13-Z40-TH"),
  it("filt:fuel-23390-0l0410", "filt", "Fule Filter 23390-0L0410"),
  it("filt:oil-wl-yo14", "filt", "Oil Filter W/L YO-14-302-D"),

  // 🛢 Work shop
  it("wsh:grind-180x6.5", "wsh", "Graindncg disk 180*6.5"),
  it("wsh:cut-180x22", "wsh", "Cutting Disk 180*22mm"),
  it("wsh:wire-brush", "wsh", "Wire brush"),
  it("wsh:electrod-84.78", "wsh", "Electrod 84.78 (32mm)", "pak"),
  it("wsh:china-electrod-4", "wsh", "Electrod China #4", "pak"),
  it("wsh:drill-chuck", "wsh", "Drill Chack 1.5-13mm"),
  it("wsh:bronze-rod", "wsh", "Filling rod Bronze"),
  it("wsh:pipe-threader", "wsh", "Pip teeth maker"),
  it("wsh:acetylene", "wsh", "Acetyline cylinder (Local)"),

  // 🛢 Consumables
  it("cons:plastic-bag-1kg", "cons", "Plastik bags 1kg"),
  it("cons:plastic-bag-2kg", "cons", "Plastik bags 2kg"),
  it("cons:glue-cm43", "cons", "Adhesive Glue CM-43", "tin"),
  it("cons:teflon", "cons", "Teflon Tape"),
  it("cons:paint-activator", "cons", "Oil Activator (paint)"),
  it("cons:paint-black", "cons", "Paint Black"),
  it("cons:spray-paint-black", "cons", "Spray paint Black"),

  // 🛢 Steel, pipe & sheet
  it("steel:galv-pipe-1.5", "steel", "Galvinized pipe 1&1/2", "berga"),
  it("steel:rhs-20x10x1", "steel", "RHS 20*10*1 mm"),
  it("steel:rhs-10x10x1", "steel", "RHS 10*10*1 mm"),
  it("steel:t28", "steel", "T-28"),
  it("steel:steel-pipe-3in", "steel", "Steel pipe 3 inch"),
  it("steel:ppr-3-4", "steel", "PPR 4m-3/4"),
  it("steel:ppr-half", "steel", "PPR 1/2\""),
  it("steel:plastic-tube-8", "steel", "Plastic Tube 8", "m"),
  it("steel:plastic-tube-6", "steel", "Plastic Tube 6", "m"),
  it("steel:fiber-glass", "steel", "Fiber glass"),
  it("steel:fiber-glass-transparent", "steel", "Fiber glass 1-2m (Transparent)"),
  it("steel:plastic-sheet", "steel", "Plastic sheet 9*11 m"),
  it("steel:roof-screw", "steel", "Roof screw (drill)"),

  // 🛢 Safety & tools
  it("safety:fire-ext-foam-9l", "safety", "Fire extinguisher foam 9L", "bottle"),
  it("safety:fire-ext-co2-5kg", "safety", "Fire extinguisher Co2 5Kg", "bottle"),
  it("safety:fire-ext-1kg", "safety", "Fire extinguisher 1Kg (Land rover)"),
  it("safety:fire-ext-6l", "safety", "Fire extingusher 6 liters"),
  it("safety:boots", "safety", "Boots"),
  it("safety:goggle-white", "safety", "Eye Gogle (white)"),
  it("safety:goggle-black", "safety", "Eye Gogle (Black)"),
  it("safety:face-shield", "safety", "Face cover (shield)"),
  it("safety:measuring-tape", "safety", "Measuring Tape 10 m"),
  it("safety:weight-500g", "safety", "Standard wheight 500g"),
  it("safety:weight-1000g", "safety", "Standard weight 1000g"),
  it("safety:shovel", "safety", "Shovel with out handle"),
  it("safety:plastic-hammer", "safety", "Plastic Hammer"),
  it("safety:wood-plane", "safety", "Wood plain (melagiya)"),
  it("safety:straw-footmat", "safety", "Straw footmat"),
  it("safety:wool-fabric-20", "safety", "Industrial wool Fabric (20x1x2)"),
  it("safety:wool-fabric-10", "safety", "Industrial wool Fabric (10x1x2)"),
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
