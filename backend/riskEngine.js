/**
 * riskEngine.js — Combine SPC + HRRR + NWS into a single 0–100 risk score.
 */

const config = require("../config");
const { RISK } = config;

/**
 * Main risk calculation.
 *
 * @param {object} spc   - from spc.js getSPCData()
 * @param {object} hrrr  - from hrrr.js getHRRRScore()
 * @param {object} nws   - from nws.js getNWSAlerts()
 * @returns {object} risk result
 */
function calculateRisk(spc, hrrr, nws) {
  const reasons = [];
  let score;

  // ── Step 1: Tornado Warning hard override ──────────────────────
  if (nws.hasTornadoWarning) {
    score = RISK.tornado_warning_score;
    reasons.push({
      source: "NWS",
      weight: "critical",
      text: `TORNADO WARNING in effect for Jonesboro area`,
    });

    return buildResult(score, "EXTREME", reasons, spc, hrrr, nws);
  }

  // ── Step 2: SPC baseline ───────────────────────────────────────
  const spcBaseline = spc.day1.probability;
  // If not in any Day 1 polygon, use a small background rate
  const baseline = spcBaseline > 0 ? spcBaseline : 2;

  if (spcBaseline > 0) {
    reasons.push({
      source: "SPC",
      weight: "primary",
      text: `SPC Day 1 tornado probability: ${spcBaseline}%${
        spc.day1.significant ? " (SIGNIFICANT — hatched region)" : ""
      }`,
    });
  } else {
    reasons.push({
      source: "SPC",
      weight: "primary",
      text: `Jonesboro outside SPC Day 1 tornado outlook (background rate ≤2%)`,
    });
  }

  // ── Step 3: HRRR modifier ──────────────────────────────────────
  const ingredientScore = hrrr.ingredientScore || 0;
  const hrrrMultiplier =
    RISK.hrrr_base_weight + RISK.hrrr_ingredient_weight * ingredientScore;

  score = baseline * hrrrMultiplier;

  // Top 3 HRRR drivers
  const breakdown = hrrr.scoring?.breakdown || {};
  const topIngredients = Object.entries(breakdown)
    .filter(([key]) => key !== "cin")
    .sort(([, a], [, b]) => (b.score || 0) - (a.score || 0))
    .slice(0, 3);

  topIngredients.forEach(([key, data]) => {
    const label = ingredientLabel(key);
    const unit = ingredientUnit(key);
    reasons.push({
      source: "HRRR",
      weight: "modifier",
      text: `${label}: ${data.value}${unit} (score ${Math.round(data.score * 100)}%)`,
    });
  });

  if (breakdown.cin?.penalty > 0.1) {
    reasons.push({
      source: "HRRR",
      weight: "modifier",
      text: `Strong CIN cap (${breakdown.cin.value} J/kg) suppressing convection`,
    });
  }

  // ── Step 4: Watch bonus ───────────────────────────────────────
  if (nws.hasTornadoWatch) {
    score += RISK.tornado_watch_bonus;
    reasons.push({
      source: "NWS",
      weight: "additive",
      text: "Tornado Watch currently active for the region",
    });
  }

  // ── Step 5: Day 2 context ─────────────────────────────────────
  if (spc.day2.probability > 0) {
    reasons.push({
      source: "SPC",
      weight: "context",
      text: `SPC Day 2 tornado probability: ${spc.day2.probability}%`,
    });
  }

  // ── Clamp final score ──────────────────────────────────────────
  score = Math.round(Math.min(94, Math.max(0, score)));

  const label = riskLabel(score);
  return buildResult(score, label, reasons, spc, hrrr, nws);
}

function buildResult(score, label, reasons, spc, hrrr, nws) {
  return {
    score,
    label,
    reasons,
    inputs: {
      spcDay1Prob: spc.day1.probability,
      spcDay2Prob: spc.day2.probability,
      spcDay1Significant: spc.day1.significant,
      ingredientScore: hrrr.ingredientScore,
      hasTornadoWarning: nws.hasTornadoWarning,
      hasTornadoWatch: nws.hasTornadoWatch,
    },
    calculatedAt: new Date().toISOString(),
  };
}

function riskLabel(score) {
  if (score >= 80) return "EXTREME";
  if (score >= 50) return "HIGH";
  if (score >= 20) return "ELEVATED";
  if (score >= 5) return "MARGINAL";
  return "MINIMAL";
}

function ingredientLabel(key) {
  return (
    {
      cape: "CAPE (instability)",
      shear06km: "0–6 km bulk shear",
      srh01km: "0–1 km SRH",
      lclHeight: "LCL height",
    }[key] || key
  );
}

function ingredientUnit(key) {
  return (
    { cape: " J/kg", shear06km: " kt", srh01km: " m²/s²", lclHeight: " m" }[
      key
    ] || ""
  );
}

module.exports = { calculateRisk };
