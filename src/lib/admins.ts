import sql from "@/lib/sql";

/**
 * Who the administrators are, and how to reach all of them.
 *
 * The error alert and the archive export each had their own copy of this
 * query, and two copies of "who is an admin" is how one of them ends up sending
 * to a different set of people than the other. Everything that messages the
 * administrators — and only them — goes through here. (The whiteness alert
 * also reaches HR, so it keeps its own, wider list.)
 *
 * An admin with no chat id has never signed into the bot, and there is no way
 * to message them; they are simply not in the list.
 */

export interface AdminRecipient {
  id: string;
  fullName: string;
  chatId: string;
}

export async function adminRecipients(): Promise<AdminRecipient[]> {
  const rows = await sql<{ id: string; full_name: string; chat_id: string }[]>`
    select id, full_name, chat_id
      from telegram_users
     where active = true and chat_id is not null and 'admin' = any(positions)
  `;
  return rows.map((r) => ({ id: String(r.id), fullName: r.full_name, chatId: String(r.chat_id) }));
}

/**
 * Send one message to every administrator. Returns how many received it.
 *
 * Never throws: it is called from failure paths — a job that just failed, an
 * error just logged — and a notifier that could throw would turn one handled
 * failure into an unhandled one. When nobody is signed in it falls back to the
 * owner's chat, because a failure nobody hears about is the one thing this
 * exists to prevent.
 */
export async function notifyAdmins(text: string): Promise<number> {
  try {
    const { sendMessage } = await import("@/lib/telegram");
    let targets = (await adminRecipients()).map((a) => a.chatId);
    if (targets.length === 0) {
      const ceo = (process.env.TELEGRAM_CEO_CHAT_ID || "").trim();
      if (ceo) targets = [ceo];
    }
    const sent = await Promise.all(
      targets.map((chatId) =>
        sendMessage(chatId, text)
          .then((r) => Boolean(r?.ok))
          .catch(() => false)
      )
    );
    return sent.filter(Boolean).length;
  } catch (e) {
    console.error("notifyAdmins failed:", e);
    return 0;
  }
}
