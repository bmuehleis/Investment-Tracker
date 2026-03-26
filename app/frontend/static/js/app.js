/**
 * app.js — Investment Tracker frontend
 * Trade schema: { ticker, date, action, quantity, price, commission, currency, note }
 * Gains endpoints: GET /portfolio/unrealized  GET /portfolio/realized  GET /portfolio/total
 * Positions endpoint: GET /positions/get_positions  (returns open positions with current price / gain)
 * Edit:   PUT  /trades/{trade_id}   body: TradeCreate
 * Delete: DELETE /trades/{trade_id}
 */

let API = localStorage.getItem("api_url") || "http://127.0.0.1:8000/api/v1";
let DEFAULT_CURRENCY = localStorage.getItem("default_currency") || "EUR";

// ── Constants ─────────────────────────────────────────────
const CURRENCY_SYMBOLS = { "EUR": "€", "USD": "$", "GBP": "£" };
const CACHE_KEYS = {
  TRADES: "TRADES",
  GAINS: "GAINS",
  POSITIONS: "POSITIONS"
};

// ── Data Caching System ───────────────────────────────────────
// Smart client-side caching to reduce API calls and improve performance

const DataCache = {
  storage: {},

  TTL: {
    TRADES: 24 * 60,           // 24 hours
    REALIZED_PNL: 4 * 60,      // 4 hours
    UNREALIZED_PNL: 10,        // 10 minutes
    POSITIONS: 10,             // 10 minutes
    PORTFOLIO_VALUE: 10        // 10 minutes
  },

  set(key, data, ttl_minutes) {
    this.storage[key] = { data, timestamp: Date.now(), ttl_minutes };
  },

  get(key) {
    const item = this.storage[key];
    if (!item) return null;

    const age_minutes = (Date.now() - item.timestamp) / (1000 * 60);
    if (age_minutes > item.ttl_minutes) {
      delete this.storage[key];
      return null;
    }
    return item.data;
  },

  invalidate(pattern) {
    for (const key in this.storage) {
      if (key.includes(pattern)) delete this.storage[key];
    }
  },

  clear() {
    this.storage = {};
  }
};

// ── Helpers ──────────────────────────────────────────────

function fmt(value, decimals = 2) {
  if (value === null || value === undefined || isNaN(value)) return "—";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  try { return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return dateStr; }
}

function gainClass(val) {
  if (val === null || val === undefined || isNaN(val)) return "gain-neu";
  return val > 0 ? "gain-pos" : val < 0 ? "gain-neg" : "gain-neu";
}

function gainPrefix(val) {
  return (!val || isNaN(val)) ? "" : val > 0 ? "+" : "";
}

function getCurrencySymbol(currency) {
  return CURRENCY_SYMBOLS[currency] || currency;
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

// ── Global refresh button ─────────────────────────────────

document.getElementById("btn-global-refresh").addEventListener("click", () => {
  DataCache.clear();
  const active = document.querySelector(".tab.active")?.id?.replace("tab-", "");
  if (active === "dashboard") loadDashboard();
  if (active === "trades")    loadTrades();
  showToast("Cache cleared. Refreshed from server.");
});

// ── Settings modal ────────────────────────────────────────

const settingsModal = document.getElementById("settings-modal");

document.getElementById("btn-settings").addEventListener("click", () => {
  document.getElementById("setting-api-url").value = API;
  document.getElementById("setting-currency").value = DEFAULT_CURRENCY;
  settingsModal.style.display = "flex";
});

document.getElementById("btn-close-settings").addEventListener("click", () => {
  settingsModal.style.display = "none";
});

settingsModal.addEventListener("click", e => {
  if (e.target === settingsModal) settingsModal.style.display = "none";
});

document.getElementById("btn-save-settings").addEventListener("click", () => {
  const newUrl = document.getElementById("setting-api-url").value.trim().replace(/\/$/, "");
  if (newUrl) { API = newUrl; localStorage.setItem("api_url", API); }

  const newCurrency = document.getElementById("setting-currency").value;
  if (newCurrency && newCurrency !== DEFAULT_CURRENCY) {
    // Currency changed - invalidate currency-specific caches
    DataCache.invalidate(CACHE_KEYS.GAINS);
    DataCache.invalidate(CACHE_KEYS.POSITIONS);
  }
  if (newCurrency) {
    DEFAULT_CURRENCY = newCurrency;
    localStorage.setItem("default_currency", DEFAULT_CURRENCY);
  }

  settingsModal.style.display = "none";
  showToast("Settings saved.");

  // Reload dashboard with new settings
  const active = document.querySelector(".tab.active")?.id?.replace("tab-", "");
  if (active === "dashboard") loadDashboard();
  if (active === "trades") loadTrades();
});

// ── Fetch helpers ─────────────────────────────────────────

// Invalidate all dashboard-related caches
function invalidateDashboardCaches() {
  DataCache.invalidate(CACHE_KEYS.GAINS);
  DataCache.invalidate(CACHE_KEYS.POSITIONS);
  DataCache.invalidate(CACHE_KEYS.TRADES);
}

// Auto-refresh dashboard if currently active
function refreshDashboardIfActive() {
  if (document.getElementById("tab-dashboard").classList.contains("active")) {
    loadDashboard();
  }
}

async function fetchTrades() {
  const res = await fetch(`${API}/trades`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.trades || [];
}

async function fetchGains() {
  const [unrealRes, realRes, totalRes] = await Promise.allSettled([
    fetch(`${API}/portfolio/unrealized?currency=${DEFAULT_CURRENCY}`),
    fetch(`${API}/portfolio/realized?currency=${DEFAULT_CURRENCY}`),
    fetch(`${API}/portfolio/total?currency=${DEFAULT_CURRENCY}`),
  ]);

  const safeJson = async (r) => {
    if (r.status !== "fulfilled" || !r.value.ok) return null;
    try { return await r.value.json(); } catch { return null; }
  };

  return {
    unrealized: await safeJson(unrealRes),
    realized:   await safeJson(realRes),
    total:      await safeJson(totalRes),
  };
}

async function fetchPositions() {
  const res = await fetch(`${API}/positions/get_positions?currency=${DEFAULT_CURRENCY}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.positions || data || [];
}

// ── Cached Fetch Functions ────────────────────────────────

async function fetchTradesCached() {
  const cached = DataCache.get(CACHE_KEYS.TRADES);
  if (cached) return cached;

  const trades = await fetchTrades();
  DataCache.set(CACHE_KEYS.TRADES, trades, DataCache.TTL.TRADES);
  return trades;
}

async function fetchGainsCached() {
  const cacheKey = `${CACHE_KEYS.GAINS}_${DEFAULT_CURRENCY}`;
  const cached = DataCache.get(cacheKey);
  if (cached) return cached;

  const gains = await fetchGains();
  DataCache.set(cacheKey, gains, DataCache.TTL.UNREALIZED_PNL);
  return gains;
}

async function fetchPositionsCached() {
  const cacheKey = `${CACHE_KEYS.POSITIONS}_${DEFAULT_CURRENCY}`;
  const cached = DataCache.get(cacheKey);
  if (cached) return cached;

  const positions = await fetchPositions();
  DataCache.set(cacheKey, positions, DataCache.TTL.POSITIONS);
  return positions;
}

// ── Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
  const posBody = document.getElementById("positions-body");
  posBody.innerHTML = `<tr><td colspan="8" class="empty">Loading...</td></tr>`;

  // ── Gains cards ──
  try {
    const gains = await fetchGainsCached();

    // Helper to extract a numeric value from various response shapes
    const extractVal = (obj, ...keys) => {
      if (obj === null || obj === undefined) return null;
      for (const k of keys) {
        if (obj[k] !== undefined) return Number(obj[k]);
      }
      if (typeof obj === "number") return obj;
      return null;
    };

    const unrealVal = extractVal(gains.unrealized, "unrealized_gains", "value", "unrealized", "gains");
    const realVal   = extractVal(gains.realized,   "realized_gains",   "value", "realized",   "gains");
    const totalVal  = extractVal(gains.total,       "total_gains",      "value", "total",      "gains");

    // Portfolio value: fall back to fetching trades if no endpoint
    let portfolioVal = null;
    let trades = null;
    try {
      trades = await fetchTradesCached();

      const invested = trades
        .filter(t => (t.action || "buy").toLowerCase() === "buy")
        .reduce((s, t) => s + (t.quantity ?? 0) * (t.price ?? 0), 0);

      portfolioVal = invested + (unrealVal ?? 0);
    } catch {}

    const setCard = (id, subId, val) => {
      const el    = document.getElementById(id);
      const subEl = document.getElementById(subId);
      if (val === null) {
        el.textContent  = "—";
        el.className    = "card-value mono";
        subEl.textContent = "Not available";
        subEl.className   = "card-sub";
        return;
      }
      const symbol = getCurrencySymbol(DEFAULT_CURRENCY);
      el.textContent  = `${symbol} ${gainPrefix(val)}${fmt(Math.abs(val))}`;
      el.className    = `card-value mono ${val > 0 ? "positive" : val < 0 ? "negative" : ""}`;
      subEl.className = `card-sub ${val > 0 ? "positive" : val < 0 ? "negative" : ""}`;
      subEl.textContent = val > 0 ? "▲ Positive" : val < 0 ? "▼ Negative" : "Breakeven";
    };

    const symbol = getCurrencySymbol(DEFAULT_CURRENCY);
    document.getElementById("portfolio-value").textContent = portfolioVal !== null ? `${symbol} ${fmt(portfolioVal)}` : "—";
    document.getElementById("portfolio-value").className   = "card-value mono";

    setCard("unrealised-gains", "unrealised-gains-sub", unrealVal);
    setCard("realised-gains",   "realised-gains-sub",   realVal);
    setCard("total-gains",      "total-gains-sub",      totalVal);

  } catch (e) {
    console.error("Gains load error:", e);
  }

  // ── Render chart ──
  if (trades) {
    renderPlaceholderChart(trades);
  } else {
    fetchTradesCached()
      .then(trades => renderPlaceholderChart(trades))
      .catch(() => {});
  }

  // ── Open positions ──
  try {
    const positions = await fetchPositionsCached();
    if (!positions.length) {
      posBody.innerHTML = `<tr><td colspan="8" class="empty">No open positions.</td></tr>`;
      return;
    }
    posBody.innerHTML = positions.map(buildPositionRow).join("");
  } catch (e) {
    // Fallback: derive open positions from trades
    try {
      if (!trades) trades = await fetchTradesCached();
      const derived = deriveOpenPositions(trades);
      if (!derived.length) {
        posBody.innerHTML = `<tr><td colspan="8" class="empty">No open positions.</td></tr>`;
      } else {
        posBody.innerHTML = derived.map(buildPositionRow).join("");
      }
    } catch {
      posBody.innerHTML = `<tr><td colspan="8" class="empty">Error loading positions.</td></tr>`;
    }
    console.error("Positions load error:", e);
  }
}

// Derive open positions client-side when /positions/get_positions endpoint is unavailable
function deriveOpenPositions(trades) {
  const map = {};
  for (const t of trades) {
    const key = `${t.ticker}::${t.currency || "EUR"}`;
    if (!map[key]) map[key] = { ticker: t.ticker, currency: t.currency || "EUR", quantity: 0, totalCost: 0 };
    const qty = t.quantity ?? 0;
    const price = t.price ?? 0;
    if ((t.action || "buy").toLowerCase() === "buy") {
      map[key].totalCost += qty * price;
      map[key].quantity  += qty;
    } else {
      // SELL: reduce position
      const avgCost = map[key].quantity > 0 ? map[key].totalCost / map[key].quantity : 0;
      map[key].quantity  -= qty;
      map[key].totalCost -= avgCost * qty;
    }
  }
  return Object.values(map).filter(p => p.quantity > 0.00001);
}

function buildPositionRow(pos) {
  const avgCost     = pos.avg_cost     ?? pos.avgCost     ?? (pos.totalCost && pos.quantity ? pos.totalCost / pos.quantity : null);
  const currentPrice= pos.current_price?? pos.currentPrice?? null;
  const qty         = pos.quantity     ?? 0;
  const currency    = pos.currency     ?? DEFAULT_CURRENCY ?? "—";

  const marketValue = currentPrice !== null ? qty * currentPrice : null;
  const costBasis   = avgCost      !== null ? qty * avgCost      : null;
  const gainLoss    = (marketValue !== null && costBasis !== null) ? marketValue - costBasis : pos.gain ?? pos.unrealized_gain ?? null;
  const pct         = (gainLoss !== null && costBasis && costBasis !== 0) ? (gainLoss / costBasis) * 100 : null;

  const glClass = gainClass(gainLoss);
  const symbol = getCurrencySymbol(DEFAULT_CURRENCY);
  const glStr   = gainLoss !== null ? `${gainPrefix(gainLoss)}${symbol} ${fmt(Math.abs(gainLoss))}` : "—";
  const pctStr  = pct      !== null ? `${gainPrefix(pct)}${fmt(Math.abs(pct), 2)}%`        : "—";

  return `
    <tr>
      <td class="ticker-cell">${pos.ticker}</td>
      <td class="mono">${fmt(qty, 2)}</td>
      <td class="mono">${avgCost      !== null ? `${symbol} ${fmt(avgCost)}`     : "—"}</td>
      <td class="mono">${currentPrice !== null ? `${symbol} ${fmt(currentPrice)}`: "—"}</td>
      <td class="mono">${marketValue  !== null ? `${symbol} ${fmt(marketValue)}` : "—"}</td>
      <td class="${glClass}">${glStr}</td>
      <td class="${glClass}">${pctStr}</td>
      <td class="mono" style="color:var(--text-muted)">${currency}</td>
    </tr>
  `;
}

document.getElementById("btn-refresh").addEventListener("click", () => {
  loadDashboard();
  showToast("Refreshed.");
});

// ── Portfolio chart ───────────────────────────────────────

let chartInstance = null;
let currentWindow = "1W";

function generatePlaceholderData(trades, window) {
  const days   = { "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "ALL": 730 }[window] || 30;
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
  if (!canvas) return;

  placeholder.style.display = "none";
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const { labels, values } = generatePlaceholderData(trades, currentWindow);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, "rgba(79,158,255,0.18)");
  gradient.addColorStop(1, "rgba(79,158,255,0)");

  chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: "#4f9eff",
        borderWidth: 2,
        backgroundColor: gradient,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: "#4f9eff",
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c2030",
          borderColor: "#252a38",
          borderWidth: 1,
          titleColor: "#6b7490",
          bodyColor: "#e2e6f0",
          titleFont: { family: "'IBM Plex Mono'" },
          bodyFont:  { family: "'IBM Plex Mono'" },
          callbacks: { label: ctx => ` ${getCurrencySymbol(DEFAULT_CURRENCY)} ${fmt(ctx.parsed.y)}` }
        }
      },
      scales: {
        x: {
          grid:  { color: "#1c2030", drawBorder: false },
          ticks: { color: "#6b7490", font: { family: "'IBM Plex Mono'", size: 10 }, maxTicksLimit: 6 }
        },
        y: {
          grid:  { color: "#1c2030", drawBorder: false },
          ticks: { color: "#6b7490", font: { family: "'IBM Plex Mono'", size: 10 }, callback: v => `${getCurrencySymbol(DEFAULT_CURRENCY)} ${fmt(v, 0)}` }
        }
      }
    }
  });
}

document.querySelectorAll(".tw-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tw-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentWindow = btn.dataset.window;
    fetchTrades().then(trades => renderPlaceholderChart(trades)).catch(() => {});
  });
});

// ── Trades tab ────────────────────────────────────────────

function buildTradeRow(trade) {
  const action     = (trade.action || "buy").toLowerCase();
  const quantity   = trade.quantity   != null ? fmt(trade.quantity, 4) : "—";
  const price      = trade.price      != null ? fmt(trade.price, 2)    : "—";
  const commission = trade.commission != null ? fmt(trade.commission, 2) : "—";
  const total      = (trade.quantity != null && trade.price != null) ? fmt(trade.quantity * trade.price) : "—";
  const currency   = trade.currency   || "—";
  const date       = fmtDate(trade.date);
  const id         = trade.id ?? trade.trade_id ?? "";

  return `
    <tr data-id="${id}">
      <td class="ticker-cell">${trade.ticker}</td>
      <td class="mono" style="color:var(--text-muted)">${date}</td>
      <td><span class="badge badge-${action}">${action.toUpperCase()}</span></td>
      <td class="mono">${quantity}</td>
      <td class="mono">${price}</td>
      <td class="mono">${commission}</td>
      <td class="mono">${total}</td>
      <td class="mono" style="color:var(--text-muted)">${currency}</td>
      <td class="note-cell">${trade.note || ""}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon-edit" onclick="openEditModal(${id})">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <button class="btn-icon-delete" onclick="openDeleteModal(${id}, '${trade.ticker}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete
          </button>
        </div>
      </td>
    </tr>
  `;
}

async function loadTrades() {
  const tbody = document.getElementById("trades-body");
  tbody.innerHTML = `<tr><td colspan="10" class="empty">Loading...</td></tr>`;

  try {
    const trades = await fetchTrades();
    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty">No trades yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = [...trades].reverse().map(buildTradeRow).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty">Error loading trades.</td></tr>`;
    console.error(e);
  }
}

// ── Edit trade modal ──────────────────────────────────────

const editModal = document.getElementById("edit-modal");

async function openEditModal(tradeId) {
  document.getElementById("edit-msg").textContent = "";

  try {
    const all = await fetchTrades();
    const trade = all.find(t => (t.id ?? t.trade_id) === tradeId);
    if (!trade) { showToast("Trade not found."); return; }

  document.getElementById("edit-trade-id").value   = tradeId;
  document.getElementById("edit-ticker").value      = trade.ticker     || "";
  document.getElementById("edit-date").value        = trade.date       || "";
  document.getElementById("edit-action").value      = (trade.action    || "buy").toLowerCase();
  document.getElementById("edit-quantity").value    = trade.quantity   ?? "";
  document.getElementById("edit-price").value       = trade.price      ?? "";
  document.getElementById("edit-commission").value  = trade.commission ?? "0";
  document.getElementById("edit-currency").value    = trade.currency   || "EUR";
  document.getElementById("edit-note").value        = trade.note       || "";

  editModal.style.display = "flex";
}

// Auto-uppercase ticker in edit form
document.getElementById("edit-ticker").addEventListener("input", function () {
  const pos = this.selectionStart;
  this.value = this.value.toUpperCase();
  this.setSelectionRange(pos, pos);
});

document.getElementById("btn-close-edit").addEventListener("click", () => { editModal.style.display = "none"; });
document.getElementById("btn-cancel-edit").addEventListener("click", () => { editModal.style.display = "none"; });
editModal.addEventListener("click", e => { if (e.target === editModal) editModal.style.display = "none"; });

document.getElementById("btn-save-edit").addEventListener("click", async () => {
  const msgEl  = document.getElementById("edit-msg");
  const id     = document.getElementById("edit-trade-id").value;
  const ticker = document.getElementById("edit-ticker").value.trim().toUpperCase();
  const date   = document.getElementById("edit-date").value;
  const action = document.getElementById("edit-action").value;
  const qty    = parseFloat(document.getElementById("edit-quantity").value);
  const price  = parseFloat(document.getElementById("edit-price").value);
  const comm   = parseFloat(document.getElementById("edit-commission").value) || 0;
  const curr   = document.getElementById("edit-currency").value;
  const note   = document.getElementById("edit-note").value.trim();

  if (!ticker || !date || isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
    msgEl.textContent = "Please fill in all required fields correctly.";
    return;
  }

  msgEl.textContent = "";

  const payload = { ticker, date, action, quantity: qty, price, commission: comm, currency: curr };
  if (note) payload.note = note;

  try {
    const res = await fetch(`${API}/trades/${id}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    editModal.style.display = "none";
    showToast(`Trade #${id} updated.`);

    // Invalidate caches and auto-refresh
    invalidateDashboardCaches();
    loadTrades();
    refreshDashboardIfActive();
  } catch (err) {
    msgEl.textContent = `Error: ${err.message}`;
  }
});

// ── Delete trade modal ────────────────────────────────────

const deleteModal = document.getElementById("delete-modal");
let _pendingDeleteId = null;

function openDeleteModal(tradeId, ticker) {
  _pendingDeleteId = tradeId;
  document.getElementById("delete-trade-label").textContent = `#${tradeId} (${ticker})`;
  deleteModal.style.display = "flex";
}

document.getElementById("btn-close-delete").addEventListener("click",  () => { deleteModal.style.display = "none"; _pendingDeleteId = null; });
document.getElementById("btn-cancel-delete").addEventListener("click", () => { deleteModal.style.display = "none"; _pendingDeleteId = null; });
deleteModal.addEventListener("click", e => { if (e.target === deleteModal) { deleteModal.style.display = "none"; _pendingDeleteId = null; } });

document.getElementById("btn-confirm-delete").addEventListener("click", async () => {
  if (_pendingDeleteId === null) return;
  const id = _pendingDeleteId;

  try {
    const res = await fetch(`${API}/trades/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    deleteModal.style.display = "none";
    _pendingDeleteId = null;
    showToast(`Trade #${id} deleted.`);

    // Invalidate caches and auto-refresh
    invalidateDashboardCaches();
    loadTrades();
    refreshDashboardIfActive();
  } catch (err) {
    showToast(`Error: ${err.message}`);
    deleteModal.style.display = "none";
    _pendingDeleteId = null;
  }
});

// Make modal openers globally accessible (called from inline onclick)
window.openEditModal   = openEditModal;
window.openDeleteModal = openDeleteModal;

// ── Add trade form ────────────────────────────────────────

document.getElementById("f-date").valueAsDate = new Date();

document.getElementById("f-ticker").addEventListener("input", function () {
  const pos = this.selectionStart;
  this.value = this.value.toUpperCase();
  this.setSelectionRange(pos, pos);
});

["f-ticker", "f-date", "f-action", "f-quantity", "f-price", "f-commission", "f-currency"].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener("input",  updatePreview);
  el.addEventListener("change", updatePreview);
});

function updatePreview() {
  const ticker   = document.getElementById("f-ticker").value.trim();
  const date     = document.getElementById("f-date").value;
  const action   = document.getElementById("f-action").value.toUpperCase();
  const quantity = parseFloat(document.getElementById("f-quantity").value);
  const price    = parseFloat(document.getElementById("f-price").value);
  const comm     = parseFloat(document.getElementById("f-commission").value) || 0;
  const currency = document.getElementById("f-currency").value;
  const preview  = document.getElementById("trade-preview");

  if (ticker && !isNaN(quantity) && !isNaN(price) && quantity > 0 && price > 0) {
    const total   = quantity * price;
    const commStr = comm > 0 ? ` + ${fmt(comm)} commission` : "";
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

  const ticker = document.getElementById("f-ticker").value.trim().toUpperCase();
  const date   = document.getElementById("f-date").value;
  const action = document.getElementById("f-action").value;
  const qty    = parseFloat(document.getElementById("f-quantity").value);
  const price  = parseFloat(document.getElementById("f-price").value);
  const comm   = parseFloat(document.getElementById("f-commission").value) || 0;
  const curr   = document.getElementById("f-currency").value;
  const note   = document.getElementById("f-note").value.trim();

  if (!ticker || !date || isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
    msgEl.className   = "err";
    msgEl.textContent = "Please fill in all required fields correctly.";
    return;
  }

  try {
    const payload = { ticker, date, action, quantity: qty, price, commission: comm, currency: curr };
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

    msgEl.className   = "";
    msgEl.textContent = `✓ Trade saved: ${action.toUpperCase()} ${ticker} — ${curr} ${fmt(qty * price)}`;
    document.getElementById("add-form").reset();
    document.getElementById("f-date").valueAsDate = new Date();
    document.getElementById("trade-preview").textContent = "";

    // Invalidate caches and auto-refresh
    invalidateDashboardCaches();
    showToast("Trade saved!");
    refreshDashboardIfActive();
  } catch (err) {
    msgEl.className   = "err";
    msgEl.textContent = `Error: ${err.message}`;
  }
});

// ── Chart.js loader ───────────────────────────────────────

function loadChartJS(cb) {
  if (window.Chart) { cb(); return; }
  const s   = document.createElement("script");
  s.src     = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js";
  s.onload  = cb;
  s.onerror = () => console.error("Failed to load Chart.js");
  document.head.appendChild(s);
}

// ── Init ──────────────────────────────────────────────────

loadChartJS(() => loadDashboard());