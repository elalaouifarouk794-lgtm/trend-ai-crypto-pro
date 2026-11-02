// Watchlist: starred coins with quick actions and alerts-style stats.

import { store } from "../state.js";
import { fetchMarkets } from "../api.js";
import { coinTable, bindCoinTable, loadingGrid } from "../components.js";
import { momentumScore, scoreLabel } from "../analysis.js";
import { fmtUsd, fmtPct, deltaSpan, timeAgo } from "../utils.js";
import { go } from "../router.js";

export async function render(root) {
  if (!store.coins.length) {
    root.innerHTML = loadingGrid();
    await fetchMarkets().catch(() => {});
  }
  const rows = store.watchlist.map((id) => store.coinById(id)).filter(Boolean);
  const missing = store.watchlist.filter((id) => !store.coinById(id));

  root.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <span class="card-title">My Watchlist<span class="sub">${rows.length} assets · updated ${timeAgo(store.lastUpdated)}</span></span>
        <span class="card-actions">
          <button class="btn btn-sm" id="wl-add">Add coin</button>
          <button class="btn btn-sm btn-primary" id="wl-analyze">Scan with AI</button>
        </span>
      </div>
      ${rows.length
        ? `<div id="wl-body">${coinTable(rows, { showRank: true })}</div>`
        : `<div class="state-box"><h3>Watchlist is empty</h3>
            <p>Star any coin in the Live Market table to track it here. Your list persists locally in this browser.</p>
            <button class="btn btn-primary" id="wl-goto-market">Open Live Market</button></div>`}
      ${missing.length ? `<p class="blurb" style="margin-top:12px">Not in current snapshot (lower-cap or delisted): ${missing.join(", ")}.</p>` : ""}
    </div>

    ${rows.length ? `<div class="card">
      <div class="card-head"><span class="card-title">Quick Signals</span></div>
      <div class="grid g-third">
        ${rows.slice(0, 6).map((c) => {
          const s = momentumScore(c, c.sparkline_in_7d?.price ?? []);
          const l = scoreLabel(s);
          return `<div class="pos-card">
            <div style="display:flex;align-items:center;gap:8px">
              <b>${c.symbol.toUpperCase()}</b>
              <span class="score-pill ${l.cls}" style="margin-left:auto">${s}</span>
            </div>
            <div style="margin-top:8px;font-size:13px">${fmtUsd(c.current_price)} ${deltaSpan(c.price_change_percentage_24h_in_currency)}</div>
            <p class="blurb" style="margin-top:6px">${l.text} · 7d ${fmtPct(c.price_change_percentage_7d_in_currency)}</p>
          </div>`;
        }).join("")}
      </div>
    </div>` : ""}`;

  bindCoinTable(root);
  root.querySelector("#wl-goto-market")?.addEventListener("click", () => go("market"));
  root.querySelector("#wl-add").addEventListener("click", () => go("market"));
  root.querySelector("#wl-analyze")?.addEventListener("click", () => {
    window.__pendingCopilotAsk = "Scan my watchlist";
    go("copilot");
  });
}
