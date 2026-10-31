// Live Market: full sortable coin table with search + category filters.

import { store } from "../state.js";
import { fetchMarkets } from "../api.js";
import { coinTable, bindCoinTable, loadingGrid } from "../components.js";
import { debounce } from "../utils.js";
import { toast } from "../toast.js";

const state = { query: "", majorsOnly: false, watchedOnly: false, sort: "rank", dir: 1 };

export async function render(root) {
  state.query = store.searchQuery || "";
  if (!store.coins.length) {
    root.innerHTML = loadingGrid();
    try { await fetchMarkets(); } catch { toast("Market fetch failed — retrying shortly.", "err"); }
  }
  paint(root);
}

function filtered() {
  let list = store.coins.slice();
  if (state.query) {
    const q = state.query.toLowerCase();
    list = list.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
  }
  if (state.majorsOnly) list = list.slice(0, 15);
  if (state.watchedOnly) list = list.filter((c) => store.inWatchlist(c.id));
  const key = state.sort;
  const val = (c) => {
    switch (key) {
      case "rank": return c.market_cap_rank ?? 999;
      case "price": return c.current_price ?? 0;
      case "change": return c.price_change_percentage_24h_in_currency ?? 0;
      case "volume": return c.total_volume ?? 0;
      case "mcap": return c.market_cap ?? 0;
      default: return 0;
    }
  };
  return list.sort((a, b) => (val(a) - val(b)) * state.dir);
}

function escAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

function paint(root) {
  const rows = filtered();
  root.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <span class="card-title">Live Prices<span class="sub">${rows.length} assets · auto-refresh 90s</span></span>
        <span class="card-actions">
          ${store.apiMode === "demo" ? '<span class="chip warn">DEMO DATA</span>' : '<span class="chip up">LIVE</span>'}
        </span>
      </div>
      <div class="filter-row" style="margin-bottom:16px">
        <div class="field" style="flex:1;min-width:200px">
          <label for="mkt-q">Search</label>
          <input class="input" id="mkt-q" type="search" placeholder="Name or ticker, e.g. solana or SOL" value="${escAttr(state.query)}">
        </div>
        <div class="field">
          <label>Segment</label>
          <div class="seg">
            <button data-seg="all" class="${!state.majorsOnly && !state.watchedOnly ? "on" : ""}">Top 100</button>
            <button data-seg="majors" class="${state.majorsOnly ? "on" : ""}">Majors</button>
            <button data-seg="watch" class="${state.watchedOnly ? "on" : ""}">Watchlist</button>
          </div>
        </div>
        <div class="field">
          <label>Sort by</label>
          <select class="input" id="mkt-sort">
            <option value="rank">Market Cap Rank</option>
            <option value="price">Price</option>
            <option value="change">24h Change</option>
            <option value="volume">24h Volume</option>
            <option value="mcap">Market Cap</option>
          </select>
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn" id="mkt-dir" title="Toggle sort direction">${state.dir === 1 ? "Ascending ↑" : "Descending ↓"}</button>
        </div>
      </div>
      <div id="mkt-body">${coinTable(rows)}</div>
    </div>`;

  bindCoinTable(root.querySelector("#mkt-body"));
  root.querySelector("#mkt-sort").value = state.sort;

  root.querySelector("#mkt-q").addEventListener("input", debounce((e) => {
    state.query = e.target.value.trim();
    const body = root.querySelector("#mkt-body");
    body.innerHTML = coinTable(filtered());
    bindCoinTable(body);
  }, 250));

  root.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => {
    state.majorsOnly = b.dataset.seg === "majors";
    state.watchedOnly = b.dataset.seg === "watch";
    paint(root);
  }));
  root.querySelector("#mkt-sort").addEventListener("change", (e) => { state.sort = e.target.value; paint(root); });
  root.querySelector("#mkt-dir").addEventListener("click", () => { state.dir *= -1; paint(root); });
}
