# keedian-market-analysis

Internal tool for prioritizing customer profiles in Keedian's expansion roadmap.
Renders an Impact × Feasibility matrix across all candidate customer profiles
(both productized and new), with drill-down per profile and editable scoring
parameters.

Not part of the productization microsite. This repo decides *where to go*;
[`roiams/KeedianProductization`](https://github.com/roiams/KeedianProductization)
packages *what we have*.

## Live URL

https://martinokeedian.github.io/keedian-market-analysis/

## What's inside

- **Matrix view** (`docs/index.html`) — scatter of profiles, Impact (1–10) ×
  Feasibility (1–10), filterable by country (CL / MX / US / All) and revenue
  mode (Full / Subscription only / Implementation only).
- **Drill-down** (`docs/profile.html?id=<id>`) — every field for one profile:
  inherited from productization + market-analysis-only fields + scoring
  breakdown + AI mock suggestion box.
- **Parameters** (`docs/parameters.html`) — editable weights for the
  feasibility composite, Impact normalization method, point-size mode.
  Persists to `localStorage`; export to YAML to promote defaults.

## Architecture in one paragraph

Vanilla HTML + CSS + JS, no build step for the app. Data lives in YAML under
`data/`, parsed in-browser via `js-yaml` from a CDN. A scheduled GitHub Action
(`sync-kp.yml`) pulls `segments.yml` and `styles.css` from the private
productization repo with a PAT and commits them under `data/_kp-mirror/` and
`docs/assets/`. The app reads the mirror — no auth needed in the browser.
Pages deploys on every push to `main`.

## Data model

Data lives under `docs/data/` so the served Pages site can fetch it
same-origin (no token, no CORS workaround). Edit it as if it were a
data folder — its physical location alongside `docs/assets/` is a
deploy-time concession, not a semantic one.

```
docs/data/
├── profiles/<id>.yml          # one YAML per customer profile (22 of them)
├── scoring.yml                # default weights, normalization, filters
├── countries.yml              # CL, MX, US
└── _kp-mirror/                # populated by sync-kp.yml (do not edit by hand)
    └── segments.yml
```

Each profile YAML has two top-level blocks:

- `inherited_cache` — snapshot of productization data (read-only, refreshed
  by the mirror). Authoritative copy lives in KeedianProductization.
- `market_analysis` — all market-analysis-only data: site counts by country,
  addressable %, ticket and ARPU per country, BMS penetration, market
  concentration, pain points, feasibility inputs. Source of truth is here.

See `docs/data/profiles/_TEMPLATE.yml` for the full schema.

## Scoring

**Impact** is calculated from real economics, not a manual score:

```
implementation_revenue = sites × impl_addressable_pct × impl_ticket_usd
subscription_revenue   = sites × sub_addressable_pct  × arpu_monthly_usd × 12 × horizon_years
total_impact_usd       = combination depending on selected mode
```

The 1–10 axis is then derived via the chosen normalization (`log` / `linear` /
`quantile`).

**Feasibility** is a weighted composite on a 1–10 scale:

```
need_perception            (weight 0.30)
hw_gap                     (weight 0.25, inverted: high gap → low feasibility)
similar_clients_exist      (weight 0.20)
bms_penetration_effect     (weight 0.10, sign depends on mode)
sustainment_upside         (weight 0.15)
```

BMS penetration effect has different signs by mode:
- `subscription_only` — positive (existing BMS makes service entry easier)
- `implementation_only` — negative (existing BMS reduces room for new impl)
- `full` — combination weighted by the revenue split of the profile

All weights and toggles are editable from `docs/parameters.html`.

## Suggestion flow

The AI mock chat in the drill-down does not write to disk. It creates a
GitHub Issue in this repo via the API, with label `suggestion`, body
containing the proposed patch in markdown. Approval = close the issue and
manually apply the change to the YAML (or ask the agent to do it).

A real LLM swap is one file change away — see `docs/assets/ai-mock.js`.

## Local development

```bash
# Serve docs/ on http://localhost:8000
python -m http.server 8000 -d docs

# Or use any static server you like
npx serve docs
```

Visit `http://localhost:8000/` to land on the matrix. The app fetches data
via relative URLs (`./data/...`), so it works from any plain static server
without flags. No env vars or API keys needed for matrix and drill-down to
render. The AI mock and Issue creation require a GitHub PAT — paste it in
`parameters.html` under "GitHub integration" (stored in `localStorage`).

## Ownership

Single owner: [@MartinoKeedian](https://github.com/MartinoKeedian). No PR
review is required for changes within this repo. The three touchpoints
that require a PR to KeedianProductization (link from KP index, segment
enrichment in `segments.yml`, updates to `customer-segments.md`) are
managed separately.
