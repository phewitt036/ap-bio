/* Bio Buddy — static study site for OpenStax Biology for AP Courses. No build step. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $("#app");
  const pad2 = n => String(n).padStart(2, "0");
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const strip = h => String(h || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- saved progress (this device only) ----------
  const KEY = "biobuddy.v1";
  let state = { read: {}, last: null, cards: {}, quiz: {}, size: 1.05, simple: true };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
  document.documentElement.style.setProperty("--read", state.size + "rem");

  // ---------- data ----------
  const cache = {};
  // every deploy stamps a new version into index.html, so data files never mix old and new after an update
  const V = (document.currentScript && new URL(document.currentScript.src).searchParams.get("v")) || "dev";
  const getJSON = url => cache[url] ||= fetch(`${url}?v=${V}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const tryJSON = url => getJSON(url).catch(() => { delete cache[url]; return null; });
  let toc = null;
  const loadToc = async () => toc ||= await getJSON("data/toc.json");
  const getChapter = n => getJSON(`data/ch${pad2(n)}.json`);
  const getStudy = n => cache[`study${n}`] ||= tryJSON(`study/ch${pad2(n)}.json`);
  const chOf = id => +String(id).split(/[.-]/)[0];
  const tocCh = n => toc.chapters.find(c => c.n === n);
  const KIND_LABEL = { intro: "Introduction", terms: "Key Terms", summary: "Chapter Summary", review: "Review Questions", critical: "Critical Thinking Questions", testprep: "Test Prep for AP® Courses", challenge: "Science Practice Challenge" };
  const isReading = s => s.kind === "section" || s.kind === "intro";
  const secLabel = s => s.kind === "section" ? `${s.id} ${s.title}` : s.title;

  // page range for a section, using the next section's start page
  function pageRange(ch, s) {
    const i = ch.sections.indexOf(s);
    const next = ch.sections.slice(i + 1).find(x => x.page != null);
    let end = next ? next.page - (next.page > s.page ? 1 : 0) : null;
    if (!end) { const nc = tocCh(ch.n + 1); end = nc ? nc.page - 1 : s.page; }
    return [s.page, Math.max(s.page, end)];
  }
  const pagesText = ([a, b]) => a == null ? "" : a === b ? `page ${a}` : `pages ${a}–${b}`;

  // ---------- glossary ----------
  function glossary(chap) {
    if (chap._gloss) return chap._gloss;
    const m = new Map();
    const terms = chap.sections.find(s => s.kind === "terms")?.terms || [];
    for (const t of terms) {
      const base = t.term.replace(/\s*\(.*?\)\s*/g, " ").trim().toLowerCase();
      for (const k of [base, base + "s", base + "es", base.replace(/y$/, "ies"), base.replace(/um$/, "a"), base.replace(/us$/, "i")]) if (!m.has(k)) m.set(k, t);
    }
    return (chap._gloss = m);
  }
  const findTerm = (gl, word) => {
    const w = strip(word).toLowerCase().replace(/[\s ]+/g, " ").replace(/[.,;:]$/, "").trim();
    return gl.get(w) || gl.get(w.replace(/s$/, "")) || gl.get(w.replace(/es$/, "")) || null;
  };

  // ---------- inline enhancement ----------
  function enhance(html, ctx) {
    const parts = html.split(/(<[^>]+>)/);
    let inB = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.startsWith("<")) { if (p === "<b>") inB++; else if (p === "</b>") inB--; continue; }
      if (!p) continue;
      let t = p.replace(/https?:\/\/[^\s)<]+[^\s).,<]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, "")}</a>`);
      t = t.replace(/\b(Figure|Table)s?\s+(\d{1,2}\.\d{1,2})\b/g, (m, kind, id) => `<a class="xref" href="#/${kind === "Figure" ? "fig" : "table"}/${id}">${m}</a>`);
      parts[i] = t;
    }
    let out = parts.join("");
    if (ctx && ctx.gloss) {
      out = out.replace(/<b>((?:(?!<\/?b>).)+?)<\/b>/g, (m, inner) => {
        const t = findTerm(ctx.gloss, inner);
        return t ? `<button class="term" data-term="${esc(t.term)}">${inner}</button>` : m;
      });
    }
    return out;
  }

  // ---------- block rendering ----------
  const BOX_KIND = [[/LINK TO LEARNING/, "link"], [/VISUAL CONNECTION/, "visual"], [/EVOLUTION/, "evo"], [/SCIENCE PRACTICE/, "sci"], [/EVERYDAY/, "everyday"], [/CAREER/, "career"], [/SCIENTIFIC METHOD/, "method"]];
  const titleCase = s => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()).replace(/\bAp®/g, "AP®").replace(/\bFor\b/g, "for").replace(/\bTo\b/g, "to");
  function renderBlocks(blocks, ctx, prefix = "") {
    let html = "", lastPg = ctx.lastPg;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i], path = prefix ? `${prefix}.${i}` : `${i}`;
      const pgTag = b.pg != null && b.pg !== ctx.lastPg ? `<span class="pg" title="Page in the printed book">p. ${b.pg}</span>` : "";
      if (b.pg != null) ctx.lastPg = b.pg;
      const id = `b${path.replace(/\./g, "-")}`;
      switch (b.t) {
        case "p": html += `<p id="${id}" data-say>${pgTag}${enhance(b.html, ctx)}</p>`; break;
        case "eq": html += `<p id="${id}" class="eq">${pgTag}${b.html}</p>`; break;
        case "small": html +=`<p id="${id}" class="small">${pgTag}${enhance(b.html, ctx)}</p>`; break;
        case "h3": html += `${pgTag}<h3 id="${id}" data-say>${b.html.replace(/<\/?b>/g, "")}</h3>`; break;
        case "h4": html += `${pgTag}<h4 id="${id}" data-say>${b.html.replace(/<\/?b>/g, "")}</h4>`; break;
        case "label": html += `${pgTag}<p id="${id}" class="label">${/learning objectives/i.test(strip(b.html)) ? "Goals for this section" : esc(titleCase(strip(b.html)))}</p>`; break;
        case "li": case "nli": case "opt": case "term": {
          const tag = b.t === "opt" ? "ol type=\"a\"" : b.t === "nli" ? "ol class=\"steps\"" : "ul";
          let items = "";
          let j = i;
          while (j < blocks.length && blocks[j].t === b.t) {
            const bj = blocks[j], pj = prefix ? `${prefix}.${j}` : `${j}`;
            const body = b.t === "opt" ? bj.html.replace(/^[a-e]\.\s*/, "") : bj.html.replace(/^[•●▪◦]\s*/, "");
            items += `<li id="b${pj.replace(/\./g, "-")}" data-say>${enhance(body, ctx)}</li>`;
            if (bj.pg != null) ctx.lastPg = bj.pg;
            j++;
          }
          html += `${pgTag}<${tag}>${items}</${tag.split(" ")[0]}>`;
          i = j - 1; break;
        }
        case "fig": {
          if (!b.src) break;
          const label = b.id ? `<b>Figure ${b.id}</b> ` : "";
          html += `<figure id="${b.id ? "fig-" + b.id.replace(".", "-") : id}">${pgTag}<img src="${b.src}" width="${b.w}" height="${b.h}" loading="lazy" alt="${esc(b.capText || "Figure")}" data-cap="${esc(label + (b.cap || ""))}">${b.cap || b.id ? `<figcaption data-say>${label}${enhance(b.cap || "", ctx)}</figcaption>` : ""}</figure>`;
          break;
        }
        case "table": case "tableimg": {
          const cap = b.id || b.cap ? `<p class="tcap" id="${b.id ? "tab-" + b.id.replace(".", "-") : ""}">${b.id ? "Table " + b.id + " " : ""}${b.cap || ""}</p>` : "";
          const body = b.t === "tableimg"
            ? `<figure><img src="${b.src}" width="${b.w}" height="${b.h}" loading="lazy" alt="${esc(strip(b.cap) || "Table")}" data-cap="${esc(strip(b.cap))}"></figure>`
            : `<div class="tablewrap"><table>${b.rows.map(r => `<tr>${r.map(c => `<td>${enhance(c, ctx)}</td>`).join("")}</tr>`).join("")}</table></div>`;
          if (b.ap) html += `${pgTag}<details class="ap" id="${id}"><summary>AP® framework for this section (for teachers)</summary>${body}</details>`;
          else html += `${pgTag}${cap}${body}`;
          break;
        }
        case "box": {
          const k = (BOX_KIND.find(([re]) => re.test(b.kind)) || [, "sci"])[1];
          html += `<aside class="box k-${k}" id="${id}">${pgTag}<div class="box-kind">${esc(titleCase(b.kind))}</div>${b.title ? `<h4 data-say>${esc(b.title)}</h4>` : ""}${renderBlocks(b.children, ctx, path)}</aside>`;
          break;
        }
        case "q": html += `<p id="${id}">${enhance(b.html, ctx)}</p>`; break;
        default: if (b.html) html += `<p id="${id}">${enhance(b.html, ctx)}</p>`;
      }
    }
    return html;
  }

  // ---------- question cards ----------
  // study files can repair a question the PDF garbled: fix[n] = { stem: [blockIndex | "html", …], opts: ["html", …] }
  function fixQ(q, study) {
    const f = study?.fix?.[q.n];
    if (!f) return q;
    const stem = f.stem ? f.stem.map(x => typeof x === "number" ? q.stem[x] : typeof x === "object" ? x : { t: "p", html: x }).filter(Boolean) : q.stem;
    return { ...q, stem, opts: f.opts || q.opts };
  }
  function questionCard(q, ctx, key) {
    const ans = key?.[q.n];
    const opts = q.opts.length ? `<ol class="opts">${q.opts.map((o, i) => `<li><button class="opt" data-q="${q.n}" data-i="${i}" ${ans ? "" : "disabled"}><span class="letter">${"abcde"[i]}</span><span>${enhance(o, ctx)}</span></button></li>`).join("")}</ol>` : "";
    const stem = renderBlocks(q.stem, { ...ctx, lastPg: null }, `q${q.n}`);
    const free = !q.opts.length && ans?.why ? `<details class="why-d"><summary class="btn small" style="margin-top:10px">Show a model answer</summary><div class="why">${ans.why}</div></details>` : "";
    const note = q.opts.length && !ans ? `<p class="nokey">Answer key for this chapter is coming soon.</p>` : "";
    return `<div class="card qcard" id="q${q.n}"><div class="qstem"><span class="qnum">${q.n}.</span>${stem.replace(/^<p id="[^"]*">/, "")}</div>${opts}<div class="fb"></div>${free}${note}</div>`;
  }
  function wireQuestions(root, key, onAnswer) {
    root.addEventListener("click", e => {
      const btn = e.target.closest(".opt");
      if (!btn || btn.disabled) return;
      const n = btn.dataset.q, i = +btn.dataset.i, ans = key?.[n];
      if (!ans) return;
      const card = btn.closest(".qcard");
      const right = "abcde".indexOf(ans.a);
      const ok = i === right || (ans.alt || []).includes("abcde"[i]);
      $$(".opt", card).forEach((b, k) => { b.disabled = true; if (k === right || (ok && k === i)) b.classList.add("right"); });
      if (!ok) btn.classList.add("wrong");
      $(".fb", card).innerHTML = `<div class="why"><b>${ok ? "✅ Nice!" : "Not quite. The answer is " + ans.a + "."}</b> ${ans.why || ""}</div>`;
      onAnswer && onAnswer(ok, n);
    });
  }

  // ---------- popover (key terms) ----------
  const pop = $("#pop");
  function showPop(anchor, html) {
    pop.innerHTML = html; pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    let left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 16);
    pop.style.left = Math.max(16, left) + "px";
    pop.style.top = window.scrollY + r.bottom + 8 + "px";
  }
  document.addEventListener("click", e => {
    const t = e.target.closest("button.term");
    if (t) {
      e.preventDefault();
      const ctx = currentCtx;
      const term = ctx?.chap && (ctx.chap.sections.find(s => s.kind === "terms")?.terms || []).find(x => x.term === t.dataset.term);
      if (term) showPop(t, `<div class="w">${esc(term.term)}</div><div>${term.def}</div><div class="from">Key term · Chapter ${ctx.chap.n}</div>`);
      return;
    }
    if (!e.target.closest("#pop")) pop.hidden = true;
    const img = e.target.closest(".reader figure img, .qcard figure img");
    if (img) { const lb = $("#lightbox"); $("img", lb).src = img.src; $("p", lb).innerHTML = img.dataset.cap || ""; lb.hidden = false; }
  });
  $("#lightbox").addEventListener("click", e => { if (e.target.tagName !== "IMG") $("#lightbox").hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { $("#lightbox").hidden = true; pop.hidden = true; } });

  // ---------- confetti ----------
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = $("#confetti"), colors = ["#14b8a6", "#f59e0b", "#6366f1", "#ec4899", "#22c55e"];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "vw"; p.style.background = colors[i % colors.length];
      p.style.animationDuration = 1.6 + Math.random() * 1.8 + "s"; p.style.animationDelay = Math.random() * .4 + "s";
      c.appendChild(p); setTimeout(() => p.remove(), 4200);
    }
  }

  // ---------- read aloud ----------
  let speaking = null;
  function stopSpeaking() { if (speaking) { speaking.stop = true; speechSynthesis.cancel(); $$(".speaking").forEach(x => x.classList.remove("speaking")); speaking = null; } const b = $("#sayBtn"); if (b) b.innerHTML = "🔊 Read aloud"; }
  function startSpeaking(fromEl) {
    stopSpeaking();
    const els = $$(".reader [data-say]").filter(el => el.offsetParent !== null);
    let i = Math.max(0, fromEl ? els.indexOf(fromEl) : 0);
    const job = speaking = { stop: false };
    $("#sayBtn").innerHTML = "⏹ Stop reading";
    const next = () => {
      if (job.stop) return;
      $$(".speaking").forEach(x => x.classList.remove("speaking"));
      if (i >= els.length) { stopSpeaking(); return; }
      const el = els[i++];
      el.classList.add("speaking");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const text = el.innerText.replace(/^p\. \d+\s*/, "").replace(/\(?https?:\S+\)?/g, "");
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.onend = next; u.onerror = next;
      speechSynthesis.speak(u);
    };
    next();
  }

  // ---------- views ----------
  let currentCtx = null;
  const setTitle = t => (document.title = t ? `${t} · Bio Buddy` : "Bio Buddy");

  function ring(pct) {
    const r = 20, c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--line)" stroke-width="4"/>${pct > 0 ? `<circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--brand)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${c * pct} ${c}"/>` : ""}</svg>`;
  }
  const chProgress = ch => { const rs = ch.sections.filter(isReading); return rs.length ? rs.filter(s => state.read[s.id]).length / rs.length : 0; };

  async function viewHome(hwText = "") {
    await loadToc();
    setTitle("");
    const last = state.last;
    const examples = ["Read 4.3 and do review questions 5–10", "Pages 112–118", "Flashcards for chapter 5", "Figure 7.11", "What is osmosis?"];
    app.innerHTML = `
      <section class="card hero">
        <div class="kicker">Homework helper</div>
        <h1>What did your teacher assign?</h1>
        <p>Type it the way your teacher said it. You'll get a link straight to the section, page, figure or questions.</p>
        <form class="hw" id="hwForm"><textarea id="hwText" rows="2" placeholder="e.g. Read section 4.3, pages 145–150, and answer review questions 5–10">${esc(hwText)}</textarea><button class="btn primary">Find it</button></form>
        <div class="examples">Try: ${examples.map(x => `<button type="button" data-ex="${esc(x)}">${esc(x)}</button>`).join("")}</div>
        <div class="hw-results" id="hwResults"></div>
      </section>
      ${last ? `<a class="card continue" href="#/s/${last.id}"><span class="big">📖</span><span><span class="kicker">Pick up where you left off</span><br><b>${esc(last.label)}</b></span></a>` : ""}
      ${toc.units.map(u => `
        <div class="unit"><span class="kicker">Unit ${u.n}</span><h2>${esc(u.title)}</h2></div>
        <div class="chapters">${toc.chapters.filter(c => c.n >= u.from && c.n <= u.to).map(c => `
          <a class="card ch-card" href="#/c/${c.n}"><span class="ch-num">${ring(chProgress(c))}<span>${c.n}</span></span><span><span class="t">${esc(c.title)}</span><br><span class="s">${c.sections.filter(s => s.kind === "section").length} sections · p. ${c.page}</span></span></a>`).join("")}
        </div>`).join("")}`;
    const run = () => { const v = $("#hwText").value.trim(); if (v) { history.replaceState(null, "", "#/hw/" + encodeURIComponent(v)); showHW(v); } };
    $("#hwForm").addEventListener("submit", e => { e.preventDefault(); run(); });
    $("#hwText").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } });
    $$("[data-ex]").forEach(b => b.addEventListener("click", () => { $("#hwText").value = b.dataset.ex; run(); }));
    if (hwText) showHW(hwText);
  }

  // ---------- homework helper ----------
  function parseHW(raw) {
    let t = " " + raw.replace(/[–—]/g, "-") + " ";
    const cards = [];
    const seen = new Set();
    const add = c => { if (!seen.has(c.href)) { seen.add(c.href); cards.push(c); } };
    let ctxCh = null;
    const secById = id => { for (const c of toc.chapters) { const s = c.sections.find(x => x.id === id); if (s) return [c, s]; } return [null, null]; };
    // figures & tables first so their numbers are not read as sections
    t = t.replace(/\b(fig(?:ure)?s?|tables?)\.?\s*(\d{1,2})\.(\d{1,2})/gi, (m, w, a, b) => {
      const isFig = /^f/i.test(w);
      const ch = tocCh(+a);
      if (ch) { ctxCh = ch; add({ ico: isFig ? "🖼️" : "📊", t: `${isFig ? "Figure" : "Table"} ${a}.${b}`, s: `Chapter ${ch.n}: ${ch.title}`, href: `#/${isFig ? "fig" : "table"}/${a}.${b}` }); }
      return " ";
    });
    // section ranges like 4.1-4.3
    t = t.replace(/(?<![\d.])(\d{1,2})\.(\d{1,2})\s*(?:-|to|through|thru)\s*(?:(\d{1,2})\.)?(\d{1,2})(?![\d.])/gi, (m, a, b, c2, d) => {
      if (c2 && c2 !== a) return m;
      for (let k = +b; k <= +d; k++) { const [ch, s] = secById(`${a}.${k}`); if (s) { ctxCh = ch; add({ ico: "📖", t: `Read ${s.id} ${s.title}`, s: `Chapter ${ch.n} · ${pagesText(pageRange(ch, s))}`, href: `#/s/${s.id}` }); } }
      return " ";
    });
    t = t.replace(/(?<![\d.])(\d{1,2})\.(\d{1,2})(?![\d.])/g, (m, a, b) => {
      const [ch, s] = secById(`${a}.${b}`);
      if (!s) return m;
      ctxCh = ch; add({ ico: "📖", t: `Read ${s.id} ${s.title}`, s: `Chapter ${ch.n} · ${pagesText(pageRange(ch, s))}`, href: `#/s/${s.id}` });
      return " ";
    });
    // chapters
    const chMentions = [];
    t = t.replace(/\b(?:ch(?:apter)?s?\.?)\s*(\d{1,2})\b/gi, (m, a) => { const ch = tocCh(+a); if (ch) { chMentions.push(ch); ctxCh = ch; } return " "; });
    if (!ctxCh && state.last) ctxCh = tocCh(chOf(state.last.id));
    // pages
    t = t.replace(/\b(?:p(?:age)?s?|pg)\.?\s*(\d{1,4})(?:\s*(?:-|to|through|thru|and)\s*(\d{1,4}))?/gi, (m, a, b) => {
      const from = +a, to = b ? +b : +a;
      const hits = [];
      for (const ch of toc.chapters) for (const s of ch.sections) { if (s.page == null) continue; const [p0, p1] = pageRange(ch, s); if (p0 <= to && p1 >= from) hits.push([ch, s]); }
      if (hits.length) ctxCh = hits[0][0];
      hits.slice(0, 6).forEach(([ch, s]) => add({ ico: "📄", t: `${from === to ? "Page " + from : "Pages " + from + "–" + to}: ${secLabel(s)}`, s: `Chapter ${ch.n} · this section is ${pagesText(pageRange(ch, s))}`, href: s.kind === "section" || s.kind === "intro" ? `#/p/${from}` : `#/s/${s.id}` }));
      if (!hits.length) add({ ico: "❓", t: `Page ${from} isn't in the book`, s: "The book runs from page 1 to about 1,700.", href: "#/" });
      return " ";
    });
    // question numbers
    const kindWords = [[/review/i, "review"], [/critical/i, "critical"], [/test\s*prep|\bap\b/i, "testprep"], [/challenge|science practice/i, "challenge"]];
    let wantedKind = (kindWords.find(([re]) => re.test(raw)) || [])[1];
    t = t.replace(/\b(?:questions?|q'?s?|#|problems?|numbers?|nos?\.?)\s*((?:\d{1,3}\s*(?:-|to|through|thru|,|and|&|\s)\s*)*\d{1,3})/gi, (m, list) => {
      const nums = new Set();
      for (const part of list.split(/\s*(?:,|and|&)\s*|\s+(?=\d)/i)) {
        const r = part.match(/(\d+)\s*(?:-|to|through|thru)\s*(\d+)/i);
        if (r) for (let k = +r[1]; k <= +r[2] && k - r[1] < 60; k++) nums.add(k);
        else if (/^\d+$/.test(part.trim())) nums.add(+part.trim());
      }
      const ch = ctxCh;
      if (!ch) { add({ ico: "❓", t: "Which chapter are those questions from?", s: "Add the chapter, like “chapter 4 questions 5–10”.", href: "#/" }); return " "; }
      const qsecs = ch.sections.filter(s => s.range && s.range[0] != null);
      const groups = new Map();
      for (const n of [...nums].sort((a, b) => a - b)) {
        const s = qsecs.find(s => n >= s.range[0] && n <= s.range[1]);
        if (!s) continue;
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s).push(n);
      }
      if (!groups.size) add({ ico: "❓", t: `Chapter ${ch.n} doesn't have question ${[...nums][0]}`, s: `Its questions run 1–${qsecs.at(-1)?.range[1]}.`, href: `#/c/${ch.n}` });
      for (const [s, ns] of groups) {
        const label = ns.length > 1 ? `Questions ${ns[0]}–${ns.at(-1)}` : `Question ${ns[0]}`;
        add({ ico: "✏️", t: `${label} · ${s.title}`, s: `Chapter ${ch.n}: ${ch.title} · ${pagesText(pageRange(ch, s))}`, href: `#/s/${s.id}/q${ns[0]}` });
      }
      wantedKind = null;
      return " ";
    });
    const ch = ctxCh;
    if (ch && wantedKind) { const s = ch.sections.find(x => x.kind === wantedKind); if (s) add({ ico: "✏️", t: `${s.title}`, s: `Chapter ${ch.n}: ${ch.title} · questions ${s.range[0]}–${s.range[1]}`, href: `#/s/${s.id}` }); }
    if (ch && /\b(key terms?|vocab\w*|terms|flash ?cards?|words)\b/i.test(raw)) add({ ico: "🃏", t: `Key-term flashcards`, s: `Chapter ${ch.n}: ${ch.title} · ${ch.terms} terms`, href: `#/cards/${ch.n}` });
    if (ch && /\bsummary\b/i.test(raw)) { const s = ch.sections.find(x => x.kind === "summary"); if (s) add({ ico: "📝", t: "Chapter Summary", s: `Chapter ${ch.n}: ${ch.title}`, href: `#/s/${s.id}` }); }
    if (ch && /\b(quiz|practice|study)\b/i.test(raw)) add({ ico: "🎯", t: "Practice quiz", s: `Chapter ${ch.n}: ${ch.title}`, href: `#/quiz/${ch.n}` });
    for (const c of chMentions) add({ ico: "📚", t: `Chapter ${c.n}: ${c.title}`, s: `Starts on page ${c.page}`, href: `#/c/${c.n}` });
    const leftover = t.replace(/\b(read|do|answer|the|and|section|sections|for|from|in|on|of|please|homework|hw|due|tomorrow|tonight|study|vocab\w*|key|terms?|summary|review|critical|thinking|test|prep|questions?|all|odd|even|to|chapter|flash ?cards?|quiz|practice|words)\b/gi, " ").replace(/[^\w\s]/g, " ").trim();
    if (leftover.split(/\s+/).filter(w => w.length > 2).length >= 1 && !cards.length) add({ ico: "🔎", t: `Search the book for “${raw.trim()}”`, s: "Find every place it's mentioned", href: `#/search/${encodeURIComponent(raw.trim())}` });
    else if (leftover.split(/\s+/).filter(w => w.length > 3).length >= 2) add({ ico: "🔎", t: `Search the book for “${leftover.replace(/\s+/g, " ")}”`, s: "In case that's a topic, not a section", href: `#/search/${encodeURIComponent(leftover.replace(/\s+/g, " "))}` });
    return cards;
  }
  function showHW(text) {
    const cards = parseHW(text);
    $("#hwResults").innerHTML = cards.length
      ? cards.map(c => `<a class="card hw-card" href="${c.href}"><span class="ico">${c.ico}</span><span><span class="t">${esc(c.t)}</span><br><span class="s">${esc(c.s)}</span></span></a>`).join("")
      : `<p class="muted">I couldn't find a section, page or question number in that. Try “4.3”, “page 120” or “chapter 5 questions 1–8”.</p>`;
  }

  async function viewChapter(n) {
    await loadToc();
    const ch = tocCh(n);
    if (!ch) return notFound();
    const study = await getStudy(n);
    setTitle(`Chapter ${n}`);
    const unit = toc.units.find(u => n >= u.from && n <= u.to);
    const reading = ch.sections.filter(isReading), end = ch.sections.filter(s => !isReading(s));
    const row = s => {
      const pr = pageRange(ch, s);
      return `<a class="card sec-row" href="#/s/${s.id}"><span class="check ${state.read[s.id] ? "on" : ""}">✓</span><span class="num">${s.kind === "section" ? s.id : s.kind === "intro" ? "★" : ""}</span><span class="t">${esc(s.kind === "section" ? s.title : s.title)}${s.count ? ` <span class="muted" style="font-size:.85em">(${s.range ? "questions " + s.range[0] + "–" + s.range[1] : s.count + " terms"})</span>` : ""}</span><span class="s">${pagesText(pr)}</span></a>`;
    };
    const quizReady = study && study.answers && Object.keys(study.answers).length;
    const best = state.quiz[n]?.best;
    app.innerHTML = `
      <div class="crumbs"><a href="#/">Home</a> › Unit ${unit.n}: ${esc(unit.title)}</div>
      <section class="card ch-head">
        <div class="kicker">Chapter ${n}</div>
        <h1>${esc(ch.title)}</h1>
        <div class="muted">${pagesText([ch.page, (tocCh(n + 1)?.page || ch.page + 40) - 1])} · ${reading.filter(s => state.read[s.id]).length} of ${reading.length} read</div>
        <div class="tools">
          <a class="btn primary" href="#/s/${(reading.find(s => !state.read[s.id]) || reading[0]).id}">📖 ${reading.some(s => state.read[s.id]) ? "Keep reading" : "Start reading"}</a>
          <a class="btn" href="#/cards/${n}">🃏 Flashcards · ${ch.terms}</a>
          <a class="btn" href="#/quiz/${n}">🎯 Practice quiz${quizReady ? "" : " (soon)"}${best != null ? ` · best ${best}%` : ""}</a>
        </div>
      </section>
      <div class="sub-h">Read</div>
      <div class="sec-list">${reading.map(row).join("")}</div>
      <div class="sub-h">End of chapter</div>
      <div class="sec-list">${end.map(row).join("")}</div>
      <div class="pager">${tocCh(n - 1) ? `<a class="card" href="#/c/${n - 1}"><div class="dir">← Previous chapter</div>${esc(tocCh(n - 1).title)}</a>` : "<span></span>"}${tocCh(n + 1) ? `<a class="card next" href="#/c/${n + 1}"><div class="dir">Next chapter →</div>${esc(tocCh(n + 1).title)}</a>` : ""}</div>`;
  }

  async function viewSection(id, focus) {
    await loadToc();
    const n = chOf(id);
    const tch = tocCh(n);
    if (!tch) return notFound();
    app.innerHTML = `<p class="empty">Loading…</p>`;
    const [chap, study] = await Promise.all([getChapter(n), getStudy(n)]);
    const s = chap.sections.find(x => x.id === id);
    if (!s) return notFound();
    const ts = tch.sections.find(x => x.id === id);
    const ctx = { chap, gloss: glossary(chap), lastPg: null };
    currentCtx = ctx;
    const i = chap.sections.indexOf(s);
    const prev = chap.sections[i - 1] || null, next = chap.sections[i + 1] || null;
    const prevCh = !prev && tocCh(n - 1), nextCh = !next && tocCh(n + 1);
    const pr = pageRange(tch, ts);
    setTitle(secLabel(s));
    state.last = { id, label: `${s.kind === "section" ? s.id + " " : "Ch " + n + " · "}${s.title}` }; save();
    const notes = study?.sections?.[id];
    const simple = notes ? `<section class="simple" ${state.simple ? "" : "hidden"} id="simple">
        <div class="kicker">⚡ The short version</div>
        <div class="big">${notes.big}</div>
        ${notes.points?.length ? `<ul>${notes.points.map(p => `<li>${p}</li>`).join("")}</ul>` : ""}
        ${notes.tip ? `<p style="margin:.4em 0 0">💡 ${notes.tip}</p>` : ""}
        ${notes.words?.length ? `<div class="words"><span class="muted" style="font-size:.85em">Words to know:</span> ${notes.words.map(w => { const t = findTerm(ctx.gloss, w); return t ? `<button class="term" data-term="${esc(t.term)}">${esc(w)}</button>` : `<b>${esc(w)}</b>`; }).join(" · ")}</div>` : ""}
      </section>` : "";
    let body;
    if (s.kind === "terms") {
      body = `<p class="muted">Tap <a href="#/cards/${n}">Flashcards</a> to practice these.</p><dl class="terms">${s.terms.map((t, k) => `<p id="t${k}" data-say><b>${esc(t.term)}</b> — ${t.def}</p>`).join("")}</dl>`;
    } else if (s.questions) {
      const key = study?.answers;
      body = (s.kind === "challenge" ? `<p class="muted">These are longer, AP-exam-style questions. Work them on paper.</p>` : "") + s.questions.map(q => questionCard(fixQ(q, study), ctx, key)).join("");
    } else {
      body = renderBlocks(s.blocks, ctx);
    }
    app.innerHTML = `
      <div class="reader-wrap">
        <div class="crumbs"><a href="#/">Home</a> › <a href="#/c/${n}">Chapter ${n}: ${esc(chap.title)}</a></div>
        <div class="kicker">${s.kind === "section" ? `Section ${s.id}` : KIND_LABEL[s.kind] ? `Chapter ${n}` : ""}</div>
        <h1>${esc(s.title)}</h1>
        <div class="muted" style="font-size:.9rem">In the book: ${pagesText(pr)}</div>
        <div class="reader-bar">
          ${isReading(s) || s.kind === "terms" || s.kind === "summary" ? `<button class="iconbtn" id="sayBtn">🔊 Read aloud</button>` : ""}
          ${notes ? `<button class="iconbtn" id="simpleBtn">⚡ Short version</button>` : ""}
          <button class="iconbtn" id="smaller" aria-label="Smaller text">A−</button><button class="iconbtn" id="bigger" aria-label="Bigger text">A+</button>
          <span class="sp"></span>
          ${isReading(s) ? `<button class="iconbtn ${state.read[id] ? "on" : ""}" id="readBtn">${state.read[id] ? "✓ Read" : "Mark as read"}</button>` : ""}
        </div>
        ${simple}
        <article class="reader">${body}</article>
        <nav class="pager" id="pager">
          ${prev ? `<a class="card" href="#/s/${prev.id}"><div class="dir">← Previous</div>${esc(secLabel(prev))}</a>` : prevCh ? `<a class="card" href="#/c/${prevCh.n}"><div class="dir">← Previous chapter</div>${esc(prevCh.title)}</a>` : "<span></span>"}
          ${next ? `<a class="card next" href="#/s/${next.id}"><div class="dir">Next →</div>${esc(secLabel(next))}</a>` : nextCh ? `<a class="card next" href="#/c/${nextCh.n}"><div class="dir">Next chapter →</div>${esc(nextCh.title)}</a>` : ""}
        </nav>
      </div>`;
    const reader = $(".reader");
    if (s.questions) wireQuestions(reader, study?.answers);
    const sayBtn = $("#sayBtn");
    if (sayBtn) {
      if (!("speechSynthesis" in window)) sayBtn.remove();
      else sayBtn.addEventListener("click", () => speaking ? stopSpeaking() : startSpeaking());
    }
    $("#simpleBtn")?.addEventListener("click", () => { state.simple = !state.simple; save(); $("#simple").hidden = !state.simple; });
    const size = d => { state.size = Math.min(1.5, Math.max(.9, +(state.size + d).toFixed(2))); save(); document.documentElement.style.setProperty("--read", state.size + "rem"); };
    $("#smaller").addEventListener("click", () => size(-.08));
    $("#bigger").addEventListener("click", () => size(.08));
    const readBtn = $("#readBtn");
    const markRead = on => { if (on) state.read[id] = Date.now(); else delete state.read[id]; save(); if (readBtn) { readBtn.classList.toggle("on", on); readBtn.textContent = on ? "✓ Read" : "Mark as read"; } };
    readBtn?.addEventListener("click", () => markRead(!state.read[id]));
    if (readBtn && !state.read[id] && "IntersectionObserver" in window) {
      const started = Date.now();
      const io = new IntersectionObserver(es => { if (es[0].isIntersecting && Date.now() - started > 15000) { markRead(true); io.disconnect(); } });
      io.observe($("#pager"));
    }
    // focus a block (from search, page jump, figure link, question number)
    if (focus) {
      const el = document.getElementById(focus) || document.getElementById("b" + focus.replace(/\./g, "-"));
      if (el) {
        const box = el.closest("details"); if (box) box.open = true;
        requestAnimationFrame(() => { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 2500); });
        return;
      }
    }
    window.scrollTo(0, 0);
  }

  async function goFigure(kind, id) {
    await loadToc();
    const n = chOf(id);
    const chap = await getChapter(n).catch(() => null);
    if (!chap) return notFound();
    for (const s of chap.sections) {
      let found = null;
      const walk = (bs, prefix) => bs.forEach((b, i) => {
        const p = prefix ? `${prefix}.${i}` : `${i}`;
        if (found) return;
        if (b.id === id && (kind === "fig" ? b.t === "fig" : b.t === "table" || b.t === "tableimg")) found = kind === "fig" ? `fig-${id.replace(".", "-")}` : p;
        if (b.children) walk(b.children, p);
      });
      walk(s.blocks || [], "");
      if (found) return location.replace(`#/s/${s.id}/${found}`);
    }
    location.replace(`#/search/${encodeURIComponent((kind === "fig" ? "Figure " : "Table ") + id)}`);
  }

  async function goPage(p) {
    await loadToc();
    const pages = await getJSON("data/pages.json");
    let best = null;
    for (const e of pages) if (e[0] <= p && (!best || e[0] >= best[0])) best = e;
    if (!best) return location.replace("#/");
    location.replace(`#/s/${best[1]}/${best[2]}`);
  }

  // ---------- flashcards ----------
  async function viewCards(n) {
    await loadToc();
    const chap = await getChapter(n).catch(() => null);
    if (!chap) return notFound();
    setTitle(`Flashcards · Chapter ${n}`);
    const terms = chap.sections.find(s => s.kind === "terms")?.terms || [];
    const boxes = state.cards[n] ||= {};
    let flipBack = false;
    let queue, total, done;
    const start = all => {
      queue = shuffle(terms.filter(t => all || (boxes[t.term] || 0) < 2));
      if (!queue.length) queue = shuffle(terms.slice());
      total = queue.length; done = 0; draw();
    };
    const draw = () => {
      if (!queue.length) {
        app.innerHTML = `<div class="fc-wrap"><div class="crumbs"><a href="#/">Home</a> › <a href="#/c/${n}">Chapter ${n}</a></div>
          <div class="card done"><div class="big">🎉</div><h1>Deck done!</h1><p class="muted">You worked through ${total} cards. ${terms.filter(t => (boxes[t.term] || 0) >= 2).length} of ${terms.length} terms are marked as known.</p>
          <div class="fc-actions"><button class="btn primary" id="again">Go again</button><a class="btn" href="#/quiz/${n}">Try the quiz</a><a class="btn" href="#/c/${n}">Back to chapter</a></div></div></div>`;
        confetti();
        $("#again").addEventListener("click", () => start(true));
        return;
      }
      const t = queue[0];
      const front = flipBack ? `<div class="def">${t.def}</div>` : `<div class="word">${esc(t.term)}</div>`;
      const back = flipBack ? `<div class="word">${esc(t.term)}</div>` : `<div class="def">${t.def}</div>`;
      app.innerHTML = `<div class="fc-wrap">
        <div class="crumbs"><a href="#/">Home</a> › <a href="#/c/${n}">Chapter ${n}: ${esc(chap.title)}</a></div>
        <div class="fc-top"><h1 style="margin:0">Flashcards</h1><span><button class="iconbtn" id="dir">${flipBack ? "Show term first" : "Show definition first"}</button> <button class="iconbtn" id="all">Study all ${terms.length}</button></span></div>
        <div class="muted" style="font-size:.85rem">${done} of ${total} done · ${terms.filter(t => (boxes[t.term] || 0) >= 2).length}/${terms.length} known</div>
        <div class="bar"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
        <div class="flip" id="card" tabindex="0" role="button" aria-label="Flip card"><div class="flip-in"><div class="face">${front}<span class="hint">Tap to flip</span></div><div class="face back">${back}<span class="hint">Did you know it?</span></div></div></div>
        <div class="fc-actions"><button class="btn again" id="no">↺ Still learning</button><button class="btn good" id="yes">✓ Got it</button></div>
        <p class="muted" style="text-align:center;font-size:.8rem;margin-top:14px">Keys: space = flip, ← still learning, → got it</p></div>`;
      const card = $("#card");
      card.addEventListener("click", () => card.classList.toggle("on"));
      $("#yes").addEventListener("click", () => answer(true));
      $("#no").addEventListener("click", () => answer(false));
      $("#dir").addEventListener("click", () => { flipBack = !flipBack; draw(); });
      $("#all").addEventListener("click", () => start(true));
    };
    const answer = ok => {
      const t = queue.shift();
      if (ok) { boxes[t.term] = Math.min(3, (boxes[t.term] || 0) + 1); done++; }
      else { boxes[t.term] = 0; queue.splice(Math.min(queue.length, 3 + (Math.random() * 3 | 0)), 0, t); }
      save(); draw();
    };
    keyHandler = e => {
      if (!$("#card")) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); $("#card").classList.toggle("on"); }
      if (e.key === "ArrowRight") answer(true);
      if (e.key === "ArrowLeft") answer(false);
    };
    if (!terms.length) { app.innerHTML = `<p class="empty">No key terms found for this chapter.</p>`; return; }
    start(false);
  }

  // ---------- quiz ----------
  async function viewQuiz(n) {
    await loadToc();
    const [chap, study] = await Promise.all([getChapter(n).catch(() => null), getStudy(n)]);
    if (!chap) return notFound();
    setTitle(`Quiz · Chapter ${n}`);
    const key = study?.answers || {};
    const pool = chap.sections.filter(s => s.questions && s.kind !== "challenge").flatMap(s => s.questions.map(q => fixQ(q, study)).filter(q => q.opts.length >= 2 && key[q.n]).map(q => ({ q, s })));
    const head = `<div class="crumbs"><a href="#/">Home</a> › <a href="#/c/${n}">Chapter ${n}: ${esc(chap.title)}</a></div>`;
    if (!pool.length) {
      const rs = chap.sections.find(s => s.kind === "review");
      app.innerHTML = `<div class="quiz-wrap">${head}<div class="card done"><div class="big">🛠️</div><h1>Quiz coming soon</h1><p class="muted">The answer key for this chapter isn't ready yet. You can still look at the questions.</p><div class="fc-actions">${rs ? `<a class="btn primary" href="#/s/${rs.id}">See the review questions</a>` : ""}<a class="btn" href="#/cards/${n}">Flashcards instead</a></div></div></div>`;
      return;
    }
    const ctx = { chap, gloss: glossary(chap), lastPg: null };
    currentCtx = ctx;
    const deck = shuffle(pool.slice()).slice(0, 10);
    let i = 0, right = 0, missed = [];
    const draw = () => {
      if (i >= deck.length) {
        const pct = Math.round((right / deck.length) * 100);
        const q = state.quiz[n] ||= {};
        q.last = pct; q.best = Math.max(q.best || 0, pct); save();
        app.innerHTML = `<div class="quiz-wrap">${head}<div class="card done"><div class="score">${right}/${deck.length}</div><h1>${pct >= 90 ? "Amazing! 🌟" : pct >= 70 ? "Nice work! 💪" : "Good practice! 📚"}</h1>
          ${missed.length ? `<p class="muted">Worth another look:</p>${missed.map(({ q, s }) => `<p><a href="#/s/${s.id}/q${q.n}">Question ${q.n} · ${esc(s.title)}</a></p>`).join("")}` : `<p class="muted">You got every one right.</p>`}
          <div class="fc-actions"><button class="btn primary" id="again">New quiz</button><a class="btn" href="#/cards/${n}">Flashcards</a><a class="btn" href="#/c/${n}">Back to chapter</a></div></div></div>`;
        if (pct >= 80) confetti();
        $("#again").addEventListener("click", () => viewQuiz(n));
        return;
      }
      const { q, s } = deck[i];
      app.innerHTML = `<div class="quiz-wrap">${head}<div class="fc-top"><h1 style="margin:0">Practice quiz</h1><span class="pill">${i + 1} of ${deck.length} · ${right} right</span></div>
        <div class="bar"><i style="width:${(i / deck.length) * 100}%"></i></div>
        <div class="reader" id="qwrap">${questionCard(q, ctx, key)}</div>
        <p class="muted" style="font-size:.8rem">From ${esc(s.title)}, question ${q.n}</p>
        <div class="fc-actions"><button class="btn primary" id="nextQ" hidden>${i + 1 < deck.length ? "Next question →" : "See my score"}</button></div></div>`;
      wireQuestions($("#qwrap"), key, ok => { if (ok) right++; else missed.push(deck[i]); $(".pill").textContent = `${i + 1} of ${deck.length} · ${right} right`; $("#nextQ").hidden = false; $("#nextQ").focus({ preventScroll: true }); });
      $("#nextQ").addEventListener("click", () => { i++; draw(); window.scrollTo(0, 0); });
    };
    draw();
  }

  // ---------- search ----------
  const STOP = new Set("a an the of and or to in on for is are was were be by with what which who how why when where does do did that this these those it its as at from into about can i you me my your explain define definition meaning mean means".split(" "));
  async function viewSearch(q) {
    await loadToc();
    $("#q").value = q;
    setTitle(`Search: ${q}`);
    // a bare section / page / figure number goes straight there
    const jump = q.trim().match(/^(?:section\s*)?(\d{1,2})\.(\d{1,2})$/i);
    if (jump && toc.chapters.some(c => c.sections.some(s => s.id === `${+jump[1]}.${+jump[2]}`))) return location.replace(`#/s/${+jump[1]}.${+jump[2]}`);
    const pj = q.trim().match(/^(?:p|pg|page)\.?\s*(\d{1,4})$/i);
    if (pj) return location.replace(`#/p/${pj[1]}`);
    const fj = q.trim().match(/^(fig(?:ure)?|table)\.?\s*(\d{1,2}\.\d{1,2})$/i);
    if (fj) return location.replace(`#/${/^f/i.test(fj[1]) ? "fig" : "table"}/${fj[2]}`);
    const cj = q.trim().match(/^(?:ch|chapter)\.?\s*(\d{1,2})$/i);
    if (cj) return location.replace(`#/c/${cj[1]}`);
    app.innerHTML = `<p class="empty">Searching the whole book…</p>`;
    const idx = await getJSON("data/search.json");
    if (!idx._low) idx._low = idx.docs.map(d => d[3].toLowerCase());
    const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(w => w && !STOP.has(w));
    if (!words.length) { app.innerHTML = `<p class="empty">Type a word to search for.</p>`; return; }
    const stems = words.map(w => w.length > 4 ? w.replace(/(ies|es|s|ing|ed)$/, "") : w);
    const phrase = words.join(" ");
    const res = [];
    const kindW = { h3: 3, h4: 3, term: 4, box: 1.5, fig: 1.2, p: 1, li: 1, q: .6 };
    idx._low.forEach((t, i) => {
      let score = 0, hit = 0;
      for (const s of stems) {
        let k = 0, pos = t.indexOf(s);
        while (pos !== -1 && k < 20) { if (pos === 0 || !/[\p{L}\p{N}]/u.test(t[pos - 1])) k++; pos = t.indexOf(s, pos + s.length); }
        if (k) { hit++; score += 1 + Math.log(k); }
      }
      if (!hit) return;
      if (hit < stems.length) score *= .35 * hit / stems.length;
      if (stems.length > 1 && t.includes(phrase)) score *= 2;
      const d = idx.docs[i];
      score *= kindW[d[2]] || 1;
      if (d[2] === "term" && t.startsWith(stems[0])) score *= 3;
      if (d[3].length < 80 && d[2] !== "term" && d[2] !== "h3" && d[2] !== "h4") score *= .7;
      res.push([score, i]);
    });
    res.sort((a, b) => b[0] - a[0]);
    const bySec = new Map();
    for (const [score, i] of res) {
      const d = idx.docs[i];
      if (!bySec.has(d[0])) { if (bySec.size >= 25) continue; bySec.set(d[0], { score, hits: [] }); }
      const g = bySec.get(d[0]);
      if (g.hits.length < 3) g.hits.push(d);
    }
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${stems.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})([\\p{L}]*)`, "giu");
    const snip = text => {
      const low = text.toLowerCase();
      let at = Math.min(...stems.map(s => { const p = low.indexOf(s); return p < 0 ? 1e9 : p; }));
      if (at === 1e9) at = 0;
      const a = Math.max(0, at - 90), b = Math.min(text.length, at + 170);
      return (a ? "…" : "") + esc(text.slice(a, b)).replace(re, "$1<mark>$2$3</mark>") + (b < text.length ? "…" : "");
    };
    const secInfo = id => { const ch = tocCh(chOf(id)); const s = ch?.sections.find(x => x.id === id); return [ch, s]; };
    const total = res.length;
    app.innerHTML = `<div class="reader-wrap"><div class="crumbs"><a href="#/">Home</a> › Search</div><h1>“${esc(q)}”</h1>
      <p class="muted">${total ? `Found in ${total} place${total === 1 ? "" : "s"}${bySec.size >= 25 ? " — showing the best 25 sections" : ""}.` : "No matches. Try a shorter word, or check the spelling."}</p>
      <div class="results">${[...bySec.entries()].map(([sid, g]) => {
        const [ch, s] = secInfo(sid);
        if (!s) return "";
        return `<div class="card res"><div class="where">Chapter ${ch.n}: ${esc(ch.title)} · ${pagesText(pageRange(ch, s))}</div>
          <a class="title" href="#/s/${sid}">${esc(secLabel(s))}</a>
          ${g.hits.map(d => `<a class="snip" style="display:block;color:inherit;text-decoration:none" href="#/s/${sid}/${d[1].startsWith("q") || d[1].startsWith("t") ? d[1] : d[1]}">${d[2] === "term" ? "🔑 " : d[2] === "fig" ? "🖼️ " : d[2] === "q" ? "✏️ " : ""}${snip(d[3])}</a>`).join("")}</div>`;
      }).join("")}</div></div>`;
    window.scrollTo(0, 0);
  }

  function notFound() { app.innerHTML = `<div class="card empty"><h1>Hmm, can't find that.</h1><p><a href="#/">Go home</a></p></div>`; }

  // ---------- router ----------
  let keyHandler = null;
  document.addEventListener("keydown", e => { if (keyHandler && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) keyHandler(e); });
  async function route() {
    stopSpeaking(); pop.hidden = true; keyHandler = null; currentCtx = null;
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const [v, a, ...rest] = h.split("/");
    const b = rest.join("/");
    if (v !== "search") $("#q").value = "";
    try {
      if (!v) return await viewHome();
      if (v === "hw") return await viewHome([a, b].filter(Boolean).join("/"));
      if (v === "c") return await viewChapter(+a);
      if (v === "s") return await viewSection(a, b || null);
      if (v === "fig" || v === "table") return await goFigure(v, a);
      if (v === "p") return await goPage(+a);
      if (v === "cards") return await viewCards(+a);
      if (v === "quiz") return await viewQuiz(+a);
      if (v === "search") return await viewSearch([a, b].filter(Boolean).join("/"));
      notFound();
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="card empty"><h1>Something went wrong loading that.</h1><p class="muted">${esc(err.message)}</p><p><a href="#/">Go home</a></p></div>`;
    }
  }
  $("#searchForm").addEventListener("submit", e => { e.preventDefault(); const v = $("#q").value.trim(); if (v) location.hash = "#/search/" + encodeURIComponent(v); $("#q").blur(); });
  window.addEventListener("hashchange", route);
  route();
})();
