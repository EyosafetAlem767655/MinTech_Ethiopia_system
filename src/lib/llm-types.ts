/**
 * The shapes the provider layer passes around.
 *
 * Apart from llm.ts so the cross-provider mapping (llm-crossing.ts) can be a
 * pure module: importing llm.ts for a type would pull the API clients, the keys
 * and every prompt in the system into anything that wanted one.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeminiPart = Record<string, any>;

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export interface GeminiCall {
  name: string;
  args: Record<string, unknown>;
  /**
   * Gemini 3's opaque reasoning token for this call.
   *
   * It must be echoed back VERBATIM on the part when the conversation is sent
   * again, or the API refuses the next turn outright:
   *
   *   400 INVALID_ARGUMENT — Function call is missing a thought_signature in
   *   functionCall parts.
   *
   * Which is exactly what happened to the dashboard chat: every question that
   * actually reached the database failed on the round after its first tool
   * call. It is meaningless to us and must not be inspected or regenerated —
   * only carried back.
   */
  thoughtSignature?: string;
}

export interface GeminiCallResult {
  ok: boolean;
  /** Concatenated text parts of the first candidate. */
  text: string;
  /** Function calls the model asked for, when tools were supplied. */
  calls: GeminiCall[];
  error?: string;
  /** HTTP status, when the call reached Google and was refused. */
  status?: number;
  /** The model this attempt actually used. */
  model?: string;
}
