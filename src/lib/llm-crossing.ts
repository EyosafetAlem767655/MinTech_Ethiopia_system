import type { GeminiContent, GeminiPart } from "@/lib/llm-types";

/**
 * Translating one request from Gemini's shape into the OpenAI-compatible shape
 * the two backup providers speak, and the answer back again.
 *
 * This exists so an outage at one provider is a slower answer rather than a
 * dead feature. Gemini goes down — it has, repeatedly, with every model busy at
 * once — and NVIDIA's Nemotron (text, and function calling) and Qwen-VL (image
 * reading) are already configured in this system for other jobs.
 *
 * Pure by design: no network, no clients, no keys. The mapping is the part that
 * can be wrong in a way nobody notices until a figure is off, so it is the part
 * that is tested on its own.
 *
 * TWO SHAPES, ONE MEANING. Gemini puts the system prompt in its own field and
 * carries tool calls as `functionCall` / `functionResponse` PARTS inside the
 * conversation; OpenAI uses a `system` message, an assistant message with
 * `tool_calls`, and separate `tool` messages keyed by id. Everything below is
 * that correspondence, written out once.
 */

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface OpenAiTool {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object";

/** Text of a part, if it is a text part. */
function partText(p: GeminiPart): string {
  return isObj(p) && typeof p.text === "string" ? p.text : "";
}

/** The inline image on a part, in either spelling Gemini accepts. */
function partImage(p: GeminiPart): { mime: string; data: string } | null {
  if (!isObj(p)) return null;
  const inline = (p.inline_data ?? p.inlineData) as Record<string, unknown> | undefined;
  if (!isObj(inline)) return null;
  const data = typeof inline.data === "string" ? inline.data : "";
  if (!data) return null;
  const mime = String(inline.mime_type ?? inline.mimeType ?? "image/jpeg");
  return { mime, data };
}

/** True when any part of the conversation carries an image. */
export function hasImages(contents: GeminiContent[]): boolean {
  return contents.some((c) => (c.parts || []).some((p) => partImage(p) !== null));
}

/**
 * A deterministic id for the nth tool call of a turn.
 *
 * OpenAI pairs a result to its call by id; Gemini pairs them by NAME and
 * position. Deriving the id from both means the pairing survives a model that
 * asked for the same tool twice in one turn — which the chat does, routinely.
 */
export function toolCallId(turn: number, index: number, name: string): string {
  return `call_${turn}_${index}_${name}`.slice(0, 64);
}

/**
 * Gemini `contents` + system instruction → OpenAI messages.
 *
 * Images become data URLs, which is what both backup endpoints accept. A part
 * the mapping does not understand is dropped rather than guessed at: a request
 * that arrives subtly different is worse than one that arrives plainly smaller.
 */
export function toOpenAiMessages(
  contents: GeminiContent[],
  opts: { systemInstruction?: string; json?: boolean } = {}
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  if (opts.systemInstruction) out.push({ role: "system", content: opts.systemInstruction });
  // JSON mode is a generationConfig flag for Gemini. For an OpenAI-compatible
  // endpoint it is safer to ASK in words than to rely on response_format, which
  // not every model behind these base URLs honours — and every caller strips
  // fences before parsing anyway.
  if (opts.json) {
    out.push({ role: "system", content: "Reply with strict JSON only. No prose, no markdown fences." });
  }

  contents.forEach((c, turn) => {
    const parts = c.parts || [];

    // A model turn carrying function calls becomes an assistant message with
    // `tool_calls` and no content.
    const calls = parts.filter((p) => isObj(p) && isObj(p.functionCall));
    if (c.role === "model" && calls.length > 0) {
      const text = parts.map(partText).filter(Boolean).join("\n");
      out.push({
        role: "assistant",
        content: text,
        tool_calls: calls.map((p, i) => {
          const fc = (p as Record<string, Record<string, unknown>>).functionCall;
          const name = String(fc.name || "");
          return {
            id: toolCallId(turn, i, name),
            type: "function" as const,
            function: { name, arguments: JSON.stringify(fc.args ?? {}) },
          };
        }),
      });
      return;
    }

    // A user turn carrying function RESULTS becomes one `tool` message each,
    // paired back to the ids minted for the model turn just above it.
    const results = parts.filter((p) => isObj(p) && isObj(p.functionResponse));
    if (results.length > 0) {
      results.forEach((p, i) => {
        const fr = (p as Record<string, Record<string, unknown>>).functionResponse;
        const name = String(fr.name || "");
        out.push({
          role: "tool",
          tool_call_id: toolCallId(turn - 1, i, name),
          content: JSON.stringify(fr.response ?? {}),
        });
      });
      return;
    }

    // An ordinary turn: text, and images when there are any.
    const images = parts.map(partImage).filter((x): x is { mime: string; data: string } => x !== null);
    const text = parts.map(partText).filter(Boolean).join("\n");
    if (images.length === 0) {
      if (text) out.push({ role: c.role === "model" ? "assistant" : "user", content: text });
      return;
    }
    out.push({
      role: "user",
      content: [
        ...images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mime};base64,${img.data}` },
        })),
        ...(text ? [{ type: "text", text }] : []),
      ],
    });
  });

  return out;
}

/**
 * Gemini tool declarations → OpenAI tools.
 *
 * Both describe parameters with JSON Schema, so the schema travels unchanged;
 * only the envelope differs. Gemini nests declarations under `functionDeclarations`
 * and may be given several tool objects at once.
 */
export function toOpenAiTools(tools: unknown): OpenAiTool[] {
  const list = Array.isArray(tools) ? tools : [tools];
  const out: OpenAiTool[] = [];
  for (const entry of list) {
    if (!isObj(entry)) continue;
    const decls = entry.functionDeclarations ?? entry.function_declarations;
    if (!Array.isArray(decls)) continue;
    for (const d of decls) {
      if (!isObj(d) || typeof d.name !== "string") continue;
      out.push({
        type: "function",
        function: {
          name: d.name,
          description: typeof d.description === "string" ? d.description : undefined,
          parameters: isObj(d.parameters) ? (d.parameters as Record<string, unknown>) : undefined,
        },
      });
    }
  }
  return out;
}

/**
 * What came back from the backup provider → the shape every caller already reads.
 *
 * Arguments arrive as a JSON STRING and are parsed here. A string that will not
 * parse yields an empty argument object rather than throwing: the tool then
 * runs with its defaults, which is a worse answer but still an answer, and the
 * alternative is the whole conversation failing on one malformed call.
 */
export function fromOpenAiMessage(message: unknown): {
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
} {
  if (!isObj(message)) return { text: "", calls: [] };
  const text = typeof message.content === "string" ? message.content : "";
  const raw = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const calls = raw
    .map((c: unknown) => {
      if (!isObj(c) || !isObj(c.function)) return null;
      const fn = c.function as Record<string, unknown>;
      const name = String(fn.name || "");
      if (!name) return null;
      let args: Record<string, unknown> = {};
      try {
        const parsed = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
        if (isObj(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        // Left empty on purpose — see the note above.
      }
      return { name, args };
    })
    .filter((c): c is { name: string; args: Record<string, unknown> } => c !== null);
  return { text, calls };
}
