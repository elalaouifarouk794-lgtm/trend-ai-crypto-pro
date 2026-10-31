// Dashboard: market overview KPIs, BTC/ETH pulse, breadth, fear & greed, movers.

import { store } from "../state.js";
import { fetchMarketChart } from "../api.js";
import { kpiCard, coinTable, bindCoinTable, loadingGrid } from "../components.js";
import { priceChart, donutChart } from "../charts.js";
import { marketOverview, analyzeCoin, scoreLabel } from "../analysis.js";
import { fmtUsd, fmtCompact, fmtPct, deltaSpan, timeAgo, errorState } from "../utils.js";
import { go } from "../router.js";

export async function render(root) {
  if (!store.coins.length) {
    root.innerHTML = loadingGrid();
    await new Promise((r) => setTimeout(r, 400));
    if (!store.coins.length) {
      root.innerHTML = errorState("Waiting for the first market snapshot. Use the refresh button if this persists.");
      return;
    }
  }

  const ov = marketOverview(store.coins, store.global, store.fng);
  const btc = store.coinById("bitcoin");
  const eth = store.coinById("ethereum");
  const demoTag = store.apiMode === "demo" ? '<span class="chip warn">DEMO DATA</span>' : "";

  const topMovers = [...store.coins]
    .filter((c) => c.id !== "tether")
    .sort((a, b) => Math.abs(b.price_change_percentage_24h_in_currency ?? 0) - Math.abs(a.price_change_percentage_24h_in_currency ?? 0))
    .slice(0, 6);

  root.innerHTML = `
    <div class="grid g-kpi" style="margin-bottom:18px">
      ${kpiCard("Total Market Cap", fmtCompact(ov?.totalCap ?? null),
        (ov?.totalCap ? deltaSpan(store.global?.market_cap_change_percentage_24h_usd) : "") + demoTag)}
      ${kpiCard("24h Volume", fmtCompact(store.global?.total_volume?.usd ?? null),
        `<span style="color:var(--text-3)">${store.coins.length} tracked assets · updated ${timeAgo(store.lastUpdated)}</span>`)}
      ${kpiCard("BTC Dominance", ov?.dominanceBtc ? ov.dominanceBtc.toFixed(1) + "%" : "—",
        `<span class="chip purple">ETH ${store.global?.market_cap_percentage?.eth?.toFixed(1) ?? "—"}%</span>`)}
      ${kpiCard("Market Regime", ov?.regime ?? "—",
        ov ? `<span class="chip ${ov.avg >= 0 ? "up" : "down"}">Avg 24h ${fmtPct(ov.avg)}</span>` : "")}
    </div>

    <div class="grid g-main" style="margin-bottom:18px">
      <div class="card">
        <div class="card-head">
          <span class="card-title">BTC / ETH 24h Pulse<span class="sub">live hourly candles</span></span>
          <span class="card-actions">
            <button class="btn btn-sm" data-open="charts">Full charts</button>
          </span>
        </div>
        <div class="chart-box chart-h-320"><canvas id="dash-btc-eth"></canvas></div>
        <div style="display:flex;gap:22px;margin-top:12px;flex-wrap:wrap">
          ${[btc, eth].filter(Boolean).map((c) => `
            <span style="display:flex;align-items:center;gap:8px">
              <span style="width:9px;height:9px;border-radius:50%;background:${c.id === "bitcoin" ? "#00e5ff" : "#8b5cf6"}"></span>
              <b>${c.symbol.toUpperCase()}</b> ${fmtUsd(c.current_price)} ${deltaSpan(c.price_change_percentage_24h_in_currency)}
            </span>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><span class="card-title">Breadth &amp; Sentiment</span></div>
        <div class="gauge-wrap" style="margin-bottom:14px">
          <div class="gauge"><canvas id="dash-fng"></canvas>
            <div class="g-val"><span class="g-num" style="color:${fngColor(ov?.fng)}">${ov?.fng ?? "—"}</span><span class="g-lbl">${ov?.fngLabel ?? "Fear / Greed"}</span></div>
          </div>
          <div style="flex:1">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;font-size:12px;margin-bottom:5px">
              <span style="color:var(--up)">Advancing ${ov?.advancers ?? 0}</span>
              <span style="color:var(--down)">Declining ${ov?.decliners ?? 0}</span>
            </div>
            <div class="heat-bar" style="width:100%"><div class="heat-fill" style="width:${ov?.breadthPct ?? 50}%"></div></div>
            <p class="blurb" style="margin-top:10px">Breadth measures how many tracked coins rose in 24h. A narrow advance during a rally often signals a fragile move.</p>
          </div>
        </div>
        <div class="card-head" style="margin-top:6px"><span class="card-title" style="font-size:12.5px">Cap Distribution</span></div>
        <div class="chart-box" style="height:190px"><canvas id="dash-donut"></canvas></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <span class="card-title">Biggest Movers (24h)</span>
        <span class="card-actions"><button class="btn btn-sm" data-open="market">View all</button></span>
      </div>
      ${coinTable(topMovers, { showVolume: false })}
    </div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">AI Market Scan<span class="sub">automatic momentum read on majors</span></span>
        <span class="card-actions"><button class="btn btn-sm btn-primary" data-open="copilot">Ask Copilot</button></span>
      </div>
      <div id="dash-signals" class="grid g-third">
        ${'<div class="skeleton" style="height:86px"></div>'.repeat(3)}
      </div>
    </div>
  `;

  bindCoinTable(root);
  root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => go(b.dataset.open)));

  // BTC vs ETH relative-performance line (normalized to 100)
  try {
    const [b, e] = await Promise.all([fetchMarketChart("bitcoin", 1), fetchMarketChart("ethereum", 1)]);
    const norm = (series) => {
      const base = series[0]?.[1] ?? 1;
      return series.map(([ts, p]) => ({ x: ts, y: (p / base) * 100 }));
    };
    const canvas = root.querySelector("#dash-btc-eth");
    const chart = priceChart(canvas, b.prices, { color: "#00e5ff", spanHours: 24 });
    if (e?.prices?.length) {
      chart.data.datasets.push({
        label: "ETH", data: norm(e.prices), borderColor: "#8b5cf6", borderWidth: 2,
        pointRadius: 0, tension: 0.28, fill: false,
      });
      chart.data.datasets[0].data = norm(b.prices);
      chart.options.scales.y.ticks.callback = (v) => v.toFixed(1);
      chart.options.plugins.tooltip.callbacks.label = (i) => `${i.dataset.label}: ${i.parsed.y.toFixed(2)} (normalized)`;
      chart.update();
    }
  } catch { /* chart stays empty; table still works */ }

  // Fear & greed gauge (doughnut arc)
  const fngCanvas = root.querySelector("#dash-fng");
  if (fngCanvas && ov) {
    const v = ov.fng ?? 50;
    new Chart(fngCanvas, {
      type: "doughnut",
      data: {
        labels: ["Sentiment", ""],
        datasets: [{ data: [v, 100 - v], backgroundColor: [fngColor(v), "rgba(86,130,255,0.10)"], borderWidth: 0 }] },
      options: {
        rotation: -120, circumference: 240, cutout: "74%", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
  }

  // Cap distribution donut
  const donut = root.querySelector("#dash-donut");
  if (donut && store.coins.length) {
    const top5 = store.coins.slice(0, 5);
    const rest = store.coins.slice(5).reduce((a, c) => a + (c.market_cap ?? 0), 0);
    donutChart(donut,
      [...top5.map((c) => c.symbol.toUpperCase()), "Others"],
      [...top5.map((c) => c.market_cap), rest],
      ["#00e5ff", "#8b5cf6", "#3d7bff", "#22e5a0", "#ffc857", "rgba(159,176,208,0.25)"]);
  }

  // AI signals strip
  const signals = root.querySelector("#dash-signals");
  if (signals) {
    const picks = [btc, eth, store.coins.find((c) => c.id === "solana")].filter(Boolean);
    signals.innerHTML = picks.map((c) => {
      const a = analyzeCoin(c);
      const s = scoreLabel(a.score);
      return `<div class="pos-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <b>${c.symbol.toUpperCase()}</b><span style="color:var(--text-3);font-size:11px">${c.name}</span>
          <span class="score-pill ${s.cls}" style="margin-left:auto">${a.score}</span>
        </div>
        <div style="font-weight:700;font-size:13px" class="${a.cls}">${a.label} tilt</div>
        <p class="blurb" style="margin-top:5px">${fmtUsd(c.current_price)} · 24h ${fmtPct(c.price_change_percentage_24h_in_currency)} · open full report in Copilot.</p>
      </div>`;
    }).join("");
  }
}

function fngColor(v) {
  if (v == null) return "#64789f";
  if (v < 25) return "#ff5c7a";
  if (v < 45) return "#ffc857";
  if (v < 65) return "#3d7bff";
  if (v < 80) return "#22e5a0";
  return "#00e5ff";
}
