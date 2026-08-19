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
import { eatDateLabel } from "@/lib/dates";
import { requiresDailyReport } from "@/lib/positions";
import { splitByCompliance } from "@/lib/compliance";

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
      name: "get_daily_submissions",
      description:
        "The reports employees file on the Telegram bot each day: the free-text daily report " +
        "(daily_reports), HR/customer reports (hr_reports) and material counts (material_counts). " +
        "Returns the actual text of each submission with who wrote it and when. Use this for any " +
        "question about what staff reported, said, or flagged — including 'what was submitted today'.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "How many days back. Default 3." },
          person: { type: "string", description: "Filter by employee name (partial match, optional)" },
          limit: { type: "number", description: "Max rows per collection. Default 25." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_asset_reports",
      description:
        "Asset-management reports, ROW BY ROW: raw material received (supplier, delivery-note no, " +
        "truck plate, MRV, tonnage per material), finished-goods deliveries (customer, invoice in " +
        "cash/credit, delivery note, tonnage per product) and purchased items. Use this for any " +
        "question naming a supplier, a truck, a customer delivery, or a specific material/product " +
        "tonnage over a period.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["raw_material", "delivery", "purchase_items", "all"],
            description: "Which report to read. Default 'all'.",
          },
          days: { type: "number", description: "How many days back. Default 30." },
          limit: { type: "number", description: "Max rows. Default 50." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_production_reports",
      description:
        "Production-side reports ROW BY ROW: the daily production grid (production_reports: FGR no " +
        "and tons per product), the monthly stock status (stock_status_reports) and the daily " +
        "operations report (daily_ops_reports: delivered, received, closing stock and bag counts). " +
        "Use this for questions about output, stock on hand, or bag usage.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "How many days back. Default 30." },
          limit: { type: "number", description: "Max rows per report type. Default 25." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_submission_compliance",
      description:
        "Who filed their daily report and who did not, for a given day. Cross-references the " +
        "employee roster (telegram_users, and which roles are obliged to report daily) against the " +
        "bot activity log. Use this for 'who has not submitted', 'who is behind', 'did X report today'.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "EAT day as YYYY-MM-DD. Defaults to today." },
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
              "daily_reports",
              "hr_reports",
              "material_counts",
              "daily_ops_reports",
              "production_reports",
              "stock_status_reports",
              "raw_material_receipts",
              "delivery_reports",
              "purchase_item_reports",
              "bot_activity",
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
    case "get_daily_submissions": {
      const days = Math.min(Number(args.days) || 3, 120);
      const limit = Math.min(Number(args.limit) || 25, 100);
      const since = new Date(Date.now() - days * 86400_000);
      const who = args.person ? `%${String(args.person)}%` : "%";
      const [daily, hr, materials] = await Promise.all([
        sql`select full_name as "fullName", positions, date_key as "dateKey", text,
                   array_length(photo_file_ids, 1) as photos, created_at as "createdAt"
              from daily_reports
             where created_at >= ${since} and full_name ilike ${who}
             order by created_at desc limit ${limit}`,
        sql`select full_name as "fullName", kind, text, created_at as "createdAt"
              from hr_reports
             where created_at >= ${since} and full_name ilike ${who}
             order by created_at desc limit ${limit}`,
        sql`select counted_by as "countedBy", date_key as "dateKey", raw_text as "text",
                   created_at as "createdAt"
              from material_counts
             where created_at >= ${since} and counted_by ilike ${who}
             order by created_at desc limit ${limit}`,
      ]);
      return { days, dailyReports: daily, hrReports: hr, materialCounts: materials };
    }

    case "get_asset_reports": {
      const kind = String(args.kind || "all");
      const days = Math.min(Number(args.days) || 30, 365);
      const limit = Math.min(Number(args.limit) || 50, 200);
      const since = new Date(Date.now() - days * 86400_000);
      const out: Record<string, unknown> = { days };

      if (kind === "raw_material" || kind === "all") {
        out.rawMaterialReceived = await sql`
          select date, supplier, dn_no as "dnNo", truck_plate as "truckPlate", mrv_no as "mrvNo",
                 materials, reported_by as "reportedBy"
            from raw_material_receipts
           where date >= ${since} order by date desc limit ${limit}`;
      }
      if (kind === "delivery" || kind === "all") {
        out.deliveries = await sql`
          select date, customer, invoice_cash as "invoiceCash", invoice_credit as "invoiceCredit",
                 qty as "totalQty", delivery_no as "deliveryNo", products, reported_by as "reportedBy"
            from delivery_reports
           where date >= ${since} order by date desc limit ${limit}`;
      }
      if (kind === "purchase_items" || kind === "all") {
        out.purchasedItems = await sql`
          select date, description, uom, qty, supplier, amount, cost_center as "costCenter",
                 purchaser, reported_by as "reportedBy"
            from purchase_item_reports
           where date >= ${since} order by date desc limit ${limit}`;
      }
      return out;
    }

    case "get_production_reports": {
      const days = Math.min(Number(args.days) || 30, 365);
      const limit = Math.min(Number(args.limit) || 25, 100);
      const since = new Date(Date.now() - days * 86400_000);
      const [production, stock, ops] = await Promise.all([
        sql`select date, fgr_no as "fgrNo", products, reported_by as "reportedBy"
              from production_reports where date >= ${since}
             order by date desc limit ${limit}`,
        sql`select month, items, reported_by as "reportedBy", created_at as "createdAt"
              from stock_status_reports order by created_at desc limit ${limit}`,
        sql`select date_label as "dateLabel", date, delivered, received, stock, bags,
                   reported_by as "reportedBy"
              from daily_ops_reports where date >= ${since}
             order by date desc limit ${limit}`,
      ]);
      return { days, productionReports: production, stockStatus: stock, dailyOpsReports: ops };
    }

    case "get_submission_compliance": {
      const day = typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
        ? args.date
        : eatDateLabel(new Date());
      const dayStart = new Date(`${day}T00:00:00+03:00`);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);

      const roster = await sql<{ full_name: string; positions: string[]; active: boolean }[]>`
        select full_name, positions, active from telegram_users where active = true
      `;
      // Only roles that actually owe a daily report count as "missing" — holding
      // a receiver-only role (HR, admin) is not a failure to submit.
      const obliged = roster.filter((u) => requiresDailyReport(u.positions));

      // Same definition the reminder cron and the dashboard panel use: each
      // role's own submission tables, not `daily_reports` alone.
      const { submitted, missing } = await splitByCompliance(day, obliged);

      // The raw activity log too, so questions about non-obliged staff still
      // have something to work with.
      const filed = await sql<{ actor: string }[]>`
        select distinct actor from bot_activity
         where action = 'submission' and ok = true
           and created_at >= ${dayStart} and created_at < ${dayEnd}
      `;

      return {
        date: day,
        obligedCount: obliged.length,
        submitted: submitted.map((u) => u.full_name),
        missing: missing.map((u) => u.full_name),
        allActorsToday: filed.map((f) => f.actor),
      };
    }

    case "search_records": {
      const limit = Math.min(Number(args.limit) || 20, 50);
      switch (args.collection) {
        case "sales_receipts":
          return sql`select * from sales_receipts order by date desc limit ${limit}`;
        case "daily_reports":
          return sql`select * from daily_reports order by created_at desc limit ${limit}`;
        case "hr_reports":
          return sql`select * from hr_reports order by created_at desc limit ${limit}`;
        case "material_counts":
          return sql`select * from material_counts order by created_at desc limit ${limit}`;
        case "daily_ops_reports":
          return sql`select * from daily_ops_reports order by date desc limit ${limit}`;
        case "production_reports":
          return sql`select * from production_reports order by date desc limit ${limit}`;
        case "stock_status_reports":
          return sql`select * from stock_status_reports order by created_at desc limit ${limit}`;
        case "raw_material_receipts":
          return sql`select * from raw_material_receipts order by date desc limit ${limit}`;
        case "delivery_reports":
          return sql`select * from delivery_reports order by date desc limit ${limit}`;
        case "purchase_item_reports":
          return sql`select * from purchase_item_reports order by date desc limit ${limit}`;
        case "bot_activity":
          return sql`select created_at, actor, action, detail, ok from bot_activity
                      order by created_at desc limit ${limit}`;
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
        "Staff file structured reports on the Telegram bot every day and you CAN read all of them: " +
        "use get_daily_submissions for the free-text daily/HR/material-count reports, get_asset_reports " +
        "for raw material received, deliveries and purchased items, get_production_reports for the " +
        "production grid, stock status and daily operations report, and get_submission_compliance for " +
        "who has or has not filed. If a question is about what someone reported, reach for those first. " +
        "ALWAYS fetch data with tools before quoting figures; " +
        "never estimate or invent numbers. If a tool result says it was TRUNCATED, say the answer is " +
        "partial and narrow the query rather than totalling what you can see. If the data genuinely " +
        "does not contain the answer, say so plainly instead of guessing. Currency is ETB. Today is " +
        eatDateLabel(new Date()) +
        " (East Africa Time). Be concise, direct, and flag anything that looks like a problem.";

  // The prompt goes in Gemini's own system_instruction field. It used to be
  // prepended to the first message of the window, which broke once the history
  // grew: slice(-12) can land on an ASSISTANT message, so the instructions ended
  // up attributed to the model and then unshifted a second time as a user turn.
  const convo: GeminiContent[] = messages.slice(-12).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  // Gemini requires the conversation to open on a user turn.
  while (convo.length > 0 && convo[0].role !== "user") convo.shift();
  if (convo.length === 0) return "I could not produce an answer.";

  // Three model passes have to fit inside the route's maxDuration of 60s, with
  // room for the DB queries between them — hence 12s each, not 20.
  const CHAT_TIMEOUT_MS = 12000;
  const tools = geminiTools();
  let lastError = "";
  let toolsRan = false;

  for (let round = 0; round < 2; round++) {
    const res = await geminiGenerate(convo, {
      systemInstruction: systemPrompt,
      tools,
      // Round one MUST query something. Left on AUTO, a small model happily
      // answers from thin air — which is exactly the "the AI can't see the
      // database" complaint, and flatly against this prompt's own rules.
      toolConfig: round === 0 ? { functionCallingConfig: { mode: "ANY" } } : undefined,
      temperature: 0.2,
      maxOutputTokens: 900,
      timeoutMs: CHAT_TIMEOUT_MS,
    });

    // A transport failure must not hang or blank the chat — break out and try to
    // answer below with whatever data was already gathered.
    if (!res.ok) {
      lastError = res.error || "unknown error";
      console.error("chat tool round failed:", lastError);
      break;
    }
    if (res.calls.length === 0) {
      if (res.text.trim()) return res.text;
      break;
    }

    // Echo back the model's own turn — including any text it emitted alongside
    // the calls, or the reconstructed history stops matching what it produced.
    const modelParts: Record<string, unknown>[] = [];
    if (res.text.trim()) modelParts.push({ text: res.text });
    for (const c of res.calls) modelParts.push({ functionCall: { name: c.name, args: c.args } });
    convo.push({ role: "model", parts: modelParts });

    const responses = [];
    for (const call of res.calls) {
      let result: unknown;
      try {
        result = await runTool(call.name, call.args);
        toolsRan = true;
      } catch (e) {
        console.error(`chat tool ${call.name} failed:`, e);
        result = { error: String(e) };
      }
      responses.push({
        functionResponse: { name: call.name, response: { result: clampResult(result) } },
      });
    }
    convo.push({ role: "user", parts: responses });
  }

  // Final pass: keep the full conversation (including any tool results already
  // fetched) so the answer is grounded, and nudge the model to reply in prose.
  //
  // `tools` MUST be passed even though we want no more calls. By now `convo`
  // holds functionCall/functionResponse parts, and Gemini rejects those outright
  // when no functionDeclarations accompany them — a 400 that fired on precisely
  // the requests where data HAD been fetched, making the assistant look blind to
  // the database. NONE forbids further calls without removing the declarations.
  const final = await geminiGenerate(
    [
      ...convo,
      { role: "user", parts: [{ text: "Answer my question now using the data above. Do not call any more tools." }] },
    ],
    {
      systemInstruction: systemPrompt,
      tools,
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
      temperature: 0.2,
      maxOutputTokens: 900,
      timeoutMs: CHAT_TIMEOUT_MS,
    }
  );
  if (final.ok && final.text.trim()) return final.text;

  // Throw rather than returning prose: the route must be able to tell a failure
  // from an answer, so it does not spend one of the day's ten questions on it.
  const why = final.error || lastError || "empty response";
  console.error("chat final pass failed:", why, toolsRan ? "(tools had run)" : "(no tools ran)");
  throw new Error(`The assistant could not complete the answer: ${why}`);
}

/**
 * Serialise a tool result for the model, with an explicit marker when it is cut.
 * A bare slice() ends mid-object and the model cannot tell clipped data from
 * complete data — it then reports a partial total as if it were the whole.
 */
function clampResult(result: unknown, limit = 24000): string {
  const json = JSON.stringify(result) ?? "null";
  if (json.length <= limit) return json;
  return (
    json.slice(0, limit) +
    `\n\n[TRUNCATED after ${limit} characters — this result is INCOMPLETE. ` +
    `Say so, and narrow the query (fewer days, or a filter) rather than totalling what you can see.]`
  );
}
