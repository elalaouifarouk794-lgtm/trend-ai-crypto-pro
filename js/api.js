// CoinGecko public API client. Free endpoints require no key; nothing secret
// ships in the frontend. Falls back to a deterministic demo dataset when the
// network or rate limit is unavailable so the UI stays functional.

import { CONFIG } from "./config.js";
import { store } from "./state.js";

const cache = new Map(); // key -> { at, data }

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.api.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function cached(key, ttl = CONFIG.api.cacheTtlMs) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < ttl ? hit.data : null;
}
function putCache(key, data) { cache.set(key, { at: Date.now(), data }); }

/* ------------------------------------------------------------------ */
/* Demo dataset (static snapshot, clearly labelled in the UI)          */
/* ------------------------------------------------------------------ */

const DEMO_SEED = [
  ["bitcoin", "Bitcoin", "btc", 67432, 0.42, 28, 1.9],
  ["ethereum", "Ethereum", "eth", 3512, 0.61, 18, 2.4],
  ["tether", "Tether", "usdt", 1.0, 0.01, 2.1, 0.0],
  ["solana", "Solana", "sol", 176.4, 1.85, 12, 3.1],
  ["ripple", "XRP", "xrp", 0.5231, -0.34, 4.9, -1.2],
  ["binancecoin", "BNB", "bnb", 604.2, 0.92, 7, 0.8],
  ["dogecoin", "Dogecoin", "doge", 0.1342, -1.21, 6, 2.7],
  ["cardano", "Cardano", "ada", 0.4512, 0.77, 3.2, -0.5],
  ["avalanche-2", "Avalanche", "avax", 38.11, -0.94, 2.4, 1.1],
  ["tron", "TRON", "trx", 0.1355, 0.31, 1.9, 0.4],
  ["chainlink", "Chainlink", "link", 14.82, 2.44, 1.7, 4.2],
  ["polygon", "Polygon", "pol", 0.7188, -0.62, 1.2, -2.1],
  ["polkadot", "Polkadot", "dot", 7.03, 0.55, 1.1, 0.9],
  ["litecoin", "Litecoin", "ltc", 84.31, 1.02, 1.4, 1.6],
  ["uniswap", "Uniswap", "uni", 9.87, -1.73, 0.9, -3.2],
  ["aptos", "Aptos", "apt", 8.44, 1.19, 0.7, 2.0],
  ["arbitrum", "Arbitrum", "arb", 0.7412, -2.05, 0.6, -4.4],
  ["optimism", "OP Mainnet", "op", 1.8331, 1.44, 0.5, 3.6],
  ["injective-protocol", "Injective", "inj", 26.11, 3.12, 0.4, 5.8],
  ["filecoin", "Filecoin", "fil", 5.92, -0.88, 0.35, -1.7],
];

function genSeries(seedStr, points, base, vol) {
  // deterministic pseudo-random walk from a string seed
  let h = 0;
  for (const ch of seedStr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; };
  const out = [];
  let p = base * (1 - vol * 0.9);
  for (let i = 0; i < points; i++) {
    p = p * (1 + (rnd() - 0.46) * vol * 0.14);
    out.push(Math.max(base * 0.4, p));
  }
  const drift = base / out[out.length - 1];
  return out.map((v, i) => v * (1 + (drift - 1) * (i / (points - 1))));
}

function demoMarkets() {
  return DEMO_SEED.map(([id, name, symbol, price, ch24, mcapB, ch7d], idx) => {
    const series = genSeries(id, 168, price, symbol === "usdt" ? 0.001 : 0.05);
    return {
      id, name, symbol, current_price: price, market_cap_rank: idx + 1,
      market_cap: mcapB * 1e9, total_volume: mcapB * 1e9 * 0.06,
      price_change_percentage_1h_in_currency: symbol === "usdt" ? 0.0 : ch24 / 24,
      price_change_percentage_24h_in_currency: ch24,
      price_change_percentage_7d_in_currency: ch7d,
      high_24h: price * 1.021, low_24h: price * 0.978,
      ath: price * (id === "bitcoin" ? 1.16 : 1.9), ath_change_percentage: -18.4,
      sparkline_in_7d: { price: series }, image: "", demo: true,
    };
  });
}

function demoGlobal() {
  return {
    total_market_cap: { usd: 2.41e12 }, total_volume: { usd: 7.8e10 },
    market_cap_percentage: { btc: 53.1, eth: 16.8 },
    market_cap_change_percentage_24h_usd: 0.62, active_cryptocurrencies: 16421,
    demo: true,
  };
}

function demoTrending() {
  const names = ["Bitcoin", "Solana", "Chainlink", "Injective", "Dogecoin"];
  return {
    coins: names.map((n, i) => ({
      item: {
        id: DEMO_SEED.find((d) => d[1] === n)?.[0] ?? "bitcoin",
        name: n, symbol: n.slice(0, 3).toLowerCase(),
        market_cap_rank: i + 1, data: { price_change_percentage_24h: { usd: [1.2, -0.8, 4.4, 6.1, -2.3][i] } },
      },
    })),
    demo: true,
  };
}

function demoChart(coinId, days) {
  const seed = DEMO_SEED.find((d) => d[0] === coinId) || DEMO_SEED[0];
  const points = days <= 1 ? 24 : days <= 7 ? 7 * 8 : days <= 30 ? 30 * 4 : 365;
  const series = genSeries(coinId + days, points, seed[3] * (0.85 + 0.02 * (seed[3] > 1 ? 1 : 0)), 0.05);
  const now = Date.now();
  const step = (days * 86400000) / points;
  return {
    prices: series.map((p, i) => [now - (points - i) * step, p]),
    volumes: series.map((p, i) => [now - (points - i) * step, p * (20000 + (i % 7) * 4200)]),
    demo: true,
  };
}

/* ------------------------------------------------------------------ */
/* Public fetch wrappers with live -> demo degradation                 */
/* ------------------------------------------------------------------ */

async function fetchWithFallback(key, url, demoFactory) {
  const hit = cached(key);
  if (hit) return { data: hit, live: true };
  try {
    const data = await getJson(url);
    putCache(key, data);
    return { data, live: true };
  } catch (err) {
    console.warn(`[api] ${key} failed (${err.message}); serving demo data.`);
    const data = demoFactory();
    putCache(key, data);
    return { data, live: false };
  }
}

export async function fetchMarkets() {
  const url = `${CONFIG.api.baseUrl}/coins/markets`
    + `?vs_currency=${CONFIG.vsCurrency}`
    + "&order=market_cap_desc&per_page=100&page=1"
    + "&sparkline=true&price_change_percentage=1h%2C24h%2C7d";
  const { data, live } = await fetchWithFallback("markets", url, demoMarkets);
  if (live) store.setApiMode("live");
  else if (store.apiMode !== "live") store.setApiMode("demo");
  store.setCoins(data);
  return data;
}

export async function fetchGlobal() {
  const url = `${CONFIG.api.baseUrl}/global`;
  const { data, live } = await fetchWithFallback("global", url, demoGlobal);
  // CoinGecko wraps /global payloads in a `data` envelope.
  const payload = data?.data ?? data;
  if (!live) payload.demo = true;
  store.setGlobal(payload);
}

export async function fetchTrending() {
  const url = `${CONFIG.api.baseUrl}/search/trending`;
  const { data } = await fetchWithFallback("trending", url, demoTrending);
  store.setTrending(data);
}

export async function fetchFearGreed() {
  try {
    const raw = await getJson(`${CONFIG.api.fngUrl}?limit=1`);
    const item = raw?.data?.[0];
    store.setFng({ value: Number(item.value), classification: item.value_classification, live: true });
  } catch {
    // derive a plausible index from market breadth
    const ups = store.coins.filter((c) => (c.price_change_percentage_24h_in_currency ?? 0) > 0).length;
    const total = store.coins.length || 1;
    store.setFng({ value: Math.round(24 + (ups / total) * 52), classification: "Neutral", live: false });
  }
}

export async function fetchMarketChart(coinId, days = 30) {
  const url = `${CONFIG.api.baseUrl}/coins/${coinId}/market_chart`
    + `?vs_currency=${CONFIG.vsCurrency}&days=${days}`;
  const { data, live } = await fetchWithFallback(`chart:${coinId}:${days}`, url, () => demoChart(coinId, days));
  return { coinId, days, prices: data.prices, volumes: data.volumes, demo: !live || !!data.demo };
}

// Full refresh used on load, manual refresh and the auto-refresh timer.
export async function refreshMarketData() {
  cache.clear();
  const results = await Promise.allSettled([
    fetchMarkets(), fetchGlobal(), fetchTrending(), fetchFearGreed(),
  ]);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length === results.length) store.setApiMode("down");
  return results;
}
