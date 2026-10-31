// App bootstrap: topbar wiring, live status, ticker strip, auto-refresh.

import { CONFIG } from "./config.js";
import { store } from "./state.js";
import { refreshMarketData } from "./api.js";
import { startRouter, reloadView } from "./router.js";
import { fmtUsd, debounce } from "./utils.js";
import { toast } from "./toast.js";

/* ---------- sidebar (mobile) ---------- */
document.getElementById("menu-toggle").addEventListener("click", () => {
  document.body.classList.toggle("nav-open");
});
document.getElementById("sidebar-backdrop").addEventListener("click", () => {
  document.body.classList.remove("nav-open");
});

/* ---------- clock ---------- */
const clock = document.getElementById("market-clock");
function tickClock() {
  clock.textContent = new Date().toLocaleTimeString("en-US", { hour12: false }) + " UTC"
    + (Intl.DateTimeFormat().resolvedOptions().timeZone !== "UTC" ? " · local" : "");
}
tickClock();
setInterval(tickClock, 1000);

/* ---------- api status pill ---------- */
function renderApiStatus() {
  const dot = document.getElementById("api-dot");
  const text = document.getElementById("api-status-text");
  dot.className = "dot " + ({ live: "dot-live", demo: "dot-demo", down: "dot-down", connecting: "" }[store.apiMode] || "");
  text.textContent = {
    live: "Live market data · CoinGecko",
    demo: "Demo mode · API unreachable",
    down: "Data feed offline",
    connecting: "Connecting…",
  }[store.apiMode] || store.apiMode;
}
store.subscribe((evt) => {
  if (evt === "apiMode") renderApiStatus();
  if (evt === "watchlist") {
    document.getElementById("watchlist-count").textContent = String(store.watchlist.length);
  }
  if (evt === "coins") renderTicker();
});

/* ---------- ticker strip ---------- */
function renderTicker() {
  const strip = document.getElementById("ticker-strip");
  const top = store.coins.slice(0, 12);
  if (!top.length) return;
  strip.innerHTML = top.map((c) => {
    const ch = c.price_change_percentage_24h_in_currency ?? 0;
    const color = ch >= 0 ? "var(--up)" : "var(--down)";
    const img = c.image
      ? `<img src="${c.image}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : "";
    return `<span class="ticker-item">${img}<span class="ticker-sym">${c.symbol.toUpperCase()}</span>`
      + `<span class="ticker-price">${fmtUsd(c.current_price)}</span>`
      + `<span style="color:${color};font-family:var(--font-mono);font-size:11px">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(2)}%</span></span>`;
  }).join("");
  strip.classList.remove("sweep");
  void strip.offsetWidth;
  strip.classList.add("sweep");
}

/* ---------- refresh ---------- */
let refreshing = false;
async function doRefresh(manual = false) {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById("refresh-btn");
  btn.classList.add("spinning");
  const prev = store.apiMode;
  const results = await refreshMarketData();
  btn.classList.remove("spinning");
  refreshing = false;
  const allFailed = results.every((r) => r.status === "rejected");
  if (manual) {
    if (allFailed) toast("Could not reach the market API. Showing last data.", "err");
    else if (store.apiMode === "demo") toast("Live API unavailable — refreshed demo dataset.", "err");
    else toast("Market data refreshed.", "ok");
  } else if (prev === "connecting" && store.apiMode === "demo") {
    toast("Live feed unreachable — running in clearly-labelled demo mode.", "err", 5200);
  }
  reloadView();
}
document.getElementById("refresh-btn").addEventListener("click", () => doRefresh(true));
setInterval(() => { if (!document.hidden) doRefresh(false); }, CONFIG.api.refreshIntervalMs);

/* ---------- global search ---------- */
document.getElementById("global-search").addEventListener("input", debounce((e) => {
  const q = e.target.value.trim().toLowerCase();
  store.searchQuery = q;
  if (!q) return;
  const hit = store.coins.find((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase() === q);
  if (hit && location.hash !== "#/market") {
    location.hash = "#/market";
    toast(`Showing market rows for “${hit.name}”.`, "info", 2000);
  }
}, 400));

/* ---------- boot ---------- */
startRouter();
renderApiStatus();
doRefresh(false).finally(() => {
  renderTicker();
  document.getElementById("watchlist-count").textContent = String(store.watchlist.length);
});
