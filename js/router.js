// Hash-based router with animated view transitions.

import { destroyAllIn } from "./charts.js";

const root = () => document.getElementById("view-root");

export const ROUTES = {
  dashboard: { title: "Dashboard", module: () => import("./views/dashboard.js") },
  market: { title: "Live Market", module: () => import("./views/market.js") },
  charts: { title: "BTC / ETH Charts", module: () => import("./views/chartsView.js") },
  copilot: { title: "AI Crypto Copilot", module: () => import("./views/copilot.js") },
  scanner: { title: "Market Scanner", module: () => import("./views/scanner.js") },
  watchlist: { title: "Watchlist", module: () => import("./views/watchlist.js") },
  news: { title: "News & Narratives", module: () => import("./views/news.js") },
  paper: { title: "Paper Trading Simulator", module: () => import("./views/paper.js") },
  agent: { title: "AI Trading Agent", module: () => import("./views/agent.js") },
};

let currentRoute = null;
let renderQueue = Promise.resolve();

function syncNav(route) {
  document.querySelectorAll(".nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
  document.getElementById("page-title").textContent = ROUTES[route]?.title ?? "Dashboard";
  document.body.classList.remove("nav-open");
}

async function renderRoute(route) {
  const def = ROUTES[route] || ROUTES.dashboard;
  const container = root();
  destroyAllIn(container);
  currentRoute = route;
  syncNav(route);
  container.innerHTML = "";
  try {
    const mod = await def.module();
    await mod.render(container);
  } catch (err) {
    console.error("[router]", err);
    container.innerHTML = `<div class="state-box"><h3>View failed to load</h3><p>${err.message}</p></div>`;
  }
  window.scrollTo({ top: 0 });
}

async function transition(route) {
  const container = root();
  container.classList.add("switching");
  await new Promise((r) => setTimeout(r, 160));
  container.classList.remove("switching");
  await renderRoute(route);
}

function schedule(route, animate) {
  renderQueue = renderQueue.then(() => (animate ? transition(route) : renderRoute(route))).catch(console.error);
  return renderQueue;
}

function navigate() {
  const route = (location.hash.replace(/^#\//, "") || "dashboard").split("?")[0];
  if (route === currentRoute) return;
  return schedule(route, true);
}

// Re-render the active view without changing the hash (used by refresh).
export function reloadView() {
  const route = (location.hash.replace(/^#\//, "") || "dashboard").split("?")[0];
  return schedule(route, false);
}

export function go(route) {
  if (currentRoute === route) { reloadView(); return; }
  location.hash = "#/" + route;
}

export function startRouter() {
  window.addEventListener("hashchange", navigate);
  navigate();
}

// Expose for the error-state retry button in utils.
window.loadView = reloadView;
