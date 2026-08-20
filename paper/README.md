# The Value Engine Benchmark — Paper

Modular LaTeX source for the VEB paper (arXiv preprint → NeurIPS Datasets &
Benchmarks track).

## Build

```bash
cd docs/paper
tectonic main.tex          # one-shot, self-contained (used to build the shipped PDF)
# — or the classic path (what arXiv runs):
pdflatex main && bibtex main && pdflatex main && pdflatex main
```

Compiles today with a neutral `article` base (no vendor style required). For the
camera-ready, drop the official `neurips_2024.sty` (or the Datasets & Benchmarks
variant) into this directory — `main.tex` auto-detects it via `\IfFileExists`.

## Layout

- `main.tex` — assembly point + preamble + draft flags.
- `macros.tex` — **single source of truth for every number.** Design constants
  are final; result numbers are wrapped in `\NUM{}` and render distinctly until
  the grid freezes. Freeze = replace the `\NUM{...}` bodies and set `\draftfalse`
  in `main.tex`.
- `sections/` — one file per section. Front sections (00–05) are fully written;
  06–08 (experiments/results/analysis) are scaffolded with `\TODO{}` callouts;
  09–11 (limitations/ethics/repro/conclusion) are fully written.
- `tables/` — table skeletons keyed to result macros.
- `figures/` — figure assets + `render_figures.py` (matplotlib, reads the frozen
  `paper-stats.json`). `value_frontier.pdf` is rendered; re-run the script after
  any data refresh.
- `references.bib` — real citations; verify each before camera-ready.

## Status

| Section | State |
|---|---|
| Abstract, Intro, Related Work | written |
| Environment, Grading, Validation | written |
| Experiments | written (design) + TODOs for frozen numbers |
| Results, Analysis | scaffolded (pre-committed analyses + macro placeholders) |
| Limitations, Ethics, Reproducibility, Conclusion | written |
| Appendix | scaffolded |

## Grounding

- Methodology (pack track + rubric): the book
  `docs/The_Value_Engine_Ed1_revised_AI_afterword.docx`.
- Grading math: `benchmark/src/grading/{dvi,judge,report}.ts`.
  - DVI = MEDDPICC 40 · 3 Whys 20 · EB 15 · MAP 15 · Champion 10 (bands: ≥75
    commit, 50–74 develop, <50 rebuild).
  - SQS = 0.6·DVI + 20·PriceIntegrity + Outcome (won 20 · no-decision 6 · lost 0).

## Before camera-ready

Search for `\TODO{` and resolve each; set `\draftfalse`; verify every `.bib`
entry; add repo/DOI/license; fill the author block.

## Submitting to arXiv

See **[`ARXIV-SUBMISSION.md`](ARXIV-SUBMISSION.md)** for the full step-by-step:
the freeze gate (fill $\kappa$/$\alpha$, flip `\draftfalse`, re-render figures),
building the source bundle, filename rules, category/license choices, and the
announcement cycle.
