// Drill-down view — renders one profile by ?id=<id>.

import { loadAll, getProfileDisplayName, getProfileStatus, isProfileInKP } from './data-loader.js';
import { computeImpactUsd, computeFeasibility, fmtUsd } from './scoring.js';
import { submitSuggestion, renderPendingSuggestions } from './ai-mock.js';

const KP_BASE = 'https://roiams.github.io/KeedianProductization';

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const loading = document.getElementById('profile-loading');
  const content = document.getElementById('profile-content');

  if (!id) {
    loading.textContent = 'No profile id given. Go back to the matrix.';
    return;
  }

  try {
    const state = await loadAll();
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) {
      loading.textContent = `Profile "${id}" not found.`;
      return;
    }
    renderProfile(profile, state);
    loading.hidden = true;
    content.hidden = false;
    bindChat(profile);
    renderPendingSuggestions(profile.id);
  } catch (err) {
    loading.textContent = `Failed to load profile: ${err.message}`;
    console.error(err);
  }
});

function renderProfile(profile, state) {
  document.title = `Keedian — ${getProfileDisplayName(profile)}`;
  document.getElementById('profile-title').textContent = getProfileDisplayName(profile);

  const status = getProfileStatus(profile);
  const badge = document.getElementById('profile-status-badge');
  badge.textContent = status;
  badge.className = `badge status-${status}`;

  document.getElementById('profile-blurb').textContent =
    profile.inherited_cache?.blurb || 'No blurb in productization. This profile lives only in market analysis.';

  // Meta line: KP link if applicable.
  const meta = document.getElementById('profile-meta');
  if (isProfileInKP(profile)) {
    meta.innerHTML = `<a href="${KP_BASE}/${profile.kp_segment_id}/" target="_blank" rel="noopener">↗ View in productization</a>`;
  } else {
    meta.innerHTML = `<span class="muted">Not in productization yet — market-analysis only.</span>`;
  }

  renderInheritedBlock(profile);
  renderMarketBlock(profile);
  renderScoringBlock(profile, state);
}

function renderInheritedBlock(profile) {
  const el = document.getElementById('inherited-block');
  if (!isProfileInKP(profile)) {
    el.innerHTML = `<p class="muted">This profile is not productized. No inherited data.</p>`;
    return;
  }
  const ic = profile.inherited_cache;
  const d = ic.differences || {};
  el.innerHTML = `
    <dl class="kv">
      <dt>Reference customer</dt><dd>${ic.reference_customer || '—'}</dd>
      <dt>Status</dt><dd>${ic.status || '—'}</dd>
      <dt>Products developed</dt><dd>${(ic.products_developed || []).join(', ') || '—'}</dd>
      <dt>Avg sites per customer</dt><dd>${d.avg_sites_per_customer || '—'}</dd>
      <dt>Dominant Data Enabler</dt><dd>${d.dominant_data_enabler || '—'}</dd>
      <dt>Tier most often sold</dt><dd>${d.tier_most_often_sold || '—'}</dd>
      <dt>Typical buyer</dt><dd>${d.typical_buyer || '—'}</dd>
      <dt>Sales cycle</dt><dd>${d.sales_cycle || '—'}</dd>
      <dt>Critical add-ons</dt><dd>${d.critical_addons || '—'}</dd>
      <dt>Custom layer demand</dt><dd>${d.custom_layer_demand || '—'}</dd>
      <dt>Distinctive product candidates</dt><dd>${d.distinctive_product_candidates || '—'}</dd>
    </dl>
    <p class="muted small">Synced from <code>${ic.source}</code> at ${ic._synced_at || '—'}</p>
  `;
}

function renderMarketBlock(profile) {
  const m = profile.market_analysis || {};
  const sqft = m.typical_site_sqft || {};
  const conc = m.market_concentration || {};
  const bms = m.bms_penetration || {};
  const pains = m.pain_points || [];

  const countryCard = (code, label) => {
    const c = (m.by_country || {})[code] || {};
    const s = c.sites || {};
    const i = c.implementation || {};
    const sub = c.subscription || {};
    return `
      <div class="country-card">
        <h4>${label}</h4>
        <dl class="kv compact">
          <dt>Sites</dt>
          <dd>${fmtRange(s.low, s.high)} <span class="muted">(nominal ${fmtNum(s.nominal)})</span></dd>
          <dt>Impl addressable</dt><dd>${fmtPct(i.addressable_pct)}</dd>
          <dt>Avg ticket</dt><dd>${fmtUsdRaw(i.avg_ticket_usd)}</dd>
          <dt>Sub addressable</dt><dd>${fmtPct(sub.addressable_pct)}</dd>
          <dt>ARPU / month</dt><dd>${fmtUsdRaw(sub.arpu_monthly_usd)}</dd>
        </dl>
      </div>
    `;
  };

  document.getElementById('market-block').innerHTML = `
    <dl class="kv">
      <dt>Typical site size (ft²)</dt>
      <dd>${fmtRange(sqft.low, sqft.high)} <span class="muted">(nominal ${fmtNum(sqft.nominal)})</span></dd>
      <dt>Market concentration</dt>
      <dd>${conc.value || '—'} ${conc.notes ? `<span class="muted">— ${conc.notes}</span>` : ''}</dd>
      <dt>BMS penetration (1–10)</dt>
      <dd>${bms.value ?? '—'} ${bms.notes ? `<span class="muted">— ${bms.notes}</span>` : ''}</dd>
      <dt>Pain points</dt>
      <dd>${pains.length ? `<ul class="bullets">${pains.map((p) => `<li>${p}</li>`).join('')}</ul>` : '—'}</dd>
    </dl>
    <h3>By country</h3>
    <div class="country-grid">
      ${countryCard('CL', 'Chile')}
      ${countryCard('MX', 'Mexico')}
      ${countryCard('US', 'United States')}
    </div>
  `;
}

function renderScoringBlock(profile, state) {
  const modes = ['full', 'subscription_only', 'implementation_only'];
  const rows = modes
    .map((mode) => {
      const usd = computeImpactUsd(profile, mode, 'all', state.scoring);
      const feas = computeFeasibility(profile, mode, state.scoring);
      return `
      <tr>
        <td>${mode}</td>
        <td class="mono right">${fmtUsd(usd)}</td>
        <td class="mono right">${feas !== null ? feas.toFixed(1) : '—'}</td>
      </tr>`;
    })
    .join('');

  document.getElementById('scoring-block').innerHTML = `
    <table class="scoring-table">
      <thead><tr><th>Mode</th><th class="right">Impact (USD, all)</th><th class="right">Feasibility (1–10)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted small">Impact aggregates the three countries with <code>${state.scoring.countries_filter.aggregation}</code>. Feasibility uses current weights.</p>
  `;
}

function bindChat(profile) {
  const btn = document.getElementById('ai-submit');
  const input = document.getElementById('ai-prompt');
  const statusEl = document.getElementById('ai-status');

  btn.addEventListener('click', async () => {
    const prompt = input.value.trim();
    if (!prompt) {
      statusEl.textContent = 'Type a prompt first.';
      return;
    }
    statusEl.textContent = 'Creating suggestion…';
    try {
      const result = await submitSuggestion(profile, prompt);
      statusEl.textContent = result.message;
      statusEl.className = `status-msg ${result.ok ? 'success' : 'warn'}`;
      input.value = '';
      renderPendingSuggestions(profile.id);
    } catch (err) {
      statusEl.textContent = `Failed: ${err.message}`;
      statusEl.className = 'status-msg error';
    }
  });
}

// -------------------------- formatters --------------------------

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toString();
}
function fmtRange(low, high) {
  if (low === null || low === undefined || high === null || high === undefined) return '—';
  return `${fmtNum(low)}–${fmtNum(high)}`;
}
function fmtPct(p) {
  if (p === null || p === undefined) return '—';
  return `${p}%`;
}
function fmtUsdRaw(n) {
  if (n === null || n === undefined) return '—';
  return `$${n.toLocaleString()}`;
}
