// Central configuration. All endpoints are public and key-free — no secrets
// ever live in frontend code.

export const CONFIG = {
  appName: "TREND AI · CRYPTO PRO",
  api: {
    baseUrl: "https://api.coingecko.com/api/v3",
    fngUrl: "https://api.alternative.me/fng/",
    timeoutMs: 12000,
    // CoinGecko free tier allows ~10-30 req/min. Auto-refresh respects this.
    refreshIntervalMs: 90000,
    cacheTtlMs: 60000,
  },
  vsCurrency: "usd",
  defaultCoinIds: [
    "bitcoin", "ethereum", "tether", "solana", "ripple", "binancecoin",
    "dogecoin", "cardano", "avalanche-2", "tron", "chainlink", "polygon",
    "polkadot", "litecoin", "uniswap", "aptos", "arbitrum", "optimism",
    "injective-protocol", "filecoin",
  ],
  majorCoins: { bitcoin: "BTC", ethereum: "ETH" },
  paper: {
    startingCashUsd: 10000,
    feeRate: 0.001, // simulated exchange fee, 0.1%
  },
};
