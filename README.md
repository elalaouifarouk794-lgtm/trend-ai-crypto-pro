# TREND AI CRYPTO PRO

Crypto market-intelligence dashboard with an AI copilot, a scanner, a virtual-funds
paper trader and an **autonomous trading agent** that runs on the server.

Static ES-module frontend (no build step) + a zero-dependency Node server that acts as
the AI proxy, the exchange client and the risk gate.

```
node serve.js        →  http://localhost:8090
```

Requires Node 18+. Copy `.env.example` to `.env` first — `.env` is gitignored and its
keys never reach the browser.

## Pages

| Route | What it does |
| --- | --- |
| `#/dashboard` | Market overview, dominance, movers, Fear & Greed |
| `#/market` | Top-100 coin table, search, sort |
| `#/charts` | BTC/ETH price + volume charts |
| `#/copilot` | Full-screen AI chat (server model, local fallback) |
| `#/scanner` | Signal scanner over the watchlist universe |
| `#/watchlist` | Saved coins |
| `#/news` | Headlines and narratives |
| `#/paper` | Virtual-funds simulator — no wallet, no exchange, no money |
| `#/agent` | The autonomous agent: live trades and P&L |

Market data comes from CoinGecko's public endpoints and Binance's public REST. When
those are unreachable the app serves labelled demo data instead of failing.

## The trading agent (`#/agent`)

The loop runs server-side, not in the browser:

```
Binance klines → indicators (RSI/EMA/range) → AI decision (strict JSON)
               → risk gate → paper fill or real MARKET order → ledger + P&L
```

- **The model proposes, the gate disposes.** `server/agent-engine.mjs` is the only code
  that can approve an order: symbol allowlist, max USD per order, max open positions,
  daily loss cap, 15 s cooldown, 30 orders/day, minimum confidence. A model that asks
  for `$999,999` on a non-allowlisted coin gets clamped or rejected, and the rejection
  is written to the agent log.
- **Three modes.** `paper` (default) fills against real live prices with fee + slippage
  assumptions and needs no key. `testnet` sends real orders to Binance Testnet.
  `live` sends real orders to your Binance spot account.
- **Live is deliberately hard to reach.** It requires exchange keys in `.env`, a typed
  `LIVE FUNDS` confirmation persisted as `liveConfirmed`, and it never re-enables itself
  when the server restarts — a boot always lands on *stopped*.
- **Kill switch** stops the loop immediately; **Close positions** market-sells everything.
- Endpoints are **loopback-only** unless you set `AGENT_API_TOKEN`, so a stranger on your
  LAN cannot press buy. The exchange secret is never sent to the client, and there are no
  withdrawal endpoints anywhere in the code.

### Before you trade real money

This is software written for a dashboard, not a fund-managed execution system. It has had
no security audit, no backtest, and the model can be wrong or manipulated by the very
prices it reads. Prices move while the loop is between cycles, MARKET orders have no
price ceiling, and a `dailyLossLimitUsd` breach only stops *new* orders — it cannot undo
one that already filled. Run it in paper for a while, then testnet, then only ever live
with an account whose total balance you can afford to lose. Nothing here is financial
advice, and nothing here is a promise that it will make money.

## Vendored DEX SDK (`vendor/`)

`tools/install-vendor.mjs` downloads the pinned Uniswap/ethers dependency graph from
`registry.npmjs.org`, verifies every tarball against the registry's own sha512 integrity,
installs conflicting versions nested (exactly like npm) and bundles one deduplicated ESM
file with esbuild:

```
node tools/install-vendor.mjs     # needs an esbuild binary; set ESBUILD_PATH
```

One bundle is not a style choice: the SDKs type-check `token instanceof Token`, so
`sdk-core` must be a single module instance shared by v2-sdk and v3-sdk. The swap UI that
consumes it is not wired yet — `vendor/dex-sdk.mjs` is currently an unused, verified
artifact, and no on-chain trading happens in this app.

## Layout

```
serve.js                  static server + /api/chat + /api/health + /api/agent/*
server/binance.mjs        public + signed Binance REST, HMAC signing, MARKET orders only
server/agent-engine.mjs   ledger, P&L, risk gate, config validation
server/agent-loop.mjs     indicators, prompt building, JSON parsing, scheduling
server/agent-api.mjs      HTTP surface, loopback guard, state snapshots
js/                       frontend views (ES modules, hash router, Chart.js)
tools/install-vendor.mjs  reproducible DEX SDK bundler
vendor/                   dex-sdk.mjs + manifest.json (versions + hashes)
data/agent.json           local ledger — gitignored, contains your trade history
```
