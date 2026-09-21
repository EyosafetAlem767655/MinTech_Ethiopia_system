import { geminiGenerate } from "@/lib/llm";
import {
  allStepsFor,
  draftKeyLabel,
  findStep,
  isSkip,
  itemKeys,
  MAX_VOUCHER_ITEMS,
  nextStep,
  parseQty,
  stepLabel,
  type AssetFlowKind,
  type AssetStep,
} from "@/lib/asset-flows";

/** The two flows whose draft is a list of line items that can grow or shrink. */
const VOUCHER_KINDS = new Set<AssetFlowKind>(["grv", "store_issue"]);

/** Slot number of the first line item nobody has described yet, or null when full. */
function firstEmptyItem(draft: Record<string, string | number>): number | null {
  for (let i = 1; i <= MAX_VOUCHER_ITEMS; i++) {
    const v = draft[itemKeys(i).description];
    if (v === undefined || v === "") return i;
  }
  return null;
}

/**
 * Correcting any field of any report, before it is submitted.
 *
 * Only the sales receipt could be corrected before this existed. Every other
 * flow — both vouchers, production, damage, bag usage, whiteness, the price
 * list, the opening balance — offered a review card whose only choices were
 * approve or cancel, so one wrong digit on the eighth line of a voucher meant
 * cancelling and retyping the whole thing.
 *
 * The rule that shapes this file: **nothing is hidden.** The voucher review card
 * summarises eight line items into a few rows, so most of what was typed is not
 * even visible there. The editor lists every ANSWERED step — all 8 × 7 item
 * fields included — because a curated "these are the editable ones" list is
 * exactly the complaint this replaces.
 *
 * Three further rules, inherited from the sales editor this generalises:
 *
 *  1. A value has to pass **its own step's** validation. An edit must not be
 *     able to put something in the draft that the original question refused.
 *  2. **Every attempt reports what changed**, field by field, old → new.
 *  3. **An attempt that changed nothing says so**, and is never presented as a
 *     success. That silence was the original sales bug.
 */

/** A field as offered for editing: its number in the list, and its value now. */
export interface EditableField {
  index: number;
  step: AssetStep;
  label: string;
  value: string;
}

export interface FlowChange {
  id: string;
  label: string;
  from: string;
  to: string;
}

export interface FlowEditResult {
  draft: Record<string, string | number>;
  changes: FlowChange[];
  /** Values that were understood but refused by their own step. */
  rejected: { label: string; reason: string }[];
  /** True when an AI pass was needed to understand the correction. */
  usedAi: boolean;
  /** Set when the AI pass was needed but could not run. */
  error?: string;
  /**
   * A step to resume the flow at instead of the review card.
   *
   * Set when a voucher line was ADDED: the description is in, but its unit,
   * quantity and stock-item questions are not, and they are asked the ordinary
   * way rather than left for a second edit.
   */
  resumeAt?: string;
}

/**
 * Every field the reporter has actually answered.
 *
 * This walks THE DRAFT, not the step table, and that is the whole point. Walking
 * the steps looked right and quietly hid three classes of field:
 *
 *  - the 36 figures of the daily production report and the 19 of the opening
 *    balance, which arrive through one paste step and have no steps of their own
 *    at all — the editor listed a single field and nothing a correction named
 *    could match, which is exactly what "no edit is happening" looked like;
 *  - `unit` on a voucher line, written by an extraction and never asked for;
 *  - any step whose `when` guard has since gone false while its answer stayed in
 *    the draft.
 *
 * A step is still used wherever one exists — it supplies the label, the choice
 * list and the validation. A key without one is edited as free text under a
 * decoded label. Order follows the flow, with the step-less keys after it.
 *
 * Photo and paste steps are the only exclusions: a photo is replaced by sending
 * another one and a paste by pasting again, so neither is a value to type over.
 */
export function editableFields(
  kind: AssetFlowKind,
  draft: Record<string, string | number>
): EditableField[] {
  const answered = (key: string) => {
    const v = draft[key];
    return v !== undefined && v !== "";
  };

  const out: EditableField[] = [];
  const taken = new Set<string>();

  const push = (step: AssetStep, label: string) => {
    if (taken.has(step.id)) return;
    taken.add(step.id);
    out.push({
      index: out.length + 1,
      step,
      label,
      value: displayValue(step, draft[step.id]),
    });
  };

  // Flow order first, and the UNFILTERED step list: a `when` guard decides what
  // to ask next, never what may be corrected.
  //
  // The one exception is an id declared TWICE — one per branch of the purchase
  // request, with different wording. There the guard picks which copy supplies
  // the label; the field is still listed either way.
  const all = allStepsFor(kind);
  for (const step of all) {
    if (step.type === "photo" || step.type === "photos" || step.type === "paste") continue;
    if (step.when && !step.when(draft) && all.some((o) => o !== step && o.id === step.id)) continue;
    if (answered(step.id)) push(step, stepLabel(step));
  }

  // Then everything else the draft holds. `fill` and internal bookkeeping have
  // no place on the list, but there is no allow-list here on purpose — the
  // complaint was precisely that a curated list hides things.
  for (const key of Object.keys(draft)) {
    if (taken.has(key) || !answered(key)) continue;
    // Extraction hints are the model's suggestion, never an answer, and
    // showing them would invite "correcting" a field that does not exist.
    if (key.endsWith("_hint")) continue;
    // Numeric where the value is numeric, so a correction is still checked as a
    // number rather than stored as text.
    const numeric = typeof draft[key] === "number" || /^-?\d*\.?\d+$/.test(String(draft[key]));
    push({ id: key, prompt: key, type: numeric ? "number" : "text" }, draftKeyLabel(key));
  }

  // A voucher can GROW from here. The next empty line is offered as one more
  // numbered entry, so "12 = Cement 50kg" adds a fourth item the same way
  // "3 = 45" corrects the third. Without this the only way to add a line a
  // reporter forgot was to cancel and retype the whole voucher — the exact
  // complaint the editor exists to answer. Removing a line is the reverse:
  // its description set to "-".
  if (VOUCHER_KINDS.has(kind)) {
    const slot = firstEmptyItem(draft);
    if (slot !== null && slot > 1) {
      const step = findStep(kind, itemKeys(slot).description);
      if (step && !taken.has(step.id)) {
        taken.add(step.id);
        out.push({ index: out.length + 1, step, label: `➕ ዕቃ ${slot} · Description (አዲስ)`, value: "—" });
      }
    }
  }

  return out;
}

/** A choice is stored as its value but was chosen by its label — show the label. */
function displayValue(step: AssetStep, raw: string | number): string {
  if (step.type === "choice") {
    const match = step.choices?.find((c) => c.value === String(raw));
    if (match) return match.label;
  }
  return String(raw);
}

/**
 * The numbered list, split into messages Telegram will accept.
 *
 * A GRV with eight items runs to sixty-odd lines and a full production report to
 * thirty-seven; the 4096-character cap is reachable, and a silently truncated
 * list would hide exactly the late line items this feature exists to expose.
 */
/**
 * Escape a value for a Telegram HTML message.
 *
 * Telegram REJECTS a message whose HTML it cannot parse, and `call()` in
 * telegram.ts swallows that rejection — so one "&" or "<" in a value does not
 * produce an error, it produces SILENCE. An item purchase for `Valve <2">` or
 * `Nut & bolt` would send no confirmation at all, which reads exactly like the
 * edit having done nothing.
 */
export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderFieldList(fields: EditableField[], maxChars = 3400): string[] {
  const esc = escapeHtml;
  const lines = fields.map((f) => `<b>${f.index}.</b> ${esc(f.label)}: ${esc(f.value)}`);

  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : ["—"];
}

/* ─────────────────────────────── Parsing ──────────────────────────────────── */

const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s\-_.:·]/g, "");

/**
 * Match a typed answer against a choice label, the same way the webhook does.
 *
 * The leading emoji has to come off. Every choice label starts with one, and
 * "➕ አዎ፣ ሌላ ዕቃ" typed back without it — which is what a keyboard tap sends
 * versus what someone retypes — would otherwise never match.
 */
const normChoice = (s: string) =>
  String(s || "")
    .trim()
    .toLowerCase()
    // Keycap sequences first ("1️⃣"), since the digit is part of the emoji.
    .replace(/^(?:[0-9#*]️?⃣\s*)+/u, "")
    // Then the ordinary leading decoration.
    //
    // NOT `\p{Emoji}`: that property matches the ASCII digits 0-9, so a leading
    // "3-" would be stripped and the product labels "3-EL" and "5-EL" would both
    // normalise to "el" — the picker would then store whichever came first in
    // the list, silently filing a whiteness reading against the wrong brand.
    .replace(/^[\p{Extended_Pictographic}\p{S}\p{P}\p{Default_Ignorable_Code_Point}\s]+/u, "")
    .trim();

/**
 * The fast path: one correction per line, no model involved.
 *
 * The target may be the line number, the step id, or the label shown beside it.
 * All three are offered because all three are in front of the reporter when they
 * are typing — the number they just read, the English term off the paper form,
 * and the key they may know from the template.
 *
 * The separator is generous on purpose. This path is the one that works when
 * Gemini does not, and it was too strict to be that: "3 = 45" was read but
 * "3 45", "3 - 45" and "3 → 45" all fell through to the model, and when the
 * model was down (a 503 afternoon) every one of them came back as "could not
 * read the correction". A number followed by anything is a correction to that
 * line; a number alone with the value on the next line is the same thing typed
 * on a phone. The label forms still need "=" or ":" — a label can contain
 * spaces and dashes of its own.
 */
export function parseDirectEdit(
  fields: EditableField[],
  text: string
): Record<string, string> {
  const byNumber = new Map<string, EditableField>();
  const byName = new Map<string, EditableField>();
  for (const f of fields) {
    byNumber.set(String(f.index), f);
    byName.set(norm(f.step.id), f);
    byName.set(norm(f.label), f);
  }

  const out: Record<string, string> = {};
  const lines = String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // "Supplier = ABC", "3-EL = 12". Checked FIRST: several labels begin with a
    // digit ("3-EL", "5-EL", "2-EL"), and read as a number they would correct
    // line 3 to "EL = 12" instead of the brand they name.
    const byLabel = line.match(/^([^=:]+?)\s*[=:]\s*(.+?)\s*$/);
    if (byLabel) {
      const [, target, value] = byLabel;
      const named = byName.get(norm(target));
      if (named && value) {
        out[named.step.id] = value;
        continue;
      }
    }

    // "3 = 45", "3: 45", "3 - 45", "3 → 45", "3) 45", "3. 45", "3 45".
    const byNo = line.match(/^(\d{1,3})\s*(?:[=:\-–—→>)\.]\s*|\s+)(.+)$/);
    if (byNo && byNumber.has(byNo[1])) {
      out[byNumber.get(byNo[1])!.step.id] = byNo[2].trim();
      continue;
    }

    // A bare number: the value is the next line.
    if (/^\d{1,3}$/.test(line) && byNumber.has(line) && i + 1 < lines.length) {
      out[byNumber.get(line)!.step.id] = lines[++i];
      continue;
    }
  }
  return out;
}

/**
 * Check one value against the step that asked for it.
 *
 * This is the whole reason an edit cannot corrupt a draft: the number step still
 * goes through `parseQty`, the choice step still has to name one of its own
 * choices, and a step with a custom validator still runs it. A correction is
 * held to the same standard as the original answer.
 */
export function validateForStep(
  step: AssetStep,
  raw: string
): { ok: true; value: string | number } | { ok: false; reason: string } {
  const val = String(raw).trim();
  if (!val) return { ok: false, reason: "ባዶ ነው" };

  if (step.type === "number") {
    const n = parseQty(val);
    if (n === null) return { ok: false, reason: "ቁጥር መሆን አለበት" };
    return { ok: true, value: n };
  }

  if (step.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return { ok: false, reason: "ቀኑ እንደ 2026-08-17 መሆን አለበት" };
    return { ok: true, value: val };
  }

  if (step.type === "choice") {
    // Matched on the label OR the stored value, so both "3-EL" and its code work.
    const match = step.choices?.find(
      (c) => normChoice(c.label) === normChoice(val) || norm(c.value) === norm(val)
    );
    if (!match) {
      const options = (step.choices || []).map((c) => c.label).slice(0, 8).join(" / ");
      return { ok: false, reason: `ከእነዚህ አንዱ መሆን አለበት፦ ${options}` };
    }
    return { ok: true, value: match.value };
  }

  if (step.validate) {
    const res = step.validate(val);
    if (!res.ok) return { ok: false, reason: res.error.replace(/^❌\s*/, "") };
    return { ok: true, value: res.value };
  }

  return { ok: true, value: val };
}

/**
 * Drop voucher line `slot`, closing the gap.
 *
 * Lines above it move down one so the list stays contiguous — `voucherItems`
 * stops at the first empty description, and a hole in the middle would silently
 * discard every line after it. The "add another?" answer of the new last line is
 * set to "no" so the flow does not walk into the slot that was just vacated.
 */
function removeVoucherLine(draft: Record<string, string | number>, slot: number): void {
  const keysOf = (i: number) => Object.values(itemKeys(i));
  for (let i = slot; i < MAX_VOUCHER_ITEMS; i++) {
    const from = itemKeys(i + 1);
    const to = itemKeys(i);
    for (const k of Object.keys(from) as (keyof ReturnType<typeof itemKeys>)[]) {
      const v = draft[from[k]];
      if (v === undefined) delete draft[to[k]];
      else draft[to[k]] = v;
    }
    // The extraction hint travels with its line too.
    const hintFrom = `${from.ledger}_hint`;
    if (draft[hintFrom] !== undefined) draft[`${to.ledger}_hint`] = draft[hintFrom];
    else delete draft[`${to.ledger}_hint`];
  }
  for (const k of keysOf(MAX_VOUCHER_ITEMS)) delete draft[k];
  delete draft[`${itemKeys(MAX_VOUCHER_ITEMS).ledger}_hint`];

  // Re-close the list at its new end.
  const last = (firstEmptyItem(draft) ?? MAX_VOUCHER_ITEMS + 1) - 1;
  if (last >= 1 && last < MAX_VOUCHER_ITEMS) draft[itemKeys(last).more] = "no";
}

/** Apply a `{ stepId: value }` map, recording only what actually moved. */
function applyValues(
  kind: AssetFlowKind,
  fields: EditableField[],
  draft: Record<string, string | number>,
  values: Record<string, string>
): {
  draft: Record<string, string | number>;
  changes: FlowChange[];
  rejected: { label: string; reason: string }[];
  resumeAt?: string;
} {
  const next = { ...draft };
  const changes: FlowChange[] = [];
  const rejected: { label: string; reason: string }[] = [];
  const byId = new Map(fields.map((f) => [f.step.id, f]));
  let resumeAt: string | undefined;

  for (const [id, raw] of Object.entries(values)) {
    const field = byId.get(id);
    if (!field) continue;

    // Voucher lines: a description set to "-" removes the line; a description
    // typed into the empty slot adds one. Both are handled before validation,
    // which would otherwise refuse the blank and accept the addition as a
    // plain field edit with no line-item questions behind it.
    if (VOUCHER_KINDS.has(kind)) {
      const line = id.match(/^desc(\d+)$/);
      if (line) {
        const slot = Number(line[1]);
        const existed = next[id] !== undefined && next[id] !== "";
        if (existed && isSkip(raw)) {
          if (slot === 1 && firstEmptyItem(next) === 2) {
            rejected.push({ label: field.label, reason: "ቫውቸሩ ቢያንስ አንድ ዕቃ ሊኖረው ይገባል" });
            continue;
          }
          const was = String(next[id]);
          removeVoucherLine(next, slot);
          changes.push({ id, label: `ዕቃ ${slot}`, from: was, to: "ተሰርዟል" });
          continue;
        }
        if (!existed && !isSkip(raw) && raw.trim()) {
          // Open the slot: the previous line's "add another?" has to say yes or
          // the flow, and voucherItems, stop one line short of the new one.
          if (slot > 1) next[itemKeys(slot - 1).more] = "yes";
          next[id] = raw.trim();
          changes.push({ id, label: field.label, from: "—", to: raw.trim() });
          // Ask the rest of the new line's questions the ordinary way.
          resumeAt = nextStep(kind, id, next);
          continue;
        }
      }
    }

    const checked = validateForStep(field.step, raw);
    if (!checked.ok) {
      rejected.push({ label: field.label, reason: checked.reason });
      continue;
    }

    const before = String(draft[id] ?? "");
    const after = String(checked.value);
    // A "change" that changes nothing is not reported as one — otherwise
    // re-sending the same correction would look like it had taken effect.
    if (before === after) continue;

    next[id] = checked.value;
    changes.push({
      id,
      label: field.label,
      from: displayValue(field.step, before) || "—",
      to: displayValue(field.step, checked.value),
    });
  }

  return { draft: next, changes, rejected, resumeAt };
}

const EDIT_SYSTEM =
  "You apply a correction to one row of an Ethiopian factory report and return STRICT JSON only.\n" +
  "You are given the report's fields — each with an id, a label and its current value — and a free-text " +
  "correction written by the reporter, in English or Amharic. Work out WHICH FIELDS they are correcting " +
  "and to what.\n" +
  'Return exactly: { "edits": [ { "id": "<field id>", "value": "<new value as a string>" } ], ' +
  '"understood": boolean, "notes": string }.\n' +
  "Include ONLY the fields the correction actually changes. Leave every other field out entirely — do " +
  "NOT echo current values back, because anything you return is treated as an intentional edit.\n" +
  "Use the exact `id` strings given to you. Numbers are plain digits with no commas or currency symbol; " +
  "dates are YYYY-MM-DD; a field whose current value came from a fixed list must be set to one of that " +
  "list's options.\n" +
  'If you cannot tell what is being corrected, return { "understood": false, "edits": [] }. Guessing is ' +
  "worse than asking: a wrong guess is saved as a real report.";

/**
 * Read a correction, falling back to the model only when the fast path finds
 * nothing.
 *
 * The AI is asked for *only the fields that change*, never the whole draft. A
 * model that echoed the draft back would silently re-assert every value it
 * misread, turning one correction into forty.
 */
export async function applyFlowEdit(
  kind: AssetFlowKind,
  draft: Record<string, string | number>,
  text: string
): Promise<FlowEditResult> {
  const fields = editableFields(kind, draft);

  const direct = parseDirectEdit(fields, text);
  if (Object.keys(direct).length > 0) {
    const applied = applyValues(kind, fields, draft, direct);
    return { ...applied, usedAi: false };
  }

  // Only what the reporter can actually see and change is described to the
  // model, so it cannot invent a field id that the draft has no step for.
  const described = fields.map((f) => ({
    id: f.step.id,
    label: f.label,
    value: f.value,
    ...(f.step.type === "choice"
      ? { options: (f.step.choices || []).map((c) => c.label).slice(0, 20) }
      : {}),
  }));

  const res = await geminiGenerate(
    [
      {
        role: "user",
        parts: [
          {
            text:
              `Report fields:\n${JSON.stringify(described, null, 1)}\n\n` +
              `Correction from the reporter:\n${String(text).slice(0, 1000)}`,
          },
        ],
      },
    ],
    { json: true, systemInstruction: EDIT_SYSTEM, errorSource: "flow-edit", maxOutputTokens: 2048 }
  );

  if (!res.ok || !res.text.trim()) {
    return {
      draft,
      changes: [],
      rejected: [],
      usedAi: true,
      error: res.error || "the correction could not be read",
    };
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(res.text.trim().replace(/```(?:json)?/gi, "")) as Record<string, unknown>;
  } catch {
    return { draft, changes: [], rejected: [], usedAi: true, error: "the correction could not be read" };
  }

  if (parsed.understood === false) return { draft, changes: [], rejected: [], usedAi: true };

  const values: Record<string, string> = {};
  for (const e of Array.isArray(parsed.edits) ? parsed.edits : []) {
    const rec = e as Record<string, unknown>;
    const id = String(rec?.id ?? "").trim();
    const value = rec?.value;
    if (!id || value === undefined || value === null) continue;
    values[id] = String(value);
  }

  const applied = applyValues(kind, fields, draft, values);
  return { ...applied, usedAi: true };
}

/** The reply that tells the reporter exactly what their correction did. */
export function describeFlowChanges(result: FlowEditResult): string {
  const rejected = result.rejected.length
    ? `\n\n⚠️ <b>${result.rejected.length} መስክ አልተቀበልንም</b>\n` +
      result.rejected.map((r) => `• ${escapeHtml(r.label)}: ${escapeHtml(r.reason)}`).join("\n")
    : "";

  if (result.error) {
    // Say WHICH half failed. The free-text path needs the model and the model
    // is down; the numbered path needs nothing and still works. Read as "could
    // not read the correction" this looked like the editor being broken.
    return (
      `⚠️ የAI አገልግሎቱ አሁን አይገኝም፣ ስለዚህ በነጻ ጽሑፍ የተላከውን ማስተካከያ መረዳት አልቻልኩም።\n\n` +
      `እባክዎ የመስኩን ቁጥር ተጠቅመው ይላኩ — ለምሳሌ <code>3 = 45</code> ወይም <code>3 45</code>። ` +
      `በአንድ መልእክት ብዙ መስመር መላክ ይችላሉ።${rejected}`
    );
  }

  if (result.changes.length === 0) {
    // The case that used to be silent.
    return (
      (result.rejected.length === 0
        ? `ℹ️ ምንም አልተቀየረም — ማስተካከያውን አልተረዳሁትም።\n\n` +
          `እባክዎ የመስኩን ቁጥር ይጠቀሙ፣ ለምሳሌ "3 = 45" ወይም "Supplier = ABC"።`
        : `ℹ️ ምንም አልተቀየረም።`) + rejected
    );
  }

  return (
    `✏️ <b>${result.changes.length} መስክ ተቀይሯል</b>\n` +
    result.changes.map((c) => `• ${escapeHtml(c.label)}: ${escapeHtml(c.from)} → <b>${escapeHtml(c.to)}</b>`).join("\n") +
    rejected
  );
}
