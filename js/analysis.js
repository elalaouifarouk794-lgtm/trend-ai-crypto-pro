// Deterministic indicator engine powering the AI Copilot, scanner and signals.
// Educational heuristics — explicitly not financial advice.

import { fmtUsd, fmtPct } from "./utils.js";

export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / period / (loss / period);
  return 100 - 100 / (1 + rs);
}

export function volatilityPct(values, period = 24) {
  if (values.length < 2) return null;
  const slice = values.slice(-period);
  const rets = [];
  for (let i = 1; i < slice.length; i++) rets.push((slice[i] - slice[i - 1]) / slice[i - 1]);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * 100 * Math.sqrt(rets.length || 1);
}

export function supportResistance(values) {
  if (!values?.length) return { support: null, resistance: null };
  const sorted = [...values];
  return {
    support: Math.min(...sorted),
    resistance: Math.max(...sorted),
  };
}

/** Score a coin on -100..100 using price structure + published changes. */
export function momentumScore(coin, series = []) {
  let score = 0;
  const p1h = coin.price_change_percentage_1h_in_currency ?? 0;
  const p24 = coin.price_change_percentage_24h_in_currency ?? 0;
  const p7d = coin.price_change_percentage_7d_in_currency ?? 0;
  score += Math.max(-20, Math.min(20, p1h * 4));
  score += Math.max(-35, Math.min(35, p24 * 1.4));
  score += Math.max(-30, Math.min(30, p7d * 0.8));
  if (series.length > 14) {
    const r = rsi(series);
    if (r != null) score += (r - 50) * 0.3;
    const fast = sma(series, Math.max(2, Math.floor(series.length * 0.1)));
    const slow = sma(series, Math.max(4, Math.floor(series.length * 0.4)));
    if (fast && slow) score += fast > slow ? 8 : -8;
  }
  return Math.round(Math.max(-100, Math.min(100, score)));
}

export function scoreLabel(score) {
  if (score >= 35) return { text: "Bullish", cls: "score-bullish" };
  if (score <= -35) return { text: "Bearish", cls: "score-bearish" };
  return { text: "Neutral", cls: "score-neutral" };
}

/** Build a structured, educational analysis report for one coin. */
export function analyzeCoin(coin, series = []) {
  const prices = series.length ? series : (coin.sparkline_in_7d?.price ?? []);
  const score = momentumScore(coin, prices);
  const { text, cls } = scoreLabel(score);
  const r = rsi(prices);
  const vol = volatilityPct(prices);
  const { support, resistance } = supportResistance(prices.slice(-72));
  const ma24 = sma(prices, Math.max(2, Math.floor(prices.length * 0.25)));
  const aboveMa = ma24 ? coin.current_price > ma24 : null;

  const bias = score >= 35
    ? "Momentum indicators lean positive over the recent window."
    : score <= -35
      ? "Momentum indicators lean negative over the recent window."
      : "Indicators are mixed; the market is consolidating.";

  const lines = [];
  lines.push(`### ${coin.name} (${coin.symbol.toUpperCase()}) — ${text} tilt (score ${score}/100)`);
  lines.push(bias);
  lines.push("");
  lines.push("#### Snapshot");
  lines.push(`- Price: ${fmtUsd(coin.current_price)} · 24h ${fmtPct(coin.price_change_percentage_24h_in_currency)} · 7d ${fmtPct(coin.price_change_percentage_7d_in_currency)}`);
  if (r != null) lines.push(`- RSI(14) on 7d hourly data: ${r.toFixed(1)} ${r > 70 ? "(stretched to the upside)" : r < 30 ? "(deeply oversold area)" : "(neutral band)"}`);
  if (vol != null) lines.push(`- Recent volatility: ~${vol.toFixed(2)}% per-bar range — ${vol > 3 ? "high" : vol > 1.2 ? "moderate" : "low"} for crypto.`);
  if (aboveMa != null) lines.push(`- Price is ${aboveMa ? "above" : "below"} its short-term average — ${aboveMa ? "buyer control" : "seller control"} in the recent trend.`);
  if (support != null) lines.push(`- 72h observed range: support near ${fmtUsd(support)}, resistance near ${fmtUsd(resistance)}.`);
  lines.push("");
  lines.push("#### What this means (education)");
  lines.push(`- ${coin.name} ranks #${coin.market_cap_rank ?? "—"} by market cap; liquidity ${coin.total_volume > 1e9 ? "is deep" : "is thinner"}, so moves can gap.`);
  lines.push("- Momentum scores blend 1h/24h/7d returns with RSI and trend position; they describe the past, they do not predict the future.");
  lines.push("- Never size a trade from one indicator alone — confirm with volume, broader market direction and risk limits.");
  lines.push("");
  lines.push("_This is an automated educational analysis, not financial advice._");
  return { score, label: text, cls, report: lines.join("\n") };
}

/** Global market structure summary used by the dashboard and copilot. */
export function marketOverview(coins, global, fng) {
  if (!coins.length) return null;
  const advancers = coins.filter((c) => (c.price_change_percentage_24h_in_currency ?? 0) > 0).length;
  const decliners = coins.length - advancers;
  const breadthPct = (advancers / coins.length) * 100;
  const btc = coins.find((c) => c.id === "bitcoin");
  const eth = coins.find((c) => c.id === "ethereum");
  const avg = coins.reduce((a, c) => a + (c.price_change_percentage_24h_in_currency ?? 0), 0) / coins.length;
  const regime = avg > 1.5 ? "Risk-on" : avg < -1.5 ? "Risk-off" : "Neutral";
  return {
    advancers, decliners, breadthPct, btc, eth, avg, regime,
    totalCap: global?.total_market_cap?.usd ?? null,
    dominanceBtc: global?.market_cap_percentage?.btc ?? null,
    fng: fng?.value ?? null,
    fngLabel: fng?.classification ?? "—",
  };
}
