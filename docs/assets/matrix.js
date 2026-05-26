// Matrix view — SVG scatter of Impact × Feasibility.
// Click a point to select; details render below the matrix.
// Filters update the rendering in place.

import {
  loadAll, getProfileDisplayName, getProfileStatus, isProfileInKP,
  updateCountryDataField, updateProfileField, updateFeasibilityField,
  aggregateAttrsAllCountries,
  getCurrentUser,
} from './data-loader.js?v=3';
import {
  computeImpactUsd,
  normalizeImpactAxis,
  computeFeasibility,
  feasibilityInputsForCountry,
  classifyQuadrant,
  fmtUsd,
} from './scoring.js?v=2';

const SVG_NS = 'http://www.w3.org/2000/svg';
const KP_BASE = 'https://roiams.github.io/KeedianProductization';

let state = null;             // { scoring, profiles, countries, kpAvailable }
let rowsByCountry = {};       // { all: [...], US: [...], MX: [...], CL: [...] }
let axesByCountry = {};       // { all: {...}, US: {...}, MX: {...}, CL: {...} }
let selectedId = null;        // id of currently selected profile
let selectedCountry = 'all';  // which country view shows in the drill-down
let activeQuadrant = null;    // legacy (quadrant tabs removed)

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
  const { mode } = currentFilters();
  // Compute per-country rows and axes once, then draw scatter + table per country.
  for (const country of ['all', 'US', 'MX', 'CL']) {
    rowsByCountry[country] = scoreAllProfiles(country, mode);
    axesByCountry[country] = computeAxes(rowsByCountry[country], state.scoring);
    drawScatter(rowsByCountry[country], axesByCountry[country], `scatter-${country}`, `legend-${country}`, country);
    drawMasterTable(rowsByCountry[country], axesByCountry[country], country, mode, `master-table-${country}`, `totals-${country}`);
  }
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
    const feas = computeFeasibility(p, mode, country, state.scoring);
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

function drawScatter(rows, axes, svgId, legendId, country) {
  const svg = document.getElementById(svgId || 'scatter-all');
  if (!svg) return;
  svg.innerHTML = '';

  const W = 1100;
  const H = 540;
  const M = { top: 30, right: 160, bottom: 50, left: 60 };
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
    g.addEventListener('click', () => selectProfile(row.profile.id, country || 'all'));

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

  drawLegend(rows, legendId);
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

function drawLegend(rows, legendId) {
  const legend = document.getElementById(legendId || 'matrix-legend');
  if (!legend) return;
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
    // Override feasibility10 with this table's country-specific value
    // (the global value passed in via `rows` is computed for country='all').
    const localFeas = computeFeasibility(r.profile, mode, country, state.scoring);
    const localRow = { ...r, feasibility10: localFeas };
    const quadrant = localRow.hasData && localFeas !== null
      ? classifyQuadrant(localRow.impact10, localFeas, t)
      : null;
    return { row: localRow, view, quadrant };
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
    trEl.addEventListener('click', () => selectProfile(trEl.dataset.id, country));
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
  const cd = editCountry ? m.by_country?.[editCountry] : null;
  const cdRowId = cd?._id;
  // Per-country attributes — now live inside by_country[code] (0003 migration).
  // For the All view, aggregate across countries.
  const attrs = editCountry ? {
    brands_range: cd?.brands_range || {},
    market_concentration: cd?.market_concentration || {},
    bms_penetration: cd?.bms_penetration || {},
  } : aggregateAttrsAllCountries(p);
  const concVal = attrs.market_concentration?.value;
  const bmsVal = attrs.bms_penetration?.value;
  // Feasibility inputs averaged per country (across impl + sub). Read-only in table;
  // editing happens in the drill-down where each (country, type) cell is exposed.
  const fi = feasibilityInputsForCountry(p, country);

  const bmsTitle = escapeAttr(`${attrs.bms_penetration?.rationale || (editCountry ? '' : 'Weighted average across countries (by sites).')}\nSource: ${attrs.bms_penetration?.source || '—'}`);
  const concTitle = escapeAttr(`${attrs.market_concentration?.rationale || (editCountry ? '' : '"varies" if countries differ.')}\nSource: ${attrs.market_concentration?.source || '—'}`);
  const brandsTitle = escapeAttr(`${attrs.brands_range?.rationale || (editCountry ? '' : 'Range across countries (min low to max high).')}\nSource: ${attrs.brands_range?.source || '—'}`);
  const sitesTitle = escapeAttr(`${view.sites_notes || ''}`);

  const concBadge = concVal
    ? `<span class="conc-badge conc-${concVal === 'varies' ? 'mixed' : concVal}">${concVal}</span>`
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
          ${editCountry ? `
            <span ${ed('country_data', cdRowId, 'brands_range_low', 'number', attrs.brands_range?.low)}>${fmtNum(attrs.brands_range?.low) || '—'}</span>
            <span class="range-sep">–</span>
            <span ${ed('country_data', cdRowId, 'brands_range_high', 'number', attrs.brands_range?.high)}>${fmtNum(attrs.brands_range?.high) || '—'}</span>
          ` : `${fmtNum(attrs.brands_range?.low) || '—'}<span class="range-sep">–</span>${fmtNum(attrs.brands_range?.high) || '—'}`}
        </td>
        <td class="num"
            ${editCountry ? ed('country_data', cdRowId, 'sites_nominal', 'number', cd?.sites?.nominal) : ''}
            title="${sitesTitle}">${fmtNum(view.sites_total)}</td>
        <td class="num bms-cell"
            ${editCountry ? ed('country_data', cdRowId, 'bms_penetration_value', 'number-1-10', bmsVal) : ''}
            title="${bmsTitle}">${bmsVal ?? '—'}</td>
        <td ${editCountry ? ed('country_data', cdRowId, 'market_concentration_value', 'enum-concentration', concVal) : ''}
            title="${concTitle}">${concBadge}</td>
      ` : `
        <td class="num"
            ${editCountry ? ed('country_data', cdRowId, 'sites_nominal', 'number', cd?.sites?.nominal) : ''}
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
        <td class="num" title="Avg of impl + sub for this country. Edit per-type values in drill-down.">${fmtFeas(fi.need_perception)}</td>
        <td class="num" title="Avg of impl + sub for this country. Edit per-type values in drill-down.">${fmtFeas(fi.hw_gap)}</td>
        <td class="num" title="Avg of impl + sub for this country. Edit per-type values in drill-down.">${fmtFeas(fi.similar_clients_exist)}</td>
        <td class="num" title="Avg of impl + sub for this country. Edit per-type values in drill-down.">${fmtFeas(fi.bms_penetration_effect)}</td>
        <td class="num" title="Avg of impl + sub for this country. Edit per-type values in drill-down.">${fmtFeas(fi.sustainment_upside)}</td>
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
function fmtFeas(v) {
  if (v === null || v === undefined) return '—';
  return Number.isInteger(v) ? v.toString() : v.toFixed(1);
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
  // Capture phase: run BEFORE row-level click handlers that would rebuild
  // the DOM (selectProfile → render). Without capture: the row handler
  // fires first, render() wipes the cell, and our document-level handler
  // then sees a detached target → no edit ever opens.
  document.addEventListener('click', async (e) => {
    const cell = e.target.closest('[data-editable="true"]');
    if (!cell) return;
    if (editingCell) return;
    if (!document.body.classList.contains('auth-signed-in')) return;
    if (cell.querySelector('input, select')) return;
    e.stopPropagation();                                       // prevent row handler from firing
    startEdit(cell);
  }, true);
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
  if (table === 'feasibility')  return updateFeasibilityField(recordId, field, value);
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
            case 'typical_site_sqft_low': cd.typical_site_sqft.low = value; break;
            case 'typical_site_sqft_high': cd.typical_site_sqft.high = value; break;
            case 'typical_site_sqft_nominal': cd.typical_site_sqft.nominal = value; break;
            case 'market_concentration_value': cd.market_concentration.value = value; break;
            case 'market_concentration_rationale': cd.market_concentration.rationale = value; break;
            case 'market_concentration_source': cd.market_concentration.source = value; break;
            case 'bms_penetration_value': cd.bms_penetration.value = value; break;
            case 'bms_penetration_rationale': cd.bms_penetration.rationale = value; break;
            case 'bms_penetration_source': cd.bms_penetration.source = value; break;
            case 'brands_range_low': cd.brands_range.low = value; break;
            case 'brands_range_high': cd.brands_range.high = value; break;
            case 'brands_range_rationale': cd.brands_range.rationale = value; break;
            case 'brands_range_source': cd.brands_range.source = value; break;
          }
          return;
        }
      }
    }
  } else if (table === 'feasibility') {
    // recordId is the UUID of the row in the feasibility array.
    for (const p of state.profiles) {
      const r = (p.market_analysis?.feasibility || []).find((x) => x.id === recordId);
      if (r) {
        r[field] = value;
        return;
      }
    }
  }
}

// -------------------------- Inline selected-profile panel --------------------------

function selectProfile(id, country) {
  selectedId = id;
  if (country) selectedCountry = country;
  render();
  drawSelectedProfile(id);
  const el = document.getElementById('selected-profile');
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawSelectedProfile(id) {
  // Find the row in the currently-selected country's data (matches the table the
  // user clicked from); fall back to 'all' if the profile isn't in the chosen view.
  let row = (rowsByCountry[selectedCountry] || []).find((r) => r.profile.id === id);
  if (!row) row = (rowsByCountry.all || []).find((r) => r.profile.id === id);
  if (!row) return;
  const p = row.profile;
  const el = document.getElementById('selected-profile');
  el.hidden = false;

  const status = getProfileStatus(p);
  const kpLink = isProfileInKP(p)
    ? `<a href="${KP_BASE}/${p.kp_segment_id}/" target="_blank" rel="noopener">↗ View in productization</a>`
    : '<span class="muted">Not in productization yet — market-analysis only.</span>';

  const COUNTRY_LABEL = { all: 'All (sum)', US: 'United States', MX: 'Mexico', CL: 'Chile' };
  const countryPills = ['US', 'MX', 'CL', 'all'].map((c) => `
    <button class="country-pill ${c === selectedCountry ? 'active' : ''}" data-country="${c}">${COUNTRY_LABEL[c]}</button>
  `).join('');

  el.innerHTML = `
    <div class="selected-header">
      <div>
        <h2><span class="editable-text" ${ed('profiles', p.id, 'display_name', 'text', p.display_name)}>${escapeHtml(getProfileDisplayName(p))}</span> <span class="badge status-${status}">${status}</span></h2>
        <p class="muted">${p.inherited_cache?.blurb || 'Market-analysis-only profile.'}</p>
        <p class="profile-meta">${kpLink} · <a href="./profile.html?id=${encodeURIComponent(p.id)}">Full profile page →</a></p>
      </div>
      <button class="btn-secondary" onclick="document.getElementById('selected-profile').hidden = true">Close</button>
    </div>

    <div class="country-pill-group" id="drill-country-pills">
      <span class="muted small">Showing data for:</span>
      ${countryPills}
    </div>

    <div class="selected-grid">
      <section>
        <h3>Scoring · ${COUNTRY_LABEL[selectedCountry]}</h3>
        <dl class="kv compact">
          <dt>Impact (USD, current filters)</dt><dd class="mono">${fmtUsd(row.impactUsd)}</dd>
          <dt>Impact (1–10)</dt><dd class="mono">${row.impact10 != null ? row.impact10.toFixed(1) : '—'}</dd>
          <dt>Feasibility (1–10)</dt><dd class="mono">${row.feasibility10 != null ? row.feasibility10.toFixed(1) : '—'}</dd>
        </dl>
        <h4>Feasibility breakdown · ${COUNTRY_LABEL[selectedCountry]}</h4>
        ${feasibilityBreakdownHtml(p, selectedCountry)}
        <p class="small muted"><a href="./criteria.html">What do these criteria mean? →</a></p>
      </section>

      <section>
        <h3>Market analysis · ${COUNTRY_LABEL[selectedCountry]}</h3>
        ${marketBlockHtml(p, selectedCountry)}
      </section>
    </div>

    ${isProfileInKP(p) ? `
      <section class="selected-context">
        <h3>Inherited from productization</h3>
        ${inheritedBlockHtml(p)}
      </section>
    ` : ''}
  `;

  // Country pills wire-up
  el.querySelectorAll('.country-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedCountry = btn.dataset.country;
      drawSelectedProfile(id);
    });
  });
}

function feasibilityBreakdownHtml(p, countryFilter) {
  const rows = p.market_analysis?.feasibility || [];
  if (rows.length === 0) return '<p class="muted">No feasibility inputs.</p>';

  const COUNTRY_LABEL = { CL: 'Chile', MX: 'Mexico', US: 'United States' };
  const INPUT_LABELS = {
    need_perception: 'Need perception',
    hw_gap: 'HW gap',
    similar_clients_exist: 'Similar clients exist',
    bms_penetration_effect: 'BMS penetration effect',
    sustainment_upside: 'Sustainment upside',
  };

  const rowFor = (country, type) =>
    rows.find((r) => r.country_code === country && r.project_type === type);

  const card = (country, type) => {
    const r = rowFor(country, type);
    if (!r) {
      return `<div class="feas-card"><h4>${COUNTRY_LABEL[country]} — ${type}</h4><p class="muted small">(no row)</p></div>`;
    }
    const inputCell = (field) =>
      `<span class="editable-text" ${ed('feasibility', r.id, field, 'number-1-10', r[field])}>${r[field] ?? '—'}</span>`;
    return `
      <div class="feas-card">
        <h4>${COUNTRY_LABEL[country]} <span class="muted small">— ${type}</span></h4>
        <dl class="kv compact">
          ${Object.entries(INPUT_LABELS).map(([k, label]) =>
            `<dt>${label}</dt><dd class="mono">${inputCell(k)}</dd>`
          ).join('')}
        </dl>
      </div>
    `;
  };

  const countriesToShow = countryFilter && countryFilter !== 'all' ? [countryFilter] : ['CL', 'MX', 'US'];
  return `
    <p class="muted small">1–10 per project type. Score above uses these (hw_gap inverted; bms_eff sign-flipped per mode). Edit any cell directly.</p>
    <div class="feas-grid">
      ${countriesToShow.map((c) => `
        ${card(c, 'implementation')}
        ${card(c, 'subscription')}
      `).join('')}
    </div>
  `;
}

// Helper used everywhere in the drill-down: emits the data-* attrs for an editable span.
function ed(table, recordId, field, type, value) {
  if (!table || !recordId) return '';
  return `data-editable="true" data-edit-table="${table}" data-edit-record="${recordId}" data-edit-field="${field}" data-edit-type="${type}" data-edit-value="${value == null ? '' : escapeAttr(String(value))}"`;
}

function marketBlockHtml(p, countryFilter) {
  const m = p.market_analysis || {};
  const pains = m.pain_points || [];

  const editPainPoints = (val) =>
    `<div class="editable-block" ${ed('profiles', p.id, 'pain_points', 'pain-points', (val || []).join('|'))}>${
      (val || []).length
        ? `<ul class="bullets">${val.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
        : '—'
    }</div>`;

  const countryCard = (code, label) => {
    const c = (m.by_country || {})[code] || {};
    const cdId = c._id;
    const s = c.sites || {};
    const i = c.implementation || {};
    const sub = c.subscription || {};
    const sqft = c.typical_site_sqft || {};
    const brands = c.brands_range || {};
    const conc = c.market_concentration || {};
    const bms = c.bms_penetration || {};

    const editC = (field, type, val, display) =>
      cdId ? `<span class="editable-text" ${ed('country_data', cdId, field, type, val)}>${display ?? (val ?? '—')}</span>` : `<span>${display ?? (val ?? '—')}</span>`;
    const editCText = (field, val) =>
      cdId ? `<div class="editable-block" ${ed('country_data', cdId, field, 'textarea', val)}>${escapeHtml(val || '—')}</div>` : `<div>${escapeHtml(val || '—')}</div>`;
    const editCSrc = (field, val) =>
      cdId ? `<span class="editable-text" ${ed('country_data', cdId, field, 'text', val)}>${escapeHtml(val || '—')}</span>` : `<span>${escapeHtml(val || '—')}</span>`;

    return `
      <div class="country-card country-card-wide">
        <h4>${label}</h4>

        <h5>Market structure</h5>
        <dl class="kv compact">
          <dt>Brands (low–high)</dt><dd>${editC('brands_range_low', 'number', brands.low)} <span class="range-sep">–</span> ${editC('brands_range_high', 'number', brands.high)}</dd>
          <dt>Brands rationale</dt><dd>${editCText('brands_range_rationale', brands.rationale)}</dd>
          <dt>Brands source</dt><dd>${editCSrc('brands_range_source', brands.source)}</dd>
          <dt>Market concentration</dt><dd>${cdId ? `<span class="editable-text" ${ed('country_data', cdId, 'market_concentration_value', 'enum-concentration', conc.value)}>${conc.value || '—'}</span>` : (conc.value || '—')}</dd>
          <dt>Concentration rationale</dt><dd>${editCText('market_concentration_rationale', conc.rationale)}</dd>
          <dt>Concentration source</dt><dd>${editCSrc('market_concentration_source', conc.source)}</dd>
        </dl>

        <h5>Site profile</h5>
        <dl class="kv compact">
          <dt>Typical site size — low (ft²)</dt><dd>${editC('typical_site_sqft_low', 'number', sqft.low)}</dd>
          <dt>Typical site size — high (ft²)</dt><dd>${editC('typical_site_sqft_high', 'number', sqft.high)}</dd>
          <dt>Typical site size — nominal (ft²)</dt><dd>${editC('typical_site_sqft_nominal', 'number', sqft.nominal)}</dd>
          <dt>BMS penetration (1–10)</dt><dd>${editC('bms_penetration_value', 'number-1-10', bms.value)}</dd>
          <dt>BMS rationale</dt><dd>${editCText('bms_penetration_rationale', bms.rationale)}</dd>
          <dt>BMS source</dt><dd>${editCSrc('bms_penetration_source', bms.source)}</dd>
        </dl>

        <h5>Sites</h5>
        <dl class="kv compact">
          <dt>Low</dt><dd>${editC('sites_low', 'number', s.low)}</dd>
          <dt>High</dt><dd>${editC('sites_high', 'number', s.high)}</dd>
          <dt>Nominal</dt><dd>${editC('sites_nominal', 'number', s.nominal)}</dd>
          <dt>Rationale</dt><dd>${editCText('sites_rationale', c.sites_rationale)}</dd>
        </dl>

        <h5>Implementation economics</h5>
        <dl class="kv compact">
          <dt>Addressable %</dt><dd>${editC('impl_addressable_pct', 'number-decimal', i.addressable_pct, fmtPct(i.addressable_pct))}</dd>
          <dt>Avg ticket (USD)</dt><dd>${editC('impl_avg_ticket_usd', 'number-decimal', i.avg_ticket_usd, fmtUsdRaw(i.avg_ticket_usd))}</dd>
        </dl>

        <h5>Subscription economics</h5>
        <dl class="kv compact">
          <dt>Addressable %</dt><dd>${editC('sub_addressable_pct', 'number-decimal', sub.addressable_pct, fmtPct(sub.addressable_pct))}</dd>
          <dt>ARPU / month (USD)</dt><dd>${editC('sub_arpu_monthly_usd', 'number-decimal', sub.arpu_monthly_usd, fmtUsdRaw(sub.arpu_monthly_usd))}</dd>
        </dl>
      </div>
    `;
  };

  const COUNTRY_LABEL = { CL: 'Chile', MX: 'Mexico', US: 'United States' };
  const countriesToShow = countryFilter && countryFilter !== 'all' ? [countryFilter] : ['CL', 'MX', 'US'];

  return `
    <h3>Pain points <span class="muted small">(profile-level, one per line when editing)</span></h3>
    ${editPainPoints(pains)}

    ${countriesToShow.length === 1 ? '' : '<h3>By country <span class="muted small">(brands, BMS, concentration, site size, sites, economics — all per country)</span></h3>'}
    <div class="country-grid ${countriesToShow.length === 1 ? 'single-country' : ''}">
      ${countriesToShow.map((c) => countryCard(c, COUNTRY_LABEL[c])).join('')}
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
