// Stage 1: dump a compact per-page model (lines with styled spans, images, rules) to pages/NNNN.json
import * as mupdf from "mupdf";
import fs from "fs";
const PDF = process.env.PDF || "C:/Users/phewi/Downloads/Biology-AP-Courses_-_WEB.pdf";
const doc = mupdf.Document.openDocument(fs.readFileSync(PDF), "application/pdf");
fs.mkdirSync("pages", { recursive: true });
const from = +(process.argv[2] ?? 0), to = +(process.argv[3] ?? doc.countPages());

function bounds(path, m) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const pt = (x, y) => { const X = m[0]*x + m[2]*y + m[4], Y = m[1]*x + m[3]*y + m[5];
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y); };
  path.walk({ moveTo: pt, lineTo: pt, curveTo: (a, b, c, d, e, f) => { pt(a, b); pt(c, d); pt(e, f); }, closePath() {} });
  return [x0, y0, x1, y1].map(v => +v.toFixed(1));
}
const fontCache = new Map();
function fontInfo(f) {
  let name = f.getName().replace(/^[A-Z]{6}\+/, "");
  return name;
}
const r1 = v => Math.round(v * 10) / 10;

for (let p = from; p < to; p++) {
  const page = doc.loadPage(p);
  const st = page.toStructuredText("preserve-whitespace,preserve-images");
  const blocks = [], images = [];
  let blk = null, line = null;
  st.walk({
    onImageBlock(bbox) { images.push(bbox.map(r1)); },
    beginTextBlock(bbox) { blk = { bbox: bbox.map(r1), lines: [] }; },
    endTextBlock() { if (blk.lines.length) blocks.push(blk); blk = null; },
    beginLine(bbox) { line = { bbox: bbox.map(r1), chars: [] }; },
    endLine() { if (line.chars.length) blk.lines.push(line); line = null; },
    onChar(c, origin, font, size, quad) {
      line.chars.push({ c, y: origin[1], x: origin[0], f: fontInfo(font), s: size, x1: Math.max(quad[2], quad[6]) });
    },
  });
  // compress chars into spans
  for (const b of blocks) for (const l of b.lines) {
    const counts = {};
    let maxS = 0;
    for (const ch of l.chars) { maxS = Math.max(maxS, ch.s); if (ch.c.trim()) counts[ch.f + "|" + ch.s] = (counts[ch.f + "|" + ch.s] || 0) + 1; }
    const ys = {};
    for (const ch of l.chars) if (ch.s >= maxS - 0.01 && ch.c.trim()) ys[Math.round(ch.y)] = (ys[Math.round(ch.y)] || 0) + 1;
    const base = +Object.entries(ys).sort((a, b) => b[1] - a[1])[0]?.[0] || l.chars[0].y;
    const major = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || (l.chars[0].f + "|" + l.chars[0].s);
    const [mf, ms] = major.split("|");
    l.font = mf; l.size = Math.round(+ms * 10) / 10;
    const spans = [];
    let prevX1 = null;
    for (const ch of l.chars) {
      const b = /Bold|Black|SemiBold/.test(ch.f), i = /Italic|Oblique/.test(ch.f);
      let sc = "";
      if (ch.s < maxS * 0.85 && ch.c.trim()) { if (ch.y < base - 0.8) sc = "sup"; else if (ch.y > base + 0.8) sc = "sub"; }
      let c = ch.c;
      // a wide gap usually means something drawn as vector art (math) sits there: start a new span so it can be slotted in later
      const gapX = prevX1 === null ? 0 : ch.x - prevX1;
      // insert a space when there is a visible gap with no space char
      if (prevX1 !== null && ch.x - prevX1 > ch.s * 0.25 && c.trim() && spans.length && !/\s$/.test(spans[spans.length - 1].t)) c = " " + c;
      prevX1 = ch.x1;
      const last = spans[spans.length - 1];
      if (last && last.b === b && last.i === i && last.sc === sc && !(gapX > 2)) { last.t += c; last.x1 = ch.x1; }
      else spans.push({ t: c, b, i, sc, x0: ch.x, x1: ch.x1 });
    }
    l.spans = spans.map(s => { const o = { t: s.t, x0: Math.round(s.x0 * 10) / 10, x1: Math.round(s.x1 * 10) / 10 }; if (s.b) o.b = 1; if (s.i) o.i = 1; if (s.sc) o.sc = s.sc; return o; });
    l.text = spans.map(s => s.t).join("");
    delete l.chars;
  }
  const rules = [];
  page.run(new mupdf.Device({
    fillPath(path, eo, ctm, cs, color) { rules.push({ k: "f", b: bounds(path, ctm), c: color.map(v => +v.toFixed(2)) }); },
    strokePath(path, s, ctm, cs, color) { rules.push({ k: "s", b: bounds(path, ctm), c: color.map(v => +v.toFixed(2)) }); },
  }), mupdf.Matrix.identity);
  fs.writeFileSync(`pages/${String(p).padStart(4, "0")}.json`, JSON.stringify({ p, blocks, images, rules: rules.filter(r => r.b[2] - r.b[0] < 700) }));
  if (p % 100 === 0) console.log("page", p);
}
