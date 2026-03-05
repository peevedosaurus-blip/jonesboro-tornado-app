/**
 * cache.js — Simple TTL cache + fetch wrapper with exponential backoff
 */

const fetch = require("node-fetch");

// In-memory store: key → { value, expiresAt }
const store = new Map();

/**
 * Get cached value or null if missing/expired.
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Set cache entry with ttl in milliseconds.
 */
function set(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Fetch with cache, retries, and exponential backoff.
 *
 * @param {string} url
 * @param {object} opts  - fetch options
 * @param {number} ttlMs - cache TTL
 * @param {number} retries
 * @returns {Promise<any>} parsed JSON (or text if not JSON)
 */
async function cachedFetch(url, opts = {}, ttlMs = 60_000, retries = 3) {
  const cacheKey = url + JSON.stringify(opts.body || "");
  const cached = get(cacheKey);
  if (cached !== null) return cached;

  const defaultHeaders = {
    "User-Agent": "JonesboroTornadoApp/1.0 (educational; contact: your@email.com)",
    Accept: "application/json",
  };

  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * 2 ** attempt, 30_000);
      await sleep(delay);
    }
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { ...defaultHeaders, ...(opts.headers || {}) },
        timeout: 15_000,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("json") || contentType.includes("geo")) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      set(cacheKey, data, ttlMs);
      return data;
    } catch (err) {
      lastErr = err;
      console.warn(`[cache] attempt ${attempt + 1} failed for ${url}: ${err.message}`);
    }
  }

  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { get, set, cachedFetch };
