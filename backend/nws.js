/**
 * nws.js — Fetch active NWS alerts for Jonesboro area.
 *
 * Checks for:
 *   - Tornado Warning (hard override)
 *   - Tornado Watch
 *   - Severe Thunderstorm Warning
 *   - Any other active alerts
 */

const { cachedFetch } = require("./cache");
const config = require("../config");

const { APIS, LOCATION, INTERVALS } = config;

/**
 * Check if a GeoJSON geometry (Polygon/MultiPolygon) contains
 * or intersects with the Jonesboro point using a simple
 * bounding-box pre-filter + ray-casting.
 */
function pointInGeometry(geometry, lat, lon) {
  if (!geometry) return false;

  const rings =
    geometry.type === "Polygon"
      ? geometry.coordinates
      : geometry.type === "MultiPolygon"
      ? geometry.coordinates.flat(1)
      : null;

  if (!rings) return false;

  for (const ring of rings) {
    if (pointInRing(ring, lon, lat)) return true;
  }
  return false;
}

function pointInRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Fetch all active NWS alerts for Arkansas + surrounding area,
 * then filter to those covering Jonesboro.
 */
async function getNWSAlerts() {
  const { lat, lon, bbox } = LOCATION;

  // Fetch by area (state = AR) + tornado-specific
  const urls = [
    `${APIS.nwsBase}/alerts/active?area=AR`,
    `${APIS.nwsBase}/alerts/active?event=Tornado%20Warning`,
    `${APIS.nwsBase}/alerts/active?event=Tornado%20Watch`,
  ];

  let allFeatures = [];

  for (const url of urls) {
    try {
      const data = await cachedFetch(url, {}, INTERVALS.nwsAlerts);
      if (data && data.features) {
        allFeatures = allFeatures.concat(data.features);
      }
    } catch (err) {
      console.error(`[nws] fetch error ${url}:`, err.message);
    }
  }

  // De-duplicate by alert ID
  const seen = new Set();
  const unique = allFeatures.filter((f) => {
    const id = f.id || f.properties?.id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Filter to alerts that cover Jonesboro
  const relevant = unique.filter((feature) => {
    const geom = feature.geometry;
    if (!geom) {
      // Some alerts have no geometry; check affected zones text
      const desc = JSON.stringify(feature.properties || "");
      return (
        desc.includes("ARZ019") ||
        desc.includes("Jonesboro") ||
        desc.includes("Craighead")
      );
    }
    return pointInGeometry(geom, lat, lon);
  });

  // Classify
  const tornadoWarnings = relevant.filter(
    (f) => f.properties?.event === "Tornado Warning"
  );
  const tornadoWatches = relevant.filter(
    (f) => f.properties?.event === "Tornado Watch"
  );
  const svtWarnings = relevant.filter(
    (f) => f.properties?.event === "Severe Thunderstorm Warning"
  );

  return {
    hasTornadoWarning: tornadoWarnings.length > 0,
    hasTornadoWatch: tornadoWatches.length > 0,
    hasSevereThunderstormWarning: svtWarnings.length > 0,
    tornadoWarnings: tornadoWarnings.map(simplifyAlert),
    tornadoWatches: tornadoWatches.map(simplifyAlert),
    severeThunderstormWarnings: svtWarnings.map(simplifyAlert),
    allRelevantAlerts: relevant.map(simplifyAlert),
    fetchedAt: new Date().toISOString(),
  };
}

function simplifyAlert(feature) {
  const p = feature.properties || {};
  return {
    id: feature.id,
    event: p.event,
    headline: p.headline,
    description: p.description?.slice(0, 400),
    severity: p.severity,
    urgency: p.urgency,
    onset: p.onset,
    expires: p.expires,
    geometry: feature.geometry || null,
  };
}

module.exports = { getNWSAlerts };
