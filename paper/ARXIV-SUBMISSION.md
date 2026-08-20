# Getting the VEB paper onto arXiv — step by step

A practical, in-order checklist for submitting `paper/` to arXiv as a
LaTeX **source** bundle. Follow it top to bottom; nothing here assumes prior
arXiv experience.

> **Hard gate — do not skip.** The build ships clean (`\draftfalse`), but two
> headline numbers (judge–expert Cohen's $\kappa$ and Krippendorff's $\alpha$)
> are deliberately unmeasured: the `\resJudgeKappa` and `\resJudgeAlpha` macros
> render *(forthcoming)* pending the human-validation study. **No arXiv
> submission until those κ/α are computed from the `validation/` study and the
> *(forthcoming)* placeholders are replaced with real values.** **arXiv is a
> permanent, citable record.** Do not submit until the
> [freeze checklist](#0-freeze-checklist-do-this-first) below is fully green.

---

## 0. Freeze checklist (do this FIRST)

Everything else is mechanics. This is the part that protects your credibility.

- [ ] **Human validation complete.** The judge↔expert agreement study (the kit
      under `validation/`) has run and produced real values for judge–expert
      Cohen's $\kappa$ and Krippendorff's $\alpha$.
- [ ] **Fill the two placeholders** in `paper/macros.tex`:
      `\resJudgeKappa` and `\resJudgeAlpha` — replace the `\textit{(forthcoming)}`
      bodies with the measured values (plain numbers).
- [ ] **Resolve every `\TODO{}`.** Search the tree:
      ```bash
      grep -rn "\\\\TODO{" paper/sections/
      ```
      Each one is either written out or deleted. None may remain.
- [ ] **Draft flag already false.** `main.tex` ships `\draftfalse`, so a stray
      `\NUM{}` or `\TODO{}` silently vanishes instead of shouting — which is
      exactly why you resolve the two κ/α placeholders (above) *before* building
      the submission bundle, not after.
- [ ] **Re-render figures from frozen data:**
      ```bash
      python3 paper/figures/render_figures.py
      ```
      Confirm `figures/value_frontier.pdf` regenerated without error.
- [ ] **Verify every `.bib` entry** in `references.bib` resolves to a real,
      correctly-attributed work (title, authors, venue, year). No hallucinated
      citations.
- [ ] **Author block.** Fill real authors + affiliations in `main.tex` (arXiv is
      not double-blind; put the real names in).
- [ ] **Add repo / license / data-availability** pointers in the reproducibility
      section if not already present.

Only when every box is checked do you proceed.

---

## 1. One-time account setup

1. **Create an arXiv account** at <https://arxiv.org/user/register> using an
   institutional email if you have one (it speeds up endorsement).
2. **Endorsement.** First-time submitters to a category usually need an
   endorsement from an established author in that category. Our primary
   category is **cs.CL** (Computation and Language), cross-listed to **cs.LG**
   (Machine Learning).
   - If you already have submission rights to cs.CL/cs.LG, skip this.
   - Otherwise, arXiv shows an endorsement code and link once you start a
     submission. Send it to a colleague with cs.CL/cs.LG rights; they click one
     link to endorse. Endorsement is about identity, not peer review — it does
     not vouch for the content.
   - Plan for this to take a day or two. Do it before you're in a hurry.

---

## 2. Confirm it compiles under arXiv's toolchain (pdfLaTeX)

arXiv builds submissions with its own TeX Live using **AutoTeX / pdfLaTeX** — it
does **not** use tectonic, latexmk, or your local editor. Two consequences:

- **Force PDF output.** Add this as the **very first line** of `main.tex` (before
  `\documentclass`):
  ```tex
  \pdfoutput=1
  ```
  This tells arXiv to run pdfLaTeX (not the old DVI path), so your PDF figure
  embeds correctly.
- **Do a clean pdfLaTeX build locally** to catch anything tectonic tolerated
  that pdfLaTeX won't:
  ```bash
  cd paper
  pdflatex main && bibtex main && pdflatex main && pdflatex main
  ```
  It must finish with **no errors** and a complete `main.pdf`. Warnings about
  the missing NeurIPS style are fine — the neutral `article` fallback is
  intentional (`\IfFileExists` in `main.tex`).

> If you don't have a local TeX Live, the fastest clean check is Overleaf: upload
> the source bundle from §3, set the compiler to pdfLaTeX, and confirm it builds.

---

## 3. Build the source bundle (this is what you upload)

arXiv wants **LaTeX source**, not a PDF. A PDF-only submission is discouraged,
gets flagged, and loses you the on-arXiv HTML/accessibility rendering. Upload a
`.zip` (or `.tar.gz`) of `paper/` **minus build artifacts**.

- **Include:** `main.tex`, `macros.tex`, `sections/*.tex`, `tables/*.tex`,
  `references.bib`, `figures/*.pdf`, and — importantly — the generated
  **`main.bbl`** (see note below).
- **Exclude:** `main.pdf`, `*.aux`, `*.log`, `*.out`, `*.blg`, `.claude-flow/`,
  `.gitignore`, this file, and `README.md`. The `.gitignore` in this directory
  already lists the build artifacts.

**Include the `.bbl`.** arXiv's AutoTeX may not re-run BibTeX reliably for every
submission. The safe, standard practice is to bundle the `main.bbl` produced by
your local `bibtex` run so references resolve deterministically. Generate it as
part of the §2 build, then include it.

Exact command to produce a clean bundle:

```bash
cd paper
# ensure a fresh .bbl exists (from the §2 build) before zipping
zip -r ../veb-arxiv-source.zip . \
  -x '*.aux' -x '*.log' -x '*.out' -x '*.blg' -x '*.fls' -x '*.fdb_latexmk' \
  -x 'main.pdf' -x '.claude-flow/*' -x '.gitignore' \
  -x 'ARXIV-SUBMISSION.md' -x 'README.md'
```

The bundle lands at the repo root as `veb-arxiv-source.zip`.

---

## 4. Filename hygiene (arXiv is strict)

AutoTeX is picky about filenames. Before zipping, confirm:

- **Charset:** only `A–Z a–z 0–9 _ - .` — no spaces, no accents, no other
  punctuation in any filename.
- **Case-sensitive.** `Figures/` and `figures/` are different directories to
  arXiv. Our `\graphicspath{{figures/}}` and `\includegraphics{figures/value_frontier.pdf}`
  must match the actual lowercase `figures/` directory exactly.
- **No leading dot** on files you intend to upload (arXiv may ignore dotfiles).
- **One `\documentclass`.** The bundle must contain exactly one top-level
  `.tex` with `\documentclass`; arXiv treats that as the main file. Ours is
  `main.tex`.

---

## 5. Submit on arxiv.org

1. Log in → **Submit** (<https://arxiv.org/submit>).
2. **Start a new submission** → license step (see §6) → **Upload files** →
   upload `veb-arxiv-source.zip`.
3. arXiv unpacks and **runs AutoTeX**. Watch the processing log:
   - If it builds, you'll get a **"View PDF"** preview. Open it and read it
     end-to-end — this rendered PDF is exactly what the world will see.
   - If it errors, fix locally, rebuild the `.zip`, and re-upload. Common
     causes: a filename-case mismatch (§4), a missing figure, or a missing
     `.bbl`.
4. **Metadata step:**
   - **Title:** *The Value Engine Benchmark: An Evidence-Graded,
     Methodology-Controlled Environment for Multi-Touch Enterprise-Sales
     Negotiation* (match `main.tex` exactly).
   - **Authors:** same list/order as the paper.
   - **Abstract:** paste the plain-text abstract. Strip LaTeX macros; write
     `\NUM`-free, final numbers only. arXiv abstracts are plain text (a little
     inline math is tolerated, but keep it simple).
   - **Primary category:** `cs.CL`. **Cross-list:** `cs.LG` (add
     `stat.ML` only if you want the extra reach).
   - **Comments (optional):** e.g. "Preprint. Dataset and code:
     thevalueengine.ai/benchmark."
5. **Process/Preview → Submit.**

---

## 6. License choice

You pick a license during submission. Options, briefly:

- **arXiv.org perpetual, non-exclusive license** — the minimal default. You keep
  copyright; arXiv keeps the right to distribute. Safe if unsure.
- **CC BY 4.0** — most open; anyone may reuse with attribution. Best for maximum
  reach and citation, and it's what most benchmark papers pick.
- CC BY-SA, CC BY-NC-SA, CC BY-NC-ND, CC0 — narrower/other terms.

**Recommendation:** CC BY 4.0 unless a co-author or venue objects. Whatever you
choose is **permanent for that version** — you cannot make a version *more*
restrictive later.

---

## 7. Timing & the announcement cycle

- **Cutoff: 14:00 US Eastern (ET), Monday–Friday.** A submission that clears
  processing before 14:00 ET on a business day is announced at **20:00 ET the
  same day**; after 14:00 ET (or on weekends/holidays) it rolls to the next
  business cycle.
- "Announced" = it gets its permanent arXiv ID (e.g. `arXiv:25XX.XXXXX`), appears
  in the daily mailing, and becomes citable.
- Submitting is **not** the same as announced — there's a moderation/processing
  window. Don't submit at 13:59 ET expecting instant publication.

---

## 8. Fixing mistakes

- **Before the cutoff / while on hold:** you can **Unsubmit** (from your
  submission's status page), edit files or metadata, and resubmit. Use this if
  you spot a typo in the preview.
- **After it's announced:** you cannot delete it, but you can post a **new
  version** (v2, v3, …) — "Replace" from the paper's abstract page. All versions
  stay visible; the latest is shown by default. This is normal and expected.
- **Metadata-only fixes** (title/abstract/category typos) don't need a new
  source upload — use the metadata edit flow.

---

## 9. After it's live

- Grab the arXiv ID and update the `/benchmark` page's "Research paper" link and
  the site's citation block to point at the arXiv abstract page.
- Add the arXiv ID to `references.bib`/README for anyone citing the work.
- If you later submit to NeurIPS D&B, drop the official style into `paper/`
  (`main.tex` auto-detects it) and post the camera-ready as a new arXiv version.

---

### Quick reference

| Item | Value |
|---|---|
| Primary category | `cs.CL` |
| Cross-list | `cs.LG` |
| Upload format | LaTeX **source** `.zip` (incl. `main.bbl`, `figures/*.pdf`) |
| Force PDF | `\pdfoutput=1` as line 1 of `main.tex` |
| Recommended license | CC BY 4.0 |
| Announcement cutoff | 14:00 ET, business days |
| Main file | `main.tex` (single `\documentclass`) |
