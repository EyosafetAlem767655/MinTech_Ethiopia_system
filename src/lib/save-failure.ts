import { escapeHtml } from "@/lib/flow-edit";

/**
 * What to tell the person when ✅ could not save, by the database's own error
 * code. Every message ends with what to do next: nothing was saved, so the
 * card can be corrected (✏️) and sent again, or cancelled and started over.
 */
export function saveFailureMessage(e: unknown, generic: string): string {
  const code = String((e as { code?: string })?.code || "");
  const next = "\n\n✏️ አርመው ✅ ን እንደገና ይጫኑ፣ ወይም ሰርዘው እንደገና ይጀምሩ።";
  if (code === "23505") return "⚠️ ይህ መረጃ ቀደም ብሎ ተመዝግቧል (ተደጋጋሚ ቁጥር)። ምንም አልተቀመጠም።" + next;
  if (code === "23514") return "⚠️ ከተሞሉት መስኮች አንዱ ትክክል አይደለም (ለምሳሌ TIN 10 አሃዝ)። ምንም አልተቀመጠም።" + next;
  if (code === "22P02" || code === "22003") return "⚠️ አንድ ቁጥር ትክክል አይደለም ወይም በጣም ትልቅ ነው። ምንም አልተቀመጠም።" + next;
  // A message thrown on purpose by the save (an over-payment, a missing
  // choice) is already written for the person — show it.
  const msg = e instanceof Error ? e.message : "";
  if (msg && !code && !(e instanceof TypeError) && !(e instanceof RangeError) && msg.length < 300) return `⚠️ ${escapeHtml(msg)}\nምንም አልተቀመጠም።` + next;
  return generic + next;
}
