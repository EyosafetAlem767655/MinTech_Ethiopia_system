import type OpenAI from "openai";
import { geminiGenerate, type GeminiContent } from "@/lib/llm";
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
 *
 * Runs on Gemini. The tool catalogue below is still written in OpenAI's
 * JSON-Schema shape because that is the readable one and several tools are
 * shared vocabulary with the rest of the codebase — `toGeminiTools` translates
 * it at the call site.
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
      name: "get_sales_reports",
      description:
        "Sales reports filed by the sales team on the Telegram bot, with every reported column " +
        "(date, customer, FS No, Att.No, product, qty, unit price, sub total, VAT, grand total, " +
        "withholding, net pay, deposited bank) plus each row's AI cross-check verdict. This is the " +
        "'Sales report' the sales department files daily — it is SEPARATE from the invoices table. " +
        "Use this for any question about sales reports, receipts scanned by the sales team, cash " +
        "sales, FS numbers, or which customer bought what.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "How many days back to include. Default 30.", default: 30 },
          customer: { type: "string", description: "Filter by customer name (partial match, optional)" },
          limit: { type: "number", default: 50 },
        },
      },
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
              "sales_receipts",
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
    case "get_sales_reports": {
      const days = Math.min(Number(args.days) || 30, 365);
      const limit = Math.min(Number(args.limit) || 50, 200);
      const since = new Date(Date.now() - days * 86400_000);
      const customer = args.customer ? String(args.customer) : "";
      const rows = customer
        ? await sql`
            select date, customer_name as "customerName", fs_no as "fsNo", att_no as "attNo",
                   product_ty as "productTy", qty, unit_price as "unitPrice", sub_total as "subTotal",
                   vat, grand_total as "grandTotal", withhold, net_pay as "netPay",
                   deposited_bank as "depositedBank", remark, status, reported_by as "reportedBy",
                   receipt_check as "receiptCheck"
              from sales_receipts
             where date >= ${since} and customer_name ilike '%' || ${customer} || '%'
             order by date desc limit ${limit}`
        : await sql`
            select date, customer_name as "customerName", fs_no as "fsNo", att_no as "attNo",
                   product_ty as "productTy", qty, unit_price as "unitPrice", sub_total as "subTotal",
                   vat, grand_total as "grandTotal", withhold, net_pay as "netPay",
                   deposited_bank as "depositedBank", remark, status, reported_by as "reportedBy",
                   receipt_check as "receiptCheck"
              from sales_receipts
             where date >= ${since}
             order by date desc limit ${limit}`;

      // Totals alongside the rows: the row list is capped by `limit`, so a model
      // adding up only what it can see would under-report on a busy month.
      const [totals] = customer
        ? await sql<{ n: string; grand: string; net: string; wht: string }[]>`
            select count(*) as n, coalesce(sum(grand_total),0) as grand,
                   coalesce(sum(net_pay),0) as net, coalesce(sum(withhold),0) as wht
              from sales_receipts
             where date >= ${since} and customer_name ilike '%' || ${customer} || '%'`
        : await sql<{ n: string; grand: string; net: string; wht: string }[]>`
            select count(*) as n, coalesce(sum(grand_total),0) as grand,
                   coalesce(sum(net_pay),0) as net, coalesce(sum(withhold),0) as wht
              from sales_receipts
             where date >= ${since}`;

      return {
        days,
        totals: {
          reports: Number(totals?.n) || 0,
          grandTotalEtb: Number(totals?.grand) || 0,
          netPayableEtb: Number(totals?.net) || 0,
          withholdingEtb: Number(totals?.wht) || 0,
        },
        rows,
      };
    }
    case "search_records": {
      const limit = Math.min(Number(args.limit) || 20, 50);
      switch (args.collection) {
        case "sales_receipts":
          return sql`select * from sales_receipts order by date desc limit ${limit}`;
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

/* ────────────────────── OpenAI schema → Gemini schema ─────────────────────── */

/**
 * Gemini's function declarations use a trimmed OpenAPI dialect: types are
 * UPPERCASE, and it rejects keywords it does not know — `default` among them,
 * which several tools above use. Translate rather than hand-maintaining a second
 * copy of the catalogue that would silently drift from `runTool`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toGeminiSchema(node: any): any {
  if (!node || typeof node !== "object") return node;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "default") continue; // not part of Gemini's dialect
    if (k === "type" && typeof v === "string") out.type = v.toUpperCase();
    else if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    } else if (k === "items") out.items = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

function geminiTools() {
  return [
    {
      functionDeclarations: tools.map((t) => {
        // A parameterless tool must omit `parameters` entirely — an empty
        // properties object is rejected.
        const params = toGeminiSchema(t.function.parameters);
        const hasProps = params?.properties && Object.keys(params.properties).length > 0;
        return {
          name: t.function.name,
          description: t.function.description,
          ...(hasProps ? { parameters: params } : {}),
        };
      }),
    },
  ];
}

export async function companyChat(
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const systemPrompt =
        "You are the internal assistant of MinTech Ethiopia, a mining company that crushes stone into sacks. " +
        "You can query live company data with the provided tools — production, sales, collections, receivables, " +
        "bag-lot control, damage claims and purchase requests. " +
        "There are TWO distinct sales channels and you must not confuse them: `invoices` (credit sales, billed to " +
        "a client) and the sales team's daily Sales report (`sales_receipts`, filed on the Telegram bot from " +
        "scanned receipts) — use get_sales_reports for the latter. If a question just says 'sales', check both " +
        "and say which channel each figure came from. " +
        "ALWAYS fetch data with tools before quoting figures; " +
        "never estimate or invent numbers. Currency is ETB. Today is " +
        new Date().toISOString().slice(0, 10) +
        ". Be concise, direct, and flag anything that looks like a problem.";

  // Gemini has no system role: the instructions lead the first user turn.
  const history = messages.slice(-12);
  const convo: GeminiContent[] = history.map((m, i) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: i === 0 ? `${systemPrompt}\n\n---\n\n${m.content}` : m.content }],
  }));
  if (convo.length === 0 || convo[0].role !== "user") {
    convo.unshift({ role: "user", parts: [{ text: systemPrompt }] });
  }

  // Two tool rounds is enough for these queries and keeps us inside maxDuration.
  // The chat is not inside the Telegram webhook, so it can afford a longer budget
  // than the receipt reader's.
  const CHAT_TIMEOUT_MS = 20000;

  for (let round = 0; round < 2; round++) {
    const res = await geminiGenerate(convo, {
      tools: geminiTools(),
      temperature: 0.2,
      maxOutputTokens: 900,
      timeoutMs: CHAT_TIMEOUT_MS,
    });

    // A transport failure must not hang or blank the chat — break out and try a
    // plain, tool-free answer below with whatever data was already gathered.
    if (!res.ok) {
      console.error("chat tool round failed, falling back to plain answer:", res.error);
      break;
    }
    if (res.calls.length === 0) {
      if (res.text.trim()) return res.text;
      break;
    }

    // Echo the calls back as a model turn, then answer each one. Gemini requires
    // the functionCall turn to be present before its functionResponse.
    convo.push({
      role: "model",
      parts: res.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
    });

    const responses = [];
    for (const call of res.calls) {
      let result: unknown;
      try {
        result = await runTool(call.name, call.args);
      } catch (e) {
        result = { error: String(e) };
      }
      responses.push({
        functionResponse: {
          name: call.name,
          // Truncated: a wide table can otherwise crowd out the question itself.
          response: { result: JSON.stringify(result).slice(0, 24000) },
        },
      });
    }
    convo.push({ role: "user", parts: responses });
  }

  // Final pass: keep the full conversation (including any tool results already
  // fetched) so the answer is grounded, and nudge the model to reply in prose.
  const final = await geminiGenerate(
    [...convo, { role: "user", parts: [{ text: "Answer my question now using the data above. Do not call any more tools." }] }],
    { temperature: 0.2, maxOutputTokens: 900, timeoutMs: CHAT_TIMEOUT_MS }
  );
  if (final.ok && final.text.trim()) return final.text;

  console.error("chat final pass failed:", final.error);
  return "The assistant is taking too long to respond right now. Please try again in a moment.";
}
