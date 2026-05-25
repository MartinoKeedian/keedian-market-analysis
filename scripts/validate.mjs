// Validates data/profiles/*.yml, scoring.yml, countries.yml against a small
// schema. Exits non-zero on any problem so CI can block.
//
// Run locally: node scripts/validate.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'docs', 'data');

let errors = 0;
function fail(msg) {
  console.error(`✗ ${msg}`);
  errors += 1;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf-8'));
}

// ---------- scoring.yml ----------
const scoring = loadYaml(join(DATA, 'scoring.yml'));
if (!scoring.feasibility?.weights) fail('scoring.yml missing feasibility.weights');
else {
  const sum = Object.values(scoring.feasibility.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 0.001) fail(`feasibility weights sum to ${sum.toFixed(3)} (expected 1.0)`);
  else ok('scoring.yml weights sum to 1.0');
}
if (!['log', 'linear', 'quantile'].includes(scoring.impact?.normalization?.method)) {
  fail(`unknown impact normalization method: ${scoring.impact?.normalization?.method}`);
} else ok(`scoring.yml normalization method: ${scoring.impact.normalization.method}`);

// ---------- countries.yml ----------
const countries = loadYaml(join(DATA, 'countries.yml'));
const countryCodes = (countries.countries || []).map((c) => c.code);
if (!countryCodes.includes('CL') || !countryCodes.includes('MX') || !countryCodes.includes('US')) {
  fail('countries.yml must include CL, MX, US');
} else ok(`countries.yml has [${countryCodes.join(', ')}]`);

// ---------- profiles/_index.yml ----------
const indexFile = loadYaml(join(DATA, 'profiles', '_index.yml'));
const indexIds = new Set(indexFile.profiles);
const profileFiles = readdirSync(join(DATA, 'profiles'))
  .filter((f) => f.endsWith('.yml') && f !== '_index.yml' && f !== '_TEMPLATE.yml')
  .map((f) => f.replace(/\.yml$/, ''));
const profileFileIds = new Set(profileFiles);

for (const id of indexIds) {
  if (!profileFileIds.has(id)) fail(`profiles/_index.yml lists "${id}" but profiles/${id}.yml does not exist`);
}
for (const id of profileFileIds) {
  if (!indexIds.has(id)) fail(`profiles/${id}.yml exists but is not listed in _index.yml`);
}
if (indexIds.size === profileFileIds.size) ok(`profiles/_index.yml matches filesystem (${profileFileIds.size} profiles)`);

// ---------- per-profile schema ----------
for (const id of profileFiles) {
  const path = join(DATA, 'profiles', `${id}.yml`);
  const p = loadYaml(path);
  if (p.id !== id) fail(`${id}.yml: top-level id "${p.id}" does not match filename`);
  if (!p.display_name) fail(`${id}.yml: missing display_name`);
  const m = p.market_analysis || {};
  for (const country of ['CL', 'MX', 'US']) {
    const c = m.by_country?.[country];
    if (!c) {
      fail(`${id}.yml: missing by_country.${country}`);
      continue;
    }
    validatePct(`${id}.by_country.${country}.implementation.addressable_pct`, c.implementation?.addressable_pct);
    validatePct(`${id}.by_country.${country}.subscription.addressable_pct`, c.subscription?.addressable_pct);
    validateNonNeg(`${id}.by_country.${country}.implementation.avg_ticket_usd`, c.implementation?.avg_ticket_usd);
    validateNonNeg(`${id}.by_country.${country}.subscription.arpu_monthly_usd`, c.subscription?.arpu_monthly_usd);
    validateNonNeg(`${id}.by_country.${country}.sites.nominal`, c.sites?.nominal);
  }
  const f = m.feasibility_inputs || {};
  validate1to10(`${id}.feasibility_inputs.need_perception`, f.need_perception);
  validate1to10(`${id}.feasibility_inputs.delivery_capacity.hw_gap`, f.delivery_capacity?.hw_gap);
  validate1to10(`${id}.feasibility_inputs.delivery_capacity.similar_clients_exist`, f.delivery_capacity?.similar_clients_exist);
  validate1to10(`${id}.feasibility_inputs.delivery_capacity.bms_penetration_effect`, f.delivery_capacity?.bms_penetration_effect);
  validate1to10(`${id}.feasibility_inputs.delivery_capacity.sustainment_upside`, f.delivery_capacity?.sustainment_upside);
  validate1to10(`${id}.bms_penetration.value`, m.bms_penetration?.value);
}

function validatePct(label, v) {
  if (v === null || v === undefined) return; // pending is OK
  if (typeof v !== 'number' || v < 0 || v > 100) fail(`${label}: "${v}" not in [0, 100]`);
}
function validate1to10(label, v) {
  if (v === null || v === undefined) return; // pending is OK
  if (typeof v !== 'number' || v < 1 || v > 10) fail(`${label}: "${v}" not in [1, 10]`);
}
function validateNonNeg(label, v) {
  if (v === null || v === undefined) return; // pending is OK
  if (typeof v !== 'number' || v < 0) fail(`${label}: "${v}" not non-negative number`);
}

// ---------- summary ----------
if (errors > 0) {
  console.error(`\n${errors} error(s). Failing validation.`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
