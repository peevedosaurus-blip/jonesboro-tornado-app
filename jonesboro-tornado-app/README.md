# 🌪 Jonesboro Tornado Probability

A real-time tornado probability web app for **Jonesboro, AR** combining:

- **SPC Convective Outlooks** — official probabilistic tornado probabilities
- **NWS Active Alerts** — tornado warnings (hard override → score 95–100), watches, severe thunderstorm warnings
- **Atmospheric Ingredients** — CAPE, shear, SRH, LCL, CIN via NWS gridded forecast (HRRR proxy)
- **SPC Storm Reports** — nearby confirmed reports filtered to ±100 km

---

## Quick Start

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Start the backend API

```bash
npm start
# or for development with auto-reload:
npm run dev
```

The server starts on **http://localhost:3001**

### 3. Open the frontend

Open `frontend/public/index.html` in your browser.

> **Tip**: Serve it with any static file server to avoid CORS issues:
> ```bash
> npx serve frontend/public
> ```
> Then visit http://localhost:3000

---

## API Endpoints

| Endpoint    | Description                          | Update interval |
|-------------|--------------------------------------|-----------------|
| `GET /risk`    | Full risk assessment JSON           | ~2 min          |
| `GET /spc`     | SPC tornado outlook data            | 5 min           |
| `GET /alerts`  | NWS active alerts                   | 1 min           |
| `GET /hrrr`    | Atmospheric ingredient score        | 60 min          |
| `GET /reports` | SPC storm reports near Jonesboro    | 5 min           |
| `GET /health`  | Service health check                | —               |

### Example `/risk` response

```json
{
  "location": { "name": "Jonesboro, AR", "lat": 35.8423, "lon": -90.7043 },
  "risk": {
    "score": 18,
    "label": "ELEVATED",
    "reasons": [
      { "source": "SPC",  "weight": "primary",  "text": "SPC Day 1 tornado probability: 5%" },
      { "source": "HRRR", "weight": "modifier", "text": "CAPE (instability): 1200 J/kg (score 35%)" },
      { "source": "HRRR", "weight": "modifier", "text": "0–6 km bulk shear: 38 kt (score 52%)" }
    ],
    "inputs": {
      "spcDay1Prob": 5,
      "ingredientScore": 0.42,
      "hasTornadoWarning": false,
      "hasTornadoWatch": false
    }
  }
}
```

---

## Risk Score Logic

```
1. Start with SPC Day 1 tornado probability (or 2% background if outside any polygon)
2. Multiply by HRRR modifier:  baseline × (0.75 + 0.75 × ingredientScore)
3. Add watch bonus (+15) if Tornado Watch is active
4. Override to 97–100 if Tornado Warning covers Jonesboro
5. Clamp to [0, 100]
```

**Risk Labels:**

| Score  | Label    |
|--------|----------|
| 0–4    | MINIMAL  |
| 5–19   | MARGINAL |
| 20–49  | ELEVATED |
| 50–79  | HIGH     |
| 80–100 | EXTREME  |

### Ingredient Scoring (0–1 each, then averaged)

| Ingredient | 0 (no threat) | 1 (high threat) |
|---|---|---|
| CAPE       | < 500 J/kg    | > 2500 J/kg     |
| 0–6km shear| < 25 kt       | > 50 kt         |
| 0–1km SRH  | < 100 m²/s²   | > 300 m²/s²     |
| LCL height | > 1800 m      | < 800 m         |
| CIN        | — | Penalizes if > 50 J/kg |

---

## Configuration

Edit **`config.js`** in the root to change location or thresholds:

```js
LOCATION: {
  name: "Jonesboro, AR",
  lat: 35.8423,
  lon: -90.7043,
  // ...
}
```

Change `LOCATION.lat`, `LOCATION.lon`, and `LOCATION.name` to monitor any city.
Also update `LOCATION.nwsZone` and `LOCATION.nwsOffice` for accurate local alerts.

---

## Data Sources

| Source | Description | Endpoint |
|--------|-------------|----------|
| SPC ArcGIS | Day 1/2 tornado outlook polygons | `mapservices.weather.noaa.gov/vector/...` |
| NWS API | Active alerts, warnings, watches | `api.weather.gov/alerts/active` |
| NWS Gridded | Forecast grid for ingredient proxy | `api.weather.gov/points/{lat},{lon}` |
| SPC Reports | Confirmed storm reports CSV | `spc.noaa.gov/climo/reports/today_filtered.csv` |

### HRRR Integration (Production Upgrade)

The current ingredient score uses an NWS gridded forecast as a proxy.
For direct HRRR GRIB2 parsing, install **wgrib2** and replace `getIngredientsFromNWSProxy()` in `backend/hrrr.js` with:

```bash
# Extract CAPE near Jonesboro from latest HRRR run:
wgrib2 hrrr.t{HH}z.wrfsfcf00.grib2 \
  -match "CAPE:surface" \
  -lon -90.70 35.84 -print_out
```

---

## Project Structure

```
jonesboro-tornado/
├── config.js              ← Location & thresholds config
├── package.json           ← Root scripts
├── backend/
│   ├── server.js          ← Express API server
│   ├── spc.js             ← SPC ArcGIS outlook queries
│   ├── nws.js             ← NWS alert fetcher
│   ├── hrrr.js            ← Ingredient scoring
│   ├── reports.js         ← SPC storm report parser
│   ├── riskEngine.js      ← Score calculation
│   ├── cache.js           ← TTL cache + exponential backoff
│   └── package.json
└── frontend/
    └── public/
        └── index.html     ← Single-file dashboard UI
```

---

## Notes

- The NWS API requires a descriptive `User-Agent` header (set in `cache.js`). Update the contact email.
- All fetches use exponential backoff (up to 30s) and a TTL cache keyed by URL.
- CORS is enabled on the backend by default — restrict `origin` in production.
- The frontend polls `/risk` every 2 minutes automatically and shows a live status indicator.
- If the backend is unreachable, the frontend renders demo data so the UI remains visible.

---

## License

MIT — for educational/informational use only.  
**Not a substitute for official NWS warnings or emergency management guidance.**
