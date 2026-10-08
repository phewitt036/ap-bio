// Stage 3: build data/toc.json and data/search.json from the chapter files.
import fs from "fs";
const OUT = process.env.OUT || "out";
const UNITS = [
  [1, "The Chemistry of Life", 1, 3], [2, "The Cell", 4, 10], [3, "Genetics", 11, 17], [4, "Evolutionary Processes", 18, 20],
  [5, "Biological Diversity", 21, 22], [6, "Plant Structure and Function", 23, 23], [7, "Animal Structure and Function", 24, 34], [8, "Ecology", 35, 38],
];
const strip = h => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const files = fs.readdirSync(`${OUT}/data`).filter(f => /^ch\d+\.json$/.test(f)).sort();
const toc = { units: UNITS.map(([n, title, a, b]) => ({ n, title, from: a, to: b })), chapters: [] };
const docs = []; // [sectionId, blockPath, kind, text]
const pageMap = []; // [printedPage, sectionId, blockPath]
for (const f of files) {
  const c = JSON.parse(fs.readFileSync(`${OUT}/data/${f}`));
  const chap = { n: c.n, title: c.title, page: c.firstPage, sections: [], figures: c.figures.map(x => x.id), terms: 0, questions: 0 };
  for (const s of c.sections) {
    const entry = { id: s.id, title: s.title, kind: s.kind, page: s.page };
    if (s.terms) { entry.count = s.terms.length; chap.terms += s.terms.length; }
    if (s.questions) { entry.count = s.questions.length; entry.range = [s.questions[0]?.n, s.questions.at(-1)?.n]; chap.questions += s.questions.length; }
    chap.sections.push(entry);
    let lastPg = null;
    const walk = (blocks, prefix) => blocks.forEach((b, i) => {
      const path = prefix ? `${prefix}.${i}` : `${i}`;
      if (b.pg != null && b.pg !== lastPg) { pageMap.push([b.pg, s.id, path]); lastPg = b.pg; }
      if (b.t === "box") { docs.push([s.id, path, "box", (b.kind + " " + (b.title || "")).trim()]); walk(b.children, path); return; }
      let text = b.text || "";
      if (b.t === "fig") text = (b.id ? `Figure ${b.id} ` : "") + (b.capText || "");
      if (b.t === "table" || b.t === "tableimg") text = (b.id ? `Table ${b.id} ` : "") + strip(b.cap || "") + " " + (b.text || "");
      if (!text.trim() || b.t === "q" || b.t === "opt" || b.t === "term") return;
      docs.push([s.id, path, b.t, text.replace(/\s+/g, " ").trim()]);
    });
    if (s.kind === "terms") s.terms.forEach((t, i) => docs.push([s.id, `t${i}`, "term", `${t.term} — ${strip(t.def)}`]));
    else if (s.questions) s.questions.forEach((q, i) => docs.push([s.id, `q${q.n}`, "q", `Question ${q.n}. ` + strip(q.stem.map(b => b.html || b.cap || "").join(" ")) + " " + q.opts.map(strip).join(" ")]));
    else walk(s.blocks, "");
  }
  toc.chapters.push(chap);
}
fs.writeFileSync(`${OUT}/data/toc.json`, JSON.stringify(toc));
fs.writeFileSync(`${OUT}/data/search.json`, JSON.stringify({ docs }));
fs.writeFileSync(`${OUT}/data/pages.json`, JSON.stringify(pageMap));
console.log("chapters", toc.chapters.length, "docs", docs.length, "pages", pageMap.length, "search.json KB", (fs.statSync(`${OUT}/data/search.json`).size / 1024) | 0);
