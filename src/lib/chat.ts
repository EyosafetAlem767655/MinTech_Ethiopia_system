import OpenAI from "openai";
import { textAI, TEXT_MODEL } from "@/lib/llm";
import {
  damageTripwires,
  getDailySeries,
  getYesterdayNumbers,
  missingWithholding,
  monthOnMonth,
  pendingPurchaseRequests,
  receivablesAging,
} from "@/lib/metrics";
import sql from "@/lib/sql";
import { getLotBalances } from "@/lib/metrics";

/**
 * Company chatbot with full data access via tool-calling. The model decides
 * which queries to run; every figure it reports comes from a tool result.
 */

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_yesterday_numbers",
      description: "Yesterday's key numbers: truckloads, sacks produced/sold, revenue invoiced, cash collected, damage claims.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trends",
      description: "Daily series of production (sacks), sales (ETB invoiced) and collections (ETB) for the last N days, plus month-on-month comparison.",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "7, 30 or 90", default: 30 } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_money_status",
      description: "Receivables aging buckets, overdue clients, invoices missing withholding receipts, pending purchase requests.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bag_control",
      description: "Bag lots with reconciled balances and gaps, recent damage claims with AI verdicts/flags, and damage tripwires by worker/shift/supplier.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_records",
      description: "Search recent raw records by collection.",
      parameters: {
        type: "object",
        properties: {
          collection: {
            type: "string",
            enum: [
              "invoices",
              "stone_deliveries",
              "shift_reports",
              "receipts",
              "damage_claims",
              "bag_lots",
              "purchase_requests",
              "briefs",
            ],
          },
          client: { type: "string", description: "Filter invoices by client name (regex, optional)" },
          limit: { type: "number", default: 20 },
        },
        required: ["collection"],
      },
    },
  },
];

async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_yesterday_numbers":
      return getYesterdayNumbers();
    case "get_trends": {
      const days = Math.min(Number(args.days) || 30, 90);
      const [series, mom] = await Promise.all([getDailySeries(days), monthOnMonth()]);
      return { days, series, monthOnMonth: mom };
    }
    case "get_money_status": {
      const [aging, withholding, prs] = await Promise.all([
        receivablesAging(),
        missingWithholding(),
        pendingPurchaseRequests(),
      ]);
      return { receivablesAging: aging, missingWithholdingReceipts: withholding, pendingPurchaseRequests: prs };
    }
    case "get_bag_control": {
      const [lots, claims, tripwires] = await Promise.all([
        getLotBalances(),
        sql`
          select c.id, c.quantity, c.status, c.worker, c.flags, c.created_at,
                 (select jsonb_agg(jsonb_build_object('ai', p.ai)) from claim_photos p where p.claim_id = c.id) as photos
            from damage_claims c order by c.created_at desc limit 30`,
        damageTripwires(),
      ]);
      return { lots, recentClaims: claims, tripwires };
    }
    case "search_records": {
      const limit = Math.min(Number(args.limit) || 20, 50);
      switch (args.collection) {
        case "invoices":
          // Parameterised ILIKE — no unescaped input into a regex.
          return args.client
            ? sql`select * from invoices where client ilike '%' || ${String(args.client)} || '%' order by invoiced_at desc limit ${limit}`
            : sql`select * from invoices order by invoiced_at desc limit ${limit}`;
        case "stone_deliveries":
          return sql`select * from stone_deliveries order by date desc limit ${limit}`;
        case "shift_reports":
          return sql`select * from shift_reports order by date desc limit ${limit}`;
        case "receipts":
          return sql`select * from receipts order by created_at desc limit ${limit}`;
        case "damage_claims":
          return sql`select * from damage_claims order by created_at desc limit ${limit}`;
        case "bag_lots":
          return sql`select * from bag_lots order by received_at desc limit ${limit}`;
        case "purchase_requests":
          return sql`select * from purchase_requests order by created_at desc limit ${limit}`;
        case "briefs":
          return sql`select * from briefs order by created_at desc limit ${limit}`;
      }
      return { error: "unknown collection" };
    }
  }
  return { error: "unknown tool" };
}

export async function companyChat(
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are the internal assistant of MinTech Ethiopia, a mining company that crushes stone into sacks. " +
        "You can query live company data with the provided tools — production, sales, collections, receivables, " +
        "bag-lot control, damage claims and purchase requests. ALWAYS fetch data with tools before quoting figures; " +
        "never estimate or invent numbers. Currency is ETB. Today is " +
        new Date().toISOString().slice(0, 10) +
        ". Be concise, direct, and flag anything that looks like a problem.",
    },
    ...messages.slice(-12),
  ];

  for (let round = 0; round < 4; round++) {
    const res = await textAI().chat.completions.create({
      model: TEXT_MODEL,
      messages: convo,
      tools,
      max_tokens: 800,
    });
    const msg = res.choices[0]?.message;
    if (!msg) break;
    convo.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content || "I could not produce an answer.";
    }
    for (const tc of msg.tool_calls) {
      let result: unknown;
      try {
        result = await runTool(tc.function.name, JSON.parse(tc.function.arguments || "{}"));
      } catch (e) {
        result = { error: String(e) };
      }
      convo.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, 24000),
      });
    }
  }

  // Final pass without tools so the model must answer.
  const final = await textAI().chat.completions.create({
    model: TEXT_MODEL,
    messages: convo,
    max_tokens: 800,
  });
  return final.choices[0]?.message?.content || "I could not produce an answer.";
}
