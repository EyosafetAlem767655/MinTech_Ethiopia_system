import { NextRequest, NextResponse } from "next/server";
import sql, { isUuid } from "@/lib/sql";

export const dynamic = "force-dynamic";

/**
 * Edit / delete a single daily submission from the Brief. The three daily-report
 * collections keep their body in different columns, so the collection segment
 * selects the table + text column. Table/column names can't be parameterised, so
 * each is a fixed literal branch (never interpolated from user input).
 */
const COLLECTIONS = ["daily", "hr", "materials"] as const;
type Collection = (typeof COLLECTIONS)[number];

function isCollection(v: string): v is Collection {
  return (COLLECTIONS as readonly string[]).includes(v);
}

export async function PATCH(req: NextRequest, { params }: { params: { collection: string; id: string } }) {
  if (!isCollection(params.collection) || !isUuid(params.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Text is required." }, { status: 400 });

  if (params.collection === "daily") {
    await sql`update daily_reports set text = ${text}, updated_at = now() where id = ${params.id}`;
  } else if (params.collection === "hr") {
    await sql`update hr_reports set text = ${text} where id = ${params.id}`;
  } else {
    await sql`update material_counts set raw_text = ${text} where id = ${params.id}`;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { collection: string; id: string } }) {
  if (!isCollection(params.collection) || !isUuid(params.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (params.collection === "daily") {
    await sql`delete from daily_reports where id = ${params.id}`;
  } else if (params.collection === "hr") {
    await sql`delete from hr_reports where id = ${params.id}`;
  } else {
    await sql`delete from material_counts where id = ${params.id}`;
  }
  return NextResponse.json({ ok: true });
}
