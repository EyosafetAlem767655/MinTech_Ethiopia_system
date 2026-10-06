import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { loadImage } from "@/lib/images";
import { analyseToolPhoto, verifyRequestLegitimacy } from "@/lib/llm";
import { ledgerLabel } from "@/lib/products";
import { processPpDamageReport, type PpDamagePile } from "@/lib/pp-bag-damage";

export const dynamic = "force-dynamic";

/**
 * The AI checks that did NOT run, and a way to run them again.
 *
 * Every photo verdict in this system is written with `checked: false` when the
 * model could not be reached, precisely so a provider outage never reads as an
 * accusation against the employee who filed the report. That was the right call
 * and it left a hole: the submission is saved, the figures are counted, and the
 * verdict is simply absent for ever — there was no way to ask again once the
 * provider came back.
 *
 * So the gap is now a list, and the list has a button. The report itself is
 * never touched: a re-check writes a verdict and nothing else, so re-running one
 * can neither move a figure nor change who filed it.
 */

type Kind = "purchase_request" | "pp_bag_damage";

interface Pending {
  kind: Kind;
  id: string;
  label: string;
  by: string;
  at: string | null;
  /** Why it is listed — "never ran" or the error the attempt recorded. */
  reason: string;
}

export async function GET() {
  const out: Pending[] = [];

  // Purchase requests: the maintenance ones carry a photo of the damaged item,
  // and that photo is the whole evidence behind the spend.
  const prs = await sql<Record<string, string | null>[]>`
    select id, title, kind, requested_by as by, created_at as at,
           legitimacy->>'observations' as note,
           coalesce(photo_file_id::text, tg_file_id) as photo
      from purchase_requests
     where (legitimacy is null or legitimacy->>'checked' = 'false')
       and coalesce(photo_file_id::text, tg_file_id) is not null
     order by created_at desc
     limit 60
  `.catch(() => []);
  for (const p of prs) {
    out.push({
      kind: "purchase_request",
      id: String(p.id),
      label: `🛒 ${p.title || "Purchase request"}`,
      by: String(p.by || "—"),
      at: p.at ? String(p.at) : null,
      reason: p.note || "the check never ran",
    });
  }

  const bags = await sql<Record<string, string | null>[]>`
    select id, reason, quantity, reported_by as by, created_at as at
      from pp_bag_damage_reports
     where ai is null or ai->>'checked' = 'false'
     order by created_at desc
     limit 60
  `.catch(() => []);
  for (const b of bags) {
    out.push({
      kind: "pp_bag_damage",
      id: String(b.id),
      label: `🧺 ${b.quantity || "?"} bags · ${b.reason || "damage"}`,
      by: String(b.by || "—"),
      at: b.at ? String(b.at) : null,
      reason: "the photo check never ran",
    });
  }

  out.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return NextResponse.json({ rows: out });
}

/** POST { kind, id } — run the check again and store whatever comes back. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const kind = String(body?.kind || "") as Kind;
  const id = String(body?.id || "");
  if (!id || (kind !== "purchase_request" && kind !== "pp_bag_damage")) {
    return NextResponse.json({ error: "kind and id are required" }, { status: 400 });
  }

  if (kind === "purchase_request") {
    const [row] = await sql<
      { title: string | null; quantity: number | null; kind: string | null; amount: string | null; photo: string | null }[]
    >`
      select title, quantity, kind, amount,
             coalesce(photo_file_id::text, tg_file_id) as photo
        from purchase_requests where id = ${id}
    `;
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!row.photo) return NextResponse.json({ error: "this request has no photograph to check" }, { status: 400 });

    const image = await loadImage(row.photo).catch(() => null);
    if (!image) {
      return NextResponse.json({ error: "the photograph could not be loaded back" }, { status: 502 });
    }

    // Two different questions, as at submission time: a maintenance request is
    // asked whether the photo shows the damage claimed; anything else is asked
    // whether the document supports the spend. Re-checking must ask the SAME
    // question the row's verdict shape already answers, or the panel reading it
    // would show a legitimacy score where it expects a photo verdict.
    const verdict =
      row.kind === "maintenance"
        ? await analyseToolPhoto(image, String(row.title || ""), Number(row.quantity) || undefined)
        : await verifyRequestLegitimacy(
            image.base64,
            image.contentType,
            "purchase_request",
            row.title ? `item: ${row.title}, amount: ${row.amount ?? "?"}` : undefined
          ).catch(() => null);

    if (!verdict) {
      return NextResponse.json({ error: "the model is still unreachable — try again later" }, { status: 502 });
    }
    // A second failed attempt is stored as a failed attempt, not thrown away:
    // the row stays in the list and the reason it gives is the newest one.
    await sql`update purchase_requests set legitimacy = ${sql.json(verdict as never)} where id = ${id}`;
    const ran = (verdict as { checked?: boolean }).checked !== false;
    return NextResponse.json({ ok: ran, ran, verdict });
  }

  // PP bag damage: the piles are rebuilt from the saved rows, and the previous
  // photo rows are cleared FIRST. Without that, the duplicate search would find
  // this report's own photos and flag the report as a copy of itself.
  const piles = await sql<{ file_id: string; ledger_key: string; quantity: number }[]>`
    select file_id, ledger_key, quantity
      from pp_bag_damage_items
     where report_id = ${id}
     order by position
  `.catch(() => []);
  if (piles.length === 0) {
    return NextResponse.json({ error: "no photographed piles are stored for this report" }, { status: 400 });
  }
  const [report] = await sql<{ reason: string | null }[]>`
    select reason from pp_bag_damage_reports where id = ${id}
  `;
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });

  await sql`delete from pp_bag_damage_photos where report_id = ${id}`;
  const list: PpDamagePile[] = piles.map((p) => ({
    fileId: p.file_id,
    ledgerKey: p.ledger_key,
    quantity: Number(p.quantity) || 0,
    label: ledgerLabel("bag", p.ledger_key),
  }));
  const v = await processPpDamageReport(id, list, String(report.reason || "")).catch(() => null);
  if (!v) return NextResponse.json({ error: "the check failed again" }, { status: 502 });
  return NextResponse.json({ ok: v.ai.checked, ran: v.ai.checked, verdict: v.ai, trustScore: v.trustScore });
}
