// Helpers for locating doors in a 360° panorama.
//
//   node scripts/preview.mjs grid <image> <out.jpg> [width=1600]
//     Whole panorama with yaw lines every 15° (labelled every 30°) and pitch lines every 15°.
//
//   node scripts/preview.mjs crop <image> <yawFrom> <yawTo> <pitchFrom> <pitchTo> <out.jpg>
//     Zoomed crop of a region (e.g. a candidate door), with a fine 5° grid and labels.

import sharp from 'sharp';

const [mode, src, ...rest] = process.argv.slice(2);
const label = (x, y, text, color) =>
  `<text x="${x}" y="${y}" fill="${color}" font-size="15" font-family="Arial" font-weight="bold" stroke="black" stroke-width="3" paint-order="stroke">${text}</text>`;

if (mode === 'grid') {
  const [out, W = 1600] = rest;
  const w = +W, h = w / 2;
  let svg = '';
  for (let yaw = -180; yaw <= 180; yaw += 15) {
    const x = ((yaw + 180) / 360) * w;
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${yaw % 90 === 0 ? 'red' : 'yellow'}" stroke-width="1" opacity=".6"/>`;
    if (yaw % 30 === 0) svg += label(x + 3, h / 2 - 5, yaw, 'yellow');
  }
  for (let p = -75; p <= 75; p += 15) {
    const y = ((90 - p) / 180) * h;
    svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${p === 0 ? 'red' : 'cyan'}" stroke-width="1" opacity=".6"/>` + label(3, y - 3, p, 'cyan');
  }
  await sharp(src).resize(w, h)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`) }])
    .jpeg({ quality: 80 }).toFile(out);
} else if (mode === 'crop') {
  const [y0, y1, p0, p1, out] = rest;
  const [yawA, yawB] = [+y0, +y1].sort((a, b) => a - b);
  const [pitA, pitB] = [+p0, +p1].sort((a, b) => a - b);
  const img = sharp(src);
  const { width: W, height: H } = await img.metadata();
  const px = (yaw) => Math.round(((yaw + 180) / 360) * W);
  const py = (pitch) => Math.round(((90 - pitch) / 180) * H);
  const left = px(yawA), top = py(pitB), cw = px(yawB) - left, ch = py(pitA) - top;
  const scale = Math.min(1, 900 / Math.max(cw, ch));
  const w = Math.round(cw * scale), h = Math.round(ch * scale);
  let svg = '';
  for (let yaw = Math.ceil(yawA / 5) * 5; yaw <= yawB; yaw += 5) {
    const x = ((yaw - yawA) / (yawB - yawA)) * w;
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="yellow" stroke-width="1" opacity=".5"/>` + label(x + 2, 16, yaw, 'yellow');
  }
  for (let p = Math.ceil(pitA / 5) * 5; p <= pitB; p += 5) {
    const y = ((pitB - p) / (pitB - pitA)) * h;
    svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="cyan" stroke-width="1" opacity=".5"/>` + label(3, y - 3, p, 'cyan');
  }
  await sharp(src).extract({ left, top, width: cw, height: ch }).resize(w, h)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`) }])
    .jpeg({ quality: 82 }).toFile(out);
} else {
  console.error('Usage:\n  preview.mjs grid <image> <out.jpg> [width]\n  preview.mjs crop <image> <yawFrom> <yawTo> <pitchFrom> <pitchTo> <out.jpg>');
  process.exit(1);
}
console.log('wrote', rest.at(-1) && isNaN(+rest.at(-1)) ? rest.at(-1) : rest[0]);
