// The order engine and its risk gate.
//
// Every decision — from the AI loop or a manual request — passes through
// `gate()` before any venue sees it, and the gate is the only thing that can
// say "no". Paper mode fills against real live prices and writes the same
// records live mode does, so switching modes changes execution, not accounting.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULTS = {
  mode: "paper", // paper | testnet | live
  running: false,
  intervalMs: 60000,
  startingCashUsd: 10000,
  symbols: ["BTCUSDT", "ETHUSDT"],
  maxOrderUsd: 200,
  maxPositions: 3,
  dailyLossLimitUsd: 500,
  minConfidence: 0.6,
  feePct: 0.1,
  slippagePct: 0.05,
  liveConfirmed: false,
  allowRuleFallback: true,
};

const now = () => Date.now();
const money = (n) => Math.round(Number(n) * 1e6) / 1e6;

function emptyDay() {
  return { date: new Date().toISOString().slice(0, 10), realizedUsd: 0, orders: 0, blocked: 0, lastOrderAt: 0 };
}

export class AgentEngine {
  #storePath;
  #binance;
  #state;

  constructor({ file, binance }) {
    this.#storePath = file;
    this.#binance = binance;
    this.#state = { config: { ...DEFAULTS }, cash: DEFAULTS.startingCashUsd, positions: {}, trades: [], journal: [], day: emptyDay(), equity: [] };
  }

  get config() {
    return this.#state.config;
  }

  get liveBlockedReason() {
    const c = this.#state.config;
    if (c.mode === "paper") return null;
    if (!this.#binance.hasKeys) return `BINANCE_API_KEY / BINANCE_API_SECRET are not set in the server environment`;
    if (c.mode === "live" && !c.liveConfirmed) return `live mode needs liveConfirmed: true (typed acknowledgement)`;
    return null;
  }

  /* ------------------------------- persistence ------------------------------ */
  async load() {
    try {
      const raw = JSON.parse(await readFile(this.#storePath, "utf8"));
      this.#state = {
        config: { ...DEFAULTS, ...raw.config, running: false }, // never auto-resume on boot
        cash: Number.isFinite(raw.cash) ? raw.cash : DEFAULTS.startingCashUsd,
        positions: raw.positions || {},
        trades: Array.isArray(raw.trades) ? raw.trades.slice(-500) : [],
        journal: Array.isArray(raw.journal) ? raw.journal.slice(-300) : [],
        day: raw.day || emptyDay(),
        equity: Array.isArray(raw.equity) ? raw.equity.slice(-500) : [],
      };
      if (this.#state.day.date !== emptyDay().date) this.#state.day = emptyDay();
    } catch {
      /* first run */
    }
    return this;
  }

  async save() {
    await mkdirSafe(this.#storePath);
    await writeFile(this.#storePath, JSON.stringify(this.#state), "utf8");
  }

  reset(preserveConfig = true) {
    const config = preserveConfig ? this.#state.config : { ...DEFAULTS };
    this.#state = {
      config,
      cash: config.startingCashUsd,
      positions: {},
      trades: [],
      journal: [],
      day: emptyDay(),
      equity: [],
    };
    this.log("ok", "state reset", { cash: this.#state.cash });
    return this.save();
  }

  /* --------------------------------- logging -------------------------------- */
  log(level, message, meta) {
    this.#state.journal.push({ ts: now(), level, message, ...(meta ? { meta } : {}) });
    if (this.#state.journal.length > 300) this.#state.journal.splice(0, this.#state.journal.length - 300);
  }

  /* ------------------------------- accounting -------------------------------- */
  markToMarket(prices) {
    const day = emptyDay().date;
    if (this.#state.day.date !== day) this.#state.day = emptyDay();
    let holdings = 0;
    for (const [symbol, pos] of Object.entries(this.#state.positions)) {
      const mark = Number(prices[symbol]);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      pos.mark = mark;
      pos.valueUsd = money(pos.qty * mark);
      pos.unrealizedUsd = money(pos.qty * (mark - pos.avgPrice));
      holdings += pos.valueUsd;
    }
    const equity = money(this.#state.cash + holdings);
    this.#state.equity.push({ ts: now(), equity });
    if (this.#state.equity.length > 500) this.#state.equity.splice(0, this.#state.equity.length - 500);
    return equity;
  }

  equity(prices = {}) {
    let holdings = 0;
    for (const [symbol, p] of Object.entries(this.#state.positions)) {
      const mark = Number(prices[symbol]) || Number(p.mark) || Number(p.avgPrice) || 0;
      holdings += Number(p.qty) * mark;
    }
    return money(this.#state.cash + holdings);
  }

  summary(prices) {
    const positions = Object.entries(this.#state.positions).map(([symbol, p]) => ({ symbol, ...p }));
    const realized = this.#state.trades.reduce((sum, t) => sum + (t.realizedUsd || 0), 0);
    const fees = this.#state.trades.reduce((sum, t) => sum + (t.feeUsd || 0), 0);
    const unrealized = positions.reduce((sum, p) => sum + (p.unrealizedUsd || 0), 0);
    const wins = this.#state.trades.filter((t) => t.side === "sell" && (t.realizedUsd || 0) > 0).length;
    const closes = this.#state.trades.filter((t) => t.side === "sell").length;
    return {
      mode: this.#state.config.mode,
      running: this.#state.config.running,
      cashUsd: money(this.#state.cash),
      equityUsd: this.equity(prices),
      holdingsUsd: money(positions.reduce((s, p) => s + (p.valueUsd || 0), 0)),
      realizedUsd: money(realized),
      unrealizedUsd: money(unrealized),
      feesUsd: money(fees),
      dayRealizedUsd: money(this.#state.day.realizedUsd),
      ordersToday: this.#state.day.orders,
      blockedToday: this.#state.day.blocked,
      trades: this.#state.trades.length,
      winRate: closes ? Math.round((wins / closes) * 100) : null,
      positions,
    };
  }

  /* -------------------------------- risk gate ------------------------------- */
  // Returns { ok } or { ok: false, reason }. This is the only place real-money
  // limits are decided, so the AI loop and any manual caller share one gate.
  gate(decision, prices) {
    const c = this.#state.config;
    const symbol = String(decision.symbol || "").toUpperCase();
    const price = Number(prices[symbol]);

    if (!c.running) return { ok: false, reason: "agent is stopped", soft: true };
    if (!c.symbols.includes(symbol)) return { ok: false, reason: `${symbol} is not on the allowlist` };
    if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: `no live price for ${symbol}` };
    if (decision.action === "hold") return { ok: false, reason: "hold", soft: true };
    if (decision.action !== "buy" && decision.action !== "sell") return { ok: false, reason: "unknown action" };

    const confidence = Number(decision.confidence);
    if (!(confidence >= c.minConfidence)) return { ok: false, reason: `confidence ${confidence || 0} < ${c.minConfidence}` };

    const pos = this.#state.positions[symbol];
    if (decision.action === "buy") {
      if (this.#state.day.orders >= 30) return { ok: false, reason: "daily order count limit reached" };
      if (now() - this.#state.day.lastOrderAt < 15000) return { ok: false, reason: "order cooldown (15s)" };
      if (Object.keys(this.#state.positions).length >= c.maxPositions && !pos) {
        return { ok: false, reason: `already at maxPositions ${c.maxPositions}` };
      }
      const usd = money(Math.min(Number(decision.sizeUsd) || c.maxOrderUsd, c.maxOrderUsd));
      if (usd > this.#state.cash) return { ok: false, reason: "insufficient cash" };
      const drawdown = -(this.#state.day.realizedUsd + this.unrealized());
      if (drawdown >= c.dailyLossLimitUsd) {
        return { ok: false, reason: `daily loss limit ${c.dailyLossLimitUsd} USD hit — trading halted for today` };
      }
      return { ok: true, action: "buy", symbol, price, usd, qty: money(usd / price) };
    }
    if (!pos || pos.qty <= 0) return { ok: false, reason: `no open ${symbol} position to sell`, soft: true };
    const fraction = Math.min(Math.max(Number(decision.fraction) || 1, 0.05), 1);
    const qty = money(Math.min(pos.qty * fraction, pos.qty));
    return { ok: true, action: "sell", symbol, price, qty, usd: money(qty * price) };
  }

  unrealized() {
    return Object.values(this.#state.positions).reduce((s, p) => s + (p.unrealizedUsd || 0), 0);
  }

  dayOrders() {
    return this.#state.day.orders;
  }

  dayBlocked() {
    this.#state.day.blocked += 1;
  }

  /* -------------------------------- execution ------------------------------- */
  async execute(order) {
    const c = this.#state.config;
    const feeRate = c.feePct / 100;
    const slip = c.slippagePct / 100;

    let fillPrice = order.price;
    let filledUsd = order.usd;
    let filledQty = order.qty;
    let venue = "paper";
    let raw = null;

    if (c.mode !== "paper") {
      // testnet and live both send a real MARKET order; only the host differs.
      try {
        raw = order.action === "buy"
          ? await this.#binance.marketBuy(order.symbol, money(order.usd))
          : await this.#binance.marketSell(order.symbol, money(order.qty));
        filledQty = Number(raw.executedQty ?? raw.filledQty ?? order.qty);
        filledUsd = Number(raw.cummulativeQuoteQty ?? raw.quoteEvalQty ?? order.usd);
        fillPrice = filledQty > 0 ? filledUsd / filledQty : order.price;
        venue = c.mode;
      } catch (err) {
        this.log("err", `${order.symbol} ${order.action} rejected by ${c.mode}: ${err.message}`);
        return { ok: false, reason: `exchange rejected the order: ${err.message}` };
      }
    } else {
      fillPrice = order.action === "buy" ? fillPrice * (1 + slip) : fillPrice * (1 - slip);
      filledQty = money(order.action === "buy" ? order.usd / fillPrice : order.qty);
      filledUsd = money(filledQty * fillPrice);
    }

    const feeUsd = money(filledUsd * feeRate);
    const trade = {
      id: `${now()}-${order.symbol}-${order.action}`,
      ts: now(),
      symbol: order.symbol,
      side: order.action,
      venue,
      qty: money(filledQty),
      price: money(fillPrice),
      usd: money(filledUsd),
      feeUsd,
      confidence: money(order.confidence ?? 0),
      reason: String(order.reason || "").slice(0, 400),
      realizedUsd: 0,
      orderId: raw?.orderId ?? null,
    };

    // Position bookkeeping is identical for paper and real fills.
    if (order.action === "buy") {
      this.#state.cash = money(this.#state.cash - filledUsd - feeUsd);
      const pos = this.#state.positions[order.symbol] || { qty: 0, avgPrice: 0, openedAt: now() };
      const cost = pos.qty * pos.avgPrice + filledQty * fillPrice;
      pos.qty = money(pos.qty + filledQty);
      pos.avgPrice = pos.qty > 0 ? money(cost / pos.qty) : 0;
      this.#state.positions[order.symbol] = pos;
    } else {
      const pos = this.#state.positions[order.symbol];
      const realized = money(filledQty * (fillPrice - pos.avgPrice) - feeUsd);
      this.#state.cash = money(this.#state.cash + filledUsd - feeUsd);
      trade.realizedUsd = realized;
      pos.qty = money(pos.qty - filledQty);
      if (pos.qty <= 1e-9) delete this.#state.positions[order.symbol];
      else this.#state.positions[order.symbol] = pos;
      this.#state.day.realizedUsd = money(this.#state.day.realizedUsd + realized);
    }

    this.#state.trades.push(trade);
    if (this.#state.trades.length > 500) this.#state.trades.splice(0, this.#state.trades.length - 500);
    this.#state.day.orders += 1;
    this.#state.day.lastOrderAt = now();
    this.log(order.action === "buy" ? "trade" : "trade", `${venue} ${order.action} ${order.symbol} ${trade.qty} @ ${trade.price}`, { usd: trade.usd });
    await this.save();
    return { ok: true, trade };
  }

  /* ------------------------------- config edits ----------------------------- */
  configure(patch) {
    const c = this.#state.config;
    const next = { ...c };
    if (Array.isArray(patch.symbols)) next.symbols = [...new Set(patch.symbols.map((s) => String(s).toUpperCase().trim()).filter((s) => /^[A-Z0-9]{5,12}$/.test(s)))].slice(0, 12);
    if (patch.mode) {
      if (!["paper", "testnet", "live"].includes(patch.mode)) return { ok: false, error: "mode must be paper | testnet | live" };
      if (patch.mode !== "paper") {
        if (!this.#binance.hasKeys) return { ok: false, error: "no exchange keys configured" };
        if (patch.mode === "live" && patch.liveConfirmed !== true && !c.liveConfirmed) {
          return { ok: false, error: "live mode requires liveConfirmed: true" };
        }
      }
      next.mode = patch.mode;
    }
    if (patch.liveConfirmed === true) {
      if (!this.#binance.hasKeys) return { ok: false, error: "no exchange keys configured" };
      next.liveConfirmed = true;
    }
    if (patch.allowRuleFallback !== undefined) {
      next.allowRuleFallback = Boolean(patch.allowRuleFallback);
    }
    for (const key of ["intervalMs", "maxOrderUsd", "maxPositions", "dailyLossLimitUsd", "startingCashUsd", "minConfidence", "feePct", "slippagePct"]) {
      if (patch[key] !== undefined) {
        const v = Number(patch[key]);
        if (!Number.isFinite(v)) return { ok: false, error: `${key} must be a number` };
        next[key] = v;
      }
    }
    next.intervalMs = Math.max(15000, Math.min(3600000, Math.round(next.intervalMs)));
    next.maxOrderUsd = Math.max(1, Math.min(100000, next.maxOrderUsd));
    next.maxPositions = Math.max(1, Math.min(10, Math.round(next.maxPositions)));
    next.dailyLossLimitUsd = Math.max(1, next.dailyLossLimitUsd);
    next.minConfidence = Math.max(0, Math.min(1, next.minConfidence));
    next.feePct = Math.max(0, Math.min(2, next.feePct));
    next.slippagePct = Math.max(0, Math.min(5, next.slippagePct));
    this.#state.config = next;
    this.log("ok", `config updated`, { mode: next.mode, maxOrderUsd: next.maxOrderUsd, symbols: next.symbols });
    return { ok: true, config: next };
  }

  setRunning(running, note) {
    this.#state.config.running = Boolean(running);
    this.log(running ? "ok" : "warn", running ? "agent started" : "agent stopped", note ? { note } : undefined);
    if (running) this.#state.equity = [];
    return this.save();
  }

  positions() {
    return this.#state.positions;
  }

  trades() {
    return this.#state.trades;
  }

  equityCurve() {
    return this.#state.equity;
  }

  journal() {
    return this.#state.journal;
  }

  closeAll(prices) {
    return Object.keys(this.#state.positions).map((symbol) => ({
      action: "sell",
      symbol,
      fraction: 1,
      confidence: 1,
      reason: "manual close-all",
      price: Number(prices[symbol]),
    }));
  }
}

async function mkdirSafe(file) {
  await mkdir(dirname(file), { recursive: true });
}

export { DEFAULTS as AGENT_DEFAULTS };
