// Matrix view — SVG scatter of Impact × Feasibility.
// Click a point to select; details render below the matrix.
// Filters update the rendering in place.

import { loadAll, getProfileDisplayName, getProfileStatus, isProfileInKP } from './data-loader.js';
import {
  computeImpactUsd,
  normalizeImpactAxis,
  computeFeasibility,
  classifyQuadrant,
  fmtUsd,
} from './scoring.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const KP_BASE = 'https://roiams.github.io/KeedianProductization';

let state = null;          // { scoring, profiles, countries, kpAvailable }
let lastRows = null;       // last computed scored rows (for selection lookup)
let selectedId = null;     // id of currently selected profile
let activeQuadrant = null; // which quadrant tab is open

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status-msg');
  try {
    state = await loadAll();
    if (!state.kpAvailable) {
      statusEl.textContent =
        'KP mirror unavailable — inherited data will show as empty until sync-kp.yml runs.';
      statusEl.classList.add('warn');
    }
    bindFilters();
    render();
  } catch (err) {
    statusEl.textContent = `Failed to load data: ${err.message}`;
    statusEl.classList.add('error');
    console.error(err);
  }
});

function bindFilters() {
  document.getElementById('country-filter').addEventListener('change', render);
  document.getElementById('mode-filter').addEventListener('change', render);
}

function currentFilters() {
  return {
    country: document.getElementById('country-filter').value,
    mode: document.getElementById('mode-filter').value,
  };
}

function render() {
  const { country, mode } = currentFilters();
  lastRows = scoreAllProfiles(country, mode);
  const axes = computeAxes(lastRows, state.scoring);
  drawScatter(lastRows, axes);
  drawQuadrantTabs(lastRows, axes);
  if (selectedId) drawSelectedProfile(selectedId);
}

function scoreAllProfiles(country, mode) {
  const impactUsd = {};
  for (const p of state.profiles) {
    impactUsd[p.id] = computeImpactUsd(p, mode, country, state.scoring);
  }
  const impactNorm = normalizeImpactAxis(
    impactUsd,
    state.scoring.impact.normalization.method
  );
  return state.profiles.map((p) => {
    const feas = computeFeasibility(p, mode, state.scoring);
    return {
      profile: p,
      impactUsd: impactUsd[p.id],
      impact10: impactNorm[p.id],
      feasibility10: feas,
      hasData: feas !== null && impactUsd[p.id] > 0,
    };
  });
}

// -------------------------- Axis computation --------------------------

function computeAxes(rows, scoring) {
  const valid = rows.filter((r) => r.hasData);
  const xs = valid.map((r) => r.impact10);
  const ys = valid.map((r) => r.feasibility10);

  const axisFit = scoring.display.axis_fit || { mode: 'auto', padding: 0.5 };
  const qt = scoring.display.quadrant_thresholds || { mode: 'median', impact: 5.5, feasibility: 5.5 };

  let xMin, xMax, yMin, yMax;
  if (axisFit.mode === 'auto' && xs.length > 0) {
    const pad = axisFit.padding ?? 0.5;
    xMin = Math.max(1, Math.floor((Math.min(...xs) - pad) * 2) / 2);
    xMax = Math.min(10, Math.ceil((Math.max(...xs) + pad) * 2) / 2);
    yMin = Math.max(1, Math.floor((Math.min(...ys) - pad) * 2) / 2);
    yMax = Math.min(10, Math.ceil((Math.max(...ys) + pad) * 2) / 2);
    if (xMax - xMin < 1) { xMin = Math.max(1, xMin - 0.5); xMax = Math.min(10, xMax + 0.5); }
    if (yMax - yMin < 1) { yMin = Math.max(1, yMin - 0.5); yMax = Math.min(10, yMax + 0.5); }
  } else {
    xMin = 1; xMax = 10; yMin = 1; yMax = 10;
  }

  let xThreshold, yThreshold;
  if (qt.mode === 'median' && xs.length > 0) {
    xThreshold = median(xs);
    yThreshold = median(ys);
  } else {
    xThreshold = qt.impact;
    yThreshold = qt.feasibility;
  }

  return { xMin, xMax, yMin, yMax, xThreshold, yThreshold };
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
}

// -------------------------- Scatter drawing --------------------------

function drawScatter(rows, axes) {
  const svg = document.getElementById('matrix-svg');
  svg.innerHTML = '';

  const W = 1000;
  const H = 640;
  const M = { top: 30, right: 220, bottom: 50, left: 60 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const xScale = (v) => M.left + ((v - axes.xMin) / (axes.xMax - axes.xMin)) * innerW;
  const yScale = (v) => M.top + innerH - ((v - axes.yMin) / (axes.yMax - axes.yMin)) * innerH;

  // Quadrant background bands (subtle, top-right).
  const rect = (x, y, w, h, fill, opacity) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill); r.setAttribute('opacity', opacity);
    return r;
  };
  if (axes.xThreshold >= axes.xMin && axes.xThreshold <= axes.xMax &&
      axes.yThreshold >= axes.yMin && axes.yThreshold <= axes.yMax) {
    svg.appendChild(rect(xScale(axes.xThreshold), M.top, xScale(axes.xMax) - xScale(axes.xThreshold), yScale(axes.yThreshold) - M.top, '#E8EEFF', 0.5));
  }

  // Quadrant dividers.
  const line = (x1, y1, x2, y2, stroke, dash) => {
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', stroke);
    if (dash) l.setAttribute('stroke-dasharray', dash);
    return l;
  };
  if (axes.xThreshold >= axes.xMin && axes.xThreshold <= axes.xMax) {
    svg.appendChild(line(xScale(axes.xThreshold), M.top, xScale(axes.xThreshold), M.top + innerH, '#9CA3AF', '4 4'));
  }
  if (axes.yThreshold >= axes.yMin && axes.yThreshold <= axes.yMax) {
    svg.appendChild(line(M.left, yScale(axes.yThreshold), M.left + innerW, yScale(axes.yThreshold), '#9CA3AF', '4 4'));
  }

  // Axes.
  svg.appendChild(line(M.left, M.top + innerH, M.left + innerW, M.top + innerH, '#000', null));
  svg.appendChild(line(M.left, M.top, M.left, M.top + innerH, '#000', null));

  // Tick labels (every integer in range, plus min/max).
  const xTicks = enumerateTicks(axes.xMin, axes.xMax);
  const yTicks = enumerateTicks(axes.yMin, axes.yMax);
  for (const v of xTicks) {
    const tx = document.createElementNS(SVG_NS, 'text');
    tx.setAttribute('x', xScale(v)); tx.setAttribute('y', M.top + innerH + 18);
    tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('class', 'axis-tick');
    tx.textContent = formatTick(v);
    svg.appendChild(tx);
  }
  for (const v of yTicks) {
    const ty = document.createElementNS(SVG_NS, 'text');
    ty.setAttribute('x', M.left - 10); ty.setAttribute('y', yScale(v) + 4);
    ty.setAttribute('text-anchor', 'end'); ty.setAttribute('class', 'axis-tick');
    ty.textContent = formatTick(v);
    svg.appendChild(ty);
  }

  // Axis labels.
  const xlabel = document.createElementNS(SVG_NS, 'text');
  xlabel.setAttribute('x', M.left + innerW / 2); xlabel.setAttribute('y', H - 12);
  xlabel.setAttribute('text-anchor', 'middle'); xlabel.setAttribute('class', 'axis-label');
  xlabel.textContent = 'IMPACT';
  svg.appendChild(xlabel);
  const ylabel = document.createElementNS(SVG_NS, 'text');
  ylabel.setAttribute('x', -(M.top + innerH / 2)); ylabel.setAttribute('y', 18);
  ylabel.setAttribute('text-anchor', 'middle'); ylabel.setAttribute('class', 'axis-label');
  ylabel.setAttribute('transform', 'rotate(-90)');
  ylabel.textContent = 'FEASIBILITY';
  svg.appendChild(ylabel);

  // Points.
  const pointSizeMode = state.scoring.display.point_size.mode;
  const sitesForSize = (p) =>
    Object.values(p.market_analysis?.by_country || {}).reduce(
      (s, c) => s + (c.sites?.nominal ?? 0), 0);
  const maxSites = Math.max(...state.profiles.map(sitesForSize), 1);

  // Render in two passes so the selected dot is on top.
  const ordered = [...rows].filter((r) => r.hasData);
  ordered.sort((a, b) => (a.profile.id === selectedId ? 1 : 0) - (b.profile.id === selectedId ? 1 : 0));

  for (const row of ordered) {
    if (row.impact10 < axes.xMin || row.impact10 > axes.xMax) continue;
    if (row.feasibility10 < axes.yMin || row.feasibility10 > axes.yMax) continue;
    const x = xScale(row.impact10);
    const y = yScale(row.feasibility10);
    const r =
      pointSizeMode === 'scaled_by_sites'
        ? 4 + Math.sqrt(sitesForSize(row.profile) / maxSites) * 14
        : 7;

    const g = document.createElementNS(SVG_NS, 'g');
    const isSelected = row.profile.id === selectedId;
    g.setAttribute('class', `dot ${getProfileStatus(row.profile)}${isSelected ? ' selected' : ''}`);
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => selectProfile(row.profile.id));

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', x); circle.setAttribute('cy', y);
    circle.setAttribute('r', isSelected ? r + 3 : r);
    g.appendChild(circle);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', x + r + 4); label.setAttribute('y', y + 4);
    label.setAttribute('class', `dot-label${isSelected ? ' selected' : ''}`);
    label.textContent = getProfileDisplayName(row.profile);
    g.appendChild(label);

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent =
      `${getProfileDisplayName(row.profile)}\n` +
      `Impact: ${row.impact10.toFixed(1)}  (${fmtUsd(row.impactUsd)})\n` +
      `Feasibility: ${row.feasibility10.toFixed(1)}\n` +
      (isProfileInKP(row.profile) ? 'In productization' : 'Not in productization');
    g.appendChild(title);
    svg.appendChild(g);
  }

  drawLegend(rows);
}

function enumerateTicks(min, max) {
  const ticks = [];
  const start = Math.ceil(min);
  for (let v = start; v <= Math.floor(max); v++) ticks.push(v);
  if (ticks[0] !== min) ticks.unshift(min);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

function formatTick(v) {
  return Number.isInteger(v) ? v.toString() : v.toFixed(1);
}

function drawLegend(rows) {
  const legend = document.getElementById('matrix-legend');
  const withData = rows.filter((r) => r.hasData).length;
  const withoutData = rows.length - withData;
  legend.innerHTML = `
    <div class="legend-row"><span class="dot-sample published"></span> In productization (published)</div>
    <div class="legend-row"><span class="dot-sample in_progress"></span> In productization (in progress)</div>
    <div class="legend-row"><span class="dot-sample pending"></span> Pending</div>
    <div class="legend-row"><span class="dot-sample non_kp"></span> Not in productization yet</div>
    <div class="legend-stats">
      ${withData} of ${rows.length} profiles plotted${withoutData ? ` · ${withoutData} pending data` : ''}
    </div>
  `;
}

// -------------------------- Quadrant tabs --------------------------

function drawQuadrantTabs(rows, axes) {
  const t = { impact: axes.xThreshold, feasibility: axes.yThreshold };
  const labels = state.scoring.display.quadrant_labels;
  const order = ['high_impact_high_feas', 'low_impact_high_feas', 'high_impact_low_feas', 'low_impact_low_feas'];
  const buckets = Object.fromEntries(order.map((q) => [q, []]));
  for (const r of rows) {
    if (!r.hasData) continue;
    const q = classifyQuadrant(r.impact10, r.feasibility10, t);
    buckets[q].push(r);
  }
  for (const q of order) {
    buckets[q].sort((a, b) =>
      b.impact10 + b.feasibility10 - (a.impact10 + a.feasibility10)
    );
  }

  // Default tab: the most populated, or "Go now" if tied.
  if (!activeQuadrant || buckets[activeQuadrant].length === 0) {
    activeQuadrant = order.find((q) => buckets[q].length > 0) || 'high_impact_high_feas';
  }

  const tabs = document.getElementById('quadrant-tabs');
  tabs.innerHTML = order
    .map(
      (q) => `
      <button class="qtab ${q === activeQuadrant ? 'active' : ''} ${q}" data-q="${q}">
        <span class="qtab-label">${labels[q]}</span>
        <span class="qtab-count">${buckets[q].length}</span>
      </button>`
    )
    .join('');
  tabs.querySelectorAll('.qtab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeQuadrant = btn.dataset.q;
      drawQuadrantTabs(rows, axes);
    });
  });

  const panel = document.getElementById('quadrant-panel');
  const profiles = buckets[activeQuadrant];
  panel.innerHTML = profiles.length === 0
    ? `<p class="muted">No profiles in <strong>${labels[activeQuadrant]}</strong> for the current filters.</p>`
    : `
      <p class="muted small">${profiles.length} profile${profiles.length === 1 ? '' : 's'} in <strong>${labels[activeQuadrant]}</strong> — sorted by combined Impact + Feasibility.</p>
      <ol class="quadrant-list">
        ${profiles.map((r) => `
          <li>
            <button class="profile-link" data-id="${r.profile.id}">
              <span class="profile-link-name">${getProfileDisplayName(r.profile)}</span>
              <span class="profile-link-scores">I ${r.impact10.toFixed(1)} · F ${r.feasibility10.toFixed(1)}</span>
            </button>
          </li>
        `).join('')}
      </ol>
    `;
  panel.querySelectorAll('.profile-link').forEach((btn) => {
    btn.addEventListener('click', () => selectProfile(btn.dataset.id));
  });
}

// -------------------------- Inline selected-profile panel --------------------------

function selectProfile(id) {
  selectedId = id;
  render();
  drawSelectedProfile(id);
  const el = document.getElementById('selected-profile');
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawSelectedProfile(id) {
  const row = lastRows.find((r) => r.profile.id === id);
  if (!row) return;
  const p = row.profile;
  const el = document.getElementById('selected-profile');
  el.hidden = false;

  const status = getProfileStatus(p);
  const kpLink = isProfileInKP(p)
    ? `<a href="${KP_BASE}/${p.kp_segment_id}/" target="_blank" rel="noopener">↗ View in productization</a>`
    : '<span class="muted">Not in productization yet — market-analysis only.</span>';

  el.innerHTML = `
    <div class="selected-header">
      <div>
        <h2>${getProfileDisplayName(p)} <span class="badge status-${status}">${status}</span></h2>
        <p class="muted">${p.inherited_cache?.blurb || 'Market-analysis-only profile.'}</p>
        <p class="profile-meta">${kpLink} · <a href="./profile.html?id=${encodeURIComponent(p.id)}">Full profile page →</a></p>
      </div>
      <button class="btn-secondary" onclick="document.getElementById('selected-profile').hidden = true">Close</button>
    </div>

    <div class="selected-grid">
      <section>
        <h3>Scoring used</h3>
        <dl class="kv compact">
          <dt>Impact (USD, current filters)</dt><dd class="mono">${fmtUsd(row.impactUsd)}</dd>
          <dt>Impact (1–10)</dt><dd class="mono">${row.impact10.toFixed(1)}</dd>
          <dt>Feasibility (1–10)</dt><dd class="mono">${row.feasibility10 != null ? row.feasibility10.toFixed(1) : '—'}</dd>
        </dl>
        <h4>Feasibility breakdown</h4>
        ${feasibilityBreakdownHtml(p)}
        <p class="small muted"><a href="./criteria.html">What do these criteria mean? →</a></p>
      </section>

      <section>
        <h3>Market analysis</h3>
        ${marketBlockHtml(p)}
      </section>
    </div>

    ${isProfileInKP(p) ? `
      <section class="selected-context">
        <h3>Inherited from productization</h3>
        ${inheritedBlockHtml(p)}
      </section>
    ` : ''}
  `;
}

function feasibilityBreakdownHtml(p) {
  const f = p.market_analysis?.feasibility_inputs;
  if (!f) return '<p class="muted">No feasibility inputs.</p>';
  const items = [
    ['Need perception', f.need_perception],
    ['HW gap (raw; inverted in scoring)', f.delivery_capacity?.hw_gap],
    ['Similar clients exist', f.delivery_capacity?.similar_clients_exist],
    ['BMS penetration effect (raw; sign by mode)', f.delivery_capacity?.bms_penetration_effect],
    ['Sustainment upside', f.delivery_capacity?.sustainment_upside],
  ];
  return `
    <table class="scoring-table compact">
      <tbody>
        ${items.map(([k, v]) => `
          <tr><td>${k}</td><td class="mono right">${v ?? '—'}</td></tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function marketBlockHtml(p) {
  const m = p.market_analysis || {};
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

  return `
    <dl class="kv compact">
      <dt>Typical site size (ft²)</dt>
      <dd>${fmtRange(sqft.low, sqft.high)} <span class="muted">(nominal ${fmtNum(sqft.nominal)})</span></dd>
      <dt>Market concentration</dt><dd>${conc.value || '—'} ${conc.notes ? `<span class="muted">— ${conc.notes}</span>` : ''}</dd>
      <dt>BMS penetration (1–10)</dt><dd>${bms.value ?? '—'} ${bms.notes ? `<span class="muted">— ${bms.notes}</span>` : ''}</dd>
      <dt>Pain points</dt>
      <dd>${pains.length ? `<ul class="bullets">${pains.map((p) => `<li>${p}</li>`).join('')}</ul>` : '—'}</dd>
    </dl>
    <h4>By country</h4>
    <div class="country-grid">
      ${countryCard('CL', 'Chile')}
      ${countryCard('MX', 'Mexico')}
      ${countryCard('US', 'United States')}
    </div>
  `;
}

function inheritedBlockHtml(p) {
  const ic = p.inherited_cache;
  if (!ic || !ic.differences) {
    return '<p class="muted">No inherited data yet. Run sync-kp.yml to populate.</p>';
  }
  const d = ic.differences;
  return `
    <dl class="kv compact">
      <dt>Reference customer</dt><dd>${ic.reference_customer || '—'}</dd>
      <dt>Status</dt><dd>${ic.status || '—'}</dd>
      <dt>Products developed</dt><dd>${(ic.products_developed || []).join(', ') || '—'}</dd>
      <dt>Avg sites per customer</dt><dd>${d.avg_sites_per_customer || '—'}</dd>
      <dt>Typical buyer</dt><dd>${d.typical_buyer || '—'}</dd>
      <dt>Sales cycle</dt><dd>${d.sales_cycle || '—'}</dd>
    </dl>
  `;
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
