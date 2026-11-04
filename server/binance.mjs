// Binance spot REST, zero-dependency.
//
// Public market data needs no key, so paper mode works without credentials.
// Signed calls need BINANCE_API_KEY / BINANCE_API_SECRET, which are read from
// the server environment only — nothing here is exported to the browser and
// nothing here can move funds off the exchange (no withdraw endpoints exist).

import { createHmac } from "node:crypto";

const HOSTS = {
  live: "https://api.binance.com",
  testnet: "https://testnet.binance.vision",
};

const round = (n) => Number(n).toFixed(8).replace(/\.?0+$/, "");

export function createBinance({ apiKey = "", apiSecret = "", network = "live", timeoutMs = 12000 } = {}) {
  const host = HOSTS[network] || HOSTS.live;
  const hasKeys = Boolean(apiKey && apiSecret);

  async function call(path, { method = "GET", params, signed = false } = {}) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== "") query.append(k, String(v));
    }
    let url = host + path;
    if (signed) {
      if (!hasKeys) throw new Error("exchange keys are not configured on this server");
      query.append("timestamp", String(Date.now()));
      query.append("recvWindow", "5000");
      const qs = query.toString();
      url += `?${qs}&signature=${createHmac("sha256", apiSecret).update(qs).digest("hex")}`;
    } else if (query.toString()) {
      url += `?${query}`;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: signed ? { "X-MBX-APIKEY": apiKey } : { "X-MBX-APIKEY": apiKey || "" },
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { msg: text.slice(0, 200) }; }
      if (!res.ok) {
        const err = new Error(data?.msg || `binance HTTP ${res.status}`);
        err.status = res.status;
        err.code = data?.code;
        throw err;
      }
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw new Error(`binance request timed out (${path})`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    network,
    hasKeys,

    ping: () => call("/api/v3/ping"),
    prices: (symbols) =>
      call("/api/v3/ticker/price", { params: symbols?.length ? { symbols: JSON.stringify(symbols) } : {} }),
    klines: (symbol, interval = "1h", limit = 120) => call("/api/v3/klines", { params: { symbol, interval, limit } }),

    async filters(symbol) {
      const info = await call("/api/v3/exchangeInfo", { params: { symbol } });
      const s = info?.symbols?.[0];
      if (!s) throw new Error(`unknown symbol ${symbol}`);
      const lot = s.filters.find((f) => f.filterType === "LOT_SIZE") || {};
      const notional = s.filters.find((f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL") || {};
      return {
        symbol: s.symbol,
        base: s.baseAsset,
        quote: s.quoteAsset,
        stepSize: Number(lot.stepSize || 1e-6),
        minQty: Number(lot.minQty || 0),
        minNotional: Number(notional.minNotional || notional.notional || 0),
        permissions: s.permissions,
      };
    },

    account: () => call("/api/v3/account", { signed: true }),
    openOrders: () => call("/api/v3/openOrders", { signed: true }),
    myTrades: (symbol, limit = 50) => call("/api/v3/myTrades", { signed: true, params: { symbol, limit } }),

    // MARKET orders only: the agent never leaves a resting order to manage.
    marketBuy: (symbol, quoteUsd) =>
      call("/api/v3/order", {
        method: "POST",
        signed: true,
        params: { symbol, side: "BUY", type: "MARKET", quoteOrderQty: round(quoteUsd), newOrderRespType: "RESULT" },
      }),
    marketSell: (symbol, baseQty) =>
      call("/api/v3/order", {
        method: "POST",
        signed: true,
        params: { symbol, side: "SELL", type: "MARKET", quantity: round(baseQty), newOrderRespType: "RESULT" },
      }),
  };
}

// Trading-rule enforcement that mirrors the exchange's own filters, so an order
// rejected by Binance never gets attempted with a size the agent should have known.
export function alignToStep(value, stepSize, min = 0) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const steps = Math.floor(value / stepSize + 1e-9);
  const aligned = steps * stepSize;
  if (aligned < min) return 0;
  return Number(aligned.toFixed(8));
}
