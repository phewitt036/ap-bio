# Bio Buddy

A study site for Bethany's AP Biology class, built from the free OpenStax textbook
*Biology for AP® Courses* (CC BY-NC-SA 4.0).

- **Read** every chapter and section with the figures, side boxes and printed page numbers.
- **Search** the whole book. Bold key terms are tappable and show their definitions.
- **Homework helper:** type what the teacher said ("read 5.2, pages 198–205, review questions 5–10")
  and get links straight to the section, pages, figures or questions.
- **Flashcards** for every chapter's key terms.
- **Practice quizzes** with explanations, for chapters that have an answer key in `site/study/`.
- **Read aloud** and a text-size control on every section.

Progress (sections read, flashcard boxes, quiz scores) is saved in the browser on each device.

## Layout

```
site/            the static website, deployable as-is (no build step)
  index.html, app.js, app.css
  data/          generated from the PDF: toc.json, chNN.json, search.json, pages.json
  img/           generated figures (JPEG) and inline symbols (PNG)
  study/chNN.json  hand-written: plain-English summaries + answer keys (one file per chapter)
tools/           the pipeline that turns the PDF into site/data and site/img
```

## Rebuilding the data from the PDF

The PDF (about 250 MB) is not in the repo. Download it from
https://openstax.org/details/books/biology-ap-courses, then in Git Bash:

```bash
cd tools && npm install
mkdir -p work && cd work
PDF=/path/to/Biology-AP-Courses_-_WEB.pdf node ../outline.mjs        # outline.json
PDF=/path/to/Biology-AP-Courses_-_WEB.pdf node ../stage1.mjs         # pages/NNNN.json (~4 min)
OUT=../../site PDF=/path/to/Biology-AP-Courses_-_WEB.pdf node ../stage2.mjs   # chapters + images (~10 min)
OUT=../../site node ../stage3.mjs                                    # toc, search, pages
```

`stage2.mjs 5 --no-img` rebuilds a single chapter's text without re-rendering figures.

## Adding a chapter's study notes

Copy `site/study/ch05.json` to `site/study/chNN.json` and fill in:

- `sections["N.M"]`: `big` (one sentence), `points` (short bullets), optional `tip`, `words` (key terms; these become tappable).
- `answers["Q"]`: `a` (correct letter), optional `alt` (other letters that also count), `why` (explanation).
  Questions without options take only `why`, which shows as a model answer.

The quiz for a chapter switches on automatically once its answer key exists.

## Preview locally

```bash
node tools/serve.mjs
```

Then open http://localhost:5180.

## License

Book text and figures: © Rice University, OpenStax, CC BY-NC-SA 4.0, "Access for free at openstax.org".
Everything else here adapts that work and is shared under the same license. Non-commercial use only.
