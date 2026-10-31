// Reactive app store: market cache, watchlist and paper-trading persistence.

import { CONFIG } from "./config.js";

const LS_WATCH = "trendai.watchlist.v1";
const LS_PAPER = "trendai.paper.v1";

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full/blocked */ }
}

const listeners = new Set();

export const store = {
  // ---- live market data (not persisted) ----
  coins: [],            // array of CoinGecko market rows (or demo equivalents)
  global: null,         // global market stats
  trending: null,       // trending coins payload
  fng: null,            // fear & greed { value, classification }
  lastUpdated: 0,
  apiMode: "connecting", // "live" | "demo" | "down" | "connecting"
  searchQuery: "",

  // ---- persisted ----
  watchlist: readLS(LS_WATCH, ["bitcoin", "ethereum", "solana"]),
  paper: readLS(LS_PAPER, {
    cashUsd: CONFIG.paper.startingCashUsd,
    positions: {},   // coinId -> { qty, avgCost }
    trades: [],      // { id, side, coinId, symbol, qty, price, value, fee, ts }
  }),

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(evt) { listeners.forEach((fn) => { try { fn(evt, this); } catch (e) { console.error(e); } }); },

  setApiMode(mode) { this.apiMode = mode; this.emit("apiMode"); },

  setCoins(coins) {
    this.coins = coins;
    this.lastUpdated = Date.now();
    this.emit("coins");
  },
  setGlobal(g) { this.global = g; this.emit("global"); },
  setTrending(t) { this.trending = t; this.emit("trending"); },
  setFng(f) { this.fng = f; this.emit("fng"); },

  coinById(id) { return this.coins.find((c) => c.id === id); },

  // ---- watchlist ----
  inWatchlist(id) { return this.watchlist.includes(id); },
  toggleWatch(id) {
    this.watchlist = this.inWatchlist(id)
      ? this.watchlist.filter((w) => w !== id)
      : [...this.watchlist, id];
    writeLS(LS_WATCH, this.watchlist);
    this.emit("watchlist");
  },

  // ---- paper trading ----
  savePaper() { writeLS(LS_PAPER, this.paper); this.emit("paper"); },

  paperHoldingsValue() {
    return Object.entries(this.paper.positions).reduce((sum, [id, pos]) => {
      const c = this.coinById(id);
      return sum + (c ? pos.qty * c.current_price : 0);
    }, 0);
  },
  paperEquity() { return this.paper.cashUsd + this.paperHoldingsValue(); },

  paperBuy(coinId, qtyUsd) {
    const coin = this.coinById(coinId);
    if (!coin || qtyUsd <= 0) throw new Error("Invalid order.");
    if (qtyUsd > this.paper.cashUsd) throw new Error("Insufficient virtual cash for this order.");
    const fee = qtyUsd * CONFIG.paper.feeRate;
    const filled = qtyUsd - fee;
    const qty = filled / coin.current_price;
    const pos = this.paper.positions[coinId] || { qty: 0, avgCost: 0 };
    const newQty = pos.qty + qty;
    pos.avgCost = newQty > 0 ? (pos.qty * pos.avgCost + filled) / newQty : 0;
    pos.qty = newQty;
    this.paper.positions[coinId] = pos;
    this.paper.cashUsd -= qtyUsd;
    this._logTrade("BUY", coin, qty, coin.current_price, qtyUsd, fee);
  },

  paperSell(coinId, qty) {
    const coin = this.coinById(coinId);
    const pos = this.paper.positions[coinId];
    if (!coin || !pos || qty <= 0) throw new Error("Invalid order.");
    if (qty > pos.qty + 1e-12) throw new Error("Amount exceeds your virtual holdings.");
    const gross = qty * coin.current_price;
    const fee = gross * CONFIG.paper.feeRate;
    pos.qty -= qty;
    if (pos.qty < 1e-10) delete this.paper.positions[coinId];
    this.paper.cashUsd += gross - fee;
    this._logTrade("SELL", coin, qty, coin.current_price, gross, fee);
  },

  _logTrade(side, coin, qty, price, value, fee) {
    this.paper.trades.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      side, coinId: coin.id, symbol: coin.symbol.toUpperCase(),
      qty, price, value, fee, ts: Date.now(),
    });
    this.paper.trades = this.paper.trades.slice(0, 200);
    this.savePaper();
  },

  paperReset() {
    this.paper = { cashUsd: CONFIG.paper.startingCashUsd, positions: {}, trades: [] };
    this.savePaper();
  },
};
