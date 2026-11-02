// AI Crypto Copilot page: full-screen chat backed by the server AI endpoint
// with automatic local-engine fallback. Educational only — no financial advice.

import { mountChat } from "../chat.js";
import { store } from "../state.js";

const SUGGESTIONS = [
  "Analyze Bitcoin",
  "How is the overall market right now?",
  "Compare BTC vs ETH",
  "What is RSI?",
  "Scan my watchlist",
  "Explain market dominance",
];

const GREETING = "Welcome to the **TREND AI Copilot**. I read live market data and explain what the signals suggest — purely for education.\n\nTry asking about a coin, the market regime, or concepts like RSI, dominance and liquidity.";

export async function render(root) {
  root.innerHTML = `
    <div class="card" style="height:100%">
      <div class="card-head">
        <span class="card-title">AI Crypto Copilot<span class="sub">server AI with local fallback · educational, not financial advice</span></span>
        <span class="card-actions">
          <button class="btn btn-sm" data-cop-clear>New session</button>
        </span>
      </div>
      <div data-cop-chat style="height:calc(100% - 48px)"></div>
    </div>`;

  const chat = mountChat(root.querySelector("[data-cop-chat]"), {
    suggestions: SUGGESTIONS,
    greeting: GREETING,
  });

  root.querySelector("[data-cop-clear]").addEventListener("click", () => chat.reset());

  // cross-view deep link: open with an analysis already asked
  let pending = null;
  if (window.__pendingCopilotCoin) {
    const c = store.coinById(window.__pendingCopilotCoin);
    delete window.__pendingCopilotCoin;
    if (c) pending = `analyze ${c.name}`;
  }
  if (window.__pendingCopilotAsk) {
    pending = window.__pendingCopilotAsk;
    delete window.__pendingCopilotAsk;
  }
  if (pending) setTimeout(() => chat.ask(pending), 400);
}
