/**
 * app.js — Investment Tracker frontend
 * Trade schema: { ticker, date, action, quantity, price, commission, currency, note }
 * Gains endpoints: GET /portfolio/unrealized  GET /portfolio/realized  GET /portfolio/total
 * Positions endpoint: GET /positions/get_positions  (returns open positions with current price / gain)
 * Edit:   PUT  /trades/{trade_id}   body: TradeCreate
 * Delete: DELETE /trades/{trade_id}
 */

let API = localStorage.getItem("api_url") || "http://127.0.0.1:8000/api/v1";

// ── Preferred currency ────────────────────────────────────
// Stored in localStorage as "preferred_currency" (e.g. "EUR", "USD", "GBP")
let PREFERRED_CURRENCY = localStorage.getItem("preferred_currency") || "EUR";

// ── FX rate cache ─────────────────────────────────────────
// Structure: { "USD->EUR": { rate: 0.92, date: "2024-06-01" }, ... }
// Persisted to localStorage under key "fx_cache" so it survives page reloads.
// On each app start we load the persisted cache; stale entries (not today's date)
// are simply ignored and re-fetched on demand.

const FX_CACHE_KEY = "fx_cache";
let _fxCache = (() => {
  try { return JSON.parse(localStorage.getItem(FX_CACHE_KEY)) || {}; }
  catch { return {}; }
})();

function _saveFxCache() {
  try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify(_fxCache)); } catch {}
}

function _todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Returns the FX rate to convert 1 unit of `from` into `to`.
 * - Returns 1 immediately if from === to.
 * - Checks the in-memory + localStorage cache first (date-keyed, 1d TTL).
 * - Falls back to the free Frankfurter API (https://api.frankfurter.app).
 * - On network failure returns null so callers can show "—" gracefully.
 */
async function getFxRate(from, to) {
  if (!from || !to || from.toUpperCase() === to.toUpperCase()) return 1;

  const key   = `${from.toUpperCase()}->${to.toUpperCase()}`;
  const today = _todayStr();

  // Cache hit?
  if (_fxCache[key] && _fxCache[key].date === today) {
    return _fxCache[key].rate;
  }

  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${from.toUpperCase()}&to=${to.toUpperCase()}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = data.rates?.[to.toUpperCase()];
    if (rate == null) throw new Error("Rate missing in response");

    _fxCache[key] = { rate, date: today };
    _saveFxCache();
    return rate;
  } catch (err) {
    console.warn(`FX fetch failed (${key}):`, err.message);
    return null;
  }
}

/**
 * Converts `amount` from `fromCurrency` to PREFERRED_CURRENCY.
 * Returns null if conversion is impossible.
 */
async function toPreferred(amount, fromCurrency) {
  if (amount === null || amount === undefined || isNaN(amount)) return null;
  const rate = await getFxRate(fromCurrency, PREFERRED_CURRENCY);
  if (rate === null) return null;
  return amount * rate;
}

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

/** Formats a monetary value with sign prefix and currency symbol suffix: "+1,234.56€" */
function fmtMoney(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  const symbol = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF", JPY: "¥" }[PREFERRED_CURRENCY] ?? PREFERRED_CURRENCY;
  return `${gainPrefix(val)}${fmt(Math.abs(val), decimals)}${symbol}`;
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
  const active = document.querySelector(".tab.active")?.id?.replace("tab-", "");
  if (active === "dashboard") loadDashboard();
  if (active === "trades")    loadTrades();
  showToast("Refreshed.");
});

// ── Settings modal ────────────────────────────────────────

const settingsModal = document.getElementById("settings-modal");

document.getElementById("btn-settings").addEventListener("click", () => {
  document.getElementById("setting-api-url").value = API;
  document.getElementById("setting-currency").value = PREFERRED_CURRENCY;
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

  // ── Currency preference ──
  const newCurrency = (document.getElementById("setting-currency")?.value || "EUR").trim().toUpperCase();
  if (newCurrency && newCurrency !== PREFERRED_CURRENCY) {
    PREFERRED_CURRENCY = newCurrency;
    localStorage.setItem("preferred_currency", PREFERRED_CURRENCY);
    // Reload dashboard so all values are re-converted to the new currency
    const active = document.querySelector(".tab.active")?.id?.replace("tab-", "");
    if (active === "dashboard" || !active) loadDashboard();
  }

  settingsModal.style.display = "none";
  showToast("Settings saved.");
});

// ── Fetch helpers ─────────────────────────────────────────

async function fetchTrades() {
  const res = await fetch(`${API}/trades`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.trades || [];
}

async function fetchGains() {
  const [unrealRes, realRes, totalRes] = await Promise.allSettled([
    fetch(`${API}/portfolio/unrealized`),
    fetch(`${API}/portfolio/realized`),
    fetch(`${API}/portfolio/total`),
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
  const res = await fetch(`${API}/positions/get_positions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.positions || data || [];
}

// ── Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
  const posBody = document.getElementById("positions-body");
  posBody.innerHTML = `<tr><td colspan="8" class="empty">Loading...</td></tr>`;

  // ── Gains cards ──
  try {
    const gains = await fetchGains();

    const extractVal = (obj, ...keys) => {
      if (obj === null || obj === undefined) return null;
      for (const k of keys) {
        if (obj[k] !== undefined) return Number(obj[k]);
      }
      if (typeof obj === "number") return obj;
      return null;
    };

    // Raw values (assumed to come from API in their own currency —
    // the API doesn't tell us the currency so we treat them as already
    // in the base account currency stored in PREFERRED_CURRENCY.
    // If your API returns a currency field you can extend this logic.)
    const unrealVal = extractVal(gains.unrealized, "unrealized_gains", "value", "unrealized", "gains");
    const realVal   = extractVal(gains.realized,   "realized_gains",   "value", "realized",   "gains");
    const totalVal  = extractVal(gains.total,       "total_gains",      "value", "total",      "gains");

    // API gain currency — extend this if your API exposes it
    const apiCurrency = gains.unrealized?.currency || gains.realized?.currency || gains.total?.currency || PREFERRED_CURRENCY;

    // Convert gains to preferred currency (will be a no-op if already matching)
    const [unrealConv, realConv, totalConv] = await Promise.all([
      unrealVal !== null ? toPreferred(unrealVal, apiCurrency) : Promise.resolve(null),
      realVal   !== null ? toPreferred(realVal,   apiCurrency) : Promise.resolve(null),
      totalVal  !== null ? toPreferred(totalVal,  apiCurrency) : Promise.resolve(null),
    ]);

    // Portfolio value derived from trades
    let portfolioVal = null;
    try {
      const trades = await fetchTrades();

      // Sum cost basis per currency then convert each bucket
      const buckets = {};
      for (const t of trades) {
        if ((t.action || "buy").toLowerCase() !== "buy") continue;
        const cur = (t.currency || PREFERRED_CURRENCY).toUpperCase();
        buckets[cur] = (buckets[cur] || 0) + (t.quantity ?? 0) * (t.price ?? 0);
      }

      let invested = 0;
      for (const [cur, amount] of Object.entries(buckets)) {
        const converted = await toPreferred(amount, cur);
        if (converted !== null) invested += converted;
      }

      portfolioVal = invested + (unrealConv ?? 0);
    } catch {}

    const setCard = (id, subId, val, basisForPct = null) => {
      const el    = document.getElementById(id);
      const subEl = document.getElementById(subId);
      if (val === null) {
        el.textContent    = "—";
        el.className      = "card-value mono";
        subEl.textContent = "—";
        subEl.className   = "card-sub";
        return;
      }
      el.textContent = fmtMoney(val);
      el.className   = `card-value mono ${val > 0 ? "positive" : val < 0 ? "negative" : ""}`;

      // Show return % when we have a meaningful cost basis, otherwise fall back to a plain sign label
      let subText = val > 0 ? "▲ —" : val < 0 ? "▼ —" : "—";
      if (basisForPct !== null && basisForPct !== 0) {
        const pct    = (val / Math.abs(basisForPct)) * 100;
        const prefix = pct > 0 ? "▲ +" : pct < 0 ? "▼ " : "";
        subText = `${prefix}${fmt(Math.abs(pct), 2)}%`;
      }
      subEl.textContent = subText;
      subEl.className   = `card-sub ${val > 0 ? "positive" : val < 0 ? "negative" : ""}`;
    };

    document.getElementById("portfolio-value").textContent =
      portfolioVal !== null ? fmtMoney(portfolioVal) : "—";
    document.getElementById("portfolio-value").className = "card-value mono";

    // For each card the "basis" is the invested cost so the % reads as gain-on-cost.
    // portfolioVal already includes unrealConv, so cost = portfolioVal - unrealConv.
    const costBasis = (portfolioVal !== null && unrealConv !== null) ? portfolioVal - unrealConv : null;
    setCard("unrealised-gains", "unrealised-gains-sub", unrealConv, costBasis);
    setCard("realised-gains",   "realised-gains-sub",   realConv,   costBasis);
    setCard("total-gains",      "total-gains-sub",      totalConv,  costBasis);

  } catch (e) {
    console.error("Gains load error:", e);
  }

  // ── Render chart ──
  fetchTrades()
    .then(trades => renderPlaceholderChart(trades))
    .catch(() => {});

  // ── Open positions ──
  try {
    const positions = await fetchPositions();
    if (!positions.length) {
      posBody.innerHTML = `<tr><td colspan="8" class="empty">No open positions.</td></tr>`;
      return;
    }
    const rows = await Promise.all(positions.map(buildPositionRow));
    posBody.innerHTML = rows.join("");
  } catch (e) {
    // Fallback: derive open positions from trades
    try {
      const trades = await fetchTrades();
      const derived = deriveOpenPositions(trades);
      if (!derived.length) {
        posBody.innerHTML = `<tr><td colspan="8" class="empty">No open positions.</td></tr>`;
      } else {
        const rows = await Promise.all(derived.map(buildPositionRow));
        posBody.innerHTML = rows.join("");
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
    const key = `${t.ticker}::${t.currency || PREFERRED_CURRENCY}`;
    if (!map[key]) map[key] = { ticker: t.ticker, currency: t.currency || PREFERRED_CURRENCY, quantity: 0, totalCost: 0 };
    const qty   = t.quantity ?? 0;
    const price = t.price    ?? 0;
    if ((t.action || "buy").toLowerCase() === "buy") {
      map[key].totalCost += qty * price;
      map[key].quantity  += qty;
    } else {
      const avgCost = map[key].quantity > 0 ? map[key].totalCost / map[key].quantity : 0;
      map[key].quantity  -= qty;
      map[key].totalCost -= avgCost * qty;
    }
  }
  return Object.values(map).filter(p => p.quantity > 0.00001);
}

/**
 * Builds a positions table row, converting all monetary values to PREFERRED_CURRENCY.
 * This function is async because it may need to fetch FX rates.
 */
async function buildPositionRow(pos) {
  const avgCost      = pos.avg_cost      ?? pos.avgCost      ?? (pos.totalCost && pos.quantity ? pos.totalCost / pos.quantity : null);
  const currentPrice = pos.current_price ?? pos.currentPrice ?? null;
  const qty          = pos.quantity      ?? 0;
  const posCurrency  = (pos.currency     ?? PREFERRED_CURRENCY).toUpperCase();

  const marketValueRaw = currentPrice !== null ? qty * currentPrice : null;
  const costBasisRaw   = avgCost      !== null ? qty * avgCost      : null;
  const gainLossRaw    = (marketValueRaw !== null && costBasisRaw !== null)
    ? marketValueRaw - costBasisRaw
    : pos.gain ?? pos.unrealized_gain ?? null;

  const pct = (gainLossRaw !== null && costBasisRaw && costBasisRaw !== 0)
    ? (gainLossRaw / costBasisRaw) * 100
    : null;

  // Convert monetary values to preferred currency
  const [avgCostConv, currentPriceConv, marketValueConv, gainLossConv] = await Promise.all([
    avgCost      !== null ? toPreferred(avgCost,      posCurrency) : Promise.resolve(null),
    currentPrice !== null ? toPreferred(currentPrice, posCurrency) : Promise.resolve(null),
    marketValueRaw !== null ? toPreferred(marketValueRaw, posCurrency) : Promise.resolve(null),
    gainLossRaw    !== null ? toPreferred(gainLossRaw,    posCurrency) : Promise.resolve(null),
  ]);

  const glClass = gainClass(gainLossConv);
  const glStr   = gainLossConv  !== null ? fmtMoney(gainLossConv)                          : "—";
  const pctStr  = pct           !== null ? `${gainPrefix(pct)}${fmt(Math.abs(pct), 2)}%`  : "—";

  // Show original currency badge only when it differs from preferred
  const currencyBadge = posCurrency !== PREFERRED_CURRENCY
    ? `<span style="color:var(--text-muted);font-size:0.75em">(${posCurrency})</span>`
    : "";

  return `
    <tr>
      <td class="ticker-cell">${pos.ticker} ${currencyBadge}</td>
      <td class="mono">${fmt(qty, 2)}</td>
      <td class="mono">${avgCostConv      !== null ? fmtMoney(avgCostConv)      : "—"}</td>
      <td class="mono">${currentPriceConv !== null ? fmtMoney(currentPriceConv) : "—"}</td>
      <td class="mono">${marketValueConv  !== null ? fmtMoney(marketValueConv)  : "—"}</td>
      <td class="${glClass}">${glStr}</td>
      <td class="${glClass}">${pctStr}</td>
      <td class="mono" style="color:var(--text-muted)">${PREFERRED_CURRENCY}</td>
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
          callbacks: { label: ctx => { const s = { EUR:"€",USD:"$",GBP:"£",CHF:"CHF",JPY:"¥" }[PREFERRED_CURRENCY]??PREFERRED_CURRENCY; return ` ${fmt(ctx.parsed.y)}${s}`; } }
        }
      },
      scales: {
        x: {
          grid:  { color: "#1c2030", drawBorder: false },
          ticks: { color: "#6b7490", font: { family: "'IBM Plex Mono'", size: 10 }, maxTicksLimit: 6 }
        },
        y: {
          grid:  { color: "#1c2030", drawBorder: false },
          ticks: { color: "#6b7490", font: { family: "'IBM Plex Mono'", size: 10 }, callback: v => { const s = { EUR:"€",USD:"$",GBP:"£",CHF:"CHF",JPY:"¥" }[PREFERRED_CURRENCY]??PREFERRED_CURRENCY; return `${fmt(v,0)}${s}`; } }
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
  const quantity   = trade.quantity   != null ? fmt(trade.quantity, 4)   : "—";
  const price      = trade.price      != null ? fmt(trade.price, 2)      : "—";
  const commission = trade.commission != null ? fmt(trade.commission, 2) : "—";
  const total      = (trade.quantity  != null && trade.price != null) ? fmt(trade.quantity * trade.price) : "—";
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

let _tradesCache = [];

async function openEditModal(tradeId) {
  document.getElementById("edit-msg").textContent = "";

  let trade = _tradesCache.find(t => (t.id ?? t.trade_id) === tradeId);
  if (!trade) {
    try {
      const all = await fetchTrades();
      _tradesCache = all;
      trade = all.find(t => (t.id ?? t.trade_id) === tradeId);
    } catch (e) {
      showToast("Could not load trade.");
      return;
    }
  }

  if (!trade) { showToast("Trade not found."); return; }

  document.getElementById("edit-trade-id").value   = tradeId;
  document.getElementById("edit-ticker").value      = trade.ticker     || "";
  document.getElementById("edit-date").value        = trade.date       || "";
  document.getElementById("edit-action").value      = (trade.action    || "buy").toLowerCase();
  document.getElementById("edit-quantity").value    = trade.quantity   ?? "";
  document.getElementById("edit-price").value       = trade.price      ?? "";
  document.getElementById("edit-commission").value  = trade.commission ?? "0";
  document.getElementById("edit-currency").value    = trade.currency   || PREFERRED_CURRENCY;
  document.getElementById("edit-note").value        = trade.note       || "";

  editModal.style.display = "flex";
}

document.getElementById("edit-ticker").addEventListener("input", function () {
  const pos = this.selectionStart;
  this.value = this.value.toUpperCase();
  this.setSelectionRange(pos, pos);
});

document.getElementById("btn-close-edit").addEventListener("click",  () => { editModal.style.display = "none"; });
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
    _tradesCache = [];
    loadTrades();
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
    _tradesCache = [];
    loadTrades();
  } catch (err) {
    showToast(`Error: ${err.message}`);
    deleteModal.style.display = "none";
    _pendingDeleteId = null;
  }
});

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
    _tradesCache = [];
    showToast("Trade saved!");
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