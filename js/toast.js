// Lightweight toast notifications.

const host = () => document.getElementById("toast-host");

export function toast(message, kind = "info", ms = 3200) {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  const icon = document.createElement("b");
  icon.textContent = kind === "ok" ? "✓" : kind === "err" ? "✕" : "ℹ";
  const dot = document.createElement("span");
  dot.className = "dot " + (kind === "ok" ? "dot-live" : kind === "err" ? "dot-down" : "");
  node.append(icon, dot, document.createTextNode(message));
  host()?.append(node);
  setTimeout(() => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 350);
  }, ms);
}
