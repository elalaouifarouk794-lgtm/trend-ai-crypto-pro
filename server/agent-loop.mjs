// The autonomous loop: market snapshot -> indicators -> model decision ->
// risk gate -> execution.
//
// The model never sees keys, never sizes itself beyond the gate's limits, and
// its reply is parsed as JSON before anything is trusted. In `paper` mode a
// missing/failed model call may fall back to the same rule set that produced
// the snapshot; in testnet/live that fallback is refused, because guessing on
// someone's real money is not a fallback.

function ema(values, period) {
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / period / (loss / period);
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

// Binance kline row: [openTime, open, high, low, close, volume, ...]
export function analyze(symbol, klines) {
  const closes = klines.map((k) => Number(k[4]));
  const highs = klines.map((k) => Number(k[2]));
  const lows = klines.map((k) => Number(k[3]));
  const price = closes[closes.length - 1];
  const last24 = closes.slice(-24);
  return {
    symbol,
    price,
    change1h: ((price - closes[closes.length - 2]) / closes[closes.length - 2]) * 100,
    change24h: ((price - closes[closes.length - 25]) / closes[closes.length - 25]) * 100,
    rsi14: rsi(closes),
    ema12: ema(closes, 12),
    ema26: ema(closes, 26),
    high24: Math.max(...last24),
    low24: Math.min(...lows.slice(-24)),
    rangePosition: price > 0 ? (price - Math.min(...last24)) / (Math.max(...last24) - Math.min(...last24) || 1) : 0,
    bars: closes.length,
  };
}

// Deterministic mirror of what the prompt asks the model for, used to (a) seed
// paper mode when no model is configured and (b) sanity-check a wild reply.
export function ruleDecision(snapshot, position, cfg) {
  const r = snapshot.rsi14 ?? 50;
  const momentum = snapshot.ema12 > snapshot.ema26 ? 1 : -1;
  if (position) {
    if (r > 72 || momentum < 0 || snapshot.rangePosition > 0.92) {
      return { action: "sell", symbol: snapshot.symbol, fraction: 1, confidence: 0.7, reason: `rule: RSI ${r}, momentum ${momentum}, range pos ${snapshot.rangePosition.toFixed(2)}` };
    }
    return { action: "hold", symbol: snapshot.symbol, confidence: 0.5, reason: "rule: holding" };
  }
  if (momentum > 0 && r < 45 && snapshot.change24h < 0) {
    return { action: "buy", symbol: snapshot.symbol, sizeUsd: cfg.maxOrderUsd, confidence: 0.65, reason: `rule: oversold-with-momentum (RSI ${r}, 24h ${snapshot.change24h.toFixed(2)}%)` };
  }
  return { action: "hold", symbol: snapshot.symbol, confidence: 0.4, reason: "rule: no setup" };
}

const DECISION_SCHEMA = [
  "Respond with a single JSON object and nothing else:",
  '{"action":"buy"|"sell"|"hold","symbol":"BTCUSDT","sizeUsd":number|null,"fraction":number|null,"confidence":0..1,"reason":"one sentence"}',
].join(" ");

function systemPrompt(cfg) {
  return [
    "You are the decision engine of a crypto spot trading agent. Spot only, long only, MARKET orders.",
    "You receive computed market snapshots, current positions and hard risk limits.",
    DECISION_SCHEMA,
    "Rules:",
    "- Only trade symbols that appear in the snapshot list.",
    "- sizeUsd must never exceed maxOrderUsd; sell takes fraction (0..1) of the open position.",
    "- Use hold unless you have a specific, data-grounded reason. Prefer fewer, better trades.",
    "- confidence must reflect the evidence, not conviction. Below minConfidence the order is discarded.",
    "- You cannot place, size or cancel orders yourself; the server enforces limits.",
    "- Never respond with prose, markdown fences or more than one object.",
    `- Limits: maxOrderUsd=${cfg.maxOrderUsd}, maxPositions=${cfg.maxPositions}, minConfidence=${cfg.minConfidence}, dailyLossLimitUsd=${cfg.dailyLossLimitUsd}.`,
  ].join("\n");
}

function userPrompt(snapshots, positions, account, cfg) {
  const lines = snapshots.map((s) =>
    `${s.symbol} price=${s.price.toFixed(4)} 1h=${s.change1h.toFixed(2)}% 24h=${s.change24h.toFixed(2)}% rsi14=${s.rsi14} ema12=${s.ema12.toFixed(4)} ema26=${s.ema26.toFixed(4)} rangePos=${s.rangePosition.toFixed(2)}`
  );
  const held = Object.entries(positions).map(([sym, p]) => `${sym} qty=${p.qty} avg=${p.avgPrice} unrealized=${(p.unrealizedUsd ?? 0).toFixed(2)}`);
  return [
    `SNAPSHOTS\n${lines.join("\n")}`,
    `POSITIONS\n${held.length ? held.join("\n") : "none"}`,
    `ACCOUNT cash=${account.cashUsd} equity=${account.equityUsd} dayRealized=${account.dayRealizedUsd} tradesToday=${account.ordersToday} allowlist=${cfg.symbols.join(",")}`,
    "Choose the single best action for the next 60 minutes, or hold.",
  ].join("\n\n");
}

function parseDecision(text) {
  const match = /\{[\s\S]*\}/.exec(text || "");
  if (!match) return null;
  let obj;
  try { obj = JSON.parse(match[0]); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const action = String(obj.action || "").toLowerCase();
  if (!["buy", "sell", "hold"].includes(action)) return null;
  return {
    action,
    symbol: String(obj.symbol || "").toUpperCase(),
    sizeUsd: Number.isFinite(Number(obj.sizeUsd)) ? Number(obj.sizeUsd) : null,
    fraction: Number.isFinite(Number(obj.fraction)) ? Number(obj.fraction) : null,
    confidence: Number.isFinite(Number(obj.confidence)) ? Math.max(0, Math.min(1, Number(obj.confidence))) : 0,
    reason: String(obj.reason || "").slice(0, 300),
  };
}

export function createAgentLoop({ engine, binance, ai, onComplete }) {
  let timer = null;
  let busy = false;
  let lastTick = null;

  async function snapshot() {
    const symbols = engine.config.symbols;
    const rows = await Promise.all(symbols.map((s) => binance.klines(s, "1h", 120).catch(() => null)));
    const snaps = [];
    const dropped = [];
    symbols.forEach((symbol, i) => {
      const k = rows[i];
      if (k && k.length > 30) snaps.push(analyze(symbol, k));
      else dropped.push(symbol);
    });
    const prices = {};
    for (const s of snaps) prices[s.symbol] = s.price;
    return { snaps, prices, dropped };
  }

  // One cycle, also callable directly (used by the "evaluate now" endpoint and tests).
  async function tick() {
    if (busy) return { skipped: "previous cycle still running" };
    busy = true;
    const startedAt = Date.now();
    try {
      const { snaps, prices, dropped } = await snapshot();
      const equity = engine.markToMarket(prices);
      if (dropped.length) engine.log("warn", `no data for ${dropped.join(", ")}`);

      const cfg = engine.config;
      if (!cfg.symbols.length || !snaps.length) {
        engine.log("warn", "allowlist is empty or has no data — nothing to evaluate");
        await engine.save();
        return { ok: true, decided: null, prices, equity };
      }

      let decision = null;
      let source = "ai";
      if (ai.configured) {
        try {
          const text = await ai.complete(
            [
              { role: "system", content: systemPrompt(cfg) },
              { role: "user", content: userPrompt(snaps, engine.positions(), engine.summary(prices), cfg) },
            ],
            { temperature: 0.2, maxTokens: 220 }
          );
          decision = parseDecision(text);
          if (!decision) engine.log("warn", "model reply was not valid JSON — ignoring this cycle");
        } catch (err) {
          engine.log("warn", `model call failed: ${err.message}`);
        }
      } else if (cfg.mode === "paper" && cfg.allowRuleFallback) {
        source = "rule";
        engine.log("info", "AI provider not configured — paper mode is using the rule engine");
      } else {
        engine.log("warn", "AI provider not configured; refusing to trade without a model decision");
        await engine.save();
        return { ok: false, error: "ai not configured", prices, equity };
      }

      if (!decision) {
        if (source !== "rule") return { ok: false, error: "no decision", prices, equity };
        const ranked = snaps
          .map((s) => ruleDecision(s, engine.positions()[s.symbol], cfg))
          .filter((d) => d.action !== "hold")
          .sort((a, b) => b.confidence - a.confidence);
        decision = ranked[0] || { action: "hold", symbol: snaps[0].symbol, confidence: 0.4, reason: "rule: nothing actionable" };
      }

      // The model may name a symbol it should not touch; the gate will reject it,
      // but clamp the size first so a hallucinated number cannot reach the venue.
      if (decision.action === "buy") decision.sizeUsd = Math.min(Number(decision.sizeUsd) || cfg.maxOrderUsd, cfg.maxOrderUsd);
      decision.price = prices[decision.symbol];
      decision.confidence = decision.confidence ?? 0;

      const verdict = engine.gate(decision, prices);
      lastTick = { ts: Date.now(), source, decision, verdict, symbols: snaps.length, ms: Date.now() - startedAt };
      if (!verdict.ok) {
        if (!verdict.soft) {
          engine.log("block", `${decision.action} ${decision.symbol} blocked: ${verdict.reason}`, { confidence: decision.confidence });
          engine.dayBlocked();
        }
        await engine.save();
        return { ok: true, decided: decision, blocked: verdict.reason, prices, equity };
      }
      const result = await engine.execute({ ...decision, ...verdict, confidence: decision.confidence, reason: `[${source}] ${decision.reason}` });
      onComplete?.(result);
      return { ok: true, decided: decision, trade: result.trade || null, blocked: result.reason || null, prices, equity };
    } catch (err) {
      engine.log("err", `cycle failed: ${err.message}`);
      lastTick = { ts: Date.now(), error: err.message };
      return { ok: false, error: err.message };
    } finally {
      busy = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!engine.config.running) return;
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, engine.config.intervalMs);
  }

  return {
    tick,
    start() {
      schedule();
      return tick();
    },
    stop() {
      clearTimeout(timer);
      timer = null;
    },
    get status() {
      return { running: engine.config.running && Boolean(timer), lastTick, intervalMs: engine.config.intervalMs };
    },
  };
}
