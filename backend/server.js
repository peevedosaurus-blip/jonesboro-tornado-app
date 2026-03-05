/**
 * server.js — Jonesboro Tornado Probability API Server
 *
 * Endpoints:
 *   GET /risk          — Full risk assessment JSON
 *   GET /spc           — SPC outlook data only
 *   GET /alerts        — NWS alerts only
 *   GET /hrrr          — HRRR ingredient score only
 *   GET /reports       — SPC storm reports
 *   GET /health        — Service health check
 */

const express = require("express");
const cors = require("cors");
const config = require("../config");

const { getSPCData } = require("./spc");
const { getNWSAlerts } = require("./nws");
const { getHRRRScore } = require("./hrrr");
const { getSPCReports } = require("./reports");
const { calculateRisk } = require("./riskEngine");

const app = express();
app.use(cors());
app.use(express.json());

// ── Health ────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    location: config.LOCATION.name,
    time: new Date().toISOString(),
  });
});

// ── Main risk endpoint ────────────────────────────────────────────────────
app.get("/risk", async (req, res) => {
  try {
    const [spc, hrrr, nws] = await Promise.all([
      getSPCData(),
      getHRRRScore(),
      getNWSAlerts(),
    ]);

    const risk = calculateRisk(spc, hrrr, nws);

    res.json({
      location: config.LOCATION,
      risk,
      spc,
      hrrr,
      nws,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/risk] error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── SPC endpoint ──────────────────────────────────────────────────────────
app.get("/spc", async (req, res) => {
  try {
    res.json(await getSPCData());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Alerts endpoint ───────────────────────────────────────────────────────
app.get("/alerts", async (req, res) => {
  try {
    res.json(await getNWSAlerts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HRRR endpoint ─────────────────────────────────────────────────────────
app.get("/hrrr", async (req, res) => {
  try {
    res.json(await getHRRRScore());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reports endpoint ──────────────────────────────────────────────────────
app.get("/reports", async (req, res) => {
  try {
    res.json(await getSPCReports());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = config.SERVER_PORT;
app.listen(PORT, () => {
  console.log(`\n🌪  Jonesboro Tornado API running on http://localhost:${PORT}`);
  console.log(`    Location: ${config.LOCATION.name}`);
  console.log(`    Endpoints: /risk  /spc  /alerts  /hrrr  /reports  /health\n`);
});

module.exports = app;
