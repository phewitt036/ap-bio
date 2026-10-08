// Save the PDF's bookmark outline (chapters -> sections -> page indexes) to outline.json
import * as mupdf from "mupdf";
import fs from "fs";
const PDF = process.env.PDF || "C:/Users/phewi/Downloads/Biology-AP-Courses_-_WEB.pdf";
const doc = mupdf.Document.openDocument(fs.readFileSync(PDF), "application/pdf");
const strip = it => ({ title: it.title, page: it.page, down: (it.down || []).map(strip) });
fs.writeFileSync("outline.json", JSON.stringify(doc.loadOutline().map(strip), null, 1));
console.log("outline.json written");
