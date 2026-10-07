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
/**
 * What a removed upload shows instead of a broken image.
 *
 * Uploaded photos are deleted three months after their subject is decided
 * (src/lib/storage.ts), and every panel shows photos with a plain <img>. A 404
 * there is a broken-image icon that reads as a fault; this reads as what it is.
 * Served with a short cache so a wrongly-removed file that is restored shows up.
 */
const REMOVED_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">` +
  `<rect width="320" height="200" rx="12" fill="#f5f5f4"/>` +
  `<text x="160" y="94" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" fill="#57534e">Photo removed</text>` +
  `<text x="160" y="118" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#78716c">kept 3 months after the decision</text>` +
  `</svg>`;

function removedPhoto() {
  return new NextResponse(REMOVED_SVG, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=3600" },
  });
}

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
  // A uuid with no row is an upload the retention sweep has removed.
  if (!row) return removedPhoto();

  try {
    const bytes = await getFileBytesByPath(row.storage_path);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.content_type,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return removedPhoto();
  }
}
