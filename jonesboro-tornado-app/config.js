// ============================================================
//  Jonesboro Tornado Probability — Central Config
//  Change LOCATION to monitor a different city.
// ============================================================

module.exports = {
  LOCATION: {
    name: "Jonesboro, AR",
    lat: 35.8423,
    lon: -90.7043,
    // Bounding box ~40 km radius (roughly 0.36 deg lat/lon)
    bbox: {
      minLat: 35.48,
      maxLat: 36.20,
      minLon: -91.07,
      maxLon: -90.34,
    },
    // NWS office / zone for targeted queries
    nwsZone: "ARZ019",
    nwsOffice: "MEG", // Memphis NWS
  },

  // ---- Ingredient scoring thresholds ----------------------
  THRESHOLDS: {
    cape: { low: 500, high: 2500 },          // J/kg
    shear06km: { low: 25, high: 50 },         // knots
    srh01km: { low: 100, high: 300 },         // m²/s²
    lclHeight: { low: 800, high: 1800 },      // meters (inverted: lower = better)
    cin: { penaltyAbove: 50 },                // J/kg (penalise strong cap)
  },

  // ---- Risk engine ----------------------------------------
  RISK: {
    // HRRR modifier: baseline × (BASE_WEIGHT + HRRR_WEIGHT × ingredientScore)
    hrrr_base_weight: 0.75,
    hrrr_ingredient_weight: 0.75,
    // Hard override thresholds
    tornado_warning_score: 97,
    tornado_watch_bonus: 15,
  },

  // ---- Update intervals (ms) ------------------------------
  INTERVALS: {
    nwsAlerts: 60_000,       // 1 min
    spcOutlook: 300_000,     // 5 min
    hrrr: 3_600_000,         // 60 min (HRRR updates hourly)
  },

  // ---- API endpoints --------------------------------------
  APIS: {
    nwsBase: "https://api.weather.gov",
    spcArcgis:
      "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer",
    hrrrNomads: "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl",
    mrmsBase: "https://mrms.ncep.noaa.gov/data",
    spcReportsToday:
      "https://www.spc.noaa.gov/climo/reports/today_filtered.csv",
    spcReportsYesterday:
      "https://www.spc.noaa.gov/climo/reports/yesterday_filtered.csv",
  },

  // ---- SPC ArcGIS layer IDs --------------------------------
  SPC_LAYERS: {
    day1SigTornado: 2,
    day1Tornado: 3,
    day2SigTornado: 10,
    day2Tornado: 11,
  },

  SERVER_PORT: 3001,
};
