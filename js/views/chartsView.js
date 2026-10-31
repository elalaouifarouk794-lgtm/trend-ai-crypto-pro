// Interactive BTC / ETH charts: timeframe switch, coin toggle, live stats.

import { store } from "../state.js";
import { fetchMarketChart } from "../api.js";
import { priceChart, destroyAllIn } from "../charts.js";
import { fmtUsd, fmtPct, fmtCompact, deltaSpan } from "../utils.js";

const TIMEFRAMES = [
  { key: "1", label: "24H", spanHours: 24 },
  { key: "7", label: "7D", spanHours: 24 * 7 },
  { key: "30", label: "1M", spanHours: 24 * 30 },
  { key: "90", label: "3M", spanHours: 24 * 90 },
  { key: "365", label: "1Y", spanHours: 24 * 365 },
];
const COLORS = { bitcoin: "#00e5ff", ethereum: "#8b5cf6" };

const state = { coin: "bitcoin", tf: "7", compare: true };

export async function render(root) {
  root.innerHTML = `
    <div class="grid g-half" style="margin-bottom:18px">
      ${["bitcoin", "ethereum"].map((id) => {
        const c = store.coinById(id);
        return `<div class="card" style="padding:14px 18px">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="width:11px;height:11px;border-radius:50%;background:${COLORS[id]};box-shadow:0 0 12px ${COLORS[id]}"></span>
            <b style="font-size:15px">${c?.name ?? (id === "bitcoin" ? "Bitcoin" : "Ethereum")}</b>
            <span class="coin-sym">${c?.symbol ?? id.split("-")[0]}</span>
            <span style="margin-left:auto;font-family:var(--font-mono);font-size:19px;font-weight:800">${fmtUsd(c?.current_price)}</span>
          </div>
          <div style="display:flex;gap:16px;margin-top:8px;font-size:12px;color:var(--text-2)">
            <span>24h ${deltaSpan(c?.price_change_percentage_24h_in_currency)}</span>
            <span>7d ${deltaSpan(c?.price_change_percentage_7d_in_currency)}</span>
            <span>Vol ${fmtCompact(c?.total_volume)}</span>
            <span style="margin-left:auto">ATH ${fmtUsd(c?.ath)} (${fmtPct(c?.ath_change_percentage)})</span>
          </div>
        </div>`;
      }).join("")}
    </div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">Price Chart<span class="sub" id="chart-note"></span></span>
        <span class="card-actions" style="flex-wrap:wrap;gap:8px">
          <div class="seg" id="coin-seg">
            <button data-coin="bitcoin" class="${state.coin === "bitcoin" ? "on" : ""}">BTC</button>
            <button data-coin="ethereum" class="${state.coin === "ethereum" ? "on" : ""}">ETH</button>
          </div>
          <div class="seg" id="tf-seg">
            ${TIMEFRAMES.map((t) => `<button data-tf="${t.key}" class="${state.tf === t.key ? "on" : ""}">${t.label}</button>`).join("")}
          </div>
          <button class="btn btn-sm ${state.compare ? "" : "btn-ghost"}" id="cmp-btn" title="Overlay the other major, normalized">${state.compare ? "Comparing" : "Compare"}</button>
        </span>
      </div>
      <div class="chart-box chart-h-380"><canvas id="big-chart"></canvas></div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:14px;font-size:12px;color:var(--text-2)" id="chart-stats"></div>
    </div>`;

  const canvas = root.querySelector("#big-chart");
  const holder = canvas.parentElement;

  async function draw() {
    const tfDef = TIMEFRAMES.find((t) => t.key === state.tf);
    root.querySelector("#chart-note").textContent = `${state.coin.toUpperCase()} · ${tfDef.label} · USD`;
    destroyAllIn(holder);
    holder.innerHTML = '<div class="skeleton" style="height:100%;border-radius:12px"></div>';
    try {
      const main = await fetchMarketChart(state.coin, Number(state.tf));
      holder.innerHTML = "<canvas></canvas>";
      const chart = priceChart(holder.querySelector("canvas"), main.prices, { color: COLORS[state.coin], spanHours: tfDef.spanHours });

      if (state.compare) {
        const other = state.coin === "bitcoin" ? "ethereum" : "bitcoin";
        const cmp = await fetchMarketChart(other, Number(state.tf));
        const norm = (series) => {
          const base = series[0]?.[1] ?? 1;
          return series.map(([ts, p]) => ({ x: ts, y: (p / base) * 100 }));
        };
        chart.data.datasets[0].data = norm(main.prices);
        chart.data.datasets.push({
          label: other.toUpperCase(), data: norm(cmp.prices), borderColor: COLORS[other],
          borderWidth: 2, pointRadius: 0, tension: 0.28, fill: false,
        });
        chart.options.scales.y.ticks.callback = (v) => Number(v).toFixed(1);
        chart.options.plugins.legend = { display: true, labels: { usePointStyle: true, boxWidth: 8 } };
        chart.options.plugins.tooltip.callbacks.label = (i) => `${i.dataset.label}: ${i.parsed.y.toFixed(2)} (indexed to 100)`;
        chart.update();
      }

      const prices = main.prices.map(([, p]) => p);
      const hi = Math.max(...prices), lo = Math.min(...prices);
      const chg = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
      root.querySelector("#chart-stats").innerHTML = `
        <span>Period high <b style="color:var(--up)">${fmtUsd(hi)}</b></span>
        <span>Period low <b style="color:var(--down)">${fmtUsd(lo)}</b></span>
        <span>Period change ${deltaSpan(chg)}</span>
        <span>Range width <b>${(((hi - lo) / lo) * 100).toFixed(1)}%</b></span>
        ${main.demo ? '<span class="chip warn">DEMO SERIES</span>' : ""}`;
    } catch (err) {
      holder.innerHTML = `<div class="state-box"><h3>Chart data unavailable</h3><p>${err.message}</p><button class="btn btn-primary" id="chart-retry">Retry</button></div>`;
      root.querySelector("#chart-retry")?.addEventListener("click", draw);
    }
  }

  root.querySelectorAll("#coin-seg button").forEach((b) => b.addEventListener("click", () => {
    state.coin = b.dataset.coin;
    root.querySelectorAll("#coin-seg button").forEach((x) => x.classList.toggle("on", x === b));
    draw();
  }));
  root.querySelectorAll("#tf-seg button").forEach((b) => b.addEventListener("click", () => {
    state.tf = b.dataset.tf;
    root.querySelectorAll("#tf-seg button").forEach((x) => x.classList.toggle("on", x === b));
    draw();
  }));
  root.querySelector("#cmp-btn").addEventListener("click", () => {
    state.compare = !state.compare;
    render(root);
  });

  draw();
}
