.PHONY: build demo live verify calibrate test pytest figures figures-check
SELLER ?= anthropic:claude-opus-4-8
SCENARIO ?= logistics-saas

build:
	npm ci && npm run build

# Offline, no API key: full graded episode via mock buyer + heuristic judge.
demo: build
	node dist/cli.js bench --scenario $(SCENARIO) --seller scripted-disciplined --mock --verbose

# Live: fresh graded episode against a real model (needs a key in .env).
live: build
	node dist/cli.js bench --scenario $(SCENARIO) --seller $(SELLER) --verbose

# Environment-validity gate: naive seller must NOT win; disciplined must clear.
calibrate: build
	node dist/cli.js calibrate --scenario $(SCENARIO) --mock

# Recompute paper-stats from released rows and diff against the committed file.
verify:
	python3 analysis/verify_stats.py

test: build
	npm test

# Python suite: macro generation, released-row status fields, stats verifier,
# SFT export, judge/expert agreement. Stdlib only apart from pytest itself.
pytest:
	python3 -m pytest -q analysis finetune validation

# Re-render the four paper figures from paper-stats.json. Needs matplotlib.
figures:
	python3 paper/figures/render_figures.py

# Drift gate for figures. Stdlib only, so CI needs no plotting stack: it
# recomputes the plotted values from paper-stats.json and re-hashes the PDFs
# against figure-data.json. The generated TeX was already gated this way, which
# is why prose healed on the 11->13 model regrid while the figures silently did
# not; this closes that hole.
figures-check:
	python3 paper/figures/render_figures.py --check
