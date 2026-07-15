import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 150, 500);
  const action = req.nextUrl.searchParams.get("action");

  const [items, counts] = await Promise.all([
    sql`
      select id as _id, chat_id as "chatId", actor, positions, audience, action, detail, ok,
             created_at as "createdAt"
        from bot_activity
       ${action ? sql`where action = ${action}` : sql``}
       order by created_at desc
       limit ${limit}
    `,
    sql<{ action: string; count: string }[]>`
      select action, count(*) as count
        from bot_activity
       where created_at >= now() - interval '24 hours'
       group by action
    `,
  ]);

  return NextResponse.json({
    items,
    last24h: Object.fromEntries(counts.map((c) => [c.action, Number(c.count)])),
  });
}
