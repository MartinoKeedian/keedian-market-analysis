// Parameters view — edit scoring weights, persist to localStorage.

import { loadAll } from './data-loader.js';

const STORAGE_KEY = 'kma:scoring:overrides:v1';
const GH_PAT_KEY = 'kma:gh:pat:v1';

const FEASIBILITY_LABELS = {
  need_perception: 'Need perception',
  hw_gap: 'HW gap (inverted)',
  similar_clients_exist: 'Similar clients exist',
  bms_penetration_effect: 'BMS penetration effect',
  sustainment_upside: 'Sustainment upside',
};
const MODE_LABELS = {
  full: 'Full (impl + sub)',
  subscription_only: 'Subscription only',
  implementation_only: 'Implementation only',
};

let defaults = null;
let working = null;

document.addEventListener('DOMContentLoaded', async () => {
  defaults = (await loadAll()).scoring;
  // Strip prior overrides applied by data-loader to get true defaults.
  defaults = await fetchTrueDefaults();
  working = loadOverrides() || structuredClone(defaults);
  renderAll();
  bind();
});

async function fetchTrueDefaults() {
  const res = await fetch('./data/scoring.yml', { cache: 'no-cache' });
  return window.jsyaml.load(await res.text());
}

function loadOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveOverrides() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(working));
}

function renderAll() {
  renderWeights();
  renderImpactNorm();
  renderBmsSigns();
  renderPointSize();
  renderPat();
}

function renderWeights() {
  const container = document.getElementById('feasibility-weights');
  container.innerHTML = '';
  for (const [key, label] of Object.entries(FEASIBILITY_LABELS)) {
    const value = working.feasibility.weights[key] ?? 0;
    const id = `w-${key}`;
    const row = document.createElement('div');
    row.className = 'weight-row';
    row.innerHTML = `
      <label for="${id}">${label}</label>
      <input id="${id}" type="range" min="0" max="1" step="0.05" value="${value}">
      <output id="${id}-out">${value.toFixed(2)}</output>
    `;
    container.appendChild(row);
    const input = row.querySelector('input');
    input.addEventListener('input', () => {
      working.feasibility.weights[key] = parseFloat(input.value);
      row.querySelector('output').textContent = parseFloat(input.value).toFixed(2);
      updateWeightsSum();
    });
  }
  updateWeightsSum();
}

function updateWeightsSum() {
  const sum = Object.values(working.feasibility.weights).reduce((a, b) => a + b, 0);
  document.getElementById('weights-sum-value').textContent = sum.toFixed(2);
  const statusEl = document.getElementById('weights-sum-status');
  if (Math.abs(sum - 1.0) < 0.001) {
    statusEl.textContent = '✓ valid';
    statusEl.className = 'success';
  } else {
    statusEl.textContent = '✗ should sum to 1.00';
    statusEl.className = 'warn';
  }
}

function renderImpactNorm() {
  const method = working.impact.normalization.method;
  document.querySelectorAll('input[name="impact-norm"]').forEach((r) => {
    r.checked = r.value === method;
    r.addEventListener('change', () => {
      working.impact.normalization.method = r.value;
    });
  });
  const horizon = document.getElementById('sub-horizon');
  horizon.value = working.impact.subscription_horizon_years;
  horizon.addEventListener('input', () => {
    working.impact.subscription_horizon_years = parseInt(horizon.value, 10) || 1;
  });
}

function renderBmsSigns() {
  const container = document.getElementById('bms-signs');
  container.innerHTML = '';
  const byMode = working.feasibility.bms_penetration_effect.by_mode;
  for (const mode of Object.keys(MODE_LABELS)) {
    const row = document.createElement('div');
    row.className = 'weight-row';
    row.innerHTML = `
      <label>${MODE_LABELS[mode]}</label>
      <select data-mode="${mode}">
        <option value="positive" ${byMode[mode] === 'positive' ? 'selected' : ''}>positive</option>
        <option value="negative" ${byMode[mode] === 'negative' ? 'selected' : ''}>negative</option>
        <option value="mixed" ${byMode[mode] === 'mixed' ? 'selected' : ''}>mixed</option>
      </select>
    `;
    container.appendChild(row);
    row.querySelector('select').addEventListener('change', (e) => {
      working.feasibility.bms_penetration_effect.by_mode[mode] = e.target.value;
    });
  }
}

function renderPointSize() {
  const mode = working.display.point_size.mode;
  document.querySelectorAll('input[name="point-size"]').forEach((r) => {
    r.checked = r.value === mode;
    r.addEventListener('change', () => {
      working.display.point_size.mode = r.value;
    });
  });
}

function renderPat() {
  const stored = localStorage.getItem(GH_PAT_KEY);
  const statusEl = document.getElementById('gh-pat-status');
  if (stored) {
    statusEl.textContent = `✓ PAT saved (${stored.length} chars)`;
    statusEl.className = 'status-msg success';
  } else {
    statusEl.textContent = 'No PAT — AI suggestions will fall back to console output.';
    statusEl.className = 'status-msg warn';
  }
}

function bind() {
  document.getElementById('apply-btn').addEventListener('click', () => {
    saveOverrides();
    window.location.href = './index.html';
  });
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset to defaults?')) return;
    localStorage.removeItem(STORAGE_KEY);
    working = structuredClone(defaults);
    renderAll();
    document.getElementById('actions-status').textContent = 'Reset.';
  });
  document.getElementById('export-btn').addEventListener('click', () => {
    const yaml = window.jsyaml.dump(working, { lineWidth: 120 });
    const out = document.getElementById('export-output');
    out.textContent = yaml;
    out.hidden = false;
    navigator.clipboard?.writeText(yaml).then(
      () => { document.getElementById('actions-status').textContent = 'Copied to clipboard.'; },
      () => { document.getElementById('actions-status').textContent = 'Export shown below (copy failed).'; }
    );
  });
  document.getElementById('gh-pat-save').addEventListener('click', () => {
    const pat = document.getElementById('gh-pat').value.trim();
    if (!pat) {
      localStorage.removeItem(GH_PAT_KEY);
    } else {
      localStorage.setItem(GH_PAT_KEY, pat);
      document.getElementById('gh-pat').value = '';
    }
    renderPat();
  });
}
