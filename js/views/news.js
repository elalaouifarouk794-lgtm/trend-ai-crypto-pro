// News & Narratives: trending coins plus narrative heat derived from live
// sector breadth (deterministic, computed in-browser from market data).

import { store } from "../state.js";
import { fetchTrending, fetchMarkets } from "../api.js";
import { fmtPct, timeAgo } from "../utils.js";

// Sector map for the tracked universe — powers narrative heat.
const SECTORS = [
  { name: "Layer 1 Majors", desc: "BTC, ETH and base-layer settlement chains.", ids: ["bitcoin", "ethereum", "solana", "cardano", "avalanche-2", "tron", "litecoin", "polkadot", "aptos", "filecoin", "near", "hedera-hashgraph", "internet-computer", "cosmos"] },
  { name: "Layer 2 Scaling", desc: "Rollups and optimistic/zk networks scaling Ethereum.", ids: ["arbitrum", "optimism", "polygon", "the-graph", "starknet", "immutable-x"] },
  { name: "DeFi & DEX", desc: "Trading, lending and yield infrastructure.", ids: ["uniswap", "aave", "maker", "lido-dao", "compound-governance-token", "curve-finance", "injective-protocol", "near-protocol", "decentraland"] },
  { name: "Oracle & Middleware", desc: "Data feeds, indexing and interoperability rails.", ids: ["chainlink", "py-network", "band-protocol", "api3"] },
  { name: "Memecoins", desc: "Community-driven assets — pure sentiment plays.", ids: ["dogecoin", "shiba-inu", "pepe", "bonk", "floki", "dogwifcoin"] },
  { name: "Exchange & Payments", desc: "Venue tokens and transfer rails.", ids: ["binancecoin", "ripple", "tether", "kucoin-shares", "htx-dot-ex"] },
];

function sectorHeat() {
  return SECTORS.map((s) => {
    const coins = s.ids.map((id) => store.coinById(id)).filter(Boolean);
    const avg = coins.length
      ? coins.reduce((a, c) => a + (c.price_change_percentage_24h_in_currency ?? 0), 0) / coins.length
      : null;
    return { ...s, coins: coins.length, avg };
  }).filter((s) => s.coins > 0 && s.avg != null)
    .sort((a, b) => b.avg - a.avg);
}

export async function render(root) {
  if (!store.coins.length) await fetchMarkets().catch(() => {});
  if (!store.trending) await fetchTrending().catch(() => {});

  const heat = sectorHeat();
  const trending = store.trending?.coins ?? [];

  root.innerHTML = `
    <div class="grid g-main" style="margin-bottom:18px">
      <div class="card">
        <div class="card-head"><span class="card-title">Trending Narratives<span class="sub">24h sector breadth, computed from live quotes</span></span></div>
        ${heat.length ? heat.map((s, i) => `
          <div class="narrative" style="animation-delay:${i * 0.06}s">
            <span class="rank">${i + 1}</span>
            <div style="flex:1;min-width:120px">
              <div class="name">${s.name}</div>
              <div class="desc">${s.desc} · ${s.coins} tracked assets</div>
            </div>
            <div class="heat-bar"><div class="heat-fill" style="width:${Math.round(((s.avg + 10) / 20) * 100)}%"></div></div>
            <span class="delta ${s.avg >= 0 ? "up" : "down"}" style="min-width:70px;text-align:right">${fmtPct(s.avg)}</span>
          </div>`).join("")
        : '<div class="skeleton" style="height:180px"></div>'}
        <p class="blurb" style="margin-top:14px">Narrative heat = average 24h move of a sector's tracked coins. It measures attention rotation, not fundamentals.</p>
      </div>

      <div class="card">
        <div class="card-head"><span class="card-title">Market Pulse</span></div>
        ${pulseCards()}
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <span class="card-title">Trending Coins<span class="sub">most-searched right now (CoinGecko search trends)</span></span>
      </div>
      ${trending.length ? `<div class="news-grid">
        ${trending.map((t, i) => {
          const item = t.item;
          const ch = item.data?.price_change_percentage_24h?.usd ?? 0;
          return `<div class="card news-card" style="animation-delay:${i * 0.05}s">
            <div style="display:flex;align-items:center;gap:10px">
              ${item.small ? `<img src="${item.small}" alt="" width="30" height="30" style="border-radius:50%">` : ""}
              <div><b>${item.name}</b> <span class="coin-sym">${item.symbol}</span></div>
              <span class="chip ${ch >= 0 ? "up" : "down"}" style="margin-left:auto">${fmtPct(ch)}</span>
            </div>
            <p>Rank #${item.market_cap_rank ?? "?"} · surged into the top search trends in the last hour, a leading indicator of retail attention.</p>
            <div class="news-meta"><span class="chip purple">search trend</span><span>${timeAgo(store.lastUpdated)}</span></div>
          </div>`;
        }).join("")}
      </div>` : '<div class="skeleton" style="height:150px"></div>'}
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">Structural Briefings<span class="sub">evergreen context auto-generated from current data</span></span></div>
      <div class="news-grid">${briefings(heat)}</div>
    </div>`;
}

function pulseCards() {
  const g = store.global;
  const ov = store.coins.length;
  const adv = store.coins.filter((c) => (c.price_change_percentage_24h_in_currency ?? 0) > 0).length;
  return [
    ["Total Market Cap", g ? "$" + (g.total_market_cap.usd / 1e12).toFixed(2) + "T" : "—"],
    ["24h Volume", g ? "$" + (g.total_volume.usd / 1e9).toFixed(1) + "B" : "—"],
    ["Active Assets", g?.active_cryptocurrencies ? String(g.active_cryptocurrencies.toLocaleString("en-US")) : "—"],
    ["Advancing (of tracked)", `${adv} / ${ov}`],
  ].map(([l, v]) => `<div class="pos-card" style="margin-bottom:10px"><div class="lbl">${l}</div><div class="val" style="font-size:18px">${v}</div></div>`).join("");
}

function briefings(heat) {
  const btc = store.coinById("bitcoin");
  const eth = store.coinById("ethereum");
  const items = [];
  if (btc) items.push({
    t: `Bitcoin leads market structure at ${btc.market_cap_rank === 1 ? "#1" : "#" + btc.market_cap_rank}`,
    d: `BTC moved ${fmtPct(btc.price_change_percentage_24h_in_currency)} over 24h while holding ${store.global?.market_cap_percentage?.btc?.toFixed(1) ?? "a dominant"}% of total capitalization. When majors absorb flows, alt breadth usually follows a lag.`,
    tag: "macro",
  });
  if (eth) items.push({
    t: `Ethereum ecosystem reprices at ${fmtPct(eth.price_change_percentage_24h_in_currency)} 24h`,
    d: "ETH functions as beta to the broader market: Layer-2 and DeFi sector heat is the clearest read on whether a move extends beyond the majors.",
    tag: "ecosystem",
  });
  if (heat[0]) items.push({
    t: `${heat[0].name} is the hottest narrative (${fmtPct(heat[0].avg)})`,
    d: `${heat[0].desc} Leading sector breadth tends to attract rotations; trailing laggards see flows only after leaders consolidate.`,
    tag: "rotation",
  });
  if (heat.length > 1 && heat[heat.length - 1].avg < -1) items.push({
    t: `${heat[heat.length - 1].name} under pressure (${fmtPct(heat[heat.length - 1].avg)})`,
    d: "Negative sector breadth often reflects profit-taking after prior outflows — watch whether support levels in leading names hold before calling a rotation.",
    tag: "risk",
  });
  items.push({
    t: "Stablecoin plumbing stays quiet",
    d: "Pegged assets rarely trend — but a widening depeg is one of the fastest regime-warning signals in crypto. Track USDT/USDC deviations as a systemic gauge.",
    tag: "infrastructure",
  });
  return items.map((n, i) => `<div class="card news-card" style="animation-delay:${i * 0.05}s">
      <h4>${n.t}</h4><p>${n.d}</p>
      <div class="news-meta"><span class="chip">${n.tag}</span><span>auto-generated · ${timeAgo(store.lastUpdated)}</span></div>
    </div>`).join("");
}
