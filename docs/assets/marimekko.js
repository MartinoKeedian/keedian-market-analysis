// Marimekko chart — market size cross-section by country × profile.
// X axis: country (column width = country market share)
// Y axis: profile within country (cell height = profile share within country)
// Cell area is proportional to absolute USD in that (country, profile) combo.

import { loadAll, getProfileDisplayName } from './data-loader.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COUNTRIES = ['CL', 'MX', 'US'];
const COUNTRY_NAMES = { CL: 'Chile', MX: 'Mexico', US: 'United States' };
const FILTER_KEY = 'kma:marimekko:filters:v1';
const HORIZON_DEFAULT = 3;

let state = null;
let filters = {
  countries: ['CL', 'MX', 'US'],
  profiles: [],            // populated from data on load
  mode: 'full',
  orientation: 'country_x',
};

document.addEventListener('DOMContentLoaded', async () => {
  state = await loadAll();
  filters.profiles = state.profiles.map((p) => p.id);
  loadFiltersFromStorage();
  bindFilters();
  renderFilterChecks();
  render();
});

function loadFiltersFromStorage() {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      filters = { ...filters, ...saved };
      // Reconcile profile list with current data (in case profiles changed)
      const known = new Set(state.profiles.map((p) => p.id));
      filters.profiles = filters.profiles.filter((id) => known.has(id));
      if (filters.profiles.length === 0) filters.profiles = state.profiles.map((p) => p.id);
    }
  } catch {}
}
function saveFilters() {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch {}
}

function bindFilters() {
  document.getElementById('mm-mode').value = filters.mode;
  document.getElementById('mm-orient').value = filters.orientation;
  document.getElementById('mm-mode').addEventListener('change', (e) => {
    filters.mode = e.target.value;
    saveFilters();
    render();
  });
  document.getElementById('mm-orient').addEventListener('change', (e) => {
    filters.orientation = e.target.value;
    saveFilters();
    render();
  });
  document.getElementById('mm-toggle-all-countries').addEventListener('click', () => {
    const allOn = filters.countries.length === COUNTRIES.length;
    filters.countries = allOn ? [] : [...COUNTRIES];
    saveFilters();
    renderFilterChecks();
    render();
  });
  document.getElementById('mm-toggle-all-profiles').addEventListener('click', () => {
    const all = state.profiles.map((p) => p.id);
    const allOn = filters.profiles.length === all.length;
    filters.profiles = allOn ? [] : all;
    saveFilters();
    renderFilterChecks();
    render();
  });
}

function renderFilterChecks() {
  const cEl = document.getElementById('mm-country-checks');
  cEl.innerHTML = COUNTRIES.map((c) => `
    <label class="mm-check">
      <input type="checkbox" value="${c}" ${filters.countries.includes(c) ? 'checked' : ''}>
      ${COUNTRY_NAMES[c]} <span class="muted small">(${c})</span>
    </label>
  `).join('');
  cEl.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', () => {
      const code = cb.value;
      if (cb.checked) {
        if (!filters.countries.includes(code)) filters.countries.push(code);
      } else {
        filters.countries = filters.countries.filter((c) => c !== code);
      }
      saveFilters();
      render();
    });
  });

  const pEl = document.getElementById('mm-profile-checks');
  pEl.innerHTML = state.profiles.map((p) => `
    <label class="mm-check">
      <input type="checkbox" value="${p.id}" ${filters.profiles.includes(p.id) ? 'checked' : ''}>
      ${getProfileDisplayName(p)}
    </label>
  `).join('');
  pEl.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.value;
      if (cb.checked) {
        if (!filters.profiles.includes(id)) filters.profiles.push(id);
      } else {
        filters.profiles = filters.profiles.filter((p) => p !== id);
      }
      saveFilters();
      render();
    });
  });
}

// -------------------------- Market value compute --------------------------

function marketUsd(profile, country, mode, horizon) {
  const m = profile.market_analysis || {};
  const c = (m.by_country || {})[country];
  if (!c) return 0;
  const sites = c.sites?.nominal ?? 0;
  const impl = sites * ((c.implementation?.addressable_pct ?? 0) / 100) * (c.implementation?.avg_ticket_usd ?? 0);
  const sub = sites * ((c.subscription?.addressable_pct ?? 0) / 100) * (c.subscription?.arpu_monthly_usd ?? 0) * 12 * horizon;
  if (mode === 'implementation_only') return impl;
  if (mode === 'subscription_only') return sub;
  return impl + sub;
}

function profileColor(index, total) {
  const hue = Math.round((index / total) * 360);
  return `hsl(${hue}, 55%, 55%)`;
}

// -------------------------- Render --------------------------

function render() {
  const statusEl = document.getElementById('mm-status');
  const horizon = state.scoring.impact.subscription_horizon_years ?? HORIZON_DEFAULT;
  const includedProfiles = state.profiles.filter((p) => filters.profiles.includes(p.id));
  const includedCountries = filters.countries.filter((c) => COUNTRIES.includes(c));

  if (includedCountries.length === 0 || includedProfiles.length === 0) {
    document.getElementById('mm-svg').innerHTML = '';
    document.getElementById('mm-totals').innerHTML = '<p class="muted">Select at least one country and one profile.</p>';
    statusEl.textContent = 'Empty selection.';
    statusEl.className = 'status-msg warn';
    return;
  }

  // Build matrix: matrix[country][profileId] = usd
  const matrix = {};
  let grandTotal = 0;
  for (const c of includedCountries) {
    matrix[c] = {};
    for (const p of includedProfiles) {
      const v = marketUsd(p, c, filters.mode, horizon);
      matrix[c][p.id] = v;
      grandTotal += v;
    }
  }

  if (grandTotal === 0) {
    document.getElementById('mm-svg').innerHTML = '';
    document.getElementById('mm-totals').innerHTML = '<p class="muted">No market value for the current selection — try a different mode or include more countries / profiles.</p>';
    statusEl.textContent = 'Zero total.';
    statusEl.className = 'status-msg warn';
    return;
  }

  statusEl.textContent = `Grand total: ${fmtUsd(grandTotal)} · ${includedCountries.length} countries · ${includedProfiles.length} profiles`;
  statusEl.className = 'status-msg';

  if (filters.orientation === 'profile_x') {
    drawProfileX(matrix, includedCountries, includedProfiles, grandTotal);
  } else {
    drawCountryX(matrix, includedCountries, includedProfiles, grandTotal);
  }
  drawTotals(matrix, includedCountries, includedProfiles, grandTotal);
}

function drawCountryX(matrix, countries, profiles, grandTotal) {
  const svg = document.getElementById('mm-svg');
  svg.innerHTML = '';
  const W = 1200, H = 700;
  const M = { top: 50, right: 20, bottom: 60, left: 20 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Country totals
  const countryTotals = Object.fromEntries(
    countries.map((c) => [c, profiles.reduce((s, p) => s + matrix[c][p.id], 0)])
  );

  // Sort profiles by total descending (consistent ordering inside each column)
  const profilesSorted = [...profiles].sort((a, b) => {
    const totalA = countries.reduce((s, c) => s + matrix[c][a.id], 0);
    const totalB = countries.reduce((s, c) => s + matrix[c][b.id], 0);
    return totalB - totalA;
  });
  const profileIndex = Object.fromEntries(profilesSorted.map((p, i) => [p.id, i]));

  let x = M.left;
  countries.forEach((c, ci) => {
    const colWidth = (countryTotals[c] / grandTotal) * innerW;
    let y = M.top;
    for (const p of profilesSorted) {
      const val = matrix[c][p.id];
      if (val === 0) continue;
      const cellHeight = (val / countryTotals[c]) * innerH;
      const cellColor = profileColor(profileIndex[p.id], profilesSorted.length);

      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'mm-cell');
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => {
        window.location.href = `./profile.html?id=${encodeURIComponent(p.id)}`;
      });

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', colWidth);
      rect.setAttribute('height', cellHeight);
      rect.setAttribute('fill', cellColor);
      rect.setAttribute('stroke', 'white');
      rect.setAttribute('stroke-width', '1');
      g.appendChild(rect);

      // Label if cell large enough
      if (colWidth > 60 && cellHeight > 18) {
        const txt = document.createElementNS(SVG_NS, 'text');
        txt.setAttribute('x', x + 6);
        txt.setAttribute('y', y + 14);
        txt.setAttribute('class', 'mm-cell-label');
        txt.textContent = getProfileDisplayName(p);
        g.appendChild(txt);
      }
      if (colWidth > 60 && cellHeight > 32) {
        const val_txt = document.createElementNS(SVG_NS, 'text');
        val_txt.setAttribute('x', x + 6);
        val_txt.setAttribute('y', y + 28);
        val_txt.setAttribute('class', 'mm-cell-value');
        val_txt.textContent = fmtUsd(val);
        g.appendChild(val_txt);
      }

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${getProfileDisplayName(p)} — ${COUNTRY_NAMES[c]}\n${fmtUsd(val)}\n${((val / grandTotal) * 100).toFixed(1)}% of total · ${((val / countryTotals[c]) * 100).toFixed(1)}% of country`;
      g.appendChild(title);

      svg.appendChild(g);
      y += cellHeight;
    }

    // Country label at bottom
    const countryLabel = document.createElementNS(SVG_NS, 'text');
    countryLabel.setAttribute('x', x + colWidth / 2);
    countryLabel.setAttribute('y', M.top + innerH + 22);
    countryLabel.setAttribute('text-anchor', 'middle');
    countryLabel.setAttribute('class', 'mm-axis-label');
    countryLabel.textContent = COUNTRY_NAMES[c];
    svg.appendChild(countryLabel);

    const countrySub = document.createElementNS(SVG_NS, 'text');
    countrySub.setAttribute('x', x + colWidth / 2);
    countrySub.setAttribute('y', M.top + innerH + 40);
    countrySub.setAttribute('text-anchor', 'middle');
    countrySub.setAttribute('class', 'mm-axis-sub');
    countrySub.textContent = `${fmtUsd(countryTotals[c])} · ${((countryTotals[c] / grandTotal) * 100).toFixed(1)}%`;
    svg.appendChild(countrySub);

    x += colWidth;
  });

  // Title
  const title = document.createElementNS(SVG_NS, 'text');
  title.setAttribute('x', M.left);
  title.setAttribute('y', 28);
  title.setAttribute('class', 'mm-title');
  title.textContent = `Market size by country × profile · grand total ${fmtUsd(grandTotal)}`;
  svg.appendChild(title);
}

function drawProfileX(matrix, countries, profiles, grandTotal) {
  const svg = document.getElementById('mm-svg');
  svg.innerHTML = '';
  const W = 1200, H = 700;
  const M = { top: 50, right: 20, bottom: 80, left: 20 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Profile totals
  const profileTotals = Object.fromEntries(
    profiles.map((p) => [p.id, countries.reduce((s, c) => s + matrix[c][p.id], 0)])
  );

  // Sort profiles by total descending
  const profilesSorted = [...profiles].sort((a, b) => profileTotals[b.id] - profileTotals[a.id]);

  let x = M.left;
  for (const p of profilesSorted) {
    if (profileTotals[p.id] === 0) continue;
    const colWidth = (profileTotals[p.id] / grandTotal) * innerW;
    let y = M.top;
    countries.forEach((c, ci) => {
      const val = matrix[c][p.id];
      if (val === 0) return;
      const cellHeight = (val / profileTotals[p.id]) * innerH;
      const hue = ci * 120 + 200;
      const cellColor = `hsl(${hue}, 50%, ${45 + ci * 10}%)`;

      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'mm-cell');
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => {
        window.location.href = `./profile.html?id=${encodeURIComponent(p.id)}`;
      });

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', colWidth);
      rect.setAttribute('height', cellHeight);
      rect.setAttribute('fill', cellColor);
      rect.setAttribute('stroke', 'white');
      rect.setAttribute('stroke-width', '1');
      g.appendChild(rect);

      if (colWidth > 40 && cellHeight > 18) {
        const txt = document.createElementNS(SVG_NS, 'text');
        txt.setAttribute('x', x + 4);
        txt.setAttribute('y', y + 14);
        txt.setAttribute('class', 'mm-cell-label');
        txt.style.fill = 'white';
        txt.textContent = COUNTRY_NAMES[c];
        g.appendChild(txt);
      }

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${getProfileDisplayName(p)} — ${COUNTRY_NAMES[c]}\n${fmtUsd(val)}\n${((val / grandTotal) * 100).toFixed(1)}% of total · ${((val / profileTotals[p.id]) * 100).toFixed(1)}% of profile`;
      g.appendChild(title);

      svg.appendChild(g);
      y += cellHeight;
    });

    // Profile label rotated 45deg under column
    const lblY = M.top + innerH + 14;
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', x + colWidth / 2);
    lbl.setAttribute('y', lblY);
    lbl.setAttribute('transform', `rotate(35 ${x + colWidth / 2} ${lblY})`);
    lbl.setAttribute('text-anchor', 'start');
    lbl.setAttribute('class', 'mm-axis-label');
    lbl.textContent = getProfileDisplayName(p);
    svg.appendChild(lbl);

    x += colWidth;
  }

  // Title
  const title = document.createElementNS(SVG_NS, 'text');
  title.setAttribute('x', M.left);
  title.setAttribute('y', 28);
  title.setAttribute('class', 'mm-title');
  title.textContent = `Market size by profile × country · grand total ${fmtUsd(grandTotal)}`;
  svg.appendChild(title);
}

function drawTotals(matrix, countries, profiles, grandTotal) {
  const countryTotals = Object.fromEntries(
    countries.map((c) => [c, profiles.reduce((s, p) => s + matrix[c][p.id], 0)])
  );
  const profileTotals = profiles
    .map((p) => ({ profile: p, total: countries.reduce((s, c) => s + matrix[c][p.id], 0) }))
    .sort((a, b) => b.total - a.total);

  document.getElementById('mm-totals').innerHTML = `
    <div class="mm-totals-grid">
      <div>
        <h3>Country totals</h3>
        <table class="mm-totals-table">
          <thead><tr><th>Country</th><th class="right">USD</th><th class="right">% of total</th></tr></thead>
          <tbody>
            ${countries.map((c) => `
              <tr><td>${COUNTRY_NAMES[c]}</td><td class="num right">${fmtUsd(countryTotals[c])}</td><td class="num right">${((countryTotals[c] / grandTotal) * 100).toFixed(1)}%</td></tr>
            `).join('')}
            <tr class="total-row"><td><strong>Total</strong></td><td class="num right strong">${fmtUsd(grandTotal)}</td><td>—</td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <h3>Top profiles</h3>
        <table class="mm-totals-table">
          <thead><tr><th>Profile</th><th class="right">USD</th><th class="right">% of total</th></tr></thead>
          <tbody>
            ${profileTotals.slice(0, 10).map((row) => `
              <tr><td>${getProfileDisplayName(row.profile)}</td><td class="num right">${fmtUsd(row.total)}</td><td class="num right">${((row.total / grandTotal) * 100).toFixed(1)}%</td></tr>
            `).join('')}
            ${profileTotals.length > 10 ? `<tr><td class="muted">… ${profileTotals.length - 10} more</td><td></td><td></td></tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function fmtUsd(n) {
  if (!isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
