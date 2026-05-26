// Loads scoring config, countries, and profile data.
// Primary source: Supabase (kma schema). Fallback: YAMLs in docs/data/profiles/.
// The Supabase client is initialized lazily so pages that don't need writes
// can still use the read path.

const DATA_ROOT = './data';
const KP_MIRROR_SEGMENTS = `${DATA_ROOT}/_kp-mirror/segments.yml`;

let _supabaseClient = null;
let _supabaseConfig = null;

export async function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  if (!window.supabase) {
    // SDK not loaded yet
    return null;
  }
  if (!_supabaseConfig) {
    try {
      const res = await fetch(`${DATA_ROOT}/supabase.json`, { cache: 'no-cache' });
      _supabaseConfig = await res.json();
    } catch (err) {
      console.warn('Supabase config not available:', err);
      return null;
    }
  }
  _supabaseClient = window.supabase.createClient(
    _supabaseConfig.url,
    _supabaseConfig.anonKey,
    { db: { schema: _supabaseConfig.schema || 'kma' }, auth: { persistSession: true } }
  );
  return _supabaseClient;
}

async function fetchYaml(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return window.jsyaml.load(await res.text());
}

async function fetchYamlOptional(url) {
  try { return await fetchYaml(url); }
  catch (err) {
    if (err.status === 404) return null;
    console.warn('Optional fetch failed:', url, err);
    return null;
  }
}

// -------------------------- Main loader --------------------------

export async function loadAll() {
  const [scoring, countries, kpSegments] = await Promise.all([
    fetchYaml(`${DATA_ROOT}/scoring.yml`),
    fetchYaml(`${DATA_ROOT}/countries.yml`),
    fetchYamlOptional(KP_MIRROR_SEGMENTS),
  ]);

  // Try Supabase first
  let profiles = null;
  let dataSource = 'yaml';
  let dataSourceError = null;
  const client = await getSupabaseClient();
  if (client) {
    try {
      profiles = await loadFromSupabase(client);
      dataSource = 'supabase';
    } catch (err) {
      const msg = err.message || String(err);
      dataSourceError = msg;
      if (msg.includes('Invalid schema') || msg.includes('PGRST106')) {
        console.warn('Supabase schema "kma" not exposed yet. Add it in Settings → API → Exposed schemas to enable edits. Falling back to YAML.');
      } else {
        console.warn('Supabase read failed, falling back to YAML:', msg);
      }
    }
  }

  // Fallback: load from YAMLs
  if (!profiles) {
    profiles = await loadFromYaml();
  }

  for (const p of profiles) {
    mergeKpInherited(p, kpSegments);
  }

  return {
    scoring: applyOverrides(scoring),
    countries: countries.countries,
    profiles,
    kpAvailable: kpSegments !== null,
    dataSource,
    dataSourceError,
  };
}

async function loadFromSupabase(client) {
  const [profilesRes, countryDataRes, feasRes] = await Promise.all([
    client.from('profiles').select('*'),
    client.from('country_data').select('*'),
    client.from('feasibility').select('*'),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (countryDataRes.error) throw countryDataRes.error;
  if (feasRes.error) throw feasRes.error;

  const cdByProfile = {};
  for (const row of countryDataRes.data) {
    cdByProfile[row.profile_id] = cdByProfile[row.profile_id] || {};
    cdByProfile[row.profile_id][row.country_code] = row;
  }
  // Group feasibility rows by profile_id (up to 6 per profile)
  const feasByProfile = {};
  for (const row of feasRes.data) {
    feasByProfile[row.profile_id] = feasByProfile[row.profile_id] || [];
    feasByProfile[row.profile_id].push(row);
  }

  return profilesRes.data.map((row) => assembleProfile(row, cdByProfile[row.id] || {}, feasByProfile[row.id] || []));
}

function assembleProfile(row, countryRows, feasRows) {
  const byCountry = {};
  for (const code of ['CL', 'MX', 'US']) {
    const c = countryRows[code];
    if (c) {
      byCountry[code] = {
        _id: c.id,                                          // db row id, used for updates
        sites: { low: c.sites_low, high: c.sites_high, nominal: c.sites_nominal },
        sites_rationale: c.sites_rationale,
        implementation: { addressable_pct: numOrNull(c.impl_addressable_pct), avg_ticket_usd: numOrNull(c.impl_avg_ticket_usd) },
        subscription: { addressable_pct: numOrNull(c.sub_addressable_pct), arpu_monthly_usd: numOrNull(c.sub_arpu_monthly_usd) },
      };
    } else {
      byCountry[code] = {
        sites: { low: null, high: null, nominal: null },
        implementation: { addressable_pct: null, avg_ticket_usd: null },
        subscription: { addressable_pct: null, arpu_monthly_usd: null },
      };
    }
  }

  return {
    id: row.id,
    display_name: row.display_name,
    kp_segment_id: row.kp_segment_id,
    preliminary: row.preliminary,
    inherited_cache: { source: null, _synced_at: null },
    market_analysis: {
      brands_range: {
        low: row.brands_range_low,
        high: row.brands_range_high,
        rationale: row.brands_range_rationale,
        source: row.brands_range_source,
      },
      typical_site_sqft: {
        low: row.typical_site_sqft_low,
        high: row.typical_site_sqft_high,
        nominal: row.typical_site_sqft_nominal,
      },
      market_concentration: {
        value: row.market_concentration_value,
        rationale: row.market_concentration_rationale,
        source: row.market_concentration_source,
      },
      bms_penetration: {
        value: row.bms_penetration_value,
        rationale: row.bms_penetration_rationale,
        source: row.bms_penetration_source,
      },
      pain_points: row.pain_points || [],
      by_country: byCountry,
      // Array of up to 6 feasibility rows (3 countries × 2 project types).
      // Each row has: id, country_code, project_type, 5 input fields.
      feasibility: feasRows.map((r) => ({
        id: r.id,
        country_code: r.country_code,
        project_type: r.project_type,
        need_perception: r.need_perception,
        hw_gap: r.hw_gap,
        similar_clients_exist: r.similar_clients_exist,
        bms_penetration_effect: r.bms_penetration_effect,
        sustainment_upside: r.sustainment_upside,
      })),
    },
  };
}

function numOrNull(v) {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : parseFloat(v);
}

async function loadFromYaml() {
  const indexFile = await fetchYaml(`${DATA_ROOT}/profiles/_index.yml`);
  const ids = indexFile.profiles;
  return Promise.all(
    ids.map(async (id) => {
      const profile = await fetchYaml(`${DATA_ROOT}/profiles/${id}.yml`);
      return profile;
    })
  );
}

function mergeKpInherited(profile, kpSegments) {
  if (!profile.kp_segment_id || !kpSegments) return;
  const kpData = kpSegments[profile.kp_segment_id];
  if (!kpData) return;
  profile.inherited_cache = {
    ...(profile.inherited_cache || {}),
    source: `kp:segments.yml#${profile.kp_segment_id}`,
    _synced_at: new Date().toISOString(),
    display_name: kpData.display_name,
    blurb: kpData.blurb,
    reference_customer: kpData.reference_customer,
    status: kpData.status,
    products_developed: kpData.products_developed || [],
    differences: kpData.differences || {},
  };
}

function applyOverrides(scoring) {
  try {
    const raw = localStorage.getItem('kma:scoring:overrides:v1');
    if (!raw) return scoring;
    return deepMerge(scoring, JSON.parse(raw));
  } catch { return scoring; }
}
function deepMerge(target, source) {
  if (source === null || typeof source !== 'object') return source;
  if (Array.isArray(source)) return [...source];
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(source)) out[k] = deepMerge(target?.[k], v);
  return out;
}

export function getProfileDisplayName(profile) {
  return profile.inherited_cache?.display_name || profile.display_name || profile.id;
}
export function isProfileInKP(profile) {
  return !!profile.kp_segment_id && !!profile.inherited_cache?.status;
}
export function getProfileStatus(profile) {
  if (!profile.kp_segment_id) return 'non_kp';
  return profile.inherited_cache?.status || 'unknown';
}

// -------------------------- Edits --------------------------

export async function updateCountryDataField(rowId, fieldName, newValue) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase client unavailable');
  const update = { [fieldName]: newValue };
  const { data, error } = await client.from('country_data').update(update).eq('id', rowId).select().single();
  if (error) throw error;
  await logAudit('country_data', rowId, fieldName, null, newValue);
  return data;
}

export async function updateProfileField(profileId, fieldName, newValue) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase client unavailable');
  const update = { [fieldName]: newValue };
  const { data, error } = await client.from('profiles').update(update).eq('id', profileId).select().single();
  if (error) throw error;
  await logAudit('profiles', profileId, fieldName, null, newValue);
  return data;
}

export async function updateFeasibilityField(rowId, fieldName, newValue) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase client unavailable');
  const update = { [fieldName]: newValue };
  const { data, error } = await client.from('feasibility').update(update).eq('id', rowId).select().single();
  if (error) throw error;
  await logAudit('feasibility', rowId, fieldName, null, newValue);
  return data;
}

async function logAudit(tableName, recordId, fieldName, oldValue, newValue) {
  const client = await getSupabaseClient();
  if (!client) return;
  const user = (await client.auth.getUser()).data.user;
  await client.from('audit_log').insert({
    table_name: tableName,
    record_id: String(recordId),
    field_name: fieldName,
    old_value: oldValue == null ? null : String(oldValue),
    new_value: newValue == null ? null : String(newValue),
    changed_by: user?.email || null,
  });
}

// -------------------------- Auth --------------------------

export async function signInWithMagicLink(email) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase client unavailable');
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
  if (error) throw error;
}

export async function signOut() {
  const client = await getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
}

export async function getCurrentUser() {
  const client = await getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user;
}
