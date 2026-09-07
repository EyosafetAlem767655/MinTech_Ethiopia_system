import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/sql";
import { getFileRow, getFileBytesByPath } from "@/lib/storage";
import { downloadTelegramFile } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Serve one image by reference — from the bucket, or straight from Telegram.
 *
 * Receipts and vouchers are no longer uploaded: they are read once and the
 * figures are the record. What is kept is Telegram's own file id, which resolves
 * back to the same image indefinitely. Resolving it here is what lets the
 * dashboard still show the paperwork behind a row without a byte of it living in
 * storage.
 *
 * A uuid is a `stored_files` row (historic rows, and the flows that still
 * upload); anything else is a Telegram id. Same URL shape either way, so every
 * panel that links to /api/files/<ref> works unchanged.
 *
 * This route is behind the dashboard password like every other non-public /api
 * path — see PUBLIC_PREFIXES in src/middleware.ts.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ref = params.id;

  if (!isUuid(ref)) {
    const dl = await downloadTelegramFile(ref).catch(() => null);
    if (!dl) return NextResponse.json({ error: "not found" }, { status: 404 });
    const ext = (dl.path.split(".").pop() || "").toLowerCase();
    const type =
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "pdf" ? "application/pdf" : "image/jpeg";
    return new NextResponse(new Uint8Array(dl.buffer), {
      headers: {
        "Content-Type": type,
        // Long-lived: a Telegram file id addresses one immutable file, so the
        // browser re-fetching it would only cost another round trip to Telegram.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  const row = await getFileRow(ref);
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
