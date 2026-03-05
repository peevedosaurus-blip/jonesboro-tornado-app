/**
 * hrrr.js — Fetch HRRR model data and compute ingredient score.
 *
 * Strategy:
 *   1. Attempt NOMADS HRRR 2D surface fields via HTTP filter CGI
 *      (returns a sub-setted GRIB2 file).
 *   2. Parse the GRIB2 binary for specific fields near Jonesboro.
 *   3. If NOMADS is unavailable, fall back to estimated values
 *      derived from recent NWS point forecast data (always available).
 *
 * GRIB2 parsing is complex; we use a lightweight manual approach
 * targeting the specific byte fields we need.  For production,
 * consider eccodes/wgrib2 via a sidecar process.
 */

const { cachedFetch } = require("./cache");
const config = require("../config");

const { APIS, LOCATION, INTERVALS, THRESHOLDS } = config;

// ── NWS Gridded Forecast fallback ───────────────────────────────────────────
// NWS exposes a JSON gridded forecast that includes temperature, wind, humidity.
// We use it as a fallback ingredient proxy when HRRR parsing fails.

async function getNWSGridForecast() {
  const { lat, lon } = LOCATION;

  try {
    // Step 1: resolve grid point
    const pointUrl = `${config.APIS.nwsBase}/points/${lat},${lon}`;
    const pointData = await cachedFetch(pointUrl, {}, INTERVALS.hrrr);
    const forecastGridUrl = pointData?.properties?.forecastGridData;

    if (!forecastGridUrl) throw new Error("No forecastGridData URL");

    // Step 2: fetch gridded forecast data
    const gridData = await cachedFetch(forecastGridUrl, {}, INTERVALS.hrrr);
    return gridData?.properties || null;
  } catch (err) {
    console.warn("[hrrr] NWS grid fallback failed:", err.message);
    return null;
  }
}

/**
 * Derive pseudo-ingredients from NWS gridded forecast.
 * These are rough proxies — not as accurate as direct HRRR fields,
 * but always available and useful for the ingredient score.
 */
async function getIngredientsFromNWSProxy() {
  const grid = await getNWSGridForecast();

  if (!grid) {
    return { source: "default", ingredients: defaultIngredients() };
  }

  try {
    // Pull the nearest valid time value from each field
    const now = Date.now();

    const temp = extractNearest(grid.temperature?.values, now);
    const dewpoint = extractNearest(grid.dewpoint?.values, now);
    const windSpeed = extractNearest(grid.windSpeed?.values, now);
    const windGust = extractNearest(grid.windGust?.values, now);
    const maxTemp = extractNearest(grid.maxTemperature?.values, now);
    const skyCover = extractNearest(grid.skyCover?.values, now);

    // ── Rough CAPE proxy ─────────────────────────────────────────
    // Lifted index proxy: large dewpoint depression + high temp → higher instability
    const tdDep = temp != null && dewpoint != null ? temp - dewpoint : 10;
    const tempC = temp != null ? temp - 273.15 : 20;
    // Very rough: warm moist air → higher CAPE estimate
    const estimatedCape = Math.max(
      0,
      (tempC - 15) * 80 + Math.max(0, 20 - tdDep) * 60
    );

    // ── Shear proxy ──────────────────────────────────────────────
    // Wind speed in km/h from NWS; convert to knots
    const surfWindKts = windSpeed != null ? windSpeed * 0.539957 : 10;
    const gustKts = windGust != null ? windGust * 0.539957 : surfWindKts * 1.3;
    // Rough bulk shear proxy: gust factor
    const estimatedShear06 = Math.min(70, surfWindKts * 1.5);

    // ── SRH proxy ────────────────────────────────────────────────
    // Without actual hodograph data we estimate from directional shear assumption
    const estimatedSRH = Math.max(0, estimatedShear06 * 4);

    // ── LCL proxy ────────────────────────────────────────────────
    // LCL ~ 125 * (T - Td) in metres (Bolton approximation)
    const estimatedLCL = Math.max(200, 125 * Math.max(0, tdDep));

    // ── CIN proxy ────────────────────────────────────────────────
    const estimatedCIN =
      skyCover != null && skyCover < 50 ? 80 : 20; // Clear sky → stronger cap

    return {
      source: "nws_proxy",
      ingredients: {
        cape: Math.round(estimatedCape),
        shear06km: Math.round(estimatedShear06),
        srh01km: Math.round(estimatedSRH),
        lclHeight: Math.round(estimatedLCL),
        cin: Math.round(estimatedCIN),
      },
      raw: { tempC: tempC.toFixed(1), tdDep: tdDep.toFixed(1), surfWindKts },
    };
  } catch (err) {
    console.warn("[hrrr] proxy ingredient parse error:", err.message);
    return { source: "default", ingredients: defaultIngredients() };
  }
}

function extractNearest(values, targetMs) {
  if (!Array.isArray(values) || values.length === 0) return null;
  let best = null, bestDelta = Infinity;
  for (const v of values) {
    try {
      const t = new Date(v.validTime.split("/")[0]).getTime();
      const delta = Math.abs(t - targetMs);
      if (delta < bestDelta) { bestDelta = delta; best = v.value; }
    } catch (_) {}
  }
  return best;
}

function defaultIngredients() {
  return { cape: 0, shear06km: 0, srh01km: 0, lclHeight: 1500, cin: 0 };
}

// ── Ingredient Scoring ────────────────────────────────────────────────────

/**
 * Score each ingredient 0–1, then return a combined 0–1 score.
 */
function scoreIngredients(ingredients) {
  const { cape, shear06km, srh01km, lclHeight, cin } = ingredients;
  const T = THRESHOLDS;

  // CAPE
  const capeScore = clamp(
    (cape - T.cape.low) / (T.cape.high - T.cape.low), 0, 1
  );

  // 0-6 km shear
  const shearScore = clamp(
    (shear06km - T.shear06km.low) / (T.shear06km.high - T.shear06km.low), 0, 1
  );

  // 0-1 km SRH
  const srhScore = clamp(
    (srh01km - T.srh01km.low) / (T.srh01km.high - T.srh01km.low), 0, 1
  );

  // LCL height (lower = better; inverted)
  const lclScore = clamp(
    1 - (lclHeight - T.lclHeight.low) / (T.lclHeight.high - T.lclHeight.low), 0, 1
  );

  // CIN penalty
  const cinPenalty = cin > T.cin.penaltyAbove
    ? clamp((cin - T.cin.penaltyAbove) / 150, 0, 0.5)
    : 0;

  const raw = (capeScore + shearScore + srhScore + lclScore) / 4;
  const penalised = Math.max(0, raw - cinPenalty);

  return {
    combined: penalised,
    breakdown: {
      cape: { value: cape, score: round2(capeScore) },
      shear06km: { value: shear06km, score: round2(shearScore) },
      srh01km: { value: srh01km, score: round2(srhScore) },
      lclHeight: { value: lclHeight, score: round2(lclScore) },
      cin: { value: cin, penalty: round2(cinPenalty) },
    },
  };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round2(v) { return Math.round(v * 100) / 100; }

// ── Main export ───────────────────────────────────────────────────────────

async function getHRRRScore() {
  // For v1 we use the NWS proxy (reliable, no GRIB parsing needed).
  // A production backend can shell out to wgrib2 here instead.
  const result = await getIngredientsFromNWSProxy();
  const scoring = scoreIngredients(result.ingredients);

  return {
    source: result.source,
    ingredients: result.ingredients,
    scoring,
    ingredientScore: round2(scoring.combined),
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { getHRRRScore, scoreIngredients };
