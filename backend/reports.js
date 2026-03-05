/**
 * reports.js — Fetch SPC storm reports (tornado, wind, hail)
 * and filter to those near Jonesboro.
 */

const { cachedFetch } = require("./cache");
const config = require("../config");

const RADIUS_DEG = 1.0; // ~111 km radius for "nearby" filter

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
    const obj = {};
    headers.forEach((h, i) => (obj[h] = values[i] || ""));
    return obj;
  });
}

function isNearby(report) {
  const lat = parseFloat(report.Lat || report.lat || 0);
  const lon = parseFloat(report.Lon || report.lon || 0);
  if (!lat || !lon) return false;
  return (
    Math.abs(lat - config.LOCATION.lat) < RADIUS_DEG &&
    Math.abs(lon - config.LOCATION.lon) < RADIUS_DEG
  );
}

async function getSPCReports() {
  const TTL = 5 * 60_000; // 5 min
  let todayReports = [], yesterdayReports = [];

  try {
    const todayText = await cachedFetch(config.APIS.spcReportsToday, {}, TTL);
    todayReports = parseCSV(todayText);
  } catch (err) {
    console.warn("[reports] today fetch failed:", err.message);
  }

  try {
    const yestText = await cachedFetch(config.APIS.spcReportsYesterday, {}, TTL);
    yesterdayReports = parseCSV(yestText);
  } catch (err) {
    console.warn("[reports] yesterday fetch failed:", err.message);
  }

  const tornadoToday = todayReports
    .filter((r) => (r.Type || "").toLowerCase().includes("torn") || r.F_scale !== undefined)
    .filter(isNearby)
    .slice(0, 20);

  const tornadoYesterday = yesterdayReports
    .filter((r) => (r.Type || "").toLowerCase().includes("torn"))
    .filter(isNearby)
    .slice(0, 10);

  const nearbyToday = todayReports.filter(isNearby).slice(0, 30);

  return {
    tornadoReportsToday: tornadoToday,
    tornadoReportsYesterday: tornadoYesterday,
    nearbyReportsToday: nearbyToday,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { getSPCReports };
