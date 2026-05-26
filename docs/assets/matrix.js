// Matrix view — SVG scatter of Impact × Feasibility.
// Click a point to select; details render below the matrix.
// Filters update the rendering in place.

import {
  loadAll, getProfileDisplayName, getProfileStatus, isProfileInKP,
  updateCountryDataField, updateProfileField, updateFeasibilityField,
  getCurrentUser,
} from './data-loader.js';
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
    const srcLabel = state.dataSource === 'supabase'
      ? 'Supabase (live — edits enabled when signed in)'
      : `YAML (fallback — ${state.dataSourceError && state.dataSourceError.includes('Invalid schema') ? 'expose `kma` schema in Supabase to enable edits' : 'Supabase unavailable'})`;
    statusEl.textContent = `Data source: ${srcLabel}.`;
    statusEl.className = `status-msg ${state.dataSource === 'supabase' ? 'success' : 'warn'}`;
    bindFilters();
    bindEditing();
    render();
  } catch (err) {
    statusEl.textContent = `Failed to load data: ${err.message}`;
    statusEl.classList.add('error');
    console.error(err);
  }
});

document.addEventListener('kma:auth-changed', () => {
  // re-render so editable cells show/hide accordingly
  if (state) render();
});

function bindFilters() {
  document.getElementById('mode-filter').addEventListener('change', render);
}

function currentFilters() {
  return {
    country: 'all',
    mode: document.getElementById('mode-filter').value,
  };
}

function render() {
  const { country, mode } = currentFilters();
  lastRows = scoreAllProfiles('all', mode);
  const axes = computeAxes(lastRows, state.scoring);
  drawScatter(lastRows, axes);
  // 4 tables: All, US, MX, CL. Scoring is global; per-country values change.
  drawMasterTable(lastRows, axes, 'all', mode, 'master-table-all', 'totals-all');
  drawMasterTable(lastRows, axes, 'US', mode, 'master-table-US', 'totals-US');
  drawMasterTable(lastRows, axes, 'MX', mode, 'master-table-MX', 'totals-MX');
  drawMasterTable(lastRows, axes, 'CL', mode, 'master-table-CL', 'totals-CL');
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

  const W = 1200;
  const H = 700;
  const M = { top: 30, right: 180, bottom: 50, left: 60 };
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

    // Auto-flip label to the left of the dot if near the right edge.
    const labelText = getProfileDisplayName(row.profile);
    const approxLabelWidth = labelText.length * 6;
    const flipLeft = x + r + 4 + approxLabelWidth > M.left + innerW + 30;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', flipLeft ? x - r - 4 : x + r + 4);
    label.setAttribute('y', y + 4);
    label.setAttribute('text-anchor', flipLeft ? 'end' : 'start');
    label.setAttribute('class', `dot-label${isSelected ? ' selected' : ''}`);
    label.textContent = labelText;
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

// -------------------------- Master table --------------------------

const COUNTRIES = ['CL', 'MX', 'US'];
const HORIZON_DEFAULT = 3;
const TABLE_COLLAPSED_KEY = 'kma:table:collapsed:v3';
const DEFAULT_COLLAPSED = { general_data: false, impl_market: true, sub_market: true, feas_inputs: true };

function getTableCollapsed() {
  try {
    const raw = localStorage.getItem(TABLE_COLLAPSED_KEY);
    return raw ? { ...DEFAULT_COLLAPSED, ...JSON.parse(raw) } : { ...DEFAULT_COLLAPSED };
  } catch {
    return { ...DEFAULT_COLLAPSED };
  }
}
function setTableCollapsed(state) {
  try { localStorage.setItem(TABLE_COLLAPSED_KEY, JSON.stringify(state)); } catch {}
}

function drawMasterTable(rows, axes, country, mode, containerId, totalsId) {
  const t = { impact: axes.xThreshold, feasibility: axes.yThreshold };
  const labels = state.scoring.display.quadrant_labels;
  const horizon = state.scoring.impact.subscription_horizon_years ?? HORIZON_DEFAULT;
  const collapsed = getTableCollapsed();

  const tableRows = rows.map((r) => {
    const view = computeTableRow(r.profile, country, mode, horizon);
    const quadrant = r.hasData ? classifyQuadrant(r.impact10, r.feasibility10, t) : null;
    return { row: r, view, quadrant };
  });
  // Sort by per-country impact descending (each table has its own ranking).
  tableRows.sort((a, b) => (b.view.impact_usd || 0) - (a.view.impact_usd || 0));

  // Determine visible sub-columns per group.
  const showGeneral = !collapsed.general_data;
  const showImplDetail = !collapsed.impl_market;
  const showSubDetail = !collapsed.sub_market;
  const showFeasInputs = !collapsed.feas_inputs;

  const generalCols = showGeneral ? 4 : 1;
  const implCols = showImplDetail ? 3 : 1;
  const subCols = showSubDetail ? 3 : 1;
  const feasInputsCols = showFeasInputs ? 5 : 1;

  const expandBtn = (group, isCollapsed) =>
    `<button class="expand-btn" data-group="${group}" title="${isCollapsed ? 'Expand' : 'Collapse'} columns">${isCollapsed ? '▶' : '▼'}</button>`;

  // Country grand total for the summary line
  const grandUsd = tableRows.reduce((s, r) => s + (r.view.impact_usd || 0), 0);
  const totalsEl = totalsId ? document.getElementById(totalsId) : null;
  if (totalsEl) totalsEl.textContent = `· total ${fmtUsd(grandUsd)}`;

  const sectionEl = document.getElementById(containerId);
  sectionEl.innerHTML = `
    <div class="master-table-scroll">
      <table class="master-table">
        <thead>
          <tr class="group-header">
            <th rowspan="2" class="sticky-col">Profile</th>
            <th colspan="${generalCols}">General<br>data ${expandBtn('general_data', !showGeneral)}</th>
            <th colspan="${implCols}">Implementation<br>market ${expandBtn('impl_market', !showImplDetail)}</th>
            <th colspan="${subCols}">Subscription<br>market <span class="group-sub">/yr · Essential</span> ${expandBtn('sub_market', !showSubDetail)}</th>
            <th colspan="2">Total<br>impact</th>
            <th colspan="2">Quadrant ·<br>Feasibility</th>
            <th colspan="${feasInputsCols}">Feasibility<br>inputs ${expandBtn('feas_inputs', !showFeasInputs)}</th>
          </tr>
          <tr class="sub-header">
            ${showGeneral ? `
              <th class="num">Brands</th>
              <th class="num">Sites</th>
              <th class="num" title="Building Management System / IoT penetration (1–10).">BMS</th>
              <th>Concentration</th>
            ` : `<th class="num">Sites</th>`}
            ${showImplDetail ? `
              <th class="num">%&nbsp;Sites</th>
              <th class="num">$/ticket</th>
              <th class="num highlight-total">Total&nbsp;impl.</th>
            ` : `<th class="num highlight-total">Total&nbsp;impl.</th>`}
            ${showSubDetail ? `
              <th class="num">%&nbsp;Sites</th>
              <th class="num">$/yr/site</th>
              <th class="num highlight-total">Total&nbsp;sub.</th>
            ` : `<th class="num highlight-total">Total&nbsp;sub.</th>`}
            <th class="num highlight-total">USD</th>
            <th class="num highlight-axis">1–10</th>
            <th>Quadrant</th>
            <th class="num highlight-score">Score</th>
            ${showFeasInputs ? `
              <th class="num" title="Need perception">Need</th>
              <th class="num" title="HW gap (raw — inverted in scoring)">HW&nbsp;gap</th>
              <th class="num" title="Similar clients exist">Sim.</th>
              <th class="num" title="BMS penetration effect (raw — sign by mode)">BMS&nbsp;eff.</th>
              <th class="num" title="Sustainment upside">Sust.</th>
            ` : `<th class="num" title="Composite (expand to see inputs)">—</th>`}
          </tr>
        </thead>
        <tbody>
          ${tableRows.map((tr) => renderTableRow(tr, labels, showGeneral, showImplDetail, showSubDetail, showFeasInputs, country)).join('')}
        </tbody>
      </table>
    </div>
  `;

  sectionEl.querySelectorAll('tr.data-row').forEach((trEl) => {
    trEl.addEventListener('click', () => selectProfile(trEl.dataset.id));
  });
  sectionEl.querySelectorAll('.expand-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const group = btn.dataset.group;
      const cur = getTableCollapsed();
      cur[group] = !cur[group];
      setTableCollapsed(cur);
      render();
    });
  });
}

function renderTableRow({ row, view, quadrant }, labels, showGeneral, showImplDetail, showSubDetail, showFeasInputs, country) {
  const p = row.profile;
  const m = p.market_analysis || {};
  const isSelected = p.id === selectedId;
  // Country-specific editing only in CL/MX/US tables, not in "All" sum.
  const editCountry = country !== 'all' ? country : null;
  const cdRowId = editCountry ? m.by_country?.[editCountry]?._id : null;
  // ed() is the global helper defined below — uses escapeAttr for safe values.
  const concVal = m.market_concentration?.value;
  const bmsVal = m.bms_penetration?.value;

  const bmsTitle = escapeAttr(`${m.bms_penetration?.rationale || ''}\nSource: ${m.bms_penetration?.source || '—'}`);
  const concTitle = escapeAttr(`${m.market_concentration?.rationale || ''}\nSource: ${m.market_concentration?.source || '—'}`);
  const brandsTitle = escapeAttr(`${m.brands_range?.rationale || ''}\nSource: ${m.brands_range?.source || '—'}`);
  const sitesTitle = escapeAttr(`${view.sites_notes || ''}`);

  const concBadge = m.market_concentration?.value
    ? `<span class="conc-badge conc-${m.market_concentration.value}">${m.market_concentration.value}</span>`
    : '—';

  const quadrantLabel = quadrant ? labels[quadrant] : '—';
  const quadrantClass = quadrant ? quadrant : '';

  return `
    <tr class="data-row${isSelected ? ' selected' : ''}" data-id="${p.id}">
      <td class="sticky-col profile-name">
        <span class="status-dot status-${getProfileStatus(p)}"></span>
        <span ${ed('profiles', p.id, 'display_name', 'text', p.display_name)}>${escapeHtml(getProfileDisplayName(p))}</span>
      </td>
      ${showGeneral ? `
        <td class="num" title="${brandsTitle}">
          <span ${ed('profiles', p.id, 'brands_range_low', 'number', m.brands_range?.low)}>${fmtNum(m.brands_range?.low) || '—'}</span>
          <span class="range-sep">–</span>
          <span ${ed('profiles', p.id, 'brands_range_high', 'number', m.brands_range?.high)}>${fmtNum(m.brands_range?.high) || '—'}</span>
        </td>
        <td class="num"
            ${editCountry ? ed('country_data', cdRowId, 'sites_nominal', 'number', m.by_country?.[editCountry]?.sites?.nominal) : ''}
            title="${sitesTitle}">${fmtNum(view.sites_total)}</td>
        <td class="num bms-cell"
            ${ed('profiles', p.id, 'bms_penetration_value', 'number-1-10', bmsVal)}
            title="${bmsTitle}">${bmsVal ?? '—'}</td>
        <td ${ed('profiles', p.id, 'market_concentration_value', 'enum-concentration', concVal)}
            title="${concTitle}">${concBadge}</td>
      ` : `
        <td class="num"
            ${editCountry ? ed('country_data', cdRowId, 'sites_nominal', 'number', m.by_country?.[editCountry]?.sites?.nominal) : ''}
            title="${sitesTitle}">${fmtNum(view.sites_total)}</td>
      `}
      ${showImplDetail ? `
        <td class="num"
            ${editCountry ? ed('country_data', cdRowId, 'impl_addressable_pct', 'number', view.impl_addr) : ''}>${fmtPct(view.impl_addr)}</td>
        <td class="num"
            ${editCountry ? ed('country_data', cdRowId, 'impl_avg_ticket_usd', 'number', view.impl_ticket) : ''}>${fmtUsd(view.impl_ticket)}</td>
      ` : ''}
      <td class="num strong highlight-total">${fmtUsd(view.impl_total)}</td>
      ${showSubDetail ? `
        <td class="num"
            ${editCountry ? ed('country_data', cdRowId, 'sub_addressable_pct', 'number', view.sub_addr) : ''}>${fmtPct(view.sub_addr)}</td>
        <td class="num"
            ${editCountry ? ed('country_data', cdRowId, 'sub_arpu_monthly_usd_yearly', 'number-arpu-annual', view.sub_arpu_annual) : ''}>${fmtUsd(view.sub_arpu_annual)}</td>
      ` : ''}
      <td class="num strong highlight-total">${fmtUsd(view.sub_total)}</td>
      <td class="num strong highlight-total">${fmtUsd(view.impact_usd)}</td>
      <td class="num highlight-axis">${row.impact10 != null ? row.impact10.toFixed(1) : '—'}</td>
      <td><span class="qbadge ${quadrantClass}">${quadrantLabel}</span></td>
      <td class="num strong highlight-score">${row.feasibility10 != null ? row.feasibility10.toFixed(1) : '—'}</td>
      ${showFeasInputs ? `
        <td class="num" ${ed('feasibility_inputs', p.id, 'need_perception', 'number-1-10', m.feasibility_inputs?.need_perception)}>${m.feasibility_inputs?.need_perception ?? '—'}</td>
        <td class="num" ${ed('feasibility_inputs', p.id, 'hw_gap', 'number-1-10', m.feasibility_inputs?.delivery_capacity?.hw_gap)}>${m.feasibility_inputs?.delivery_capacity?.hw_gap ?? '—'}</td>
        <td class="num" ${ed('feasibility_inputs', p.id, 'similar_clients_exist', 'number-1-10', m.feasibility_inputs?.delivery_capacity?.similar_clients_exist)}>${m.feasibility_inputs?.delivery_capacity?.similar_clients_exist ?? '—'}</td>
        <td class="num" ${ed('feasibility_inputs', p.id, 'bms_penetration_effect', 'number-1-10', m.feasibility_inputs?.delivery_capacity?.bms_penetration_effect)}>${m.feasibility_inputs?.delivery_capacity?.bms_penetration_effect ?? '—'}</td>
        <td class="num" ${ed('feasibility_inputs', p.id, 'sustainment_upside', 'number-1-10', m.feasibility_inputs?.delivery_capacity?.sustainment_upside)}>${m.feasibility_inputs?.delivery_capacity?.sustainment_upside ?? '—'}</td>
      ` : `
        <td class="num muted">—</td>
      `}
    </tr>
  `;
}

function computeTableRow(profile, country, mode, horizon) {
  const m = profile.market_analysis || {};
  const countries = country === 'all' ? COUNTRIES : [country];

  // Per-country aggregation
  let sitesTotal = 0;
  let implTotal = 0;
  let subTotal = 0;
  let weightedImplAddr = 0;
  let weightedSubAddr = 0;
  let weightedImplTicket = 0;
  let weightedSubArpu = 0;
  let weightSum = 0;

  for (const c of countries) {
    const cd = (m.by_country || {})[c];
    if (!cd) continue;
    const sites = cd.sites?.nominal ?? 0;
    if (sites === 0) continue;
    sitesTotal += sites;

    const implAddr = cd.implementation?.addressable_pct ?? 0;
    const implTicket = cd.implementation?.avg_ticket_usd ?? 0;
    const subAddr = cd.subscription?.addressable_pct ?? 0;
    const arpuMonthly = cd.subscription?.arpu_monthly_usd ?? 0;
    const arpuAnnual = arpuMonthly * 12;

    implTotal += sites * (implAddr / 100) * implTicket;
    subTotal += sites * (subAddr / 100) * arpuAnnual * horizon;

    weightedImplAddr += implAddr * sites;
    weightedSubAddr += subAddr * sites;
    weightedImplTicket += implTicket * sites;
    weightedSubArpu += arpuAnnual * sites;
    weightSum += sites;
  }

  const view = {
    sites_total: sitesTotal,
    impl_addr: weightSum > 0 ? Math.round(weightedImplAddr / weightSum) : null,
    impl_ticket: weightSum > 0 ? Math.round(weightedImplTicket / weightSum) : null,
    impl_total: implTotal,
    sub_addr: weightSum > 0 ? Math.round(weightedSubAddr / weightSum) : null,
    sub_arpu_annual: weightSum > 0 ? Math.round(weightedSubArpu / weightSum) : null,
    sub_total: subTotal,
    impact_usd:
      mode === 'implementation_only' ? implTotal :
      mode === 'subscription_only' ? subTotal :
      implTotal + subTotal,
    sites_notes: m.by_country?.US?.sites_rationale || '',
  };
  return view;
}

function escapeAttr(s) {
  return String(s).replaceAll('"', '&quot;').replaceAll('\n', '&#10;');
}
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// -------------------------- Inline editing --------------------------

let editingCell = null;

function bindEditing() {
  document.addEventListener('click', async (e) => {
    const cell = e.target.closest('[data-editable="true"]');
    if (!cell) return;
    if (editingCell) return;                                   // already editing another
    if (!document.body.classList.contains('auth-signed-in')) return;
    if (cell.querySelector('input, select')) return;
    startEdit(cell);
  });
}

function startEdit(cell) {
  editingCell = cell;
  const { editTable, editRecord, editField, editType, editValue } = cell.dataset;
  cell.dataset.original = cell.innerHTML;

  let inputEl;
  if (editType === 'enum-concentration') {
    inputEl = document.createElement('select');
    inputEl.innerHTML = `
      <option value=""></option>
      <option value="fragmented" ${editValue === 'fragmented' ? 'selected' : ''}>fragmented</option>
      <option value="mixed" ${editValue === 'mixed' ? 'selected' : ''}>mixed</option>
      <option value="concentrated" ${editValue === 'concentrated' ? 'selected' : ''}>concentrated</option>
    `;
  } else if (editType === 'textarea' || editType === 'pain-points') {
    inputEl = document.createElement('textarea');
    inputEl.rows = editType === 'pain-points' ? 5 : 4;
    inputEl.value = editType === 'pain-points'
      ? (editValue || '').split('|').join('\n')
      : (editValue || '');
  } else if (editType === 'text') {
    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.value = editValue || '';
  } else if (editType === 'bool') {
    inputEl = document.createElement('select');
    inputEl.innerHTML = `
      <option value="true" ${editValue === 'true' ? 'selected' : ''}>true</option>
      <option value="false" ${editValue === 'false' ? 'selected' : ''}>false</option>
    `;
  } else {
    // number / number-1-10 / number-arpu-annual / number-decimal
    inputEl = document.createElement('input');
    inputEl.type = 'number';
    inputEl.value = editValue;
    if (editType === 'number-1-10') {
      inputEl.min = '1'; inputEl.max = '10'; inputEl.step = '1';
    } else if (editType === 'number-decimal') {
      inputEl.step = 'any';
    }
  }
  inputEl.className = 'inline-edit';
  cell.innerHTML = '';
  cell.appendChild(inputEl);
  inputEl.focus();
  if (inputEl.select) inputEl.select();

  let finishing = false;
  const finish = async (save) => {
    if (finishing) return;
    finishing = true;
    if (save) {
      const raw = (inputEl.value ?? '').toString();
      let toSave;
      let field = editField;
      if (editType === 'number-arpu-annual') {
        const v = raw.trim();
        toSave = v === '' ? null : parseFloat(v) / 12;
        field = 'sub_arpu_monthly_usd';
      } else if (editType === 'pain-points') {
        toSave = raw.split('\n').map((s) => s.trim()).filter(Boolean);
      } else if (editType === 'bool') {
        toSave = raw === 'true';
      } else if (editType.startsWith('number')) {
        const v = raw.trim();
        toSave = v === '' ? null : parseFloat(v);
      } else {
        const v = raw.trim();
        toSave = v === '' ? null : raw;            // preserve internal whitespace for text/textarea
      }
      try {
        cell.classList.add('saving');
        await persistEdit(editTable, editRecord, field, toSave);
        applyLocalUpdate(editTable, editRecord, field, toSave);
        editingCell = null;
        render();
      } catch (err) {
        alert(`Save failed: ${err.message}`);
        cell.innerHTML = cell.dataset.original;
        editingCell = null;
      } finally {
        cell.classList.remove('saving');
      }
    } else {
      cell.innerHTML = cell.dataset.original;
      editingCell = null;
    }
  };
  inputEl.addEventListener('blur', () => finish(true));
  inputEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !(inputEl.tagName === 'TEXTAREA' && !ev.metaKey && !ev.ctrlKey)) {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      finish(false);
    } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      finish(true);
    }
  });
}

async function persistEdit(table, recordId, field, value) {
  if (table === 'country_data') return updateCountryDataField(recordId, field, value);
  if (table === 'profiles')     return updateProfileField(recordId, field, value);
  if (table === 'feasibility_inputs') return updateFeasibilityField(recordId, field, value);
  throw new Error(`Unknown table: ${table}`);
}

function applyLocalUpdate(table, recordId, field, value) {
  // mutate state.profiles so re-render reflects the change without re-fetching
  if (table === 'profiles') {
    const p = state.profiles.find((x) => x.id === recordId);
    if (!p) return;
    const m = p.market_analysis || {};
    switch (field) {
      case 'display_name': p.display_name = value; break;
      case 'kp_segment_id': p.kp_segment_id = value; break;
      case 'preliminary': p.preliminary = value; break;
      case 'pain_points': m.pain_points = value; break;
      case 'typical_site_sqft_low': m.typical_site_sqft.low = value; break;
      case 'typical_site_sqft_high': m.typical_site_sqft.high = value; break;
      case 'typical_site_sqft_nominal': m.typical_site_sqft.nominal = value; break;
      case 'market_concentration_value': m.market_concentration.value = value; break;
      case 'market_concentration_rationale': m.market_concentration.rationale = value; break;
      case 'market_concentration_source': m.market_concentration.source = value; break;
      case 'bms_penetration_value': m.bms_penetration.value = value; break;
      case 'bms_penetration_rationale': m.bms_penetration.rationale = value; break;
      case 'bms_penetration_source': m.bms_penetration.source = value; break;
      case 'brands_range_low': m.brands_range.low = value; break;
      case 'brands_range_high': m.brands_range.high = value; break;
      case 'brands_range_rationale': m.brands_range.rationale = value; break;
      case 'brands_range_source': m.brands_range.source = value; break;
    }
  } else if (table === 'country_data') {
    for (const p of state.profiles) {
      for (const code of ['CL', 'MX', 'US']) {
        const cd = p.market_analysis?.by_country?.[code];
        if (cd && cd._id === recordId) {
          switch (field) {
            case 'sites_low': cd.sites.low = value; break;
            case 'sites_high': cd.sites.high = value; break;
            case 'sites_nominal': cd.sites.nominal = value; break;
            case 'sites_rationale': cd.sites_rationale = value; break;
            case 'impl_addressable_pct': cd.implementation.addressable_pct = value; break;
            case 'impl_avg_ticket_usd': cd.implementation.avg_ticket_usd = value; break;
            case 'sub_addressable_pct': cd.subscription.addressable_pct = value; break;
            case 'sub_arpu_monthly_usd': cd.subscription.arpu_monthly_usd = value; break;
          }
          return;
        }
      }
    }
  } else if (table === 'feasibility_inputs') {
    const p = state.profiles.find((x) => x.id === recordId);
    if (!p || !p.market_analysis.feasibility_inputs) return;
    const f = p.market_analysis.feasibility_inputs;
    if (field === 'need_perception') f.need_perception = value;
    else if (f.delivery_capacity) f.delivery_capacity[field] = value;
  }
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
        <h2><span class="editable-text" ${ed('profiles', p.id, 'display_name', 'text', p.display_name)}>${escapeHtml(getProfileDisplayName(p))}</span> <span class="badge status-${status}">${status}</span></h2>
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
  const dc = f.delivery_capacity || {};
  const cell = (field, value) =>
    `<span ${ed('feasibility_inputs', p.id, field, 'number-1-10', value)}>${value ?? '—'}</span>`;
  const items = [
    ['Need perception', cell('need_perception', f.need_perception)],
    ['HW gap (raw; inverted in scoring)', cell('hw_gap', dc.hw_gap)],
    ['Similar clients exist', cell('similar_clients_exist', dc.similar_clients_exist)],
    ['BMS penetration effect (raw; sign by mode)', cell('bms_penetration_effect', dc.bms_penetration_effect)],
    ['Sustainment upside', cell('sustainment_upside', dc.sustainment_upside)],
  ];
  return `
    <table class="scoring-table compact">
      <tbody>
        ${items.map(([k, v]) => `
          <tr><td>${k}</td><td class="mono right">${v}</td></tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Helper used everywhere in the drill-down: emits the data-* attrs for an editable span.
function ed(table, recordId, field, type, value) {
  if (!table || !recordId) return '';
  return `data-editable="true" data-edit-table="${table}" data-edit-record="${recordId}" data-edit-field="${field}" data-edit-type="${type}" data-edit-value="${value == null ? '' : escapeAttr(String(value))}"`;
}

function marketBlockHtml(p) {
  const m = p.market_analysis || {};
  const sqft = m.typical_site_sqft || {};
  const conc = m.market_concentration || {};
  const bms = m.bms_penetration || {};
  const brands = m.brands_range || {};
  const pains = m.pain_points || [];

  const editVal = (field, type, val, display) =>
    `<span class="editable-text" ${ed('profiles', p.id, field, type, val)}>${display ?? (val ?? '—')}</span>`;

  const editText = (field, val) =>
    `<span class="editable-text editable-long" ${ed('profiles', p.id, field, 'text', val)}>${escapeHtml(val || '—')}</span>`;

  const editTextarea = (field, val) =>
    `<div class="editable-block" ${ed('profiles', p.id, field, 'textarea', val)}>${escapeHtml(val || '—')}</div>`;

  const editPainPoints = (val) =>
    `<div class="editable-block" ${ed('profiles', p.id, 'pain_points', 'pain-points', (val || []).join('|'))}>${
      (val || []).length
        ? `<ul class="bullets">${val.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
        : '—'
    }</div>`;

  const countryCard = (code, label) => {
    const c = (m.by_country || {})[code] || {};
    const s = c.sites || {};
    const i = c.implementation || {};
    const sub = c.subscription || {};
    const cdId = c._id;
    const editC = (field, type, val, display) =>
      cdId ? `<span class="editable-text" ${ed('country_data', cdId, field, type, val)}>${display ?? (val ?? '—')}</span>` : `<span>${display ?? (val ?? '—')}</span>`;
    const editCText = (field, val) =>
      cdId ? `<div class="editable-block" ${ed('country_data', cdId, field, 'textarea', val)}>${escapeHtml(val || '—')}</div>` : `<div>${escapeHtml(val || '—')}</div>`;

    return `
      <div class="country-card">
        <h4>${label}</h4>
        <dl class="kv compact">
          <dt>Sites — low</dt><dd>${editC('sites_low', 'number', s.low)}</dd>
          <dt>Sites — high</dt><dd>${editC('sites_high', 'number', s.high)}</dd>
          <dt>Sites — nominal</dt><dd>${editC('sites_nominal', 'number', s.nominal)}</dd>
          <dt>Sites rationale</dt><dd>${editCText('sites_rationale', c.sites_rationale)}</dd>
          <dt>Impl addressable %</dt><dd>${editC('impl_addressable_pct', 'number-decimal', i.addressable_pct, fmtPct(i.addressable_pct))}</dd>
          <dt>Impl avg ticket (USD)</dt><dd>${editC('impl_avg_ticket_usd', 'number-decimal', i.avg_ticket_usd, fmtUsdRaw(i.avg_ticket_usd))}</dd>
          <dt>Sub addressable %</dt><dd>${editC('sub_addressable_pct', 'number-decimal', sub.addressable_pct, fmtPct(sub.addressable_pct))}</dd>
          <dt>Sub ARPU / month (USD)</dt><dd>${editC('sub_arpu_monthly_usd', 'number-decimal', sub.arpu_monthly_usd, fmtUsdRaw(sub.arpu_monthly_usd))}</dd>
        </dl>
      </div>
    `;
  };

  return `
    <h3>Typical site size (ft²)</h3>
    <dl class="kv compact">
      <dt>Low</dt><dd>${editVal('typical_site_sqft_low', 'number', sqft.low)}</dd>
      <dt>High</dt><dd>${editVal('typical_site_sqft_high', 'number', sqft.high)}</dd>
      <dt>Nominal</dt><dd>${editVal('typical_site_sqft_nominal', 'number', sqft.nominal)}</dd>
    </dl>

    <h3>Brands range (operators)</h3>
    <dl class="kv compact">
      <dt>Low</dt><dd>${editVal('brands_range_low', 'number', brands.low)}</dd>
      <dt>High</dt><dd>${editVal('brands_range_high', 'number', brands.high)}</dd>
      <dt>Rationale</dt><dd>${editTextarea('brands_range_rationale', brands.rationale)}</dd>
      <dt>Source</dt><dd>${editText('brands_range_source', brands.source)}</dd>
    </dl>

    <h3>Market concentration</h3>
    <dl class="kv compact">
      <dt>Value</dt><dd><span class="editable-text" ${ed('profiles', p.id, 'market_concentration_value', 'enum-concentration', conc.value)}>${conc.value || '—'}</span></dd>
      <dt>Rationale</dt><dd>${editTextarea('market_concentration_rationale', conc.rationale)}</dd>
      <dt>Source</dt><dd>${editText('market_concentration_source', conc.source)}</dd>
    </dl>

    <h3>BMS penetration</h3>
    <dl class="kv compact">
      <dt>Value (1–10)</dt><dd>${editVal('bms_penetration_value', 'number-1-10', bms.value)}</dd>
      <dt>Rationale</dt><dd>${editTextarea('bms_penetration_rationale', bms.rationale)}</dd>
      <dt>Source</dt><dd>${editText('bms_penetration_source', bms.source)}</dd>
    </dl>

    <h3>Pain points <span class="muted small">(one per line when editing)</span></h3>
    ${editPainPoints(pains)}

    <h3>By country</h3>
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
