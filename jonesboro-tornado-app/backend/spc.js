/**
 * spc.js — Fetch SPC probabilistic tornado outlook polygons
 * and determine if Jonesboro falls inside any polygon.
 *
 * Uses the NOAA/NWS ArcGIS MapServer REST endpoint.
 */

const { cachedFetch } = require("./cache");
const config = require("../config");

const { APIS, SPC_LAYERS, LOCATION, INTERVALS } = config;

/**
 * Query a single SPC layer for a point intersection.
 * Returns the matching feature attributes or null.
 */
async function querySPCLayer(layerId) {
  const { lat, lon } = LOCATION;

  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    f: "geojson",
  });

  const url = `${APIS.spcArcgis}/${layerId}/query?${params}`;

  try {
    const data = await cachedFetch(url, {}, INTERVALS.spcOutlook);
    if (data && data.features && data.features.length > 0) {
      return data.features[0];
    }
    return null;
  } catch (err) {
    console.error(`[spc] layer ${layerId} error:`, err.message);
    return null;
  }
}

/**
 * Parse tornado probability from a SPC feature's properties.
 * The field name varies; common ones: LABEL, LABEL2, dn, percent.
 */
function extractProbability(feature) {
  if (!feature) return 0;
  const props = feature.properties || {};

  // Try common field names
  const raw =
    props.LABEL2 ||
    props.LABEL ||
    props.dn ||
    props.percent ||
    props.IDPVALUE ||
    "0";

  // Could be "10%" or "10" or numeric
  const num = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(num) ? 0 : num;
}

/**
 * Main export: returns SPC data for Day 1 + Day 2.
 */
async function getSPCData() {
  const [day1Feature, day1SigFeature, day2Feature, day2SigFeature] =
    await Promise.all([
      querySPCLayer(SPC_LAYERS.day1Tornado),
      querySPCLayer(SPC_LAYERS.day1SigTornado),
      querySPCLayer(SPC_LAYERS.day2Tornado),
      querySPCLayer(SPC_LAYERS.day2SigTornado),
    ]);

  const day1Prob = extractProbability(day1Feature);
  const day2Prob = extractProbability(day2Feature);
  const day1Sig = !!day1SigFeature;
  const day2Sig = !!day2SigFeature;

  return {
    day1: {
      probability: day1Prob,
      significant: day1Sig,
      inOutlook: day1Prob > 0,
      feature: day1Feature
        ? { geometry: day1Feature.geometry, properties: day1Feature.properties }
        : null,
    },
    day2: {
      probability: day2Prob,
      significant: day2Sig,
      inOutlook: day2Prob > 0,
      feature: day2Feature
        ? { geometry: day2Feature.geometry, properties: day2Feature.properties }
        : null,
    },
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { getSPCData };
