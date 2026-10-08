// Stage 2: turn the page cache into per-chapter JSON + figure images.
// usage: node stage2.mjs [chapterNumbers...] [--no-img]
import * as mupdf from "mupdf";
import fs from "fs";

const OUT = process.env.OUT || "out";
const args = process.argv.slice(2);
const noImg = args.includes("--no-img");
const only = args.filter(a => /^\d+$/.test(a)).map(Number);
const SCALE = 2;

const outline = JSON.parse(fs.readFileSync("outline.json"));
const tops = outline.filter(o => /^(Chapter \d+|Appendix|Index)/.test(o.title));
const chapters = [];
for (let i = 0; i < tops.length; i++) {
  const m = tops[i].title.match(/^Chapter (\d+) (.*)$/);
  if (!m) continue;
  chapters.push({ n: +m[1], title: m[2], start: tops[i].page, end: tops[i + 1].page, items: tops[i].down });
}

let doc = null;
const getDoc = () => doc ||= mupdf.Document.openDocument(fs.readFileSync(process.env.PDF || "C:/Users/phewi/Downloads/Biology-AP-Courses_-_WEB.pdf"), "application/pdf");
const loadPage = p => JSON.parse(fs.readFileSync(`pages/${String(p).padStart(4, "0")}.json`));

// ---------- helpers ----------
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const H = l => l.bbox[3] - l.bbox[1];
const W = b => b[2] - b[0];
function cls(l) {
  const f = l.font, s = l.size;
  if (/IBMPlexSans/.test(f) && s >= 20) return "chtitle";
  if (/Mulish-Regular/.test(f) && s >= 14) return "chnum";
  if (/Mulish-SemiBold/.test(f) && s >= 12) return "h2";
  if (/Mulish-SemiBold/.test(f) && s >= 10) return "h3";
  if (/Mulish-SemiBold/.test(f)) return "h4";
  if (/Mulish-Black/.test(f)) return "boxtitle";
  if (/Mulish-Medium/.test(f)) return "boxsub";
  if (/Mulish-Bold/.test(f) && s >= 8.5) return "label";
  if (s < 8.4) return "small";
  return "body";
}
const isColored = c => c.length >= 3 && Math.max(...c) - Math.min(...c) > 0.2;
const isBlack = c => (c.length === 1 && c[0] < 0.25) || (c.length === 3 && Math.max(...c) < 0.25);
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const inside = (b, r, pad = 1) => b[0] >= r[0] - pad && b[2] <= r[2] + pad && b[1] >= r[1] - pad && b[3] <= r[3] + pad;
const center = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const ctrIn = (b, r) => { const [x, y] = center(b); return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]; };

function spansHTML(spans) {
  let out = "";
  for (const s of spans) {
    if (s.img) { out += `<img class="math" src="${s.img}" alt="${esc(s.alt || "symbol")}" style="height:${(s.h / 9).toFixed(2)}em">`; continue; }
    let t = esc(s.t);
    if (s.sc) t = `<${s.sc}>${t}</${s.sc}>`;
    if (s.i) t = `<i>${t}</i>`;
    if (s.b) t = `<b>${t}</b>`;
    out += t;
  }
  return out;
}
// join lines into one html/text string, fixing line-break joins
function joinLines(lines) {
  let html = "", text = "";
  for (const l of lines) {
    const t = l.text;
    if (text) {
      const prev = text.replace(/\s+$/, "");
      const glue = /[-/\u2013]$/.test(prev) && !/\s-$/.test(prev) ? "" : " ";
      html = html.replace(/\s+$/, "") + glue;
      text = prev + glue;
    }
    html += spansHTML(l.spans);
    text += t;
  }
  html = html.replace(/<\/b><b>/g, "").replace(/<\/i><i>/g, "").replace(/\s+/g, " ").trim();
  text = text.replace(/\s+/g, " ").trim();
  return { html, text };
}

// ---------- per-page analysis ----------
function analysePage(pg, mathSink) {
  const lines = [];
  let printed = null;
  pg.blocks.forEach((b, bi) => b.lines.forEach((l, li) => {
    l.bi = bi; l.li = li; l.c = cls(l); l.page = pg.p;
    if (l.bbox[1] < 40 || l.bbox[1] > 748) { if (/^\d+\s*$/.test(l.text)) printed = +l.text.trim(); return; }
    if (!l.text.trim()) return;
    lines.push(l);
  }));
  // option letters / bullets drawn as their own tiny line: glue them onto the text beside them
  for (const m of lines.filter(l => /^\s*([a-e]\.|[•●▪◦]|\d+\s?\.)\s*$/.test(l.text) && W(l.bbox) < 22)) {
    const mate = lines.filter(l => l !== m && !l.merged && Math.abs(l.bbox[1] - m.bbox[1]) < 3 && l.bbox[0] > m.bbox[0] && l.bbox[0] - m.bbox[2] < 30)
      .sort((a, b) => a.bbox[0] - b.bbox[0])[0];
    if (!mate) continue;
    mate.spans = [{ t: m.text.trim() + " " }, ...mate.spans];
    mate.text = m.text.trim() + " " + mate.text;
    mate.bbox = [m.bbox[0], Math.min(m.bbox[1], mate.bbox[1]), mate.bbox[2], Math.max(m.bbox[3], mate.bbox[3])];
    m.merged = true;
  }
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].merged) lines.splice(i, 1);
  const thin = r => (r.b[3] - r.b[1] <= 2.5) || (r.b[2] - r.b[0] <= 2.5);
  const rules = pg.rules.filter(thin);

  // --- tables: clusters of black rules
  const black = rules.filter(r => isBlack(r.c) && (W(r.b) > 20 || r.b[3] - r.b[1] > 8));
  black.sort((a, b) => a.b[1] - b.b[1]);
  const clusters = [];
  for (const r of black) {
    const c = clusters.find(c => r.b[1] <= c.box[3] + 30 && r.b[3] >= c.box[1] - 30 && r.b[0] <= c.box[2] && r.b[2] >= c.box[0]);
    if (c) { c.rules.push(r); c.box = [Math.min(c.box[0], r.b[0]), Math.min(c.box[1], r.b[1]), Math.max(c.box[2], r.b[2]), Math.max(c.box[3], r.b[3])]; }
    else clusters.push({ rules: [r], box: [...r.b] });
  }
  // a lone top rule sitting above a tall header row belongs to the table below it
  for (let i = clusters.length - 1; i >= 0; i--) {
    const c1 = clusters[i];
    if (c1.rules.length !== 1 || c1.box[3] - c1.box[1] > 2.5) continue;
    const c2 = clusters.find(c => c !== c1 && c.rules.length >= 2 && c.box[1] - c1.box[3] > 0 && c.box[1] - c1.box[3] <= 90 && Math.abs(c.box[0] - c1.box[0]) < 6 && Math.abs(c.box[2] - c1.box[2]) < 6);
    if (!c2) continue;
    c2.rules.push(c1.rules[0]);
    c2.box[1] = c1.box[1];
    clusters.splice(i, 1);
  }
  const tables = [];
  for (const c of clusters) {
    const hs = c.rules.filter(r => r.b[3] - r.b[1] <= 2.5 && W(r.b) > 40);
    const vs = c.rules.filter(r => W(r.b) <= 2.5 && r.b[3] - r.b[1] > 8);
    if (hs.length < 2 || W(c.box) < 150) continue;
    // coloured edges that close the grid (a vertical ends on them)
    for (const r of rules) {
      if (isBlack(r.c) || r.b[3] - r.b[1] > 2.5 || W(r.b) < 150) continue;
      const y = (r.b[1] + r.b[3]) / 2;
      if (vs.some(v => Math.abs(v.b[3] - y) < 3 || Math.abs(v.b[1] - y) < 3)) { hs.push(r); c.box[1] = Math.min(c.box[1], r.b[1]); c.box[3] = Math.max(c.box[3], r.b[3]); }
    }
    tables.push({ box: c.box, hs, vs });
  }
  const tableEdgeRule = r => tables.some(t => Math.abs(r.b[1] - t.box[1]) < 3 || Math.abs(r.b[3] - t.box[3]) < 3) && tables.some(t => r.b[0] >= t.box[0] - 3 && r.b[2] <= t.box[2] + 3);

  // --- figures
  const figs = [];
  const claimed = new Set();
  const capStarts = lines.filter(l => l.c === "small" && /^FIGURE\s+\d+\.\d+/.test(l.text));
  const used = new Set();
  for (const cap of capStarts) {
    // caption = this line and following small lines in the same block
    const capLines = [cap];
    const blk = pg.blocks[cap.bi].lines;
    for (let i = cap.li + 1; i < blk.length; i++) { const l = blk[i]; if (cls(l) !== "small" || /^FIGURE\s/.test(l.text)) break; l.c = cls(l); l.page = pg.p; capLines.push(l); }
    // also following blocks of small text directly below (captions sometimes split into blocks)
    let bottom = capLines[capLines.length - 1].bbox[3];
    for (const l of lines) if (l.c === "small" && !capLines.includes(l) && !/^FIGURE\s/.test(l.text) && l.bbox[1] >= bottom - 2 && l.bbox[1] <= bottom + 4 && Math.abs(l.bbox[0] - cap.bbox[0]) < 120) { capLines.push(l); bottom = l.bbox[3]; }
    capLines.forEach(l => used.add(l));
    const capTop = cap.bbox[1];
    const id = cap.text.match(/^FIGURE\s+(\d+\.\d+)/)[1];
    // images above the caption
    const cand = pg.images.map((b, i) => ({ b, i })).filter(o => !claimed.has(o.i) && o.b[3] <= capTop + 8 && o.b[3] >= capTop - 500 && W(o.b) * (o.b[3] - o.b[1]) > 400);
    let region = null;
    if (cand.length) {
      cand.sort((a, b) => b.b[3] - a.b[3]);
      region = [...cand[0].b]; claimed.add(cand[0].i);
      let grew = true;
      while (grew) {
        grew = false;
        for (const o of cand) if (!claimed.has(o.i) && o.b[1] <= region[3] + 14 && o.b[3] >= region[1] - 14) {
          // no body text between
          region = [Math.min(region[0], o.b[0]), Math.min(region[1], o.b[1]), Math.max(region[2], o.b[2]), Math.max(region[3], o.b[3])];
          claimed.add(o.i); grew = true;
        }
      }
      // vector labels sitting just outside the raster bounds
      for (const l of lines) if (l.c !== "small" && !used.has(l) && l.bbox[1] >= region[1] - 4 && l.bbox[3] <= capTop + 1 && l.bbox[0] >= region[0] - 40 && l.bbox[2] <= region[2] + 40 && (l.size < 8.6 || /DejaVu|Minion/.test(l.font)))
        region = [Math.min(region[0], l.bbox[0]), Math.min(region[1], l.bbox[1]), Math.max(region[2], l.bbox[2]), Math.max(region[3], l.bbox[3])];
    } else {
      // vector figure: area between last text above and the caption
      let top = 45;
      for (const l of lines) if (!used.has(l) && l.bbox[3] < capTop - 2 && l.c !== "small" && l.size >= 8.6 && !/DejaVu|Minion/.test(l.font) && W(l.bbox) > 200) top = Math.max(top, l.bbox[3]);
      for (const f of figs) if (f.capBottom < capTop) top = Math.max(top, f.capBottom);
      region = [72, top + 2, 540, capTop - 2];
      if (region[3] - region[1] < 20) region = null;
    }
    if (region) for (const l of lines) if (!used.has(l) && ctrIn(l.bbox, [region[0] - 1, region[1] - 1, region[2] + 1, region[3] + 1])) used.add(l);
    figs.push({ id, region, capLines, y: region ? region[1] : capTop, capBottom: bottom, x: region ? region[0] : cap.bbox[0] });
  }
  // un-captioned images (e.g. inside questions)
  pg.images.forEach((b, i) => {
    if (claimed.has(i)) return;
    if (W(b) * (b[3] - b[1]) < 2500 || W(b) < 40 || b[3] - b[1] < 25) return;
    if (tables.some(t => overlap(t.box, b))) return;
    if (figs.some(f => f.region && overlap(f.region, b))) return;
    figs.push({ id: null, region: b.slice(), capLines: [], y: b[1], x: b[0], capBottom: b[3] });
    for (const l of lines) if (!used.has(l) && ctrIn(l.bbox, b)) used.add(l);
  });

  // --- math typeset as vector glyphs (Na⁺, Cl⁻, ΔG …): crop each run into a small inline image
  const extraLines = [];
  if (mathSink) {
    const inFig = b => figs.some(f => f.region && overlap(f.region, b)) || pg.images.some(i => inside(b, i, 1));
    const glyphs = pg.rules.filter(r => r.k === "f" && isBlack(r.c) && W(r.b) < 40 && r.b[3] - r.b[1] < 18 && W(r.b) * (r.b[3] - r.b[1]) > 0.2 && !inFig(r.b) && r.b[1] > 40 && r.b[3] < 748)
      .map(r => r.b.slice()).sort((a, b) => a[0] - b[0]);
    const runs = [];
    for (const g of glyphs) {
      // same run = touching horizontally and on the same text line (centre within ~5pt of where the run started)
      const gcy = (g[1] + g[3]) / 2;
      const run = runs.find(r => g[0] - r[2] < 3.5 && g[0] >= r[0] - 2 && Math.abs(gcy - r.cy) < 5.5);
      if (run) { run[0] = Math.min(run[0], g[0]); run[1] = Math.min(run[1], g[1]); run[2] = Math.max(run[2], g[2]); run[3] = Math.max(run[3], g[3]); run.n++; }
      else { const r = g.slice(); r.n = 1; r.cy = gcy; runs.push(r); }
    }
    // table rules never count as math
    const mathRuns = runs.filter(r => !(r.n === 1 && (W(r) > 18 || r[3] - r[1] < 1.5 && W(r) > 8 && tables.some(t => inside(r, t.box, 2)))));
    let k = 0;
    for (const r of mathRuns) {
      if (r[3] - r[1] < 1.5 && W(r) < 2) continue;
      const cy = (r[1] + r[3]) / 2;
      // nearest text piece on the same baseline (the PDF often splits a sentence into pieces around each symbol)
      const hdist = l => r[2] <= l.bbox[0] ? l.bbox[0] - r[2] : r[0] >= l.bbox[2] ? r[0] - l.bbox[2] : 0;
      const host = lines.filter(l => cy >= l.bbox[1] - 2 && cy <= l.bbox[3] + 2 && r[0] >= l.bbox[0] - 40 && r[0] <= l.bbox[2] + 60 && !used.has(l))
        .sort((a, b) => hdist(a) - hdist(b) || Math.abs(cy - (a.bbox[1] + a.bbox[3]) / 2) - Math.abs(cy - (b.bbox[1] + b.bbox[3]) / 2))[0];
      const box = [r[0] - 0.6, Math.min(r[1], host ? host.bbox[1] + 1 : r[1]) - 0.8, r[2] + 0.6, Math.max(r[3], host ? host.bbox[3] - 1 : r[3]) + 0.8];
      const src = mathSink(pg.p, box, ++k);
      const span = { img: src, h: +(box[3] - box[1]).toFixed(1), x0: r[0], x1: r[2] };
      if (host) {
        const at = host.spans.findIndex(s => s.x0 != null && s.x0 > r[0]);
        const before = at === -1 ? host.spans.length : at;
        const ins = [span];
        const prev = host.spans[before - 1];
        if (prev && prev.t != null && !/\s$/.test(prev.t) && r[0] - (prev.x1 ?? r[0]) > 1.5) ins.unshift({ t: " " });
        const next = host.spans[before];
        if (next && next.t != null && !/^\s/.test(next.t) && (next.x0 ?? r[2]) - r[2] > 1.5) ins.push({ t: " " });
        host.spans.splice(before, 0, ...ins);
        host.text = host.spans.map(s => s.t ?? "").join("");
        host.bbox = [Math.min(host.bbox[0], r[0]), host.bbox[1], Math.max(host.bbox[2], r[2]), host.bbox[3]];
        host.hasMath = true;
      } else {
        // a line made only of math: join a neighbour run on the same baseline if we already made one
        const mate = extraLines.find(l => Math.abs(((l.bbox[1] + l.bbox[3]) / 2) - cy) < 4 && r[0] - l.bbox[2] < 20);
        if (mate) { mate.spans.push({ t: " " }, span); mate.bbox[2] = r[2]; continue; }
        const l = { bbox: [r[0], r[1] - 1, r[2], r[3] + 1], font: "math", size: 9, spans: [span], text: "", c: "body", page: pg.p, bi: -1, li: 0, hasMath: true };
        extraLines.push(l);
      }
    }
    lines.push(...extraLines);
    lines.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  }

  // --- table text
  for (const t of tables) {
    t.lines = lines.filter(l => !used.has(l) && ctrIn(l.bbox, [t.box[0] - 2, t.box[1] - 2, t.box[2] + 2, t.box[3] + 2]));
    t.lines.forEach(l => used.add(l));
    // caption just above: TABLE label and/or centered title
    t.capLines = [];
    for (const l of lines) if (!used.has(l) && l.bbox[3] <= t.box[1] + 1 && l.bbox[1] >= t.box[1] - 38 && l.bbox[0] >= t.box[0] - 6 && l.bbox[2] <= t.box[2] + 6 && (/^TABLE\s+\d/.test(l.text) || (l.bbox[0] > 110 && W(l.bbox) < 380))) t.capLines.push(l);
    t.capLines.forEach(l => used.add(l));
    t.y = Math.min(t.box[1], ...t.capLines.map(l => l.bbox[1]));
    t.x = t.box[0];
  }

  // --- box markers
  const blueRules = rules.filter(r => r.k === "f" && isColored(r.c) && W(r.b) > 400 && r.b[3] - r.b[1] <= 3.5 && !tableEdgeRule(r));
  const boxTitles = lines.filter(l => l.c === "boxtitle");
  const markers = [];
  for (const r of blueRules) {
    const opening = boxTitles.some(t => r.b[1] >= t.bbox[1] && r.b[1] - t.bbox[3] < 26);
    if (!opening) markers.push({ kind: "boxend", y: r.b[1], x: 72, bbox: r.b });
  }
  // some boxes are drawn as a coloured frame instead of top/bottom rules: the box ends at the frame's bottom edge
  for (const r of pg.rules) {
    if (r.k !== "f" || !isColored(r.c) || W(r.b) < 400 || r.b[3] - r.b[1] < 20 || r.b[3] > 745) continue;
    markers.push({ kind: "boxend", frame: true, y: r.b[3], x: 72, bbox: [r.b[0], r.b[3], r.b[2], r.b[3]] });
  }
  const items = [];
  for (const l of lines) if (!used.has(l)) items.push({ kind: "line", l, y: l.bbox[1], x: l.bbox[0], w: W(l.bbox), bbox: l.bbox });
  for (const f of figs) items.push({ kind: "fig", f, y: f.y, x: f.x, w: f.region ? W(f.region) : 300, bbox: f.region || f.capLines[0].bbox });
  for (const t of tables) items.push({ kind: "table", t, y: t.y, x: t.x, w: W(t.box), bbox: t.box });
  items.push(...markers.map(m => ({ ...m, w: 468 })));

  // --- reading order: bands split by h2 headings; two-column bands read column by column
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  let band = [];
  const flush = () => {
    if (!band.length) return;
    const narrowL = band.filter(i => i.kind === "line" && i.w < 265 && i.x < 300).length;
    const narrowR = band.filter(i => i.kind === "line" && i.w < 265 && i.x >= 300).length;
    const wide = band.filter(i => i.kind === "line" && i.w > 300 && i.l.c === "body").length;
    if (narrowR >= 2 && narrowL >= 2 && wide <= 1) {
      const col = i => (i.x >= 300 ? 1 : 0);
      band.sort((a, b) => col(a) - col(b) || a.y - b.y || a.x - b.x);
      band.forEach(i => (i.twoCol = true));
    }
    out.push(...band); band = [];
  };
  for (const it of items) {
    if (it.kind === "line" && it.l.c === "h2") { flush(); out.push(it); continue; }
    band.push(it);
  }
  flush();
  // within the same visual line, keep x order for lines with almost equal y (e.g. table-like label + text)
  return { printed, items: out };
}

// ---------- tables to html ----------
function tableRows(t) {
  const ys = [...new Set(t.hs.map(r => Math.round((r.b[1] + r.b[3]) / 2)))].sort((a, b) => a - b);
  const yb = [];
  for (const y of ys) if (!yb.length || y - yb[yb.length - 1] > 3) yb.push(y);
  if (yb[0] > t.box[1] + 3) yb.unshift(t.box[1]);
  if (yb[yb.length - 1] < t.box[3] - 3) yb.push(t.box[3]);
  const xs = [...new Set(t.vs.map(r => Math.round((r.b[0] + r.b[2]) / 2)))].filter(x => x > t.box[0] + 4 && x < t.box[2] - 4).sort((a, b) => a - b);
  const xb = [t.box[0]];
  for (const x of xs) if (x - xb[xb.length - 1] > 4) xb.push(x);
  xb.push(t.box[2]);
  if (xb.length - 1 > 8) return null;
  const rows = [];
  for (let r = 0; r < yb.length - 1; r++) {
    const cells = [];
    for (let c = 0; c < xb.length - 1; c++) {
      const ls = t.lines.filter(l => { const [x, y] = center(l.bbox); return y > yb[r] && y < yb[r + 1] && l.bbox[0] >= xb[c] - 3 && l.bbox[0] < xb[c + 1] - 3; });
      ls.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
      cells.push(ls.length ? joinLines(ls) : { html: "", text: "" });
    }
    if (cells.some(c => c.text)) rows.push(cells);
  }
  // header row: bold cells
  return rows;
}

// ---------- figure rendering ----------
function renderRegion(p, r, file) {
  if (noImg) return;
  const page = getDoc().loadPage(p);
  const pad = 2;
  const R = [Math.max(0, r[0] - pad), Math.max(0, r[1] - pad), Math.min(612, r[2] + pad), Math.min(792, r[3] + pad)];
  const SCALE = Math.max(2, Math.min(3, 900 / (R[2] - R[0])));
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [Math.floor(R[0] * SCALE), Math.floor(R[1] * SCALE), Math.ceil(R[2] * SCALE), Math.ceil(R[3] * SCALE)], false);
  pix.clear(255);
  page.run(new mupdf.DrawDevice(mupdf.Matrix.scale(SCALE, SCALE), pix), mupdf.Matrix.identity);
  fs.writeFileSync(file, pix.asJPEG(72));
  const wh = [pix.getWidth(), pix.getHeight()];
  pix.destroy?.(); page.destroy?.();
  return wh;
}
function renderMath(p, R, file) {
  if (fs.existsSync(file)) return;
  const page = getDoc().loadPage(p);
  const S = 4;
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [Math.floor(R[0] * S), Math.floor(R[1] * S), Math.ceil(R[2] * S), Math.ceil(R[3] * S)], false);
  pix.clear(255);
  page.run(new mupdf.DrawDevice(mupdf.Matrix.scale(S, S), pix), mupdf.Matrix.identity);
  fs.writeFileSync(file, pix.asPNG());
  pix.destroy?.(); page.destroy?.();
}

// ---------- chapter assembly ----------
const SECTION_KIND = [
  [/^Key Terms/, "terms", "Key Terms"],
  [/^Chapter Summary/, "summary", "Chapter Summary"],
  [/^Review Questions/, "review", "Review Questions"],
  [/^Critical Thinking/, "critical", "Critical Thinking Questions"],
  [/^Test Prep/, "testprep", "Test Prep for AP® Courses"],
  [/^Science Practice Challenge/, "challenge", "Science Practice Challenge Questions"],
];

function buildChapter(ch) {
  const dir = `${OUT}/img/c${String(ch.n).padStart(2, "0")}`;
  fs.mkdirSync(dir, { recursive: true });
  const stream = []; // ordered items across pages
  let lastPrinted = null, lastPdf = null;
  // chapter openers have no page number in the header: count back from the first numbered page
  let firstKnown = null;
  for (let p = ch.start; p < ch.end && !firstKnown; p++) { const a = analysePage(loadPage(p)); if (a.printed != null) firstKnown = [p, a.printed]; }
  if (firstKnown) { lastPdf = ch.start; lastPrinted = firstKnown[1] - (firstKnown[0] - ch.start); }
  const cdir = `c${String(ch.n).padStart(2, "0")}`;
  const mathSink = (p, box, k) => { const name = `m${p}-${k}.png`; renderMath(p, box, `${dir}/${name}`); return `img/${cdir}/${name}`; };
  for (let p = ch.start; p < ch.end; p++) {
    const a = analysePage(loadPage(p), mathSink);
    // a frame that runs to the bottom of the page and picks up again at the top of the next page is one box, not two
    if (p + 1 < ch.end && loadPage(p + 1).rules.some(r => r.k === "f" && isColored(r.c) && W(r.b) > 400 && r.b[3] - r.b[1] > 20 && r.b[1] < 75))
      a.items = a.items.filter(i => !(i.kind === "boxend" && i.frame && i.y > 600 && !a.items.some(o => o.kind === "line" && o.y > i.y + 2)));
    if (a.printed == null && lastPrinted != null) a.printed = lastPrinted + (p - lastPdf);
    if (a.printed != null) { lastPrinted = a.printed; lastPdf = p; }
    stream.push({ kind: "page", printed: a.printed, pdf: p });
    stream.push(...a.items.map(i => ({ ...i, pdf: p, printed: a.printed })));
  }
  // drop chapter opener clutter: CHAPTER N, title, CHAPTER OUTLINE list
  const sections = [];
  let cur = null, skipping = false, curPage = null, firstPage = null;
  const startSection = (id, title, kind) => { cur = { id, title, kind, items: [], page: curPage }; sections.push(cur); };
  for (const it of stream) {
    if (it.kind === "page") { curPage = it.printed ?? curPage; if (firstPage == null) firstPage = it.printed; if (cur) cur.items.push(it); continue; }
    if (it.kind === "line") {
      const l = it.l;
      if (l.c === "chnum" || l.c === "chtitle") continue;
      if (l.c === "label" && /^CHAPTER OUTLINE/.test(l.text)) { skipping = true; continue; }
      if (/^INTRODUCTION\s*$/.test(l.text) && l.bbox[0] < 80) { skipping = false; if (!cur) startSection(`${ch.n}.0`, "Introduction", "intro"); continue; }
      if (skipping) continue;
      if (l.c === "h2") {
        const t = l.text.trim();
        const m = t.match(/^(\d+)\.(\d+)\s+(.*)$/);
        if (m && +m[1] === ch.n) { startSection(`${ch.n}.${m[2]}`, m[3], "section"); continue; }
        const k = SECTION_KIND.find(([re]) => re.test(t));
        if (k) { startSection(`${ch.n}-${k[1]}`, k[2], k[1]); continue; }
        // continuation of a wrapped h2
        const last = cur && cur.items.filter(i => i.kind !== "page").length === 0;
        if (cur && last && cur.kind === "section") { cur.title += " " + t; continue; }
      }
    }
    if (!cur) { if (it.kind === "fig") { startSection(`${ch.n}.0`, "Introduction", "intro"); } else continue; }
    cur.items.push(it);
  }
  // build blocks
  const figures = [];
  let uncapN = 0;
  const mkFig = (it) => {
    const f = it.f;
    let src = null, wh = null;
    if (f.region) {
      const name = f.id ? `f${f.id.replace(".", "-")}.jpg` : `p${it.pdf}-${++uncapN}.jpg`;
      wh = renderRegion(it.pdf, f.region, `${dir}/${name}`) || [Math.round(W(f.region) * SCALE), Math.round((f.region[3] - f.region[1]) * SCALE)];
      src = `img/c${String(ch.n).padStart(2, "0")}/${name}`;
    }
    let cap = f.capLines.length ? joinLines(f.capLines) : null;
    if (cap) { cap.html = cap.html.replace(/^<b>FIGURE\s+\d+\.\d+\s*<\/b>\s*/, "").replace(/^FIGURE\s+\d+\.\d+\s*/, ""); cap.text = cap.text.replace(/^FIGURE\s+\d+\.\d+\s*/, ""); }
    const b = { t: "fig", id: f.id, src, w: wh?.[0], h: wh?.[1], cap: cap?.html || "", capText: cap?.text || "", pg: it.printed };
    if (f.id) figures.push({ id: f.id, src, cap: cap?.text || "" });
    return b;
  };
  const mkTable = (it) => {
    const t = it.t;
    const cap = t.capLines.length ? joinLines(t.capLines) : { html: "", text: "" };
    let rows = t.vs.length ? tableRows(t) : null;
    const text = t.lines.map(l => l.text).join(" ").replace(/\s+/g, " ");
    const idm = cap.text.match(/^TABLE\s+(\d+\.\d+)/);
    const capHtml = cap.html.replace(/^<b>TABLE\s+\d+\.\d+\s*<\/b>\s*/, "").replace(/^TABLE\s+\d+\.\d+\s*/, "");
    const ap = /^(Big Idea|Enduring|Essential|Science Practice|Learning Objective)/i.test(rows?.[0]?.[0]?.text || text);
    if (!rows || !rows.length) {
      const name = `t${it.pdf}-${Math.round(t.box[1])}.jpg`;
      const wh = renderRegion(it.pdf, t.box, `${dir}/${name}`) || [0, 0];
      return { t: "tableimg", id: idm?.[1] || null, src: `img/c${String(ch.n).padStart(2, "0")}/${name}`, w: wh[0], h: wh[1], cap: capHtml, text, ap, pg: it.printed };
    }
    return { t: "table", id: idm?.[1] || null, cap: capHtml, rows: rows.map(r => r.map(c => c.html)), text, ap, pg: it.printed };
  };

  for (const s of sections) {
    const out = [];
    const stack = [out]; // box nesting
    let para = null; // {type, lines}
    let box = null;
    let pendingPg = null;
    const target = () => stack[stack.length - 1];
    const endPara = () => {
      if (!para) return;
      const { html, text } = joinLines(para.lines);
      const prev = target()[target().length - 1];
      if (text && para.type === "small" && prev && prev.t === "fig" && /^\(credit/.test(text)) { prev.cap += " " + html; prev.capText += " " + text; para = null; return; }
      if (para.type === "small" && prev && (prev.t === "table" || prev.t === "tableimg") && !prev.id && /^TABLE\s+\d+\.\d+/.test(text)) {
        prev.id = text.match(/^TABLE\s+(\d+\.\d+)/)[1]; const rest = html.replace(/^(<b>)?TABLE\s+\d+\.\d+\s*(<\/b>)?\s*/, ""); if (rest) prev.cap = rest; para = null;
        // a table continued onto the next page repeats its header: append its rows to the first part
        // (a footnote may sit between the two parts)
        const tg = target(); let fi = tg.length - 2;
        if (tg[fi] && tg[fi].t === "small" && !/^TABLE\s/.test(tg[fi].text || "")) fi--;
        const first = tg[fi];
        const hdr = r => r.map(c => c.replace(/<[^>]+>/g, "").trim()).join("|");
        if (first && first.t === "table" && prev.t === "table" && (first.id === prev.id || !first.id) && !first.ap && hdr(first.rows[0]) === hdr(prev.rows[0])) {
          first.rows.push(...prev.rows.slice(1)); first.text += " " + prev.text;
          if (!first.id) { first.id = prev.id; if (prev.cap && prev.cap !== first.cap) first.cap = first.cap ? first.cap + " " + prev.cap : prev.cap; }
          target().pop();
        }
        return;
      }
      if (text || /<img/.test(html)) {
        const b = { t: para.type, html, text };
        if (para.pg != null) b.pg = para.pg;
        if (["li", "nli", "opt", "q", "term"].includes(para.type)) b.x = Math.round(para.lines[0].bbox[0]);
        target().push(b);
      }
      para = null;
    };
    const closeBox = () => { endPara(); if (box) { stack.pop(); box = null; } };
    let lastLine = null, lastQ = null;
    for (const it of s.items) {
      if (it.kind === "page") { pendingPg = it.printed; continue; }
      if (it.kind === "boxend") { closeBox(); continue; }
      if (it.kind === "fig") { endPara(); target().push(mkFig(it)); continue; }
      if (it.kind === "table") { endPara(); target().push(mkTable(it)); continue; }
      const l = it.l;
      const c = l.c;
      if (c === "boxtitle") {
        // wrapped title continues the previous one
        if (box && box.children.length === 0 && lastLine && lastLine.c === "boxtitle" && l.bbox[1] - lastLine.bbox[1] < 20) { box.kind += " " + l.text.trim(); lastLine = l; continue; }
        closeBox();
        box = { t: "box", kind: l.text.trim(), title: "", children: [], pg: pendingPg ?? it.printed };
        target().push(box); stack.push(box.children); lastLine = l; continue;
      }
      if (c === "boxsub" && box && box.children.length === 0 && !box.title) { box.title = l.text.trim(); lastLine = l; continue; }
      if (c === "boxsub" && box && box.children.length === 0 && lastLine?.c === "boxsub") { box.title += " " + l.text.trim(); lastLine = l; continue; }
      if (c === "h3" || c === "h4" || c === "boxsub" || c === "label" || c === "h2") {
        const type = c === "boxsub" ? "h4" : c === "label" ? "label" : c === "h2" ? "h3" : c;
        if (para && para.type === type && lastLine && lastLine.c === c && l.bbox[1] - lastLine.bbox[1] < l.size * 1.7 && l.bbox[1] > lastLine.bbox[1]) { para.lines.push(l); lastLine = l; continue; }
        endPara();
        if ((c === "h3" || c === "h2" || c === "h4") && box) closeBox();
        para = { type, lines: [l], pg: pendingPg }; pendingPg = null; lastLine = l; continue;
      }
      // body / small text
      const t = l.text.trim();
      const firstBold = l.spans.find(sp => (sp.t || "").trim())?.b;
      let startType = null;
      const sameVisualLine = lastLine && l.page === lastLine.page && Math.abs(l.bbox[1] - lastLine.bbox[1]) < 2.5;
      if (l.font === "math" && !sameVisualLine) startType = "eq"; // a displayed equation on its own line
      else if (/^[•●▪◦]\s*/.test(t)) startType = "li";
      else if (/^[a-e]\.(\s|$)/.test(t)) startType = "opt";
      else if (["review", "critical", "testprep", "challenge"].includes(s.kind) && /^(\d+)\s?\.(\s|$)/.test(t) && (lastQ == null || (+t.match(/^\d+/)[0] > lastQ && +t.match(/^\d+/)[0] <= lastQ + 4))) { startType = "q"; lastQ = +t.match(/^\d+/)[0]; }
      else if (s.kind === "terms" && firstBold && lastLine && (l.bbox[0] <= (it.twoCol && l.bbox[0] >= 300 ? 318 : 74))) startType = "term";
      else if (s.kind === "terms" && firstBold && !lastLine) startType = "term";
      else if (!["review", "critical", "testprep", "challenge", "terms"].includes(s.kind) && /^\d{1,2}\.\s+\S/.test(t) && !/^\d+\.\d/.test(t)) startType = "nli";
      let newPara = !!startType;
      if (!newPara && para) {
        if (!["p", "li", "nli", "opt", "q", "term", "small"].includes(para.type) && !(para.type === "eq" && sameVisualLine)) newPara = true;
        else if (lastLine) {
          const dy = l.bbox[1] - lastLine.bbox[1];
          const samePage = l.page === lastLine.page;
          if (samePage && dy > 0 && dy > l.size * 1.72) newPara = true;
          else if (samePage && dy > 0 && dy < l.size * 0.5) newPara = false;
          else if (samePage && Math.abs(dy) < 2.5 && l.bbox[0] >= lastLine.bbox[2] - 2) newPara = false; // next piece of the same visual line
          else if (!samePage || dy <= 0) {
            // column/page jump: continue only if the previous text did not end a sentence
            const prevT = lastLine.text.trim();
            if (/[.?!:”"]$/.test(prevT) && !/^[a-z]/.test(t)) newPara = true;
          }
          if (c === "small" && para.type !== "small") newPara = true;
          if (para.type === "li" || para.type === "nli" || para.type === "opt") {
            // continuation lines are indented past the marker
            if (l.bbox[0] < para.lines[0].bbox[0] + 4 && !(it.twoCol)) newPara = true;
          }
        }
      }
      if (!para || newPara) {
        endPara();
        para = { type: startType || (c === "small" ? "small" : "p"), lines: [], pg: pendingPg }; pendingPg = null;
      }
      para.lines.push(l); lastLine = l;
    }
    endPara();
    closeBox();
    s.blocks = out;
    delete s.items;
  }
  // structure end-of-chapter sections
  for (const s of sections) {
    if (s.kind === "terms") {
      s.terms = [];
      for (const b of s.blocks) if (b.t === "term" || b.t === "p") {
        const m = b.html.match(/^<b>(.*?)<\/b>\s*(.*)$/);
        if (m) s.terms.push({ term: m[1].replace(/<[^>]+>/g, "").trim(), def: m[2].trim() });
        else if (s.terms.length) s.terms[s.terms.length - 1].def += " " + b.html;
      }
    }
    if (["review", "critical", "testprep", "challenge"].includes(s.kind)) {
      const qs = [];
      let q = null, held = [];
      for (const b of s.blocks) {
        if (b.t === "q") {
          const m = b.text.match(/^(\d+)\s?\.\s?/);
          const first = b.html.replace(/^(<b>)?\s*\d+\s*(<\/b>)?\s*\.\s*(<\/b>)?\s*/, "");
          q = { n: +m[1], stem: [...held, ...(first.trim() ? [{ t: "p", html: first }] : [])], opts: [] };
          held = [];
          qs.push(q); continue;
        }
        if (!q) { if (/^(fig|table|tableimg)$/.test(b.t)) held.push(b); continue; } // a picture before the first question belongs to it
        if ((b.t === "fig" || b.t === "tableimg" || b.t === "table") && q.opts.length >= 2) { held.push(b); continue; }
        if (b.t === "opt") { q.opts.push(b.html.replace(/^[a-e]\.\s*/, "")); continue; }
        if (q.opts.length && b.t === "p" && !/^(fig|table|tableimg)$/.test(b.t)) { q.opts[q.opts.length - 1] += " " + b.html; continue; }
        if (held.length) { q.stem.push(...held); held = []; }
        q.stem.push(b);
      }
      if (held.length && q) q.stem.push(...held);
      s.questions = qs;
    }
  }
  return { n: ch.n, title: ch.title, firstPage, sections, figures };
}

fs.mkdirSync(OUT + "/data", { recursive: true });
const toc = [];
for (const ch of chapters) {
  if (only.length && !only.includes(ch.n)) continue;
  const t0 = Date.now();
  const c = buildChapter(ch);
  fs.writeFileSync(`${OUT}/data/ch${String(ch.n).padStart(2, "0")}.json`, JSON.stringify(c));
  console.log(`ch ${ch.n} ${c.title}: ${c.sections.length} sections, ${c.figures.length} figures, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
