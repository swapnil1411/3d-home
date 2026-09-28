// Creates web-optimised copies of 360° panoramas for the tour.
//
// Usage:
//   node scripts/optimize-images.mjs <source-image> [<source-image> ...]
//   node scripts/optimize-images.mjs            (re-processes everything in 360-tour/images/original/)
//
// For each source it:
//   1. copies the untouched original to 360-tour/images/original/ (if not already there)
//   2. checks the image is 2:1 (equirectangular) and warns loudly if not
//   3. writes 360-tour/images/<name>.jpg         (max 6000 px wide, desktop)
//      and    360-tour/images/mobile/<name>.jpg  (max 4096 px wide, phones)

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const TOUR_DIR = path.resolve(import.meta.dirname, '..', '360-tour');
const ORIGINAL_DIR = path.join(TOUR_DIR, 'images', 'original');
const OUTPUTS = [
  { dir: path.join(TOUR_DIR, 'images'), width: 6000 },
  { dir: path.join(TOUR_DIR, 'images', 'mobile'), width: 4096 },
];
const QUALITY = 80;
const TARGET_BYTES = 3 * 1024 * 1024;

sharp.cache(false);
sharp.concurrency(0);

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

async function processImage(src) {
  const name = path.parse(src).name;
  fs.mkdirSync(ORIGINAL_DIR, { recursive: true });
  const original = path.join(ORIGINAL_DIR, path.basename(src));
  if (path.resolve(src) !== original && !fs.existsSync(original)) {
    fs.copyFileSync(src, original);
  }

  const { width, height } = await sharp(original, { limitInputPixels: false }).metadata();
  const ratio = width / height;
  console.log(`\n${name}: ${width}×${height} (ratio ${ratio.toFixed(3)})`);
  if (Math.abs(ratio - 2) > 0.01) {
    console.warn(`  ⚠️  WARNING: ${name} is NOT 2:1. A 360° equirectangular panorama must be exactly twice as wide as it is tall.`);
    console.warn('     It will look stretched/distorted in the viewer. Re-export it from the source at 2:1.');
  }

  for (const { dir, width: maxWidth } of OUTPUTS) {
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${name}.jpg`);
    const w = Math.min(width, maxWidth);
    await sharp(original, { limitInputPixels: false })
      .flatten({ background: '#000000' }) // drop alpha channel if present
      .resize({ width: w, height: Math.round(w / ratio) })
      .jpeg({ quality: QUALITY, mozjpeg: true, progressive: true })
      .toFile(out);
    const size = fs.statSync(out).size;
    const flag = size > TARGET_BYTES ? '  ⚠️  over 3 MB target' : '';
    console.log(`  → ${path.relative(TOUR_DIR, out)}  ${w}×${Math.round(w / ratio)}  ${mb(size)}${flag}`);
  }
}

let sources = process.argv.slice(2);
if (sources.length === 0) {
  sources = fs.readdirSync(ORIGINAL_DIR)
    .filter((f) => /\.(jpe?g|png|tiff?|webp)$/i.test(f))
    .map((f) => path.join(ORIGINAL_DIR, f));
}
if (sources.length === 0) {
  console.error('No images given. Usage: node scripts/optimize-images.mjs path/to/panorama.jpg');
  process.exit(1);
}
for (const src of sources) await processImage(src);
