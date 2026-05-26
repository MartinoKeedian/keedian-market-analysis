// Pure scoring math: Impact (USD → 1–10) and Feasibility (1–10 composite).
// No DOM dependencies. Imported by matrix.js, profile.js, parameters.js.

const COUNTRIES = ['CL', 'MX', 'US'];

// -------------------------- Impact (raw USD) --------------------------

export function computeImpactUsd(profile, mode, countryFilter, scoring) {
  const horizon = scoring.impact.subscription_horizon_years;
  const countriesToInclude = countryFilter === 'all' ? COUNTRIES : [countryFilter];
  const agg = scoring.countries_filter.aggregation; // 'sum' | 'max'

  const perCountry = countriesToInclude.map((c) =>
    computeImpactUsdSingleCountry(profile, mode, c, horizon)
  );

  if (agg === 'max') return Math.max(...perCountry, 0);
  return perCountry.reduce((a, b) => a + b, 0);
}

function computeImpactUsdSingleCountry(profile, mode, country, horizonYears) {
  const m = profile.market_analysis || {};
  const c = (m.by_country || {})[country];
  if (!c) return 0;

  const sites = c.sites?.nominal ?? 0;
  const impl = c.implementation || {};
  const sub = c.subscription || {};

  const implRevenue =
    sites * pctToFraction(impl.addressable_pct) * (impl.avg_ticket_usd ?? 0);
  const subRevenue =
    sites *
    pctToFraction(sub.addressable_pct) *
    (sub.arpu_monthly_usd ?? 0) *
    12 *
    horizonYears;

  if (mode === 'implementation_only') return implRevenue;
  if (mode === 'subscription_only') return subRevenue;
  return implRevenue + subRevenue;
}

function pctToFraction(p) {
  if (p === null || p === undefined) return 0;
  return p / 100;
}

// -------------------------- Impact normalization to 1–10 --------------------------

export function normalizeImpactAxis(impactByProfile, method) {
  const entries = Object.entries(impactByProfile);
  if (method === 'linear') {
    const max = Math.max(...entries.map(([_, v]) => v), 1);
    return Object.fromEntries(
      entries.map(([id, v]) => [id, scaleTo1to10(v / max)])
    );
  }
  if (method === 'quantile') {
    const sorted = [...entries].sort((a, b) => a[1] - b[1]);
    const n = sorted.length;
    return Object.fromEntries(
      sorted.map(([id, _v], i) => [id, scaleTo1to10(n > 1 ? i / (n - 1) : 0.5)])
    );
  }
  // default: log
  const max = Math.max(...entries.map(([_, v]) => v), 1);
  const logMax = Math.log10(max + 1);
  return Object.fromEntries(
    entries.map(([id, v]) => [
      id,
      scaleTo1to10(logMax > 0 ? Math.log10(v + 1) / logMax : 0),
    ])
  );
}

function scaleTo1to10(fraction01) {
  const f = Math.max(0, Math.min(1, fraction01));
  return 1 + f * 9;
}

// -------------------------- Feasibility (1–10) --------------------------
//
// Inputs now vary by (country, project_type). Storage shape on the profile:
//   profile.market_analysis.feasibility = [
//     { id, country_code, project_type, need_perception, hw_gap,
//       similar_clients_exist, bms_penetration_effect, sustainment_upside },
//     ... (up to 6 rows per profile: 3 countries × 2 types)
//   ]
// Selecting the right slice and averaging is the scoring's job here.

export function computeFeasibility(profile, mode, country, scoring) {
  const rows = profile.market_analysis?.feasibility;
  if (!rows || rows.length === 0) return null;

  // Filter by country
  let slice = country === 'all' ? rows : rows.filter((r) => r.country_code === country);
  // Filter by mode: full uses both impl + sub rows; the other two restrict.
  if (mode === 'implementation_only') slice = slice.filter((r) => r.project_type === 'implementation');
  else if (mode === 'subscription_only') slice = slice.filter((r) => r.project_type === 'subscription');
  if (slice.length === 0) return null;

  const avg = (field) => {
    const vals = slice.map((r) => r[field]).filter((v) => v !== null && v !== undefined);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const inputs = {
    need_perception: avg('need_perception'),
    hw_gap: invertIfNeeded(avg('hw_gap'), scoring.feasibility.hw_gap?.invert),
    similar_clients_exist: avg('similar_clients_exist'),
    bms_penetration_effect: applyBmsSign(
      avg('bms_penetration_effect'),
      mode,
      scoring.feasibility.bms_penetration_effect?.by_mode,
      profile
    ),
    sustainment_upside: avg('sustainment_upside'),
  };

  const weights = scoring.feasibility.weights;
  let total = 0;
  let weightTotal = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (inputs[k] === null || inputs[k] === undefined) continue;
    total += w * inputs[k];
    weightTotal += w;
  }
  if (weightTotal === 0) return null;
  return clamp1to10(total / weightTotal);
}

// Per-country averaged inputs (used by the master table feasibility columns).
// Returns { need_perception, hw_gap, similar_clients_exist, bms_penetration_effect, sustainment_upside }
// averaged over (impl + sub) rows of the given country.
export function feasibilityInputsForCountry(profile, country) {
  const rows = profile.market_analysis?.feasibility;
  if (!rows || rows.length === 0) return {};
  let slice = country === 'all' ? rows : rows.filter((r) => r.country_code === country);
  if (slice.length === 0) return {};
  const avg = (field) => {
    const vals = slice.map((r) => r[field]).filter((v) => v !== null && v !== undefined);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10;
  };
  return {
    need_perception: avg('need_perception'),
    hw_gap: avg('hw_gap'),
    similar_clients_exist: avg('similar_clients_exist'),
    bms_penetration_effect: avg('bms_penetration_effect'),
    sustainment_upside: avg('sustainment_upside'),
  };
}

function invertIfNeeded(value, invert) {
  if (value === null || value === undefined) return null;
  if (!invert) return value;
  return 11 - value; // 1 ↔ 10, 5 ↔ 6, etc.
}

function applyBmsSign(value, mode, byMode, profile) {
  if (value === null || value === undefined) return null;
  if (!byMode) return value;
  const sign = byMode[mode];
  if (sign === 'positive') return value;
  if (sign === 'negative') return 11 - value;
  if (sign === 'mixed') {
    // Weighted by revenue split inside the profile for "full" mode.
    const split = revenueSplit(profile);
    return split.sub * value + split.impl * (11 - value);
  }
  return value;
}

function revenueSplit(profile) {
  // crude per-profile blend; falls back to 50/50 if data is missing.
  const m = profile.market_analysis?.by_country || {};
  let impl = 0;
  let sub = 0;
  for (const c of Object.values(m)) {
    const sites = c.sites?.nominal ?? 0;
    impl += sites * ((c.implementation?.addressable_pct ?? 0) / 100) * (c.implementation?.avg_ticket_usd ?? 0);
    sub += sites * ((c.subscription?.addressable_pct ?? 0) / 100) * (c.subscription?.arpu_monthly_usd ?? 0) * 12 * 3;
  }
  const total = impl + sub;
  if (total === 0) return { impl: 0.5, sub: 0.5 };
  return { impl: impl / total, sub: sub / total };
}

function clamp1to10(v) {
  return Math.max(1, Math.min(10, v));
}

// -------------------------- Quadrant classification --------------------------

export function classifyQuadrant(impact10, feasibility10, thresholds) {
  const hiImp = impact10 >= thresholds.impact;
  const hiFeas = feasibility10 >= thresholds.feasibility;
  if (hiImp && hiFeas) return 'high_impact_high_feas';
  if (hiImp && !hiFeas) return 'high_impact_low_feas';
  if (!hiImp && hiFeas) return 'low_impact_high_feas';
  return 'low_impact_low_feas';
}

// -------------------------- USD formatting --------------------------

export function fmtUsd(n) {
  if (!isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
