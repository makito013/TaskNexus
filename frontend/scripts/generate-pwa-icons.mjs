// Disposable script — run once (`node scripts/generate-pwa-icons.mjs`) to
// (re)generate the PWA icon set from frontend/public/favicon.svg. Not part
// of the build pipeline; the generated PNGs are committed to
// frontend/public/icons/ (including apple-touch-icon-*.png) like any
// other static asset.
//
// Why rasterize instead of using favicon.svg directly as a PWA icon:
// - favicon.svg has no background (the <rect> fill is commented out) — a
//   raw rasterization is a transparent PNG, which breaks both the
//   apple-touch-icon (iOS composites it onto whatever the home screen is)
//   and the maskable icon (Android's mask expects opaque content up to the
//   safe zone). Every icon here gets an opaque #0d0d0d background baked in,
//   matching --bg-base / the manifest's background_color/theme_color.
// - The maskable icon additionally needs the logo shrunk so it survives
//   Android's circular safe-zone crop (a circle of radius 40% of the icon
//   size, i.e. an 80%-diameter circle centered on the icon). The logo is
//   scaled to ~80% of the canvas, which — combined with the margin already
//   baked into favicon.svg's own viewBox — keeps it inside that circle.
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ICONS_DIR = path.join(PUBLIC_DIR, 'icons');
const SOURCE_SVG = path.join(PUBLIC_DIR, 'favicon.svg');

// Same value as --bg-base (frontend/src/index.css) and the pre-JS background
// in frontend/index.html — keeps the icon background indistinguishable from
// the app's own background on platforms that don't crop to a mask.
const BACKGROUND_COLOR = '#0d0d0d';

async function renderIcon({ outputPath, size, logoScale }) {
  const logoSize = Math.round(size * logoScale);
  const logoBuffer = await sharp(readFileSync(SOURCE_SVG))
    .resize(logoSize, logoSize)
    .png()
    .toBuffer();

  const offset = Math.round((size - logoSize) / 2);

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BACKGROUND_COLOR,
    },
  })
    .composite([{ input: logoBuffer, left: offset, top: offset }])
    .png()
    .toFile(outputPath);

  console.log(`Wrote ${path.relative(PUBLIC_DIR, outputPath)} (${size}x${size})`);
}

async function main() {
  mkdirSync(ICONS_DIR, { recursive: true });

  await renderIcon({ outputPath: path.join(ICONS_DIR, 'icon-192.png'), size: 192, logoScale: 0.8 });
  await renderIcon({ outputPath: path.join(ICONS_DIR, 'icon-512.png'), size: 512, logoScale: 0.8 });
  // Maskable: same 80% scale, but the safe-zone requirement (Android's
  // circular mask, radius 40% of the icon size) is the reason this variant
  // exists separately — see the file header comment.
  await renderIcon({ outputPath: path.join(ICONS_DIR, 'icon-512-maskable.png'), size: 512, logoScale: 0.8 });
  await renderIcon({ outputPath: path.join(ICONS_DIR, 'apple-touch-icon-180.png'), size: 180, logoScale: 0.8 });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
