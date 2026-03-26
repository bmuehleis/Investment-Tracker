/**
 * app.js — Investment Tracker frontend
 * Backend: POST/GET /api/v1/trades
 * Trade shape: { ticker, date, action, quantity, price, commission, currency, note }
 */

let API = localStorage.getItem("api_url") || "http://127.0.0.1:8000/api/v1";

// ── Helpers ──────────────────────────────────────────────

function fmt(value, decimals = 2) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return dateStr; }
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

// ── Tab navigation ────────────────────────────────────────

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${tab}`).classList.add("active");

    if (tab === "dashboard") loadDashboard();
    if (tab === "trades")    loadTrades();
  });
});

// ── Global Refresh button ─────────────────────────────────

document.getElementById("btn-global-refresh").addEventListener("click", () => {
  const activeTab = document.querySelector(".tab.active").id.replace("tab-", "");
  if (activeTab === "dashboard") loadDashboard();
  if (activeTab === "trades")    loadTrades();
  showToast("Refreshed.");
});

// ── Settings modal ────────────────────────────────────────

const settingsModal = document.getElementById("settings-modal");

document.getElementById("btn-settings").addEventListener("click", () => {
  document.getElementById("setting-api-url").value = API;
  settingsModal.style.display = "flex";
});

document.getElementById("btn-close-settings").addEventListener("click", () => {
  settingsModal.style.display = "none";
});

settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.style.display = "none";
});

document.getElementById("btn-save-settings").addEventListener("click", () => {
  const newUrl = document.getElementById("setting-api-url").value.trim().replace(/\/$/, "");
  if (newUrl) {
    API = newUrl;
    localStorage.setItem("api_url", API);
  }
  settingsModal.style.display = "none";
  showToast("Settings saved.");
});

// ── Shared: fetch all trades ──────────────────────────────

async function fetchTrades() {
  const res = await fetch(`${API}/trades`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.trades || [];
}

// ── Trade row builder (full schema) ──────────────────────

function buildRow(trade, includeNote = false) {
  const action     = (trade.action || "buy").toLowerCase();
  const quantity   = trade.quantity != null ? fmt(trade.quantity, 4) : "—";
  const price      = trade.price    != null ? fmt(trade.price,    2) : "—";
  const commission = trade.commission != null ? fmt(trade.commission, 2) : "—";
  const total      = (trade.quantity != null && trade.price != null)
    ? fmt(trade.quantity * trade.price)
    : "—";
  const currency   = trade.currency || "—";
  const date       = fmtDate(trade.date);
  const noteCell   = includeNote
    ? `<td class="note-cell">${trade.note || ""}</td>`
    : "";

  return `
    <tr>
      <td class="ticker-cell">${trade.ticker}</td>
      <td class="mono" style="color:var(--text-muted)">${date}</td>
      <td><span class="badge badge-${action}">${action.toUpperCase()}</span></td>
      <td class="mono">${quantity}</td>
      <td class="mono">${price}</td>
      <td class="mono">${commission}</td>
      <td class="mono">${total}</td>
      <td class="mono" style="color:var(--text-muted)">${currency}</td>
      ${noteCell}
    </tr>
  `;
}

// ── Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
  const tbody = document.getElementById("dashboard-body");
  tbody.innerHTML = `<tr><td colspan="8" class="empty">Loading...</td></tr>`;

  try {
    const trades = await fetchTrades();

    // --- Summary stats ---
    const buys  = trades.filter(t => (t.action || "buy").toLowerCase() === "buy");
    const sells = trades.filter(t => (t.action || "buy").toLowerCase() === "sell");

    const totalInvested  = buys.reduce((s, t) => s + (t.quantity ?? 0) * (t.price ?? 0), 0);
    const totalReturned  = sells.reduce((s, t) => s + (t.quantity ?? 0) * (t.price ?? 0), 0);
    const realisedGains  = totalReturned - sells.reduce((s, t) => {
      // best-effort: cost basis from buys if available, else 0
      return s;
    }, 0);

    document.getElementById("portfolio-value").textContent  = `€ ${fmt(totalInvested)}`;
    document.getElementById("unrealised-gains").textContent = "—";
    document.getElementById("unrealised-gains-sub").textContent = "Live prices needed";
    document.getElementById("realised-gains").textContent   = `€ ${fmt(totalReturned - totalInvested < 0 ? 0 : totalReturned - totalInvested)}`;
    document.getElementById("total-trades").textContent     = trades.length;
    document.getElementById("total-trades-sub").textContent = `${buys.length} buys · ${sells.length} sells`;

    // --- Chart ---
    renderPlaceholderChart(trades);

    // --- Table: 5 most recent ---
    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">No trades yet. Add a trade to get started.</td></tr>`;
      return;
    }
    tbody.innerHTML = trades.slice(-5).reverse().map(t => buildRow(t, false)).join("");

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">Error loading data.</td></tr>`;
    console.error(e);
  }
}

document.getElementById("btn-refresh").addEventListener("click", () => {
  loadDashboard();
  showToast("Refreshed.");
});

// ── Portfolio chart (placeholder with simulated data) ─────

let chartInstance = null;
let currentWindow = "1W";

function generatePlaceholderData(trades, window) {
  // Build a cumulative invested-value series from real trade dates (or simulate)
  const days = { "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "ALL": 730 }[window] || 30;
  const points = Math.min(days, 60);
  const labels = [];
  const values = [];
  const now    = Date.now();
  let   base   = 10000;

  for (let i = points; i >= 0; i--) {
    const d = new Date(now - i * (days / points) * 86400000);
    labels.push(d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }));
    base += (Math.random() - 0.44) * base * 0.025;
    values.push(Math.max(0, base));
  }
  return { labels, values };
}

function renderPlaceholderChart(trades) {
  const canvas      = document.getElementById("portfolio-chart");
  const placeholder = document.getElementById("chart-placeholder");

  // Always show the simulated chart (placeholder data)
  placeholder.style.display = "none";

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const { labels, values } = generatePlaceholderData(trades, currentWindow);

  const gradient = canvas.getContext("2d").createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, "rgba(79,158,255,0.18)");
  gradient.addColorStop(1, "rgba(79,158,255,0)");

  chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data:            values,
        borderColor:     "#4f9eff",
        borderWidth:     2,
        backgroundColor: gradient,
        fill:            true,
        tension:         0.4,
        pointRadius:     0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: "#4f9eff",
      }]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction:         { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c2030",
          borderColor:     "#252a38",
          borderWidth:     1,
          titleColor:      "#6b7490",
          bodyColor:       "#e2e6f0",
          titleFont:       { family: "'IBM Plex Mono'" },
          bodyFont:        { family: "'IBM Plex Mono'" },
          callbacks: {
            label: ctx => ` € ${fmt(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid:  { color: "#1c2030", drawBorder: false },
          ticks: { color: "#6b7490", font: { family: "'IBM Plex Mono'", size: 10 }, maxTicksLimit: 6 }
        },
        y: {
          grid:  { color: "#1c2030", drawBorder: false },
          ticks: { color: "#6b7490", font: { family: "'IBM Plex Mono'", size: 10 },
                   callback: v => `€ ${fmt(v, 0)}` }
        }
      }
    }
  });
}

// Time-window buttons
document.querySelectorAll(".tw-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tw-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentWindow = btn.dataset.window;
    // Re-render chart with new window
    fetchTrades().then(trades => renderPlaceholderChart(trades)).catch(() => {});
  });
});

// ── Trades tab ────────────────────────────────────────────

async function loadTrades() {
  const tbody = document.getElementById("trades-body");
  tbody.innerHTML = `<tr><td colspan="9" class="empty">Loading...</td></tr>`;

  try {
    const trades = await fetchTrades();

    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">No trades yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = [...trades].reverse().map(t => buildRow(t, true)).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">Error loading trades.</td></tr>`;
    console.error(e);
  }
}

// ── Add trade form (full schema) ──────────────────────────

// Set today as default date
document.getElementById("f-date").valueAsDate = new Date();

// Auto-uppercase ticker while typing
document.getElementById("f-ticker").addEventListener("input", function () {
  const pos = this.selectionStart;
  this.value = this.value.toUpperCase();
  this.setSelectionRange(pos, pos);
});

// Live preview — updated for full schema
["f-ticker", "f-date", "f-action", "f-quantity", "f-price", "f-commission", "f-currency"].forEach(id => {
  document.getElementById(id).addEventListener("input", updatePreview);
  document.getElementById(id).addEventListener("change", updatePreview);
});

function updatePreview() {
  const ticker     = document.getElementById("f-ticker").value.trim();
  const date       = document.getElementById("f-date").value;
  const action     = document.getElementById("f-action").value.toUpperCase();
  const quantity   = parseFloat(document.getElementById("f-quantity").value);
  const price      = parseFloat(document.getElementById("f-price").value);
  const commission = parseFloat(document.getElementById("f-commission").value) || 0;
  const currency   = document.getElementById("f-currency").value;
  const preview    = document.getElementById("trade-preview");

  if (ticker && !isNaN(quantity) && !isNaN(price) && quantity > 0 && price > 0) {
    const total = quantity * price;
    const commStr = commission > 0 ? ` + ${fmt(commission)} commission` : "";
    const dateStr = date ? ` · ${date}` : "";
    preview.textContent = `${action} ${ticker} · ${fmt(quantity, 4)} shares @ ${currency} ${fmt(price)} = ${currency} ${fmt(total)}${commStr}${dateStr}`;
  } else {
    preview.textContent = "";
  }
}

document.getElementById("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById("form-msg");
  msgEl.className = "";
  msgEl.textContent = "Saving…";

  const ticker     = document.getElementById("f-ticker").value.trim().toUpperCase();
  const date       = document.getElementById("f-date").value;
  const action     = document.getElementById("f-action").value;
  const quantity   = parseFloat(document.getElementById("f-quantity").value);
  const price      = parseFloat(document.getElementById("f-price").value);
  const commission = parseFloat(document.getElementById("f-commission").value) || 0;
  const currency   = document.getElementById("f-currency").value;
  const note       = document.getElementById("f-note").value.trim();

  if (!ticker || !date || isNaN(quantity) || quantity <= 0 || isNaN(price) || price <= 0) {
    msgEl.className = "err";
    msgEl.textContent = "Please fill in all required fields correctly.";
    return;
  }

  try {
    const payload = { ticker, date, action, quantity, price, commission, currency };
    if (note) payload.note = note;

    const res = await fetch(`${API}/trades`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    msgEl.className = "";
    msgEl.textContent = `✓ Trade saved: ${action.toUpperCase()} ${ticker} — ${currency} ${fmt(quantity * price)}`;
    document.getElementById("add-form").reset();
    document.getElementById("f-date").valueAsDate = new Date();
    document.getElementById("trade-preview").textContent = "";
    showToast("Trade saved!");
  } catch (err) {
    msgEl.className = "err";
    msgEl.textContent = `Error: ${err.message}`;
  }
});

// ── Chart.js loader ───────────────────────────────────────

function loadChartJS(cb) {
  if (window.Chart) { cb(); return; }
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js";
  s.onload = cb;
  document.head.appendChild(s);
}

// ── Init ──────────────────────────────────────────────────

loadChartJS(() => loadDashboard());