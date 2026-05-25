# Contributing

This repo is single-owner. Push to `main` directly is allowed and expected.
PRs are optional and used only when you want a checkpoint before merging a
multi-commit change.

## Branching (when you want to use branches)

| Prefix       | Use for                                       |
|--------------|-----------------------------------------------|
| `data/`      | Updates to `docs/data/profiles/*.yml` or scoring |
| `feature/`   | New views, components, or interaction modes   |
| `fix/`       | Bug fixes in the app or scoring               |
| `design/`    | CSS/visual changes (within KP design system)  |
| `docs/`      | README, this file, comments in YAML headers   |
| `chore/`     | Tooling, GH workflows, dependencies           |

## Commit message format

```
<prefix>: <short imperative description>

<optional longer body explaining the why, not the what>
```

## What requires a PR to KeedianProductization (not this repo)

These touchpoints leave the boundary of this repo and need Roi's review:

1. Adding the link to this module from `docs/index.html` of KP.
2. Promoting a new field that needs to live in both repos to
   `data/segments.yml` of KP.
3. Updating a segment's context page in KP (`context/customer-segments.md`).

Everything else stays here and needs no external review.

## Design system

This repo reuses the Keedian design system from
`KeedianProductization/docs/shared/styles.css`. The mirror workflow
(`sync-kp.yml`) keeps `docs/assets/styles.css` in sync. **Do not edit
`docs/assets/styles.css` directly** — your edits will be overwritten on the
next mirror run. Open a PR to KP if you need to change a design token.

Local component styles (matrix scatter, sliders, drill-down layout) live in
`docs/assets/app.css`. New styles must use existing tokens
(`var(--kd-blue)`, `var(--kd-ink)`, etc.); do not introduce new colors or
fonts without first proposing them in KP.

## Data integrity

Before pushing changes to `docs/data/profiles/*.yml`:

```bash
node scripts/validate.mjs
```

This validates that:
- All percentages are in [0, 100]
- Sites counts are non-negative
- Feasibility inputs are in [1, 10]
- Required fields are present
- `validation_status` flags reference real paths

CI runs this on every push via `.github/workflows/validate.yml`.

## AI mock and Issue creation

The AI chat box in `profile.html` creates GitHub Issues. To enable it,
paste a fine-grained PAT (scope: `issues:write` on this repo) in
`parameters.html` → "GitHub integration". The PAT lives in `localStorage`
and is sent on the Issue create API call. It is never committed.

If you want a real LLM behind the chat instead of the canned mock, replace
the `generateMockPatch()` function in `docs/assets/ai-mock.js`. The rest of
the pipeline (Issue creation, suggestion display) stays the same.
