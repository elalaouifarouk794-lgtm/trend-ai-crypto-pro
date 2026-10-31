// Paper Trading Simulator — VIRTUAL FUNDS ONLY.
// Fills are computed against live reference prices with a simulated fee.
// No real money, no order routing, no blockchain transactions ever occur.

import { store } from "../state.js";
import { CONFIG } from "../config.js";
import { fetchMarkets } from "../api.js";
import { fmtUsd, fmtQty, fmtPct, deltaSpan, fmtDate, errorState } from "../utils.js";
import { donutChart, destroyAllIn } from "../charts.js";
import { toast } from "../toast.js";

const ticket = { coinId: "bitcoin", side: "buy" };

export async function render(root) {
  if (!store.coins.length) {
    try { await fetchMarkets(); } catch {
      root.innerHTML = errorState("Market prices are required to simulate fills. Refresh when the feed is back.");
      return;
    }
  }
  if (!store.coinById(ticket.coinId)) ticket.coinId = store.coins[0]?.id ?? "bitcoin";
  paint(root);
}

function paint(root) {
  destroyAllIn(root);
  const equity = store.paperEquity();
  const pnl = equity - CONFIG.paper.startingCashUsd;
  const pnlPct = (pnl / CONFIG.paper.startingCashUsd) * 100;
  const coin = store.coinById(ticket.coinId);
  const positions = Object.entries(store.paper.positions)
    .map(([id, p]) => ({ coin: store.coinById(id), pos: p }))
    .filter((x) => x.coin);
  const start = window.__pendingTradeCoin;
  if (start && store.coinById(start)) { ticket.coinId = start; delete window.__pendingTradeCoin; }

  root.innerHTML = `
    <div class="notice" style="margin-bottom:16px">
      <span class="ic">SIM</span>
      <span><b>Simulation only.</b> You trade ${fmtUsd(CONFIG.paper.startingCashUsd)} of virtual USD against live reference prices.
      Orders never touch an exchange or a blockchain — this is a practice environment, not financial advice.</span>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="portfolio-summary">
        <div class="pos-card"><div class="lbl">Account Equity</div><div class="val">${fmtUsd(equity)}</div></div>
        <div class="pos-card"><div class="lbl">Virtual Cash</div><div class="val">${fmtUsd(store.paper.cashUsd)}</div></div>
        <div class="pos-card"><div class="lbl">Holdings Value</div><div class="val">${fmtUsd(store.paperHoldingsValue())}</div></div>
        <div class="pos-card"><div class="lbl">Total P&amp;L</div>
          <div class="val" style="color:${pnl >= 0 ? "var(--up)" : "var(--down)"}">${fmtUsd(pnl)}
            <span style="font-size:12px">(${fmtPct(pnlPct)})</span></div></div>
      </div>
    </div>

    <div class="grid g-main">
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <div class="card">
          <div class="card-head"><span class="card-title">Positions</span></div>
          ${positions.length ? `<div class="table-wrap"><table class="data" style="min-width:520px">
            <thead><tr><th>Asset</th><th class="num">Qty</th><th class="num">Avg Cost</th><th class="num">Last</th><th class="num">Value</th><th class="num">Unrealized</th></tr></thead>
            <tbody>${positions.map(({ coin: c, pos }) => {
              const value = pos.qty * c.current_price;
              const cost = pos.qty * pos.avgCost;
              const up = value - cost;
              return `<tr><td><span class="coin-name">${c.symbol.toUpperCase()}</span> <span class="coin-sym">${c.name}</span></td>
                <td class="num">${fmtQty(pos.qty)}</td>
                <td class="num">${fmtUsd(pos.avgCost)}</td>
                <td class="num">${fmtUsd(c.current_price)}</td>
                <td class="num">${fmtUsd(value)}</td>
                <td class="num">${deltaSpan(cost ? (up / cost) * 100 : null, fmtUsd(up) + " (" + fmtPct(cost ? (up / cost) * 100 : 0) + ")")}</td></tr>`;
            }).join("")}</tbody></table></div>`
          : '<div class="state-box"><h3>No virtual positions</h3><p>Place a simulated buy to build a practice portfolio.</p></div>'}
        </div>

        <div class="card">
          <div class="card-head"><span class="card-title">Trade History</span>
            <span class="card-actions"><button class="btn btn-sm btn-ghost" id="pt-reset">Reset simulator</button></span></div>
          ${store.paper.trades.length ? `<div class="table-wrap"><table class="data" style="min-width:560px">
            <thead><tr><th>Time</th><th>Side</th><th>Asset</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Value</th><th class="num">Fee</th></tr></thead>
            <tbody>${store.paper.trades.slice(0, 30).map((t) => `<tr>
              <td style="color:var(--text-3)">${fmtDate(t.ts, true)}</td>
              <td><span class="chip ${t.side === "BUY" ? "up" : "down"}">${t.side}</span></td>
              <td class="num" style="text-align:left">${t.symbol}</td>
              <td class="num">${fmtQty(t.qty)}</td>
              <td class="num">${fmtUsd(t.price)}</td>
              <td class="num">${fmtUsd(t.value)}</td>
              <td class="num" style="color:var(--text-3)">${fmtUsd(t.fee)}</td>
            </tr>`).join("")}</tbody></table></div>`
          : '<p class="blurb">No simulated trades yet. Fills you place will be journaled here with a ' + (CONFIG.paper.feeRate * 100).toFixed(1) + "% fee model.</p>"}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <div class="card">
          <div class="card-head"><span class="card-title">Order Ticket<span class="sub">virtual</span></span></div>
          <div class="trade-ticket">
            <div class="field"><label>Asset</label>
              <select class="input" id="pt-coin">
                ${store.coins.slice(0, 40).map((c) => `<option value="${c.id}" ${c.id === ticket.coinId ? "selected" : ""}>${c.name} (${c.symbol.toUpperCase()}) · ${fmtUsd(c.current_price)}</option>`).join("")}
              </select>
            </div>
            <div class="seg" style="justify-content:stretch">
              <button data-side="buy" class="${ticket.side === "buy" ? "on" : ""}" style="flex:1">Buy</button>
              <button data-side="sell" class="${ticket.side === "sell" ? "on" : ""}" style="flex:1">Sell</button>
            </div>
            <div class="field"><label>Amount (virtual USD)</label>
              <input class="input" id="pt-usd" type="number" min="1" step="1" placeholder="e.g. 250" value="250">
              <div class="qty-row">
                ${[50, 100, 250, 500].map((v) => `<button class="btn btn-sm" data-quick="${v}">$${v}</button>`).join("")}
                <button class="btn btn-sm" data-quick="max">Max</button>
              </div>
            </div>
            ${coin ? `<p class="blurb">Indicative fill: <b>${fmtQty(ticket.side === "buy"
              ? (250 * (1 - CONFIG.paper.feeRate)) / coin.current_price
              : 0)}</b> ${coin.symbol.toUpperCase()} at reference ${fmtUsd(coin.current_price)} · fee ${(CONFIG.paper.feeRate * 100).toFixed(1)}%</p>` : ""}
            <button class="btn ${ticket.side === "buy" ? "btn-buy" : "btn-sell"}" id="pt-submit" ${!coin ? "disabled" : ""}>
              Simulate ${ticket.side === "buy" ? "Buy" : "Sell"}
            </button>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><span class="card-title">Allocation</span></div>
          <div class="chart-box" style="height:230px"><canvas id="pt-donut"></canvas></div>
        </div>
      </div>
    </div>`;

  // interactions
  root.querySelector("#pt-coin").addEventListener("change", (e) => { ticket.coinId = e.target.value; paint(root); });
  root.querySelectorAll("[data-side]").forEach((b) => b.addEventListener("click", () => { ticket.side = b.dataset.side; paint(root); }));
  root.querySelectorAll("[data-quick]").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.quick === "max"
      ? (ticket.side === "buy" ? store.paper.cashUsd : Math.round((store.paper.positions[ticket.coinId]?.qty ?? 0) * (coin?.current_price ?? 0)))
      : Number(b.dataset.quick);
    root.querySelector("#pt-usd").value = String(Math.max(1, Math.floor(v)));
  }));

  root.querySelector("#pt-submit").addEventListener("click", () => {
    const c = store.coinById(ticket.coinId);
    if (!c) return toast("Coin not in snapshot — refresh first.", "err");
    const usd = Number(root.querySelector("#pt-usd").value);
    try {
      if (ticket.side === "buy") {
        store.paperBuy(c.id, usd);
        toast(`Simulated BUY ${c.symbol.toUpperCase()} ${fmtUsd(usd)} filled at ${fmtUsd(c.current_price)}.`, "ok");
      } else {
        const qty = usd / c.current_price;
        store.paperSell(c.id, qty);
        toast(`Simulated SELL ${c.symbol.toUpperCase()} ${fmtQty(qty)} filled at ${fmtUsd(c.current_price)}.`, "ok");
      }
      paint(root);
    } catch (err) {
      toast(err.message, "err");
    }
  });

  root.querySelector("#pt-reset").addEventListener("click", () => {
    if (!confirm("Reset the simulator? Virtual cash returns to $10,000 and all simulated positions/history are cleared.")) return;
    store.paperReset();
    toast("Simulator reset to $10,000 virtual cash.", "ok");
    paint(root);
  });

  // allocation donut
  const donut = root.querySelector("#pt-donut");
  const labels = ["Cash"], values = [store.paper.cashUsd], colors = ["rgba(159,176,208,0.35)"];
  positions.forEach(({ coin: c, pos }, i) => {
    labels.push(c.symbol.toUpperCase());
    values.push(pos.qty * c.current_price);
    colors.push(["#00e5ff", "#8b5cf6", "#3d7bff", "#22e5a0", "#ffc857", "#ff5c7a"][i % 6]);
  });
  if (donut) donutChart(donut, labels, values, colors);
}
