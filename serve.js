// TREND AI CRYPTO PRO — zero-dependency static server, AI chat proxy and
// trading-agent backend.
//
// POST /api/chat  { messages: [{role, content}], context?: string }
//   -> { reply: string }                  when an AI provider is configured
//   -> 503 { error, fallback: true }      when no key is set (frontend uses its
//                                          local rule engine instead)
//
// /api/agent/*    see server/agent-api.mjs — loopback-only unless
//                 AGENT_API_TOKEN is set. The exchange secret stays here.
//
// The API keys live ONLY here, read from process.env or a local .env file.
// They are never sent to the browser. Supports any OpenAI-compatible endpoint
// (OpenAI, OpenRouter, Groq, local Ollama/LM Studio, ...).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createAgentApi } from "./server/agent-api.mjs";

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.PORT || 8090);

/* ---------- .env loading (KEY=value lines; existing env wins) ---------- */
function loadDotEnv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = rawVal.replace(/^["']|["']$/g, "").trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

const AI = {
  apiKey: process.env.AI_API_KEY || "",
  baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
  model: process.env.AI_MODEL || "gpt-4o-mini",
  timeoutMs: Number(process.env.AI_TIMEOUT_MS || 30000),
};

const SYSTEM_PROMPT = [
  "You are TREND AI, the educational crypto market assistant inside TREND AI CRYPTO PRO.",
  "Rules:",
  "- Respond in English only.",
  "- You explain markets, indicators, risk concepts and the supplied live market context.",
  "- Never give financial advice, price predictions framed as certainty, or instructions to buy/sell.",
  "- You have no ability to place orders. The separate Agent page is the only thing that trades, and it is user-controlled.",
  "- Be concise (under ~180 words), structured with short paragraphs or bullets.",
  "- If asked something outside crypto education or market analysis, politely redirect.",
  "- When a MARKET CONTEXT block is provided, ground your answer in those numbers.",
].join("\n");

/* ---------- rate limiting: 10 chat requests / minute / IP ---------- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10;
}

/* ---------- helpers ---------- */
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        const err = new Error("body too large");
        err.code = "too_large";
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

async function providerComplete(messages, { temperature = 0.4, maxTokens = 700 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI.timeoutMs);
  try {
    const res = await fetch(`${AI.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${AI.apiKey}`,
      },
      body: JSON.stringify({
        model: AI.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error("provider returned no content");
    return reply;
  } finally {
    clearTimeout(timer);
  }
}

// The trading agent talks to the same provider through this narrow adapter, so
// it can never see the key and only ever gets a completion back.
const ai = {
  get configured() {
    return Boolean(AI.apiKey);
  },
  get model() {
    return AI.model;
  },
  complete: (messages, opts) => {
    if (!AI.apiKey) return Promise.reject(new Error("AI provider not configured"));
    return providerComplete(messages, opts);
  },
};

const agent = createAgentApi({ env: process.env, ai, file: join(ROOT, "data", "agent.json") });

async function handleChat(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) return json(res, 429, { error: "Too many requests, slow down.", fallback: true });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    if (err?.code === "too_large") return json(res, 413, { error: "Request body too large." });
    return json(res, 400, { error: "Invalid JSON body." });
  }

  const history = sanitizeMessages(body.messages);
  if (!history.length || !history.some((m) => m.role === "user")) {
    return json(res, 400, { error: "No user message provided." });
  }

  if (!AI.apiKey) {
    return json(res, 503, { error: "AI provider not configured on this server.", fallback: true });
  }

  const context = typeof body.context === "string" ? body.context.slice(0, 6000) : "";
  const messages = [{ role: "system", content: SYSTEM_PROMPT + (context ? `\n\n${context}` : "") }, ...history];

  try {
    const reply = await providerComplete(messages);
    json(res, 200, { reply, model: AI.model });
  } catch (err) {
    // Never surface provider details beyond a generic message.
    console.warn("[chat] provider error:", err.message);
    json(res, 502, { error: "AI provider unavailable.", fallback: true });
  }
}

/* ---------- static file handler ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  if (/(^|\/)\./.test(rel)) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
  const file = normalize(join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  readFile(file)
    .then((body) => {
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    })
    .catch(() => res.writeHead(404, { "content-type": "text/plain" }).end("Not found"));
}

createServer(async (req, res) => {
  if (req.url.startsWith("/api/agent/")) {
    try { await agent.handle(req, res); }
    catch (err) { console.error("[agent]", err); if (!res.headersSent) json(res, 500, { error: "Agent endpoint failed." }); }
    return;
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    try { await handleChat(req, res); }
    catch (err) { console.error("[chat]", err); if (!res.headersSent) json(res, 500, { error: "Internal error.", fallback: true }); }
    return;
  }
  if (req.url === "/api/health") {
    json(res, 200, {
      ok: true,
      aiConfigured: !!AI.apiKey,
      model: AI.apiKey ? AI.model : null,
      agent: {
        mode: agent.engine.config.mode,
        running: agent.engine.config.running,
        exchangeKeys: Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET),
      },
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
  serveStatic(req, res);
}).listen(PORT, async () => {
  await agent.boot();
  console.log(`TREND AI CRYPTO PRO → http://localhost:${PORT}`);
  console.log(`AI chat endpoint: POST /api/chat (${AI.apiKey ? `configured · ${AI.model}` : "no key — clients use local fallback"})`);
  const cfg = agent.engine.config;
  console.log(`Trading agent: ${cfg.mode.toUpperCase()} mode · ${cfg.running ? "RUNNING" : "stopped"} · allowlist ${cfg.symbols.join(", ")} · max ${cfg.maxOrderUsd} USD/order`);
  if (cfg.mode !== "paper") console.log(`  ! ${agent.liveBlockedReason || "live venue selected — real orders will be sent"}`);
});
