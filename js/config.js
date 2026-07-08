// App configuration — the knobs that define "what counts as rain" and which
// forecast models feed the ensemble. Kept in one place so the meteorology is
// auditable, not buried in fetch code.

// Open-Meteo ensemble models. Each is an independent national weather service's
// ensemble; combining their members is what turns one forecast into a distribution.
// Chosen for genuine independence (different agencies, different physics) and for
// covering Korea well. `_seamless` stitches a model's global + regional variants.
export const MODELS = [
  'icon_seamless',   // DWD (Germany) — 40 members
  'gfs_seamless',    // NOAA (USA) — 31 members
  'ecmwf_ifs025',    // ECMWF (Europe) — 51 members, usually the sharpest
  'gem_global',      // Environment Canada — 21 members
  'bom_access_global', // Australian BOM — 18 members
];

// Precipitation intensity buckets, in mm per hour. The whole app is built around
// classifying every ensemble member into exactly one of these, then counting.
// Thresholds follow common hourly-rain descriptors (KMA/WMO-ish): below 0.1 mm is
// effectively dry; 4 mm/h and up is a downpour.
export const PRECIP_BUCKETS = [
  { key: 'dry',   label: '안 옴',   min: 0,   max: 0.1 },
  { key: 'light', label: '약한 비', min: 0.1, max: 1.0 },
  { key: 'mod',   label: '비',      min: 1.0, max: 4.0 },
  { key: 'heavy', label: '강한 비', min: 4.0, max: Infinity },
];

// Any member with >= this much precip counts as "rain" for the headline probability.
export const RAIN_THRESHOLD_MM = 0.1;

// Wind is secondary: we report the spread (median + range) rather than bucketing.
// This threshold only flags "notably windy" hours in the plain-language read (m/s).
export const WINDY_THRESHOLD_MS = 8;

// Favorites the user asked for, pinned at district (구) resolution — finer than the
// bundled 시-level dataset, so these two land exactly where they live.
export const FAVORITES = [
  { sido: '경기도', name: '수원시 권선구', lat: 37.2578, lon: 126.9716 },
  { sido: '경기도', name: '성남시 수정구', lat: 37.4502, lon: 127.1459 },
];

// How far ahead to fetch. Two days of hourly = today + tomorrow, the horizon where
// the ensemble is actually informative for "should I carry an umbrella".
export const FORECAST_DAYS = 2;

export const ENSEMBLE_ENDPOINT = 'https://ensemble-api.open-meteo.com/v1/ensemble';
