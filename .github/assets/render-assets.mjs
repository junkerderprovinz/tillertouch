// Renders every TillerTouch image from the master, icon.svg, which is embedded
// as it is:
//
//   icon.png             512, transparent
//   banner.svg/.png      white 1600x500, logo, name and claim (README, light)
//   banner-dark.svg/.png #0d1117 1600x500, the same (README, dark)
//   banner-logo.svg/.png white 1600x500, logo only
//
// The compass reads on both grounds, so both banners embed the same master and
// only the text colours change. The layout matches the other banners: logo ink
// 400px with its left edge at x=165 and its centre at y=250, name 132, claim 44,
// logo-to-text gap 70, name-to-claim gap 8.
//
// Needs @resvg/resvg-js and opentype.js installed globally. The fonts (OFL) are
// fetched to the temp folder. Run: node .github/assets/render-assets.mjs

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const globalRoot = execSync("npm root -g").toString().trim();
const { Resvg } = require(`${globalRoot}/@resvg/resvg-js`);
const opentype = require(`${globalRoot}/opentype.js`);
const here = (file) => new URL(`./${file}`, import.meta.url);

const NAME = "TillerTouch";
const CLAIM = "Keeps every reply on course.";
const W = 1600, H = 500, INK = 400;
const nameSize = 132, claimSize = 44, gap = 70, lineGap = 8;
const themes = [
  { suffix: "", bg: "#ffffff", name: "#1f2328", claim: "#5a5d5e" },
  { suffix: "-dark", bg: "#0d1117", name: "#e6edf3", claim: "#9aa4ad" },
];

const master = readFileSync(here("icon.svg"), "utf8");
const vb = master.match(/viewBox="([^"]+)"/)[1];
const [vbX, vbY, vbW, vbH] = vb.split(/[\s,]+/).map(Number);

// Anchored by the ink rather than the box, so a mark inset in its viewBox still
// lands on the same line as the other banners.
const ink = new Resvg(Buffer.from(master)).innerBBox();
const scale = INK / Math.max(ink.width, ink.height);
const boxW = vbW * scale, boxH = vbH * scale;
const LX = 165 - (ink.x - vbX) * scale;
const LY = H / 2 - ((ink.y - vbY) + ink.height / 2) * scale;
const textX = 165 + ink.width * scale + gap;

const embed = (x, y, w, h) => master.replace(/<svg\b[^>]*>/,
  `<svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">`);
const png = (svg, size, bg = "rgba(0,0,0,0)") =>
  new Resvg(Buffer.from(svg), { fitTo: { mode: "width", value: size }, background: bg }).render().asPng();

async function font(file, url) {
  const path = join(tmpdir(), file);
  if (!existsSync(path)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font fetch ${res.status} ${url}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  const bytes = readFileSync(path);
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const bree = await font("TillerTouch-BreeSerif-Regular.ttf",
  "https://github.com/google/fonts/raw/main/ofl/breeserif/BreeSerif-Regular.ttf");
const lato = await font("TillerTouch-Lato-Regular.ttf",
  "https://github.com/google/fonts/raw/main/ofl/lato/Lato-Regular.ttf");

const nameAsc = bree.ascender * (nameSize / bree.unitsPerEm);
const nameDesc = -bree.descender * (nameSize / bree.unitsPerEm);
const claimAsc = lato.ascender * (claimSize / lato.unitsPerEm);
const blockH = nameAsc + nameDesc + lineGap + claimAsc;
const nameBaseline = H / 2 - blockH / 2 + nameAsc;
const claimBaseline = nameBaseline + nameDesc + lineGap + claimAsc;

// opentype.js can emit a NaN control point for a glyph drawn far from the origin,
// so each glyph is drawn at x=0 and moved into place, stepping advance and
// kerning by hand as getPath would.
function glyphs(face, text, size) {
  const unit = size / face.unitsPerEm;
  const list = face.stringToGlyphs(text);
  const out = [];
  let x = 0;
  for (let i = 0; i < list.length; i++) {
    const d = list[i].getPath(0, 0, size).toPathData(2);
    if (d) out.push({ d, x });
    x += list[i].advanceWidth * unit;
    if (i + 1 < list.length) x += face.getKerningValue(list[i], list[i + 1]) * unit;
  }
  return out;
}
const paint = (list, y, fill) =>
  list.map((g) => `<path transform="translate(${g.x.toFixed(2)},${y.toFixed(2)})" d="${g.d}" fill="${fill}"/>`).join("\n    ");
const nameGlyphs = glyphs(bree, NAME, nameSize);
const claimGlyphs = glyphs(lato, CLAIM, claimSize);
const rightEdge = textX + Math.max(bree.getAdvanceWidth(NAME, nameSize), lato.getAdvanceWidth(CLAIM, claimSize));
if (W - rightEdge < 120) throw new Error(`right margin ${(W - rightEdge).toFixed(0)}px, the banners keep at least 120`);

writeFileSync(here("icon.png"), png(master, 512));

for (const t of themes) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${embed(LX, LY, boxW, boxH)}
  <g transform="translate(${textX.toFixed(2)},0)">
    ${paint(nameGlyphs, nameBaseline, t.name)}
    ${paint(claimGlyphs, claimBaseline, t.claim)}
  </g>
</svg>
`;
  writeFileSync(here(`banner${t.suffix}.svg`), svg);
  writeFileSync(here(`banner${t.suffix}.png`), png(svg, W, t.bg));
}

const logoOnly = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  ${embed((W - boxW) / 2, (H - boxH) / 2, boxW, boxH)}
</svg>
`;
writeFileSync(here("banner-logo.svg"), logoOnly);
writeFileSync(here("banner-logo.png"), png(logoOnly, W, "#ffffff"));

console.log(`ink ${ink.width.toFixed(1)}x${ink.height.toFixed(1)} in ${vbW}x${vbH}, right margin ${(W - rightEdge).toFixed(0)}px`);
