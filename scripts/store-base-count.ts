/**
 * The store's base count, from the owner's three lists (October 2026).
 *
 *     npx tsx scripts/store-base-count.ts [YYYY-MM-DD]
 *
 * Reads scripts/store/2026-10-{general,electrical,extra}.csv and writes
 * supabase/seed/0009_store_base_count_2026_10.sql: ONE store_counts row holding
 * the physical count of every listed item. That count is the base every later
 * figure is worked out from — vouchers move each item on from it, and a later
 * weekly count resets it as any count does (src/lib/store-inventory.ts).
 *
 * The mapping below is the reviewed, row-by-row decision of which store item
 * each line is: an existing key where the list names something already on the
 * store list, a new key (added to src/lib/store-items.ts) otherwise. The run
 * FAILS if a row has no key, a key is not on the store list, or two rows land
 * on one item — so the seed can never silently drop or double a line.
 *
 * Counts, as the owner decided: "N.I" and "—" are 0, "S-1" is 1 (reported).
 * Items on the store list that these lists do not mention are left out of the
 * count entirely, so they keep whatever figure they already had.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STORE_ITEM_BY_KEY } from "../src/lib/store-items";

const DIR = join(__dirname, "store");
const OUT = join(__dirname, "..", "supabase", "seed", "0009_store_base_count_2026_10.sql");
const COUNTED_BY = "Opening count (owner's list)";

/* ── The mapping: one key per row, in row order ─────────────────────────────── */

const GENERAL: string[] = [
  /*   1 */ "comp:oil-separator", "oil:sigma-fluid", "comp:oil-filter", "comp:air-filter-insert", "comp:filter-mat",
  /*   6 */ "brg:6210", "brg:6216", "brg:6313", "brg:6212", "brg:6205",
  /*  11 */ "brg:6213", "brg:6013", "brg:1208", "brg:2311", "brg:6311",
  /*  16 */ "brg:1210", "brg:6204", "brg:6312", "brg:6219", "brg:UCF204",
  /*  21 */ "brg:1209", "brg:22213", "brg:6222", "brg:6209", "brg:6309",
  /*  26 */ "brg:6203", "brg:206", "brg:6306", "brg:6315", "brg:6206",
  /*  31 */ "brg:1211", "brg:6211", "brg:6010", "brg:6228", "brg:6308",
  /*  36 */ "brg:QJ307", "brg:NU307", "brg:2205", "steel:galv-pipe-1.5", "plant:fixed-jaw",
  /*  41 */ "plant:movable-jaw", "plant:rotary-valve-300", "plant:rotary-valve-250", "plant:hammer-mill-liner", "safety:fire-ext-foam-9l",
  /*  46 */ "safety:fire-ext-co2-5kg", "wsh:ok48-3.2", "plant:steel-shaft", "plant:air-bucket-elbow", "plant:flanged-pipe-lined",
  /*  51 */ "plant:gear-box", "plant:bucket-line12", "plant:bucket-line3", "plant:bucket-old-line12", "comp:condensate-drain",
  /*  56 */ "comp:oil-regulator-valve", "comp:vc-valve", "comp:overflow-valve", "comp:air-inlet-valve", "comp:venting-valve",
  /*  61 */ "comp:atlas-maint-kit", "filt:bag-3475", "filt:bag-2600", "filt:bag-3710", "wsh:cut-180x1.6x22",
  /*  66 */ "wsh:electrod-2.5", "cons:plastic-bag-1kg", "cons:plastic-bag-2kg", "oil:grease-ncg3", "oil:hipersyn-46",
  /*  71 */ "wsh:grind-180x6.5", "wsh:cut-180x3.2x22.23", "wsh:cut-180x22", "wsh:wire-brush", "wsh:electrod-84.78",
  /*  76 */ "wsh:ok67.46-3.2", "comp:air-regulator-half", "comp:air-regulator-3-8", "filt:loader-fuel-5020", "filt:loader-fuel-5030",
  /*  81 */ "filt:loader-oil-640", "wsh:drill-chuck", "wsh:bronze-rod", "wsh:electrod-holder", "safety:boots",
  /*  86 */ "cons:epoxy", "cons:glue-cm43", "cons:teflon", "safety:measuring-tape", "belt:C150",
  /*  91 */ "belt:C83", "belt:D165", "belt:B78", "belt:B78-2", "belt:A54",
  /*  96 */ "belt:A65", "belt:A50", "belt:A59", "belt:9.5x650", "belt:C98",
  /* 101 */ "safety:fire-ext-1kg", "oil:industrial-320", "belt:A58", "brg:6310", "plant:packing-seal",
  /* 106 */ "filt:oil-c6509", "filt:lube-3338", "filt:lube-6269", "filt:air-mann-1081", "filt:air-mann-811",
  /* 111 */ "oil:engine-20w50", "oil:transmission", "seal:sleeve-h09", "seal:sleeve-h08", "seal:sleeve-h213",
  /* 116 */ "seal:sleeve-h2313", "plant:plumber-block-510", "seal:shaft-60x80x10", "seal:shaft-80x100x10", "seal:shaft-80x110x12",
  /* 121 */ "seal:shaft-70x95x12", "seal:shaft-37.5x47x7", "seal:shaft-30x62x7", "seal:shaft-40x65x10", "seal:shaft-60x80x10-2",
  /* 126 */ "seal:oil-150x180x15", "belt:A51-loader", "filt:air-forklift", "filt:air-toyota-minibus", "filt:fuel-16405",
  /* 131 */ "wsh:pipe-threader", "plant:belt-fastener", "steel:plastic-tube-8", "steel:plastic-tube-6", "veh:loader-starter",
  /* 136 */ "comp:air-cleaner-piston", "safety:fire-ext-6l", "plant:ball-mill-liner", "oil:engine-15w40", "wsh:china-electrod-4",
  /* 141 */ "wsh:acetylene", "plant:solid-coupling", "plant:rubber-coupling", "plant:rubber-bushing", "plant:aluminium-pulley",
  /* 146 */ "plant:ball-mill-rubber-coupling", "wsh:rbar-40", "wsh:sqbar-40", "steel:rhs-20x10x1", "steel:rhs-10x10x1",
  /* 151 */ "steel:t28", "steel:steel-pipe-3in", "ctl:solenoid-valve-1", "ctl:solenoid-valve-1.5", "belt:A52",
  /* 156 */ "safety:goggle-white", "safety:goggle-black", "safety:weight-500g", "safety:weight-1000g", "safety:shovel",
  /* 161 */ "cons:hammer-6kg", "cons:silicone", "wsh:sqbar-10", "steel:ppr-3-4", "veh:tyre-6.50-10",
  /* 166 */ "veh:tyre-28x9-15", "plant:flat-belt-65cm", "safety:wood-plane", "filt:oil-90915", "filt:oil-23390-64480",
  /* 171 */ "filt:oil-15208", "filt:air-wl81", "veh:brake-pad-toyota", "plant:flat-belt-400", "seal:shaft-100x70x10",
  /* 176 */ "seal:shaft-90x70x10", "seal:shaft-42x62x10", "seal:seal-30x50x10", "comp:kit-thermo-valve", "comp:kit-bypass-valve",
  /* 181 */ "wsh:tyre-loader", "veh:shock-absorber-toyota", "veh:ujoint-bearing-mazda", "plant:toothed-belt", "safety:plastic-hammer",
  /* 186 */ "veh:loader-wear-plates", "plant:hex-nuts", "plant:classifier-cone", "plant:classifier-ring", "plant:diaphragm-1",
  /* 191 */ "plant:diaphragm-1.5", "steel:fiber-glass", "comp:separator-filter-keashan", "comp:oil-filter-keashan", "cons:china-electrod-3.2",
  /* 196 */ "wsh:cut-230x2x22.2", "steel:plastic-sheet",
];

/** Keyed by the list's own "No" — it skips 59. */
const ELECTRICAL: string[] = [
  /*   1 */ "olr:37-50A", "olr:12-18A", "olr:28-42A", "olr:13-18A", "olr:0.63-0.4A",
  /*   6 */ "olr:12.5-20A", "olr:80-110A", "olr:2.8-4.2A", "olr:45-65A", "olr:48-65A",
  /*  11 */ "olr:1-1.6A", "mpb:13-18A", "mpb:2.5-4A", "mpb:2.8-4A", "mpb:8-12A",
  /*  16 */ "mpb:4-6.3A", "elc:self-timer", "elc:digital-timer", "elc:mechanical-timer", "elc:volt-meter",
  /*  21 */ "elc:selector-switch", "ctl:selected-by-power", "ctl:light-indicator", "ctl:emergency-contactor", "ctl:aux-contactor",
  /*  26 */ "olr:30-40A", "brk:250A", "brk:160A", "brk:16A", "brk:10A",
  /*  31 */ "brk:40A", "brk:80A", "brk:25A", "brk:10A-2", "brk1p:45A",
  /*  36 */ "con:32-55A", "con:20A", "con:160A", "con:40A", "con:125A",
  /*  41 */ "con:25A", "ctl:change-over-switch", "lug:240", "lug:500", "lug:630",
  /*  46 */ "ctl:current-transformer", "brk:125A", "elc:copper-round", "elc:copper-bar", "ctl:push-button",
  /*  51 */ "fsh:400A", "elc:soldering-iron", "fus:25A", "fus:63A-R022", "fus:1A",
  /*  56 */ "fus:250A", "fus:200A", "fus:100A", /* 59 is not on the list */ "fus:300A",
  /*  61 */ "fus:160A", "fus:63A", "fus:80A", "ctl:solenoid-coil-220", "elc:igniter",
  /*  66 */ "ctl:stop-switch", "elec2:bulb-toyota", "fus:5W", "con:80A", "brk:4A",
  /*  71 */ "elc:copper-wire", "mot:blue", "mot:1470-22kw", "mot:1475-45kw", "mot:2880-30kw",
  /*  76 */ "mot:2950-30kw", "mot:oil-pump-1.1kw", "mot:1450-1725rpm", "mot:oil-pump-45kw", "mot:985-75kw",
  /*  81 */ "mot:1465-60kw", "mot:2950rpm-30kw", "mot:geared-3ph", "mot:submersible-pump", "mot:gearbox-sprocket",
  /*  86 */ "mot:vibrator", "mot:vibrator-electric", "elc:temp-sensor", "ctl:temp-controller", "elc:clamp-meter",
  /*  91 */ "ctl:pneumatic-valve", "elec2:industrial-socket-16a", "elec2:sodium-lamp", "elec2:lamp-h4", "fsh:fuse-box-holder",
  /*  96 */ "elec2:socket", "elec2:cable", "elec2:cable-2", "lug:terminal-connector", "ctl:change-over-switch-big",
  /* 101 */ "con:95A", "lug:95-bolt", "elec2:cable-lag-35", "lug:70", "lug:95-press",
  /* 106 */ "lug:16", "lug:conn-185", "lug:conn-120", "lug:conn-50", "lug:185",
  /* 111 */ "lug:conn-70", "lug:conn-150", "lug:conn-95", "lug:120", "mot:1470-22kw-2",
  /* 116 */ "ctl:pressure-switch", "ctl:emergency-button", "lug:150", "fus:63-6-10A", "mpb:unrated",
  /* 121 */ "mot:2890", "mot:2950-5.5kw", "mot:2930-7.5kw", "mot:15.2a-7.5kw", "mot:1450-3kw",
  /* 126 */ "mot:1460-15hp", "mot:1ph-0.37kw", "mot:1470-18.5kw", "mot:geared-1400-1.5kw", "mot:geared-1460-1.5kw",
  /* 131 */ "mot:3ph", "mot:3ph-2", "mot:water-pump-2.2kw", "ctl:relay-24vac", "ctl:relay-24vdc",
  /* 136 */ "ctl:relay-220vac", "ctl:classifier-sensor", "ctl:solenoid-coil-dc24",
];

/** In row order — the list numbers 24 twice. */
const EXTRA: string[] = [
  /*  1 */ "elc:carbon-brush-makita", "seal:oil-35x47x10", "seal:oil-50x70x10", "seal:oil-25x42x10", "oil:stop-leak",
  /*  6 */ "elc:carbon-brush-bosch", "safety:straw-footmat", "safety:face-shield", "cons:paint-activator", "cons:paint-black",
  /* 11 */ "cons:spray-paint-black", "steel:fiber-glass-transparent", "steel:roof-screw", "steel:ppr-half", "cons:rbar-25",
  /* 16 */ "wsh:sqbar-30", "oil:dacsin-46", "oil:coolant", "veh:ujoint-48x120", "seal:sleeve-1211",
  /* 21 */ "seal:sleeve-1210", "belt:B72", "veh:clutch-disc", "veh:clutch-cover", "veh:release-bearing",
  /* 25 */ "elc:load-cell-30t", "plant:diaphragm-valve-1-housing", "filt:fuel-23390-0l0410", "veh:feeding-pump", "filt:oil-wl-yo14",
  /* 30 */ "safety:wool-fabric-20", "safety:wool-fabric-10",
];

/**
 * Matched to an existing item although the wording differs enough to be worth
 * a second look. Reported, never silently assumed.
 */
const CHECK: Record<string, string> = {
  "wsh:ok67.46-3.2": 'list says "Electrod 67.45 (32mm)"; store list has "Ok 67.46" — taken as the same electrode',
  "belt:9.5x650": 'list says "V-Belt (95*650)"; store list has "9.5*650" — taken as the same belt',
  "elc:digital-timer": 'list says "Digital self timer"',
  "elc:selector-switch": 'list says "Selector switch"; store list has "Selected swith"',
  "elec2:socket": 'list says "Pluge (socket)"',
};

/* ── CSV ────────────────────────────────────────────────────────────────────── */

/** RFC 4180-ish: quotes, doubled quotes inside them. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

interface Row {
  list: string;
  no: string;
  text: string;
  uom: string;
  count: string;
}

function readList(file: string, shape: "full" | "short"): Row[] {
  const lines = readFileSync(join(DIR, file), "utf8").split(/\r?\n/).filter((l) => l.trim());
  return lines.slice(1).map((line) => {
    const f = splitCsv(line);
    if (shape === "short") return { list: file, no: f[0], text: f[1], uom: "pcs", count: f[2] };
    // "Bucket for B. elevator,Line 1,2,Pcs,15" — the part number itself holds a
    // comma, unquoted. The first two fields and the last two are fixed, so the
    // part number is whatever is left between them.
    const [no, desc] = f;
    const count = f[f.length - 1];
    const uom = f[f.length - 2];
    const part = f.slice(2, f.length - 2).join(",");
    return { list: file, no, text: [desc, part].filter(Boolean).join(" · "), uom, count };
  });
}

/* ── Counts ─────────────────────────────────────────────────────────────────── */

const flagged: string[] = [];

function readCount(r: Row): number {
  const raw = r.count.replace(/\s/g, "");
  if (raw === "" || raw === "—" || raw === "-" || /^n\.?i\.?$/i.test(raw)) return 0;
  const s1 = raw.match(/^S-(\d+)$/i);
  if (s1) {
    flagged.push(`${r.list} #${r.no} ${r.text}: count "${r.count}" read as ${s1[1]}`);
    return Number(s1[1]);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${r.list} #${r.no} ${r.text}: count "${r.count}" is not a number`);
  return n;
}

/* ── Main ───────────────────────────────────────────────────────────────────── */

function main() {
  const date = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : new Date().toISOString().slice(0, 10);

  const lists: [Row[], string[]][] = [
    [readList("2026-10-general.csv", "full"), GENERAL],
    [readList("2026-10-electrical.csv", "full"), ELECTRICAL],
    [readList("2026-10-extra.csv", "short"), EXTRA],
  ];

  const items: Record<string, number> = {};
  const seenBy = new Map<string, string>();
  let matched = 0;
  let added = 0;
  const unitNotes: string[] = [];

  for (const [rows, keys] of lists) {
    if (rows.length !== keys.length) {
      throw new Error(`${rows[0]?.list}: ${rows.length} rows but ${keys.length} keys in the mapping`);
    }
    rows.forEach((r, i) => {
      const key = keys[i];
      const item = STORE_ITEM_BY_KEY.get(key);
      if (!item) throw new Error(`${r.list} #${r.no} ${r.text}: "${key}" is not on the store list`);
      const prev = seenBy.get(key);
      if (prev) throw new Error(`${r.list} #${r.no} ${r.text}: "${key}" is already taken by ${prev}`);
      seenBy.set(key, `${r.list} #${r.no}`);
      items[key] = readCount(r);
      // "New" = added with this list (see the October 2026 block in store-items.ts).
      const isNew = NEW_KEYS.has(key);
      if (isNew) added++;
      else matched++;
      if (!isNew) {
        const listed = normUnit(r.uom);
        if (listed && listed !== item.unit) {
          unitNotes.push(`${key} (${item.name}): list says ${r.uom}, store list counts in ${item.unit} — kept ${item.unit}`);
        }
      }
    });
  }

  const groups = [...new Set(Object.keys(items).map((k) => STORE_ITEM_BY_KEY.get(k)!.group))].sort();

  const sql =
    `-- The store's base count, from the owner's three lists (October 2026).\n` +
    `-- GENERATED by scripts/store-base-count.ts — edit the mapping there, not this file.\n` +
    `--\n` +
    `-- One store_counts row: the physical count of every listed item, dated ${date}.\n` +
    `-- Every later voucher moves an item on from this figure, and a later count\n` +
    `-- resets it as any count does. Items the lists do not mention are not in it,\n` +
    `-- so they keep the figure they had. Re-runnable: it replaces its own row.\n\n` +
    `delete from store_counts where counted_by = '${COUNTED_BY.replace(/'/g, "''")}';\n\n` +
    `insert into store_counts (date, date_label, groups, items, counted_by, source)\n` +
    `values ('${date}T00:00:00+03:00', '${date}',\n` +
    `        array[${groups.map((g) => `'${g}'`).join(", ")}]::text[],\n` +
    `        '${JSON.stringify(items).replace(/'/g, "''")}'::jsonb,\n` +
    `        '${COUNTED_BY.replace(/'/g, "''")}', 'app');\n`;
  writeFileSync(OUT, sql);

  console.log(`Wrote ${OUT}`);
  console.log(`  ${Object.keys(items).length} items counted: ${matched} already on the store list, ${added} added`);
  console.log(`  ${groups.length} groups: ${groups.join(", ")}`);
  console.log(`  untouched (on the store list, not in these lists): ${[...STORE_ITEM_BY_KEY.keys()].filter((k) => !(k in items)).length}`);
  for (const [k, why] of Object.entries(CHECK)) console.log(`  CHECK ${k}: ${why}`);
  for (const f of flagged) console.log(`  FLAG ${f}`);
  for (const u of unitNotes) console.log(`  UNIT ${u}`);
}

const UNITS: Record<string, string> = {
  pcs: "pcs", lit: "l", l: "l", kg: "kg", set: "set", berga: "berga", bottel: "bottle", bottle: "bottle",
  pack: "pak", pkt: "pak", pak: "pak", tin: "tin", drum: "drum", roll: "roll", mat: "m", meter: "m", m: "m",
};
const normUnit = (u: string) => UNITS[u.trim().toLowerCase()] ?? "";

/** Keys this list ADDED, read from store-items.ts's October 2026 block. */
const NEW_KEYS: Set<string> = (() => {
  const src = readFileSync(join(__dirname, "..", "src", "lib", "store-items.ts"), "utf8");
  const block = src.slice(src.indexOf("Added with the owner's full store list (October 2026) ──"));
  return new Set([...block.matchAll(/it\("([^"]+)"/g)].map((m) => m[1]));
})();

main();
