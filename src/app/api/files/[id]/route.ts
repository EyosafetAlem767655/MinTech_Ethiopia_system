import { NextRequest, NextResponse } from "next/server";
import { getFileRow, getFileBytesByPath } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const row = await getFileRow(params.id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const bytes = await getFileBytesByPath(row.storage_path);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.content_type,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
