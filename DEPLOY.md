# Deploying to Vercel

This module's static frontend is configured to deploy to Vercel out of the
docs/ directory. The GitHub Pages workflow is kept as a fallback but can
be disabled once Vercel is live.

## One-time Vercel setup

1. Sign in to https://vercel.com (use GitHub to log in — same identity).
2. Click **Add New → Project**.
3. **Import Git Repository** → select `MartinoKeedian/keedian-market-analysis`.
4. Configure project:
   - Framework Preset: **Other**
   - Root Directory: `./` (default)
   - Output Directory: gets read from `vercel.json` (`docs`). Don't override.
   - Build Command: leave blank (static).
   - Install Command: leave blank.
5. Click **Deploy**.
6. First deploy takes ~30s. You'll get a URL like
   `https://keedian-market-analysis.vercel.app` (or with a suffix if name
   is taken — write down whichever you get).

## Auth options for the deployed site

### Option A — Public URL + app-level auth gate (free, recommended)

The Vercel URL is publicly resolvable, but the app shows a sign-in screen
before loading data. Supabase magic link gates access; an allowlist of
emails in `kma.allowed_users` (or RLS policy by `auth.email()`) determines
who can actually get in. This requires the gate code in `auth.js` to
redirect unauth users to a sign-in screen (not yet implemented — flag if
you want it).

**Cost:** $0. Works on Vercel Hobby (single-user team).

### Option B — Vercel Authentication (Pro plan, $20/mo)

In Vercel: **Project → Settings → Deployment Protection → Vercel
Authentication → Standard Protection**. Add team members or audience by
email. Anonymous visitors get bounced to Vercel's login.

**Cost:** Pro plan required ($20/mo) to manage > 1 user.

### Option C — Cloudflare Pages + Cloudflare Access (free, up to 50 users)

If you want edge-level gating without paying, migrate to Cloudflare Pages
instead of Vercel and turn on Cloudflare Access. Out of scope of this
file but doable in ~30 min.

## Supabase redirect URL allowlist

After the Vercel URL is known, add it to Supabase Auth → URL Configuration
→ Redirect URLs:

```
https://<your-vercel-url>.vercel.app/**
```

(Keep the existing GitHub Pages URL in the list until you're ready to
retire it.) Without this, magic link sign-ins from the Vercel URL will
bounce to localhost / Site URL fallback.

## After Vercel works: retire GitHub Pages

1. Disable Pages in the repo: Settings → Pages → Source → "None".
2. Delete or disable `.github/workflows/deploy-pages.yml` (rename to
   `deploy-pages.yml.disabled` is the safest first step).
3. Update any external links pointing to
   `https://martinokeedian.github.io/keedian-market-analysis/` to the
   Vercel URL (notably the link from KP's `docs/index.html` if you ever
   added one).

## CI/CD model

Vercel auto-deploys on every push to `main`. PRs get preview URLs
automatically — useful for review before merging.

The `sync-kp.yml` workflow stays as-is (it commits to main; Vercel will
pick that up). Same for `validate.yml`.
