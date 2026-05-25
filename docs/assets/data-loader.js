// Loads scoring config, countries, and every profile YAML.
// Falls back gracefully when data/_kp-mirror/segments.yml is missing
// (which is the case until the sync-kp.yml workflow has run at least once).

const DATA_ROOT = './data';
const KP_MIRROR_SEGMENTS = `${DATA_ROOT}/_kp-mirror/segments.yml`;

async function fetchYaml(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return window.jsyaml.load(text);
}

async function fetchYamlOptional(url) {
  try {
    return await fetchYaml(url);
  } catch (err) {
    if (err.status === 404) return null;
    console.warn('Optional fetch failed:', url, err);
    return null;
  }
}

export async function loadAll() {
  const [scoring, countries, profileIndex, kpSegments] = await Promise.all([
    fetchYaml(`${DATA_ROOT}/scoring.yml`),
    fetchYaml(`${DATA_ROOT}/countries.yml`),
    fetchYaml(`${DATA_ROOT}/profiles/_index.yml`),
    fetchYamlOptional(KP_MIRROR_SEGMENTS),
  ]);

  const profileIds = profileIndex.profiles;
  const profiles = await Promise.all(
    profileIds.map(async (id) => {
      const profile = await fetchYaml(`${DATA_ROOT}/profiles/${id}.yml`);
      mergeKpInherited(profile, kpSegments);
      return profile;
    })
  );

  return {
    scoring: applyOverrides(scoring),
    countries: countries.countries,
    profiles,
    kpAvailable: kpSegments !== null,
  };
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

// Merge localStorage overrides (set in parameters.html) on top of defaults.
function applyOverrides(scoring) {
  try {
    const raw = localStorage.getItem('kma:scoring:overrides:v1');
    if (!raw) return scoring;
    const overrides = JSON.parse(raw);
    return deepMerge(scoring, overrides);
  } catch (err) {
    console.warn('Failed to apply scoring overrides:', err);
    return scoring;
  }
}

function deepMerge(target, source) {
  if (source === null || typeof source !== 'object') return source;
  if (Array.isArray(source)) return [...source];
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(source)) {
    out[k] = deepMerge(target?.[k], v);
  }
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
