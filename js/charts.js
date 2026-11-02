// Chart.js wrappers: neon area price charts, volume bars, sparklines, donuts.

const FONT = "Inter, system-ui, sans-serif";
const activeCharts = new Map(); // canvas element -> Chart instance

Chart.defaults.font.family = FONT;
Chart.defaults.font.size = 11;
Chart.defaults.color = "#9fb0d0";
Chart.defaults.animation.duration = 650;

function gradient(ctx, area, hex1, hex2) {
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, hex1);
  g.addColorStop(1, hex2);
  return g;
}

export function destroyChart(canvas) {
  const c = activeCharts.get(canvas) || Chart.getChart(canvas);
  if (c) { c.destroy(); activeCharts.delete(canvas); }
}

function register(canvas, chart) {
  activeCharts.set(canvas, chart);
  return chart;
}

export function destroyAllIn(root) {
  for (const [canvas, chart] of activeCharts) {
    if (root.contains(canvas)) { chart.destroy(); activeCharts.delete(canvas); }
  }
}

/** Big interactive price + volume chart. points: [[ts, price]] */
export function priceChart(canvas, points, { color = "#00e5ff", spanHours = 24 } = {}) {
  destroyChart(canvas);

  const timeAxis = {
    type: "linear",
    ticks: {
      maxTicksLimit: 7,
      callback: (ts) => {
        const d = new Date(ts);
        return spanHours <= 24
          ? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
          : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      },
    },
    grid: { color: "rgba(86,130,255,0.07)" },
  };

  const price = register(canvas, new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: "Price",
        data: points.map(([ts, p]) => ({ x: ts, y: p })),
        borderColor: color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color,
        tension: 0.28,
        fill: true,
        backgroundColor: (ctx) => {
          const { ctx: c, chartArea } = ctx.chart;
          if (!chartArea) return "transparent";
          return gradient(c, chartArea, color + "44", color + "00");
        },
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0d1b3a", borderColor: color + "66", borderWidth: 1,
          padding: 11, titleFont: { weight: "700" }, displayColors: false,
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toLocaleString("en-US", { dateStyle: "medium", timeStyle: spanHours <= 24 ? "short" : undefined }),
            label: (item) => "$" + item.parsed.y.toLocaleString("en-US", { maximumFractionDigits: item.parsed.y < 1 ? 6 : 2 }),
          },
        },
      },
      scales: {
        x: timeAxis,
        y: {
          position: "right",
          grid: { color: "rgba(86,130,255,0.07)" },
          ticks: { callback: (v) => "$" + (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 4 : 2 })) },
        },
      },
    },
  }));
  return price;
}

/** Compact sparkline for tables. */
export function sparkline(canvas, series, up) {
  destroyChart(canvas);
  const color = up ? "#22e5a0" : "#ff5c7a";
  return register(canvas, new Chart(canvas, {
    type: "line",
    data: { labels: series.map((_, i) => i), datasets: [{ data: series, borderColor: color, borderWidth: 1.4, pointRadius: 0, tension: 0.3, fill: true,
      backgroundColor: (ctx) => {
        const { ctx: c, chartArea } = ctx.chart;
        if (!chartArea) return "transparent";
        return gradient(c, chartArea, color + "33", color + "00");
      } }] },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      elements: { line: { capBezierPoints: true } },
    },
  }));
}

/** Donut for portfolio allocation / dominance. */
export function donutChart(canvas, labels, values, colors) {
  destroyChart(canvas);
  return register(canvas, new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "#0a1733", borderWidth: 2, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true } },
        tooltip: { backgroundColor: "#0d1b3a", borderColor: "rgba(0,229,255,.4)", borderWidth: 1, padding: 10 },
      },
    },
  }));
}

/** Horizontal bar chart for scanner / narratives heat. */
export function barChart(canvas, labels, values, color = "#8b5cf6") {
  destroyChart(canvas);
  return register(canvas, new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: color + "88", borderColor: color, borderWidth: 1, borderRadius: 6, maxBarThickness: 22 }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#0d1b3a", borderColor: color + "66", borderWidth: 1 } },
      scales: {
        x: { grid: { color: "rgba(86,130,255,0.07)" } },
        y: { grid: { display: false } },
      },
    },
  }));
}

/** Fear & greed style 240° gauge arc. */
export function sentimentGauge(canvas, value, color) {
  destroyChart(canvas);
  const v = Math.max(0, Math.min(100, value ?? 50));
  return register(canvas, new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Sentiment", ""],
      datasets: [{ data: [v, 100 - v], backgroundColor: [color, "rgba(86,130,255,0.10)"], borderWidth: 0 }],
    },
    options: {
      rotation: -120, circumference: 240, cutout: "74%",
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  }));
}
