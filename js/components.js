// Shared UI components across views: coin tables, KPI cards, chart placeholders.

import { store } from "./state.js";
import { go } from "./router.js";
import { fmtUsd, fmtCompact, fmtPct, deltaSpan } from "./utils.js";
import { sparkline } from "./charts.js";

const STAR_SVG = '<svg viewBox="0 0 20 20"><path d="M10 1.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z"/></svg>';

export function coinTable(coins, { showRank = true, showVolume = true, showActions = true, emptyMsg = "No coins match your filters." } = {}) {
  if (!coins.length) {
    return `<div class="state-box"><h3>Nothing here</h3><p>${emptyMsg}</p></div>`;
  }
  return `<div class="table-wrap"><table class="data">
    <thead><tr>
      <th></th>
      ${showRank ? "<th>#</th>" : ""}
      <th>Coin</th>
      <th class="num">Price</th>
      <th class="num">1h</th>
      <th class="num">24h</th>
      <th class="num">7d</th>
      ${showVolume ? "<th class='num'>24h Volume</th>" : ""}
      <th class="num">Market Cap</th>
      <th>7d Chart</th>
      ${showActions ? "<th></th>" : ""}
    </tr></thead>
    <tbody>
      ${coins.map((c) => {
        const watched = store.inWatchlist(c.id);
        return `<tr data-coin="${c.id}">
          <td><button class="star-btn ${watched ? "on" : ""}" data-star="${c.id}" title="Toggle watchlist" aria-label="Toggle watchlist for ${c.name}">${STAR_SVG}</button></td>
          ${showRank ? `<td style="color:var(--text-3)">${c.market_cap_rank ?? "—"}</td>` : ""}
          <td><span class="coin-cell">
            ${c.image ? `<img src="${c.image}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="coin-cell" style="width:26px;height:26px;border-radius:50%;background:var(--grad-neon);display:inline-block"></span>`}
            <span><span class="coin-name">${c.name}</span><span class="coin-sym">${c.symbol}</span></span>
          </span></td>
          <td class="num">${fmtUsd(c.current_price)}</td>
          <td class="num">${deltaSpan(c.price_change_percentage_1h_in_currency)}</td>
          <td class="num">${deltaSpan(c.price_change_percentage_24h_in_currency)}</td>
          <td class="num">${deltaSpan(c.price_change_percentage_7d_in_currency)}</td>
          ${showVolume ? `<td class="num" style="color:var(--text-2)">${fmtCompact(c.total_volume)}</td>` : ""}
          <td class="num" style="color:var(--text-2)">${fmtCompact(c.market_cap)}</td>
          <td class="spark-cell"><canvas width="110" height="36" data-spark="${c.id}"></canvas></td>
          ${showActions ? `<td class="num">
            <button class="btn btn-sm btn-ghost" data-trade="${c.id}">Trade</button>
            <button class="btn btn-sm btn-ghost" data-analyze="${c.id}" title="AI analysis">AI</button>
          </td>` : ""}
        </tr>`;
      }).join("")}
    </tbody>
  </table></div>`;
}

// Bind interactive behaviour after a coinTable is inserted into the DOM.
export function bindCoinTable(rootEl) {
  rootEl.querySelectorAll("[data-star]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      store.toggleWatch(btn.dataset.star);
      btn.classList.toggle("on", store.inWatchlist(btn.dataset.star));
    });
  });
  rootEl.querySelectorAll("[data-trade]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.__pendingTradeCoin = btn.dataset.trade;
      go("paper");
    });
  });
  rootEl.querySelectorAll("[data-analyze]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.__pendingCopilotCoin = btn.dataset.analyze;
      go("copilot");
    });
  });
  rootEl.querySelectorAll("[data-spark]").forEach((canvas) => {
    const coin = store.coinById(canvas.dataset.spark);
    const series = coin?.sparkline_in_7d?.price;
    if (!series || series.length < 2) { canvas.style.opacity = 0.2; return; }
    const up = (series[series.length - 1] - series[0]) >= 0;
    sparkline(canvas, series, up);
  });
}

export function kpiCard(label, value, footHtml = "") {
  return `<div class="card kpi">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-foot">${footHtml}</div>
  </div>`;
}

export function loadingGrid() {
  return `<div class="grid g-kpi" style="margin-bottom:18px">
    ${'<div class="skeleton sk-card"></div>'.repeat(4)}
  </div>
  <div class="grid g-main">
    <div class="card"><div class="skeleton" style="height:300px"></div></div>
    <div class="card"><div class="skeleton" style="height:300px"></div></div>
  </div>`;
}
