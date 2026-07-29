// Builds every brand raster the app needs from the single source logo
// (scripts/assets/logo-source.png): a cleaned transparent logo, the PWA icons,
// and the manifest install screenshots. Runs on `npm run build` (prebuild hook).
//
// The source logo ships on a solid white background. We flood-fill that white
// away from the borders (so white *inside* letters/gears is preserved), erode a
// couple of rings to kill the anti-alias halo, then trim — giving a clean
// transparent wordmark we can place on any surface.
import sharp from "sharp";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const icons = join(root, "public", "icons");
const shots = join(root, "public", "screenshots");
const publicDir = join(root, "public");
const source = join(root, "scripts", "assets", "logo-source.png");
mkdirSync(icons, { recursive: true });
mkdirSync(shots, { recursive: true });

const NEAR_WHITE = 236; // r,g,b all >= this counts as background white
const HALO_LIGHT = 214; // min channel >= this is a light anti-alias fringe pixel
const HALO_PASSES = 5; // rings of fringe to erode inward from the background

/** Remove the white background from the source logo and return a trimmed sharp. */
async function cleanLogo() {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const isWhite = (i) => data[i] >= NEAR_WHITE && data[i + 1] >= NEAR_WHITE && data[i + 2] >= NEAR_WHITE;
  // A JPEG source leaves a light halo (below pure white) around the artwork; treat
  // those light-but-not-white pixels as fringe so they can be eroded away too.
  const isLight = (i) => Math.min(data[i], data[i + 1], data[i + 2]) >= HALO_LIGHT;
  const idx = (x, y) => (y * width + x) * channels;

  // 1. Flood-fill white inward from every border pixel → the exterior region.
  const outside = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (outside[p] || !isWhite(idx(x, y))) return;
    outside[p] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // 2. Erode rings of light fringe bordering the exterior — eats the JPEG halo.
  for (let pass = 0; pass < HALO_PASSES; pass++) {
    const grow = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (outside[p] || !isLight(idx(x, y))) continue;
        if (
          (x > 0 && outside[p - 1]) ||
          (x < width - 1 && outside[p + 1]) ||
          (y > 0 && outside[p - width]) ||
          (y < height - 1 && outside[p + width])
        )
          grow.push(p);
      }
    }
    for (const p of grow) outside[p] = 1;
  }

  // 3. Zero the alpha of the exterior region.
  for (let p = 0; p < width * height; p++) if (outside[p]) data[p * channels + 3] = 0;

  return sharp(data, { raw: { width, height, channels } })
    .png()
    .trim({ threshold: 1 }); // drop the now-transparent margin
}

// Brand colours sampled from the logo, so every generated surface rhymes with it.
const BRAND_RED = "#d92629";
const LOGO_BG_TOP = "#ffffff";
const LOGO_BG_BOTTOM = "#eef3f4"; // the logo's own cool-light background tone

/** SVG for a soft light background matching the logo's own backdrop. */
const iconBg = (size, round) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${LOGO_BG_TOP}"/>
      <stop offset="1" stop-color="${LOGO_BG_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${round}" fill="url(#g)"/>
</svg>`;

/** Compose the logo centred on a light square icon. `safe` = logo width fraction. */
async function makeIcon(logoPng, size, round, safe, file) {
  const bg = Buffer.from(iconBg(size, round));
  const logo = await sharp(logoPng)
    .resize({ width: Math.round(size * safe), height: Math.round(size * safe * 0.62), fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp(bg).composite([{ input: logo, gravity: "center" }]).png().toFile(join(icons, file));
}

/** A branded install screenshot: logo + tagline on a light canvas. */
async function makeScreenshot(logoPng, w, h, file) {
  const bg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fdf5f3"/>
          <stop offset="1" stop-color="#ffffff"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <rect x="0" y="0" width="${w}" height="${Math.round(h * 0.020)}" fill="${BRAND_RED}"/>
      <text x="${w / 2}" y="${h * 0.64}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
            font-size="${Math.round(Math.min(w, h) * 0.045)}" font-weight="700" fill="#3e160d">Operations Dashboard</text>
      <text x="${w / 2}" y="${h * 0.70}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
            font-size="${Math.round(Math.min(w, h) * 0.030)}" fill="${BRAND_RED}">Production · Assets · Sales · Finance</text>
    </svg>`);
  const logo = await sharp(logoPng)
    .resize({ width: Math.round(w * 0.62), fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const logoMeta = await sharp(logo).metadata();
  await sharp(bg)
    .composite([{ input: logo, left: Math.round((w - logoMeta.width) / 2), top: Math.round(h * 0.30) }])
    .png()
    .toFile(join(shots, file));
}

async function run() {
  const clean = await cleanLogo();
  const logoPng = await clean.toBuffer();

  // Cleaned, transparent logo for use across the UI (light surfaces).
  await sharp(logoPng).toFile(join(publicDir, "logo.png"));

  // PWA icons — logo centred on a light square.
  await makeIcon(logoPng, 192, 36, 0.82, "icon-192.png");
  await makeIcon(logoPng, 512, 96, 0.82, "icon-512.png");
  await makeIcon(logoPng, 512, 0, 0.66, "icon-maskable-512.png"); // full-bleed, safe zone
  await makeIcon(logoPng, 180, 0, 0.82, "apple-touch-icon.png"); // iOS masks corners itself

  // Install screenshots for the richer Chrome install dialog.
  await makeScreenshot(logoPng, 1080, 1920, "narrow.png");
  await makeScreenshot(logoPng, 1280, 800, "wide.png");

  console.log("✓ Logo cleaned + icons & screenshots generated");
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
