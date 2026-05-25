// Matrix view — SVG scatter of Impact × Feasibility.
// Click a point to drill down. Filters update the rendering in place.

import { loadAll, getProfileDisplayName, getProfileStatus, isProfileInKP } from './data-loader.js';
import {
  computeImpactUsd,
  normalizeImpactAxis,
  computeFeasibility,
  classifyQuadrant,
  fmtUsd,
} from './scoring.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

let state = null; // { scoring, profiles, countries, kpAvailable }

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
  const rows = scoreAllProfiles(country, mode);
  drawScatter(rows);
  drawQuadrantSummary(rows);
}

function scoreAllProfiles(country, mode) {
  // Step 1: raw USD impact per profile.
  const impactUsd = {};
  for (const p of state.profiles) {
    impactUsd[p.id] = computeImpactUsd(p, mode, country, state.scoring);
  }
  // Step 2: normalize to 1–10 axis.
  const impactNorm = normalizeImpactAxis(
    impactUsd,
    state.scoring.impact.normalization.method
  );
  // Step 3: feasibility (already 1–10).
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

// -------------------------- Scatter drawing --------------------------

function drawScatter(rows) {
  const svg = document.getElementById('matrix-svg');
  svg.innerHTML = '';

  const W = 1000;
  const H = 640;
  const M = { top: 30, right: 200, bottom: 50, left: 60 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const xScale = (v) => M.left + ((v - 1) / 9) * innerW;
  const yScale = (v) => M.top + innerH - ((v - 1) / 9) * innerH;

  // Quadrant background bands (subtle).
  const tx = state.scoring.display.quadrant_thresholds.impact;
  const ty = state.scoring.display.quadrant_thresholds.feasibility;
  const bandFill = 'var(--kd-blue-soft, #E8EEFF)';
  const rect = (x, y, w, h, fill, opacity) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', x);
    r.setAttribute('y', y);
    r.setAttribute('width', w);
    r.setAttribute('height', h);
    r.setAttribute('fill', fill);
    r.setAttribute('opacity', opacity);
    return r;
  };
  svg.appendChild(rect(xScale(tx), M.top, xScale(10) - xScale(tx), yScale(ty) - M.top, '#E8EEFF', 0.5));

  // Quadrant dividers.
  const line = (x1, y1, x2, y2, stroke, dash) => {
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', x1);
    l.setAttribute('y1', y1);
    l.setAttribute('x2', x2);
    l.setAttribute('y2', y2);
    l.setAttribute('stroke', stroke);
    if (dash) l.setAttribute('stroke-dasharray', dash);
    return l;
  };
  svg.appendChild(line(xScale(tx), M.top, xScale(tx), M.top + innerH, '#9CA3AF', '4 4'));
  svg.appendChild(line(M.left, yScale(ty), M.left + innerW, yScale(ty), '#9CA3AF', '4 4'));

  // Axes.
  svg.appendChild(line(M.left, M.top + innerH, M.left + innerW, M.top + innerH, '#000', null));
  svg.appendChild(line(M.left, M.top, M.left, M.top + innerH, '#000', null));

  // Tick labels.
  for (let v = 1; v <= 10; v++) {
    const tx = document.createElementNS(SVG_NS, 'text');
    tx.setAttribute('x', xScale(v));
    tx.setAttribute('y', M.top + innerH + 18);
    tx.setAttribute('text-anchor', 'middle');
    tx.setAttribute('class', 'axis-tick');
    tx.textContent = v;
    svg.appendChild(tx);
    const ty = document.createElementNS(SVG_NS, 'text');
    ty.setAttribute('x', M.left - 10);
    ty.setAttribute('y', yScale(v) + 4);
    ty.setAttribute('text-anchor', 'end');
    ty.setAttribute('class', 'axis-tick');
    ty.textContent = v;
    svg.appendChild(ty);
  }

  // Axis labels.
  const xlabel = document.createElementNS(SVG_NS, 'text');
  xlabel.setAttribute('x', M.left + innerW / 2);
  xlabel.setAttribute('y', H - 12);
  xlabel.setAttribute('text-anchor', 'middle');
  xlabel.setAttribute('class', 'axis-label');
  xlabel.textContent = 'IMPACT';
  svg.appendChild(xlabel);
  const ylabel = document.createElementNS(SVG_NS, 'text');
  ylabel.setAttribute('x', -(M.top + innerH / 2));
  ylabel.setAttribute('y', 18);
  ylabel.setAttribute('text-anchor', 'middle');
  ylabel.setAttribute('class', 'axis-label');
  ylabel.setAttribute('transform', 'rotate(-90)');
  ylabel.textContent = 'FEASIBILITY';
  svg.appendChild(ylabel);

  // Points.
  const pointSizeMode = state.scoring.display.point_size.mode;
  const sitesForSize = (p) =>
    Object.values(p.market_analysis?.by_country || {}).reduce(
      (s, c) => s + (c.sites?.nominal ?? 0),
      0
    );
  const maxSites = Math.max(...state.profiles.map(sitesForSize), 1);

  for (const row of rows) {
    if (!row.hasData) continue;
    const x = xScale(row.impact10);
    const y = yScale(row.feasibility10);
    const r =
      pointSizeMode === 'scaled_by_sites'
        ? 4 + Math.sqrt(sitesForSize(row.profile) / maxSites) * 14
        : 7;

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', `dot ${getProfileStatus(row.profile)}`);
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => {
      window.location.href = `./profile.html?id=${encodeURIComponent(row.profile.id)}`;
    });

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', r);
    g.appendChild(circle);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', x + r + 4);
    label.setAttribute('y', y + 4);
    label.setAttribute('class', 'dot-label');
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

function drawLegend(rows) {
  const legend = document.getElementById('matrix-legend');
  const withData = rows.filter((r) => r.hasData).length;
  const withoutData = rows.length - withData;
  legend.innerHTML = `
    <div class="legend-row">
      <span class="dot-sample published"></span> In productization (published)
    </div>
    <div class="legend-row">
      <span class="dot-sample in_progress"></span> In productization (in progress)
    </div>
    <div class="legend-row">
      <span class="dot-sample pending"></span> Pending
    </div>
    <div class="legend-row">
      <span class="dot-sample non_kp"></span> Not in productization yet
    </div>
    <div class="legend-stats">
      ${withData} of ${rows.length} profiles plotted ·
      ${withoutData} pending data
    </div>
  `;
}

function drawQuadrantSummary(rows) {
  const t = state.scoring.display.quadrant_thresholds;
  const labels = state.scoring.display.quadrant_labels;
  const buckets = {
    high_impact_high_feas: [],
    high_impact_low_feas: [],
    low_impact_high_feas: [],
    low_impact_low_feas: [],
  };
  for (const r of rows) {
    if (!r.hasData) continue;
    const q = classifyQuadrant(r.impact10, r.feasibility10, t);
    buckets[q].push(r);
  }
  const order = [
    'high_impact_high_feas',
    'low_impact_high_feas',
    'high_impact_low_feas',
    'low_impact_low_feas',
  ];
  const container = document.getElementById('quadrant-summary');
  container.innerHTML = order
    .map(
      (q) => `
    <div class="quadrant-card ${q}">
      <h3>${labels[q]}</h3>
      <p class="quadrant-count">${buckets[q].length} profile${buckets[q].length === 1 ? '' : 's'}</p>
      <ul>
        ${buckets[q]
          .sort((a, b) => b.impact10 + b.feasibility10 - (a.impact10 + a.feasibility10))
          .map(
            (r) =>
              `<li><a href="./profile.html?id=${encodeURIComponent(r.profile.id)}">${getProfileDisplayName(r.profile)}</a></li>`
          )
          .join('')}
      </ul>
    </div>
  `
    )
    .join('');
}
