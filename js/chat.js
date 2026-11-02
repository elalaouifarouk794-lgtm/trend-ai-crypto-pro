// Mountable chat component: message log, input, suggestion chips.
// Talks to the backend /api/chat via assistant.askAssistant and transparently
// falls back to the local engine (badge shows which one answered).

import { askAssistant } from "./assistant.js";
import { renderMiniMd } from "./utils.js";

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function mountChat(container, { suggestions = [], greeting, compact = false } = {}) {
  const history = []; // { role, content }

  container.innerHTML = `
    <div class="chat-wrap${compact ? " chat-compact" : ""}">
      <div class="chat-log" data-chat-log></div>
      ${suggestions.length ? `<div class="suggest-row" data-chat-suggest>
        ${suggestions.map((s) => `<button class="suggest-chip">${escapeHtml(s)}</button>`).join("")}
      </div>` : ""}
      <div class="chat-input">
        <input class="input" data-chat-input placeholder="Ask about a coin, the market, or a concept…" aria-label="Ask the assistant">
        <button class="btn btn-primary" data-chat-send>Ask</button>
      </div>
    </div>`;

  const log = container.querySelector("[data-chat-log]");
  const input = container.querySelector("[data-chat-input]");
  const sendBtn = container.querySelector("[data-chat-send]");

  function paint() {
    log.innerHTML = history.map((m) => {
      const mine = m.role === "user";
      return `
      <div class="msg ${mine ? "user" : "ai"}">
        <div class="avatar">${mine ? "ME" : "AI"}</div>
        <div class="bubble">${mine
          ? escapeHtml(m.content)
          : renderMiniMd(m.content) + (m.source ? `<div class="src-tag">${m.source === "ai" ? "AI model" : "Local engine"}</div>` : "")}</div>
      </div>`;
    }).join("");
    log.scrollTop = log.scrollHeight;
  }

  function showTyping() {
    const t = document.createElement("div");
    t.className = "msg ai"; t.dataset.typing = "1";
    t.innerHTML = '<div class="avatar">AI</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
    log.append(t); log.scrollTop = log.scrollHeight;
    return t;
  }

  async function ask(text) {
    text = text.trim();
    if (!text || sendBtn.disabled) return;
    history.push({ role: "user", content: text });
    paint();
    sendBtn.disabled = true;
    const typing = showTyping();
    try {
      const { reply, source } = await askAssistant(history.slice(-14));
      typing.remove();
      history.push({ role: "assistant", content: reply, source });
    } catch (err) {
      typing.remove();
      history.push({ role: "assistant", content: `I could not complete that answer: ${err.message}` });
    }
    sendBtn.disabled = false;
    paint();
    input.focus();
  }

  sendBtn.addEventListener("click", () => { ask(input.value); input.value = ""; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { ask(input.value); input.value = ""; }
  });
  container.querySelectorAll("[data-chat-suggest] .suggest-chip").forEach((b) =>
    b.addEventListener("click", () => ask(b.textContent)));

  history.push({ role: "assistant", content: greeting ?? "Ask me about a coin, the market, or any crypto concept." });
  paint();

  return {
    ask,
    reset() { history.length = 0; history.push({ role: "assistant", content: greeting ?? "Ask me about a coin, the market, or any crypto concept." }); paint(); },
    history,
  };
}
