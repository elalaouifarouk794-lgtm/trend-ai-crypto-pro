// Shared assistant brain: tries the server-side AI endpoint first and falls
// back to the deterministic local analysis engine when it is unavailable.
// All market data is public and key-free; the AI key lives only on the server.

import { store } from "./state.js";
import { fetchMarketChart } from "./api.js";
import { analyzeCoin, marketOverview, momentumScore, scoreLabel } from "./analysis.js";
import { fmtUsd, fmtPct, fmtCompact } from "./utils.js";

/* ------------------------------------------------------------------ */
/* Server call                                                         */
/* ------------------------------------------------------------------ */

let serverAiState = "unknown"; // unknown | ready | off
export async function serverAiReady() {
  if (serverAiState !== "unknown") return serverAiState === "ready";
  try {
    const res = await fetch("/api/health");
    const data = await res.json().catch(() => ({}));
    serverAiState = res.ok && data.aiConfigured ? "ready" : "off";
  } catch {
    serverAiState = "off";
  }
  return serverAiState === "ready";
}

export async function askServer(messages, context) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Chat endpoint returned ${res.status}`);
    err.fallback = !!data.fallback;
    if (res.status === 503) serverAiState = "off";
    throw err;
  }
  return data.reply;
}

export function marketBrief() {
  const top = store.coins.slice(0, 12).map((c) =>
    `${c.symbol.toUpperCase()} ${fmtUsd(c.current_price)} (24h ${fmtPct(c.price_change_percentage_24h_in_currency)}, 7d ${fmtPct(c.price_change_percentage_7d_in_currency)})`);
  const ov = marketOverview(store.coins, store.global, store.fng);
  return [
    "MARKET CONTEXT (live snapshot, USD):",
    `Mode: ${store.apiMode === "live" ? "live data" : "demo data"}`,
    `Total cap ${fmtCompact(ov?.totalCap ?? null)}, 24h vol ${fmtCompact(store.global?.total_volume?.usd ?? null)}, BTC dominance ${ov?.dominanceBtc ? ov.dominanceBtc.toFixed(1) + "%" : "n/a"}, regime ${ov?.regime ?? "n/a"}, Fear&Greed ${ov?.fng ?? "n/a"} (${ov?.fngLabel ?? "n/a"}), breadth ${ov?.advancers ?? 0}/${(ov?.advancers ?? 0) + (ov?.decliners ?? 0)} advancing.`,
    `Top assets: ${top.join(" | ")}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Local fallback engine (no network required)                         */
/* ------------------------------------------------------------------ */

function matchCoin(text) {
  return store.coins.find((c) =>
    text.includes(c.name.toLowerCase()) ||
    new RegExp(`\\b${c.symbol.toLowerCase()}\\b`).test(text)) || null;
}

async function localCoinReport(coin) {
  let series = [];
  try {
    const chart = await fetchMarketChart(coin.id, 30);
    series = chart.prices.map(([, p]) => p);
  } catch { /* use sparkline inside analyzeCoin */ }
  return analyzeCoin(coin, series).report;
}

function localMarketAnswer() {
  const ov = marketOverview(store.coins, store.global, store.fng);
  if (!ov) return "The market cache is empty right now — hit the refresh button in the top bar first.";
  return [
    `### Market Overview — ${ov.regime} regime`,
    `- Total market cap: **${fmtCompact(ov.totalCap)}** (${fmtPct(store.global?.market_cap_change_percentage_24h_usd)} in 24h)`,
    `- Breadth: ${ov.advancers} advancing vs ${ov.decliners} declining (${ov.breadthPct.toFixed(0)}% green).`,
    `- BTC dominance: ${ov.dominanceBtc ? ov.dominanceBtc.toFixed(1) + "%" : "—"} · Fear & Greed: ${ov.fng ?? "—"} (${ov.fngLabel}).`,
    "",
    "#### Reading it",
    ov.regime === "Risk-on"
      ? "- Broad positive breadth plus rising majors suggests trend participation. Watch whether BTC dominance keeps climbing while alt breadth fades."
      : ov.regime === "Risk-off"
        ? "- Negative breadth often precedes deeper corrections as liquidity thins. Measure participation, not just price."
        : "- Mixed signals mean chop: moving averages flatten and whipsaw, which is why systematic strategies often reduce size.",
    "",
    "_Heuristic summary of public data, not advice._",
  ].join("\n");
}

function localCompare() {
  const btc = store.coinById("bitcoin"), eth = store.coinById("ethereum");
  if (!btc || !eth) return "BTC or ETH is missing from the current snapshot.";
  const sb = momentumScore(btc, btc.sparkline_in_7d?.price ?? []);
  const se = momentumScore(eth, eth.sparkline_in_7d?.price ?? []);
  return [
    "### BTC vs ETH momentum",
    `- **24h**: ${fmtPct(btc.price_change_percentage_24h_in_currency)} vs ${fmtPct(eth.price_change_percentage_24h_in_currency)}`,
    `- **7d**: ${fmtPct(btc.price_change_percentage_7d_in_currency)} vs ${fmtPct(eth.price_change_percentage_7d_in_currency)}`,
    `- **Momentum score**: ${sb} (${scoreLabel(sb).text}) vs ${se} (${scoreLabel(se).text})`,
    `- **ETH/BTC ratio**: ${(eth.current_price / btc.current_price).toFixed(5)}`,
    "",
    sb > se ? "- ETH carries stronger short-term momentum; watch whether breadth confirms the rotation."
      : se > sb ? "- BTC carries stronger short-term momentum; a BTC-led rally often means alts lag."
        : "- The majors are moving together — a market-wide move rather than a rotation.",
    "",
    "_Educational comparison only._",
  ].join("\n");
}

function localWatchlist() {
  if (!store.watchlist.length) return "Your watchlist is empty — star a coin in Live Market first, then ask again.";
  const rows = store.watchlist.map((id) => store.coinById(id)).filter(Boolean);
  if (!rows.length) return "None of your watchlisted coins are in the current top-100 snapshot yet.";
  return [
    "### Watchlist scan",
    ...rows.map((c) => {
      const s = momentumScore(c, c.sparkline_in_7d?.price ?? []);
      const l = scoreLabel(s);
      return `- **${c.symbol.toUpperCase()}** ${fmtUsd(c.current_price)} · 24h ${fmtPct(c.price_change_percentage_24h_in_currency)} · ${l.text} (${s})`;
    }),
    "",
    "Momentum blends 1h/24h/7d returns with RSI and trend position — a checklist prompt, not a trade trigger.",
  ].join("\n");
}

const CONCEPTS = [
  [/rsi/, "**RSI (Relative Strength Index)**\n\nRSI(14) measures the share of recent gains vs losses on a 0–100 scale.\n- Above ~70: buyers stretched — strong trends stay overbought.\n- Below ~30: sellers stretched; mean-reversion traders watch for a reclaim.\n- Best used with trend regime, volume and higher-timeframe context."],
  [/dominan/, "**Bitcoin dominance**\n\nBTC's share of total market cap.\n- Rising dominance + rising BTC: capital prefers the safest crypto asset.\n- Falling dominance + rising total cap: rotation into altcoins.\n- It is a ratio — it can fall simply because large caps outgrow it."],
  [/liquidity/, "**Liquidity**\n\nHow easily an asset trades without moving its price.\n- Measured via order-book depth and 24h volume vs market cap.\n- Thin liquidity → slippage and flash moves; deep liquidity → smoother trends.\n- The paper simulator models a 0.1% fee; real markets add slippage."],
  [/volatil/, "**Volatility**\n\nThe magnitude of price swings over a window.\n- Higher volatility → wider expected ranges → smaller size for equal risk.\n- Crypto vol clusters: quiet periods precede and follow violent expansion.\n- Compare regimes by volatility instead of forecasting it."],
  [/paper|simulat/, "**Paper trading**\n\nSimulated fills against live reference prices with virtual funds.\n- Practice order sizing, journaling and risk rules with zero capital at risk.\n- Fills assume instant execution — real markets have slippage and queues.\n- The simulator starts at $10,000 virtual USD with a 0.1% fee model."],
  [/halving/, "**Bitcoin halving**\n\nMiner issuance halves roughly every 210,000 blocks (~4 years).\n- A supply-side event: new issuance steps down (e.g. 6.25 → 3.125 BTC/block).\n- Past cycles mixed supply shocks with demand changes; history is not a forecast.\n- Frame it as reduced miner sell-pressure, not a magic trigger."],
  [/dca|dollar.?cost/, "**Dollar-cost averaging (DCA)**\n\nFixed-amount purchases on a schedule regardless of price.\n- Reduces timing regret and averages entries.\n- Does not protect against a permanently declining asset.\n- Test DCA vs lump-sum in the paper simulator with identical funds."],
];

export async function answerLocally(question) {
  const lower = question.toLowerCase();
  if (/what is|what does|explain|define/.test(lower) && !matchCoin(lower)) {
    for (const [re, txt] of CONCEPTS) if (re.test(lower)) return txt + "\n\nAsk about a coin for a live example.";
    return "I can explain **RSI**, **dominance**, **liquidity**, **volatility**, **halving**, **DCA** and **paper trading** — or analyze any tracked coin.";
  }
  if (/market|overall|regime|breadth|sentiment/.test(lower) && !matchCoin(lower)) return localMarketAnswer();
  if (/compare|vs\b|versus/.test(lower)) return localCompare();
  if (/watchlist/.test(lower)) return localWatchlist();
  const coin = matchCoin(lower);
  if (coin) return localCoinReport(coin);
  return `I could not map “${question}” to a coin, the market overview, or a concept.\n\nTry: **Analyze Bitcoin**, **How is the market?**, **Compare BTC vs ETH**, **Scan my watchlist**, or **What is RSI?**`;
}

/* ------------------------------------------------------------------ */
/* Unified ask: server first, local fallback                           */
/* ------------------------------------------------------------------ */

export async function askAssistant(history) {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (!lastUser) throw new Error("No user message.");
  const local = () => answerLocally(lastUser.content);
  if (!(await serverAiReady())) return { reply: await local(), source: "local", reason: "AI endpoint not configured" };
  try {
    const reply = await askServer(history, marketBrief());
    return { reply, source: "ai" };
  } catch (err) {
    return { reply: await local(), source: "local", reason: err.message };
  }
}
