// Rasterizes the brand SVG into the PNG icons the PWA manifest needs.
// Runs automatically on `npm run build` (prebuild hook).
import sharp from "sharp";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a63d25"/>
      <stop offset="1" stop-color="#733122"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="url(#bg)"/>
  <g transform="translate(256 268)">
    <path d="M -150 90 L -70 -90 L -20 30 L 30 -60 L 110 90 Z" fill="#ffffff" opacity="0.95"/>
    <path d="M -20 30 L 30 -60 L 110 90 L 8 90 Z" fill="#f2b6a8" opacity="0.9"/>
    <circle cx="92" cy="-118" r="34" fill="#f8d5cc"/>
  </g>
  <text x="256" y="452" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="64" fill="#ffffff" letter-spacing="6">MINTECH</text>
</svg>`;

async function run() {
  const normal = Buffer.from(svg(false));
  const maskable = Buffer.from(svg(true));
  await sharp(normal).resize(192, 192).png().toFile(join(out, "icon-192.png"));
  await sharp(normal).resize(512, 512).png().toFile(join(out, "icon-512.png"));
  await sharp(maskable).resize(512, 512).png().toFile(join(out, "icon-maskable-512.png"));
  await sharp(normal).resize(180, 180).png().toFile(join(out, "apple-touch-icon.png"));
  console.log("✓ PWA icons generated in public/icons");
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
