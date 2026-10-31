// Market Scanner: filter + rank coins by momentum signals.

import { store } from "../state.js";
import { fetchMarkets } from "../api.js";
import { momentumScore, scoreLabel } from "../analysis.js";
import { fmtUsd, fmtPct, deltaSpan } from "../utils.js";
import { barChart, destroyAllIn } from "../charts.js";
import { go } from "../router.js";

const state = { minCap: 0, minChange: -99, maxRsiBias: 100, signal: "all", limit: 20 };

export async function render(root) {
  if (!store.coins.length) await fetchMarkets().catch(() => {});
  paint(root);
}

function scored() {
  return store.coins
    .filter((c) => (c.market_cap ?? 0) >= state.minCap)
    .filter((c) => (c.price_change_percentage_24h_in_currency ?? 0) >= state.minChange)
    .map((c) => {
      const score = momentumScore(c, c.sparkline_in_7d?.price ?? []);
      return { coin: c, score, label: scoreLabel(score) };
    })
    .filter((r) => state.signal === "all" ||
      (state.signal === "bullish" && r.score >= 35) ||
      (state.signal === "bearish" && r.score <= -35) ||
      (state.signal === "neutral" && r.score > -35 && r.score < 35))
    .sort((a, b) => b.score - a.score);
}

function paint(root) {
  const rows = scored().slice(0, state.limit);
  root.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <span class="card-title">Signal Scanner<span class="sub">momentum blend: 1h/24h/7d returns + RSI + trend position</span></span>
      </div>
      <div class="filter-row">
        <div class="field"><label>Min market cap</label>
          <select class="input" id="sc-cap">
            <option value="0">Any</option>
            <option value="1000000000">$1B+</option>
            <option value="10000000000">$10B+</option>
            <option value="100000000000">$100B+</option>
          </select>
        </div>
        <div class="field"><label>Min 24h change</label>
          <select class="input" id="sc-chg">
            <option value="-99">Any</option>
            <option value="0">Flat or up</option>
            <option value="2">+2% or more</option>
            <option value="5">+5% or more</option>
          </select>
        </div>
        <div class="field"><label>Signal</label>
          <select class="input" id="sc-sig">
            <option value="all">All</option>
            <option value="bullish">Bullish only</option>
            <option value="neutral">Neutral only</option>
            <option value="bearish">Bearish only</option>
          </select>
        </div>
        <div class="field"><label>Results</label>
          <select class="input" id="sc-limit">
            <option value="10">Top 10</option>
            <option value="20">Top 20</option>
            <option value="40">Top 40</option>
          </select>
        </div>
      </div>
    </div>

    <div class="grid g-main">
      <div class="card">
        <div class="card-head"><span class="card-title">Ranked Results</span></div>
        <div class="table-wrap"><table class="data" style="min-width:560px">
          <thead><tr><th></th><th>Coin</th><th class="num">Price</th><th class="num">24h</th><th class="num">7d</th><th class="num">Score</th><th>Signal</th><th></th></tr></thead>
          <tbody>
            ${rows.map(({ coin: c, score, label }) => `<tr>
              <td style="color:var(--text-3)">${c.market_cap_rank ?? "—"}</td>
              <td><span class="coin-cell">
                ${c.image ? `<img src="${c.image}" alt="" loading="lazy">` : ""}
                <span><span class="coin-name">${c.name}</span><span class="coin-sym">${c.symbol}</span></span>
              </span></td>
              <td class="num">${fmtUsd(c.current_price)}</td>
              <td class="num">${deltaSpan(c.price_change_percentage_24h_in_currency)}</td>
              <td class="num">${deltaSpan(c.price_change_percentage_7d_in_currency)}</td>
              <td class="num"><span class="score-pill ${label.cls}">${score}</span></td>
              <td><span class="chip ${score >= 35 ? "up" : score <= -35 ? "down" : "warn"}">${label.text}</span></td>
              <td class="num"><button class="btn btn-sm" data-analyze="${c.id}">AI</button></td>
            </tr>`).join("") || `<tr><td colspan="8"><div class="state-box"><h3>No matches</h3><p>Loosen the filters to scan more of the market.</p></div></td></tr>`}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Score Heatmap<span class="sub">top ${Math.min(12, rows.length)}</span></span></div>
        <div class="chart-box chart-h-380"><canvas id="scan-bars"></canvas></div>
        <p class="blurb" style="margin-top:12px">Scanner output describes recent statistics only. High momentum often follows high volatility — position sizing and stop discipline matter more than any single score.</p>
      </div>
    </div>`;

  root.querySelector("#sc-cap").value = String(state.minCap);
  root.querySelector("#sc-chg").value = String(state.minChange);
  root.querySelector("#sc-sig").value = state.signal;
  root.querySelector("#sc-limit").value = String(state.limit);
  [["#sc-cap", "minCap", Number], ["#sc-chg", "minChange", Number], ["#sc-sig", "signal", String], ["#sc-limit", "limit", Number]]
    .forEach(([sel, key, cast]) => root.querySelector(sel).addEventListener("change", (e) => {
      state[key] = cast(e.target.value);
      destroyAllIn(root);
      paint(root);
    }));

  root.querySelectorAll("[data-analyze]").forEach((b) =>
    b.addEventListener("click", () => { window.__pendingCopilotCoin = b.dataset.analyze; go("copilot"); }));

  const canvas = root.querySelector("#scan-bars");
  if (canvas && rows.length) {
    const top = rows.slice(0, 12);
    barChart(canvas,
      top.map((r) => r.coin.symbol.toUpperCase()),
      top.map((r) => r.score),
      "#8b5cf6");
  }
}
