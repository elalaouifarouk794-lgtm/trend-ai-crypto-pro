// HTTP surface for the trading agent.
//
// Two things are deliberately true here: the exchange secret never leaves this
// process, and these routes only answer loopback clients unless the operator
// sets AGENT_API_TOKEN and sends it back in `x-agent-token`. Without that, a
// stranger on the same LAN cannot press "buy" — or switch the agent to live.

import { timingSafeEqual, createHash } from "node:crypto";
import { AgentEngine } from "./agent-engine.mjs";
import { createBinance } from "./binance.mjs";
import { createAgentLoop } from "./agent-loop.mjs";

function isLoopback(ip) {
  if (!ip) return false;
  const clean = ip.replace(/^::ffff:/, "");
  return clean === "127.0.0.1" || clean === "::1" || clean.startsWith("127.");
}

function tokenOk(provided, expected) {
  if (!expected) return false;
  const a = createHash("sha256").update(String(provided || "")).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

async function readJson(req, limit = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error("body too large");
      err.code = "too_large";
      throw err;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createAgentApi({ env = process.env, ai, file = "data/agent.json" }) {
  const secret = env.BINANCE_API_SECRET || "";
  const key = env.BINANCE_API_KEY || "";
  const clients = {
    paper: createBinance({ network: "live" }), // public market data needs no key
    testnet: createBinance({ apiKey: key, apiSecret: secret, network: "testnet" }),
    live: createBinance({ apiKey: key, apiSecret: secret, network: "live" }),
  };
  const active = () => clients[engine.config.mode] || clients.paper;

  // Switching modes must not require rebuilding the engine, so everything talks
  // through this facade and each call lands on the client for the current mode.
  const client = {
    get network() {
      return active().network;
    },
    get hasKeys() {
      return active().hasKeys;
    },
    prices: (s) => active().prices(s),
    klines: (s, i, l) => active().klines(s, i, l),
    filters: (s) => active().filters(s),
    account: () => active().account(),
    marketBuy: (s, q) => active().marketBuy(s, q),
    marketSell: (s, q) => active().marketSell(s, q),
  };

  const engine = new AgentEngine({ file, binance: client });
  const loop = createAgentLoop({ engine, binance: client, ai });

  const cache = { prices: {}, ts: 0 };
  async function prices() {
    if (Date.now() - cache.ts < 5000) return cache.prices;
    try {
      const rows = await clients.paper.prices(engine.config.symbols);
      const map = {};
      for (const r of rows) map[r.symbol] = Number(r.price);
      cache.prices = map;
      cache.ts = Date.now();
    } catch {
      /* keep last known prices */
    }
    return cache.prices;
  }

  async function state() {
    const p = await prices();
    const cfg = engine.config;
    return {
      ok: true,
      configured: { ai: ai.configured, exchangeKeys: Boolean(key && secret) },
      liveBlockedReason: engine.liveBlockedReason,
      config: { ...cfg, liveConfirmed: cfg.liveConfirmed },
      status: loop.status,
      account: engine.summary(p),
      prices: p,
      trades: engine.trades().slice(-60).reverse(),
      equity: engine.equityCurve(),
      journal: engine.journal().slice(-60).reverse(),
    };
  }

  async function handle(req, res) {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const ip = req.socket.remoteAddress;
    const guard = env.AGENT_API_TOKEN;
    if (!isLoopback(ip) && !(guard && tokenOk(req.headers["x-agent-token"], guard))) {
      return send(403, { error: "agent endpoints are loopback-only unless AGENT_API_TOKEN is configured" });
    }
    if (req.method === "GET" && req.url.endsWith("/state")) return send(200, await state());
    if (req.method !== "POST") return send(405, { error: "method not allowed" });

    let body = {};
    try {
      body = await readJson(req);
    } catch (err) {
      if (err?.code === "too_large") return send(413, { error: "request body too large" });
      return send(400, { error: "invalid JSON body" });
    }

    const action = req.url.replace(/^.*\/api\/agent\//, "").split("?")[0];
    try {
      switch (action) {
        case "config": {
          const r = engine.configure(body);
          if (!r.ok) return send(400, { error: r.error });
          engine.log("ok", `mode=${r.config.mode} running=${r.config.running}`);
          await engine.save();
          if (r.config.running) loop.start();
          else loop.stop();
          return send(200, await state());
        }
        case "start": {
          if (engine.liveBlockedReason && engine.config.mode !== "paper") {
            return send(409, { error: engine.liveBlockedReason });
          }
          await engine.setRunning(true, body.note);
          await engine.save();
          await loop.start();
          return send(200, await state());
        }
        case "stop": {
          loop.stop();
          await engine.setRunning(false, body.note || "stopped by operator");
          await engine.save();
          return send(200, await state());
        }
        case "evaluate": {
          if (!engine.config.running) return send(409, { error: "agent is stopped" });
          const r = await loop.tick();
          await engine.save();
          return send(200, { result: r, state: await state() });
        }
        case "close-all": {
          const p = await prices();
          const closed = [];
          for (const order of engine.closeAll(p)) {
            const verdict = engine.gate(order, p);
            if (!verdict.ok) continue;
            const r = await engine.execute({ ...order, ...verdict, confidence: 1, reason: "[manual] close all positions" });
            if (r.ok) closed.push(r.trade);
          }
          await engine.save();
          return send(200, { closed, state: await state() });
        }
        case "reset": {
          loop.stop();
          await engine.reset(body.keepConfig !== false);
          return send(200, await state());
        }
        default:
          return send(404, { error: "unknown agent endpoint" });
      }
    } catch (err) {
      engine.log("err", `${action} failed: ${err.message}`);
      await engine.save().catch(() => {});
      return send(500, { error: "agent request failed", detail: err.message });
    }
  }

  return {
    handle,
    engine,
    loop,
    async boot() {
      await engine.load();
      if (engine.config.running) {
        // Never resume real trading across a restart without a fresh press.
        engine.config.running = false;
        engine.log("warn", "agent was running when the server stopped — start it again to resume");
        await engine.save();
      }
      return this;
    },
  };
}
// --- MetaTrader 5 GridBot Integration Endpoints ---
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'server', 'mt5-bot-data.json');

export function registerMT5BotRoutes(app) {
    // POST: استقبال البيانات من بوت MT5
    app.post('/api/mt5-bot', (req, res) => {
        const { bot_name, status, equity, balance, open_positions, secret_token } = req.body;

        const AUTH_TOKEN = process.env.AGENT_API_TOKEN || "MY_SECRET_KEY_123";
        if (secret_token && secret_token !== AUTH_TOKEN) {
            return res.status(401).json({ success: false, message: "Unauthorized token" });
        }

        const payload = {
            bot_name: bot_name || "MT5 GridBot",
            status: status || "UNKNOWN",
            equity: equity || 0.0,
            balance: balance || 0.0,
            open_positions: open_positions || 0,
            last_update: new Date().toISOString()
        };

        fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
        console.log(`[MT5 AGENT UPDATE] Status: ${payload.status} | Equity: ${payload.equity}`);
        return res.json({ success: true, message: "State received successfully" });
    });

    // GET: قراءة البيانات لعرضها في الموقع
    app.get('/api/mt5-bot', (req, res) => {
        if (!fs.existsSync(DATA_FILE)) {
            return res.json({ status: "STOPPED", equity: 0, balance: 0, open_positions: 0 });
        }
        const rawData = fs.readFileSync(DATA_FILE);
        res.json(JSON.parse(rawData));
    });
}
