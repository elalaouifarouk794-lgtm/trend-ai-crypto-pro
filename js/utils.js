// Formatting + tiny DOM helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function fmtUsd(n, opts = {}) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const digits = opts.digits ?? (abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function fmtCompact(n) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  return fmtUsd(n);
}

export function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(2) + "%";
}

export function fmtQty(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 4 });
}

export function deltaSpan(n, label = "") {
  const cls = n == null ? "" : n >= 0 ? "up" : "down";
  const arrow = n == null ? "" : n >= 0 ? "▲" : "▼";
  return `<span class="delta ${cls}">${arrow} ${label || fmtPct(n)}</span>`;
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  return Math.floor(s / 3600) + "h ago";
}

export function fmtDate(ts, withTime = false) {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

export function skeletonRows(n, cls = "sk-row") {
  return Array.from({ length: n }, () => `<div class="skeleton ${cls}"></div>`).join("");
}

export function emptyState(title, msg, actionHtml = "") {
  return `<div class="state-box"><h3>${title}</h3><p>${msg}</p>${actionHtml}</div>`;
}

export function errorState(message, retryFnName = "loadView") {
  return `<div class="state-box">
    <h3>Data unavailable</h3>
    <p>${message || "The market data service could not be reached. Check your connection and try again."}</p>
    <button class="btn btn-primary" onclick="window.${retryFnName} && window.${retryFnName}()">Retry</button>
  </div>`;
}

// Minimal markdown-ish rendering for copilot answers (bold + headings + lists).
export function renderMiniMd(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^[-•] (.*)$/gm, "&bull; $1")
    .replace(/\n{2,}/g, "<br><br>")
    .replace(/\n/g, "<br>");
}
