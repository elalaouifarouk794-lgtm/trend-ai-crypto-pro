// AI Crypto Copilot: rule-based educational analysis assistant.
// Deterministic, runs fully in-browser from live market data — no real-money
// advice, no execution, teaching-focused.

import { store } from "../state.js";
import { fetchMarketChart, fetchMarkets } from "../api.js";
import { analyzeCoin, marketOverview, momentumScore, scoreLabel } from "../analysis.js";
import { renderMiniMd, fmtUsd, fmtPct, fmtCompact } from "../utils.js";
import { toast } from "../toast.js";

const SUGGESTIONS = [
  "Analyze Bitcoin",
  "How is the overall market right now?",
  "Compare BTC vs ETH",
  "What is RSI?",
  "Scan my watchlist",
  "Explain market dominance",
];

const chat = []; // { role: "user"|"ai", text }

export async function render(root) {
  if (!store.coins.length) await fetchMarkets().catch(() => {});

  root.innerHTML = `
    <div class="card" style="height:100%">
      <div class="card-head">
        <span class="card-title">AI Crypto Copilot<span class="sub">educational market analysis — not financial advice</span></span>
        <span class="card-actions">
          <button class="btn btn-sm" id="cop-clear">New session</button>
        </span>
      </div>
      <div class="chat-wrap">
        <div class="chat-log" id="chat-log"></div>
        <div class="suggest-row" id="suggest-row">
          ${SUGGESTIONS.map((s) => `<button class="suggest-chip">${s}</button>`).join("")}
        </div>
        <div class="chat-input">
          <input class="input" id="cop-input" placeholder="Ask about a coin, the market, or a concept… (e.g. “analyze solana”)" aria-label="Ask the AI copilot">
          <button class="btn btn-primary" id="cop-send">Ask</button>
        </div>
      </div>
    </div>`;

  const log = root.querySelector("#chat-log");
  const input = root.querySelector("#cop-input");

  function paintLog() {
    if (!chat.length) {
      chat.push({
        role: "ai",
        text: "Welcome to the **TREND AI Copilot**. I read live market data and explain what technical signals are suggesting — purely for education.\n\nTry asking about a coin, the market regime, or concepts like RSI, dominance and liquidity.",
      });
    }
    log.innerHTML = chat.map((m) => `
      <div class="msg ${m.role}">
        <div class="avatar">${m.role === "ai" ? "AI" : "ME"}</div>
        <div class="bubble">${m.role === "ai" ? renderMiniMd(m.text) : escapeHtml(m.text)}</div>
      </div>`).join("");
    log.scrollTop = log.scrollHeight;
  }

  function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function showTyping() {
    const t = document.createElement("div");
    t.className = "msg ai"; t.id = "typing";
    t.innerHTML = '<div class="avatar">AI</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
    log.append(t); log.scrollTop = log.scrollHeight;
    return t;
  }

  async function ask(q) {
    q = q.trim();
    if (!q) return;
    chat.push({ role: "user", text: q });
    paintLog();
    const typing = showTyping();
    const delay = 500 + Math.random() * 500;
    try {
      const answer = await route(q);
      await new Promise((r) => setTimeout(r, Math.max(0, delay - 300)));
      typing.remove();
      chat.push({ role: "ai", text: answer });
    } catch (err) {
      typing.remove();
      chat.push({ role: "ai", text: `I could not complete that analysis: ${err.message}\n\nCheck the data feed status in the sidebar and try again.` });
    }
    paintLog();
  }

  async function route(q) {
    const lower = q.toLowerCase();

    // concept questions
    if (/what is|what does|explain|define/.test(lower) && !matchCoin(lower)) {
      return conceptAnswer(lower);
    }
    if (/market|overall|regime|breadth|sentiment/.test(lower) && !matchCoin(lower)) {
      return marketAnswer();
    }
    if (/compare|vs\b|versus/.test(lower)) {
      const btc = store.coinById("bitcoin"), eth = store.coinById("ethereum");
      if (btc && eth) return compareAnswer(btc, eth);
    }
    if (/watchlist/.test(lower)) return watchlistAnswer();

    const coin = matchCoin(lower);
    if (coin) {
      // enrich with a longer series when available
      let series = [];
      try {
        const chart = await fetchMarketChart(coin.id, 30);
        series = chart.prices.map(([, p]) => p);
      } catch { /* fall back to sparkline inside analyzeCoin */ }
      return analyzeCoin(coin, series).report;
    }
    return `I could not map “${q}” to a coin, the market overview, or a concept.\n\nTry: **Analyze Bitcoin**, **How is the market?**, **Compare BTC vs ETH**, **Scan my watchlist**, or **What is RSI?**`;
  }

  function matchCoin(text) {
    return store.coins.find((c) =>
      text.includes(c.name.toLowerCase()) ||
      new RegExp(`\\b${c.symbol.toLowerCase()}\\b`).test(text)) || null;
  }

  function marketAnswer() {
    const ov = marketOverview(store.coins, store.global, store.fng);
    if (!ov) return "The market cache is empty right now — hit the refresh button in the top bar first.";
    return [
      `### Market Overview — ${ov.regime} regime`,
      `- Total market cap: **${fmtCompact(ov.totalCap)}** (${fmtPct(store.global?.market_cap_change_percentage_24h_usd)} in 24h)`,
      `- Breadth: ${ov.advancers} advancing vs ${ov.decliners} declining across ${store.coins.length} tracked assets (${ov.breadthPct.toFixed(0)}% green).`,
      `- BTC dominance: ${ov.dominanceBtc ? ov.dominanceBtc.toFixed(1) + "%" : "—"} · Fear & Greed index: ${ov.fng ?? "—"} (${ov.fngLabel}).`,
      `- Average 24h move of tracked assets: ${fmtPct(ov.avg)}.`,
      "",
      "#### Reading it",
      ov.regime === "Risk-on"
        ? "- Broad positive breadth plus rising majors suggests trend participation. Watch for dominance: if BTC leads while alt breadth fades, flows are concentrating."
        : ov.regime === "Risk-off"
          ? "- Negative breadth usually precedes deeper corrections in crypto because liquidity provision thins out. Educational takeaway: measure participation, not just price."
          : "- Mixed signals mean chop. Indicators like moving averages flatten and whipsaw — a reason many systematic strategies reduce size in neutral regimes.",
      "",
      "_Heuristic summary of public data, not advice._",
    ].join("\n");
  }

  function compareAnswer(btc, eth) {
    const sb = momentumScore(btc, btc.sparkline_in_7d?.price ?? []);
    const se = momentumScore(eth, eth.sparkline_in_7d?.price ?? []);
    return [
      "### BTC vs ETH momentum",
      `- **24h**: ${fmtPct(btc.price_change_percentage_24h_in_currency)} vs ${fmtPct(eth.price_change_percentage_24h_in_currency)}`,
      `- **7d**: ${fmtPct(btc.price_change_percentage_7d_in_currency)} vs ${fmtPct(eth.price_change_percentage_7d_in_currency)}`,
      `- **Momentum score**: ${sb} (${scoreLabel(sb).text}) vs ${se} (${scoreLabel(se).text})`,
      `- **ETH/BTC ratio**: ${(eth.current_price / btc.current_price).toFixed(5)} (how much BTC one ETH buys)`,
      "",
      sb > se
        ? "- ETH currently carries stronger short-term momentum; historically leaders rotate, so track whether breadth confirms."
        : se > sb
          ? "- BTC carries stronger short-term momentum; a BTC-led rally often means alts lag."
          : "- The two majors are moving together — a market-wide move rather than a rotation.",
      "",
      "_Educational comparison only._",
    ].join("\n");
  }

  function watchlistAnswer() {
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
      "Momentum blends 1h/24h/7d returns with RSI and trend position. Use it as a checklist prompt, not a trade trigger.",
    ].join("\n");
  }

  function conceptAnswer(q) {
    const map = [
      [/rsi/, "**RSI (Relative Strength Index)**\n\nRSI(14) measures the share of recent gains vs losses on a 0–100 scale.\n- Above ~70: buyers stretched — not a sell signal by itself, strong trends stay overbought.\n- Below ~30: sellers stretched; mean-reversion traders watch for reclaim of the level.\n- Best used with context: trend regime, volume and higher-timeframe structure."],
      [/dominance|dominan/, "**Bitcoin dominance**\n\nThe share of total market cap held by BTC.\n- Rising dominance + rising BTC price: capital prefers the safest crypto asset.\n- Falling dominance + rising total cap: rotation into altcoins (an “alt season” signal).\n- It is a ratio — it can fall simply because ETH or large caps outgrow it."],
      [/liquidity/, "**Liquidity**\n\nHow easily an asset can be bought or sold without moving its price.\n- Measured via order-book depth and 24h volume vs market cap.\n- Thin liquidity → larger slippage and flash moves; deep liquidity → smoother trends.\n- In paper trading, always model slippage and fees (this app simulates a 0.1% fee)."],
      [/volatil/, "**Volatility**\n\nThe magnitude of price swings over a window.\n- High volatility → wider expected ranges, smaller position sizes for equal risk.\n- Crypto vol clusters: quiet periods precede and follow violent expansion.\n- Compare volatility across regimes instead of trying to forecast it."],
      [/paper|simulat/, "**Paper trading**\n\nExecuting simulated fills against live market prices with virtual funds.\n- Purpose: practice order sizing, journaling and risk rules with zero capital at risk.\n- Limitation: fills assume instant execution at the reference price — real markets have slippage and queues.\n- This app starts you with $10,000 virtual USD and a 0.1% simulated fee."],
      [/halving/, "**Bitcoin halving**\n\nBitcoins issued to miners halves roughly every 210,000 blocks (~4 years).\n- Supply-side event: new issuance drops from e.g. 6.25 → 3.125 BTC per block.\n- Past cycles showed supply shocks meeting demand changes, but history is not a forecast.\n- Educational framing: reduced sell-pressure from miners, not a magic price trigger."],
      [/dca|dollar.?cost/, "**Dollar-cost averaging (DCA)**\n\nFixed-amount purchases on a schedule regardless of price.\n- Reduces timing regret and averages entry price.\n- Does not protect against a permanently declining asset — it only spreads entries.\n- Compare DCA vs lump-sum in the paper simulator with identical virtual funds."],
    ];
    for (const [re, txt] of map) if (re.test(q)) return txt + "\n\nAsk a follow-up with the coin name for a live example.";
    return "I can explain **RSI**, **dominance**, **liquidity**, **volatility**, **halving**, **DCA** and **paper trading** — or analyze any tracked coin. Which one interests you?";
  }

  paintLog();
  root.querySelector("#cop-send").addEventListener("click", () => { ask(input.value); input.value = ""; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { ask(input.value); input.value = ""; } });
  root.querySelectorAll(".suggest-chip").forEach((b) => b.addEventListener("click", () => ask(b.textContent)));
  root.querySelector("#cop-clear").addEventListener("click", () => {
    chat.length = 0; paintLog(); toast("Copilot session reset.", "ok", 1500);
  });

  // cross-view deep link: open with "Analyze X" already asked
  if (window.__pendingCopilotCoin) {
    const c = store.coinById(window.__pendingCopilotCoin);
    delete window.__pendingCopilotCoin;
    if (c) setTimeout(() => ask(`analyze ${c.name}`), 300);
  }
}
