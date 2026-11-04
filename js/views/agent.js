// Trading Agent page: an autonomous AI loop that runs on the server.
//
// The browser only ever talks to /api/agent/*; it never sees the exchange key,
// and it cannot place an order the server-side risk gate has not already
// approved. Everything on this page is a control surface over that gate.

import { priceChart } from "../charts.js";
import { toast } from "../toast.js";
import { fmtUsd, fmtQty, fmtDate, deltaSpan, escapeHtml } from "../utils.js";

const MODE_META = {
  paper: { label: "PAPER", cls: "", text: "Simulated fills priced from live Binance tickers. No money moves." },
  testnet: { label: "TESTNET", cls: "warn", text: "Real orders on Binance Testnet. Fake balance, real order flow." },
  live: { label: "LIVE", cls: "danger", text: "REAL FUNDS. Every approved order is a market order on your Binance spot account." },
};

async function api(path, body) {
  const res = await fetch(`/api/agent/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  return data;
}

const signed = (n) => `${n >= 0 ? "+" : "−"}${fmtUsd(Math.abs(n))}`;

export async function render(root) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="state-box"><h3>Loading agent…</h3></div>`;
  root.append(wrap);

  let state = null;
  let symbolsDraft = "";
  let busy = false;

  const num = (v) => Number(v) || 0;

  /* --------------------------------- render -------------------------------- */
  function paint() {
    const cfg = state.config;
    const acct = state.account;
    const mode = MODE_META[cfg.mode] || MODE_META.paper;
    const blocked = state.liveBlockedReason;

    wrap.innerHTML = `
      <div class="notice ${mode.cls}" style="margin-bottom:14px">
        <span class="ic">${mode.label}</span>
        <span><b>${mode.text}</b> ${blocked ? ` · <span class="chip warn">${escapeHtml(blocked)}</span>` : ""}</span>
      </div>

      <div class="grid g-kpi" style="margin-bottom:14px">
        <div class="pos-card"><div class="lbl">Equity</div><div class="val">${fmtUsd(acct.equityUsd)}</div><div style="font-size:11.5px;color:var(--text-3);margin-top:4px">cash ${fmtUsd(acct.cashUsd)}</div></div>
        <div class="pos-card"><div class="lbl">Realized P&amp;L</div><div class="val" style="color:${acct.realizedUsd >= 0 ? "var(--up)" : "var(--down)"}">${signed(acct.realizedUsd)}</div><div style="font-size:11.5px;color:var(--text-3);margin-top:4px">today ${signed(acct.dayRealizedUsd)}</div></div>
        <div class="pos-card"><div class="lbl">Unrealized</div><div class="val" style="color:${acct.unrealizedUsd >= 0 ? "var(--up)" : "var(--down)"}">${signed(acct.unrealizedUsd)}</div><div style="font-size:11.5px;color:var(--text-3);margin-top:4px">holdings ${fmtUsd(acct.holdingsUsd)}</div></div>
        <div class="pos-card"><div class="lbl">Fill rate</div><div class="val">${acct.winRate === null ? "—" : acct.winRate + "%"}</div><div style="font-size:11.5px;color:var(--text-3);margin-top:4px">${acct.trades} trades · ${acct.blockedToday} blocked</div></div>
      </div>

      <div class="grid g-half" style="margin-bottom:14px">
        <div class="card">
          <div class="card-head"><span class="card-title">Agent control<span class="sub">${state.configured.ai ? "AI decisions from the configured model" : "no AI key on the server"}</span></span>
            <span class="card-actions"><span class="chip ${cfg.running ? "up" : "warn"}">${cfg.running ? "RUNNING" : "STOPPED"}</span></span>
          </div>
          <div class="seg" data-seg-mode>
            <button data-mode="paper" class="${cfg.mode === "paper" ? "on" : ""}">Paper</button>
            <button data-mode="testnet" class="${cfg.mode === "testnet" ? "on" : ""}">Testnet</button>
            <button data-mode="live" class="${cfg.mode === "live" ? "on" : ""}">Live</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px">
            <div class="field"><label>Loop interval</label>
              <select class="input" data-f="intervalMs">
                ${[15000, 30000, 60000, 300000, 900000].map((v) => `<option value="${v}" ${cfg.intervalMs === v ? "selected" : ""}>${v / 1000}s</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>Max per order (USD)</label><input class="input" type="number" min="1" data-f="maxOrderUsd" value="${cfg.maxOrderUsd}"></div>
            <div class="field"><label>Max positions</label><input class="input" type="number" min="1" max="10" data-f="maxPositions" value="${cfg.maxPositions}"></div>
            <div class="field"><label>Daily loss cap (USD)</label><input class="input" type="number" min="1" data-f="dailyLossLimitUsd" value="${cfg.dailyLossLimitUsd}"></div>
            <div class="field"><label>Min confidence</label><input class="input" type="number" step="0.05" min="0" max="1" data-f="minConfidence" value="${cfg.minConfidence}"></div>
            <div class="field"><label>Paper start cash</label><input class="input" type="number" min="100" step="100" data-f="startingCashUsd" value="${cfg.startingCashUsd}"></div>
          </div>
          <div class="field" style="margin-top:10px"><label>Symbol allowlist (comma separated)</label>
            <input class="input" data-f="symbols" value="${escapeHtml(symbolsDraft || cfg.symbols.join(", "))}" placeholder="BTCUSDT, ETHUSDT">
          </div>
          <div class="field" style="margin-top:10px"><label>Taker fee % / max slippage %</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <input class="input" type="number" step="0.01" data-f="feePct" value="${cfg.feePct}">
              <input class="input" type="number" step="0.01" data-f="slippagePct" value="${cfg.slippagePct}">
            </div>
          </div>
          ${cfg.mode !== "paper" && !cfg.liveConfirmed ? `
            <div class="field" style="margin-top:12px">
              <label>Type LIVE FUNDS to allow live trading</label>
              <input class="input" data-f="confirmLive" placeholder="LIVE FUNDS" autocomplete="off">
            </div>` : ""}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
            <button class="btn btn-primary btn-sm" data-act="save">Apply settings</button>
            ${cfg.running
              ? `<button class="btn btn-sell btn-sm" data-act="stop">Kill switch</button>`
              : `<button class="btn btn-buy btn-sm" data-act="start">Start agent</button>`}
            <button class="btn btn-ghost btn-sm" data-act="evaluate">Evaluate once</button>
            <button class="btn btn-ghost btn-sm" data-act="closeall">Close positions</button>
            <button class="btn btn-ghost btn-sm" data-act="reset">Reset ledger</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><span class="card-title">Equity curve<span class="sub">${state.status.running ? `next cycle in ${Math.max(0, Math.round(((state.status.lastTick?.ts || Date.now()) + cfg.intervalMs - Date.now()) / 1000))}s` : "idle"}</span></span></div>
          <div class="chart-box chart-h-240"><canvas data-equity></canvas></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><span class="card-title">Open positions<span class="sub">spot long only</span></span></div>
        ${acct.positions.length ? `<div class="table-wrap"><table class="data" style="min-width:620px">
          <thead><tr><th>Market</th><th class="num">Qty</th><th class="num">Avg cost</th><th class="num">Mark</th><th class="num">Value</th><th class="num">Unrealized</th></tr></thead>
          <tbody>${acct.positions.map((p) => `
            <tr><td><b>${escapeHtml(p.symbol)}</b></td>
            <td class="num mono">${fmtQty(p.qty)}</td>
            <td class="num mono">${fmtUsd(p.avgPrice)}</td>
            <td class="num mono">${fmtUsd(p.mark || state.prices[p.symbol] || 0)}</td>
            <td class="num mono">${fmtUsd(p.valueUsd || 0)}</td>
            <td class="num">${deltaSpan(p.unrealizedUsd || 0, signed(p.unrealizedUsd || 0))}</td></tr>`).join("")}
          </tbody></table></div>` : `<div class="state-box"><p>No open positions.</p></div>`}
      </div>

      <div class="grid g-half">
        <div class="card">
          <div class="card-head"><span class="card-title">Executed trades<span class="sub">${state.trades.length} shown</span></span></div>
          ${state.trades.length ? `<div class="table-wrap"><table class="data" style="min-width:640px">
            <thead><tr><th>Time</th><th>Side</th><th>Market</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Value</th><th class="num">P&amp;L</th></tr></thead>
            <tbody>${state.trades.map((t) => `
              <tr>
                <td class="mono" style="font-size:11px">${fmtDate(t.ts, true)}</td>
                <td><span class="chip ${t.side === "buy" ? "up" : "down"}">${t.side.toUpperCase()}</span></td>
                <td><b>${escapeHtml(t.symbol)}</b> <span style="color:var(--text-3);font-size:10.5px">${escapeHtml(t.venue)}</span></td>
                <td class="num mono">${fmtQty(t.qty)}</td>
                <td class="num mono">${fmtUsd(t.price)}</td>
                <td class="num mono">${fmtUsd(t.usd)}</td>
                <td class="num">${t.realizedUsd ? signed(t.realizedUsd) : "—"}</td>
              </tr>`).join("")}
            </tbody></table></div>` : `<div class="state-box"><p>The agent has not traded yet.</p></div>`}
        </div>
        <div class="card">
          <div class="card-head"><span class="card-title">Agent log<span class="sub">decisions, blocks and errors</span></span></div>
          <div data-log style="max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:6px">
            ${state.journal.map((j) => `
              <div style="display:flex;gap:8px;align-items:baseline;font-size:12px">
                <span class="chip ${j.level === "err" ? "down" : j.level === "warn" ? "warn" : j.level === "trade" ? "up" : "purple"}">${j.level}</span>
                <span style="color:var(--text-2)">${escapeHtml(j.message)}</span>
                <span class="mono" style="margin-left:auto;color:var(--text-3);font-size:10.5px">${fmtDate(j.ts, true)}</span>
              </div>`).join("") || `<p style="color:var(--text-3);font-size:12px">Nothing logged yet.</p>`}
          </div>
        </div>
      </div>`;

    bind();
    const canvas = wrap.querySelector("[data-equity]");
    if (canvas && state.equity.length) {
      priceChart(canvas, state.equity.map((e) => [e.ts, e.equity]), { color: "#8b5cf6", spanHours: 24 });
    } else if (canvas) {
      canvas.parentElement.innerHTML = `<div class="state-box"><p>Equity curve appears after the first cycle.</p></div>`;
    }
    wrap.querySelector("[data-log]")?.scrollTo(0, 0);
  }

  /* --------------------------------- events -------------------------------- */
  async function run(label, fn) {
    if (busy) return;
    busy = true;
    try {
      const result = await fn();
      if (result) state = result.state ? result.state : result;
      toast(label + " · done", "ok");
    } catch (err) {
      toast(err.message, "err", 6000);
    } finally {
      busy = false;
      refresh();
    }
  }

  function settingsFromDom() {
    const patch = {};
    wrap.querySelectorAll("[data-f]").forEach((input) => {
      const key = input.dataset.f;
      if (key === "symbols") {
        patch.symbols = input.value.split(/[,\s]+/).filter(Boolean);
        symbolsDraft = input.value;
      } else if (key === "confirmLive") {
        if (input.value.trim() === "LIVE FUNDS") patch.liveConfirmed = true;
      } else patch[key] = num(input.value);
    });
    return patch;
  }

  function bind() {
    wrap.querySelectorAll("[data-seg-mode] button").forEach((b) =>
      b.addEventListener("click", () => {
        const mode = b.dataset.mode;
        if (mode === "live") toast("Live mode also needs the typed confirmation below.", "info", 5000);
        if (mode === "testnet" && !state.configured.exchangeKeys) toast("No Binance testnet keys on the server.", "err");
        run(`mode ${mode}`, () => api("config", { mode }));
      })
    );

    wrap.querySelector("[data-act=save]")?.addEventListener("click", () =>
      run("settings", async () => {
        const patch = settingsFromDom();
        if (patch.mode === undefined) delete patch.mode;
        return api("config", patch);
      })
    );
    wrap.querySelector("[data-act=start]")?.addEventListener("click", () => run("start", () => api("start", {})));
    wrap.querySelector("[data-act=stop]")?.addEventListener("click", () => run("stop", () => api("stop", {})));
    wrap.querySelector("[data-act=evaluate]")?.addEventListener("click", () => run("cycle", () => api("evaluate", {})));
    wrap.querySelector("[data-act=closeall]")?.addEventListener("click", () => run("close", () => api("close-all", {})));
    wrap.querySelector("[data-act=reset]")?.addEventListener("click", () => {
      if (!confirm("Reset the agent ledger? Trades, positions and equity history are erased.")) return;
      run("reset", () => api("reset", { keepConfig: true }));
    });
  }

  /* -------------------------------- polling -------------------------------- */
  async function refresh() {
    if (!wrap.isConnected) {
      clearInterval(timer);
      return;
    }
    if (busy) return;
    try {
      const next = await api("state");
      const formIsDirty = wrap.querySelector("input:focus");
      state = next;
      if (!formIsDirty) paint();
      else {
        // keep the operator's half-typed settings, but still update the numbers
        const cards = wrap.querySelectorAll(".pos-card .val");
        if (cards.length === 4) {
          cards[0].textContent = fmtUsd(next.account.equityUsd);
          cards[1].textContent = signed(next.account.realizedUsd);
          cards[2].textContent = signed(next.account.unrealizedUsd);
        }
      }
    } catch (err) {
      wrap.innerHTML = `<div class="state-box"><div class="big">!</div><h3>Agent endpoint unavailable</h3><p>${escapeHtml(err.message)}<br><br>Trading endpoints are loopback-only. Open the app on http://localhost:8090, or set AGENT_API_TOKEN and send it as x-agent-token.</p></div>`;
    }
  }

  await refresh();
  const timer = setInterval(refresh, 5000);
}
