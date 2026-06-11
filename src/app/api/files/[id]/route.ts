import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { StoredFile } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await dbConnect();
  const file = await StoredFile.findById(params.id).lean();
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(Buffer.from(file.data as unknown as Uint8Array), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
