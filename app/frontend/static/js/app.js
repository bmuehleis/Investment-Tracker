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

    // Portfolio value: use today's market value from the history endpoint
    // (this is holdings × current price, not cost basis + unrealised PnL)
    let portfolioVal = null;
    try {
      const histData = await fetchPortfolioHistory("1W", null, null);
      if (histData && histData.today_value !== null && histData.today_value !== undefined) {
        portfolioVal = histData.today_value;
      } else if (histData && histData.values && histData.values.length > 0) {
        portfolioVal = histData.values[histData.values.length - 1];
      }
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
  loadPortfolioChart();

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
let currentChartMode = "pct"; // "absolute" | "pct"  — percentage is the default
let _chartFromDate = null;
let _chartToDate = null;

function currencySymbol() {
  return { EUR: "€", USD: "$", GBP: "£", CHF: "CHF", JPY: "¥" }[PREFERRED_CURRENCY] ?? PREFERRED_CURRENCY;
}

// Keep the "Value" mode button label in sync with the selected currency
function updateModeBtnLabel() {
  const btn = document.getElementById("mode-btn-absolute");
  if (btn) btn.textContent = currencySymbol() + " Value";
}

async function fetchPortfolioHistory(win, fromDate, toDate) {
  let url = `${API}/portfolio/history?range=${win}&currency=${PREFERRED_CURRENCY}`;
  if (win === "CUSTOM") {
    if (fromDate) url += `&from_date=${fromDate}`;
    if (toDate)   url += `&to_date=${toDate}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function buildChartDatasets(ctx, labels, values, costBases, trades, mode) {
  if (!values.length) return [];

  // ── Main line dataset ──────────────────────────────────
  let displayValues;
  if (mode === "pct") {
    // % unrealised return: (market_value - cost_basis) / cost_basis * 100
    displayValues = values.map((v, i) => {
      const cb = costBases && costBases[i] ? costBases[i] : null;
      if (!cb || cb === 0) return 0;
      return ((v - cb) / Math.abs(cb)) * 100;
    });
  } else {
    // Raw market value — jumps are intentional, trade markers explain them
    displayValues = values;
  }

  const netChange = displayValues[displayValues.length - 1] - displayValues[0];
  const lineColor = netChange >= 0 ? "#34d399" : "#f87171";
  const gradStart = netChange >= 0 ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)";

  const h = ctx.canvas.clientHeight || 280;
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, gradStart);
  gradient.addColorStop(1, "rgba(0,0,0,0)");

  const mainDataset = {
    label: "portfolio",
    data: displayValues,
    borderColor: lineColor,
    borderWidth: 2,
    backgroundColor: gradient,
    fill: true,
    tension: 0.35,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBackgroundColor: lineColor,
    pointHoverBorderColor: "#0d0f14",
    pointHoverBorderWidth: 2,
    order: 2,
  };

  // ── Trade marker dataset ───────────────────────────────
  if (!trades || !trades.length) return [mainDataset];

  // Build label -> index lookup
  const labelIndex = {};
  labels.forEach((l, i) => { labelIndex[l] = i; });

  function nearestLabelIdx(tradeDateStr) {
    if (labelIndex[tradeDateStr] !== undefined) return labelIndex[tradeDateStr];
    const td = new Date(tradeDateStr).getTime();
    let best = -1, bestDiff = Infinity;
    labels.forEach((l, i) => {
      const diff = Math.abs(new Date(l).getTime() - td);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    return best;
  }

  // Group trades by chart index
  const markerMap = {};
  trades.forEach(t => {
    const idx = nearestLabelIdx(t.date);
    if (idx < 0) return;
    if (!markerMap[idx]) markerMap[idx] = { buys: [], sells: [], idx };
    if ((t.action || "").toUpperCase() === "BUY") markerMap[idx].buys.push(t);
    else markerMap[idx].sells.push(t);
  });

  const markerData   = new Array(displayValues.length).fill(null);
  const markerColors = new Array(displayValues.length).fill("transparent");
  const markerMeta   = new Array(displayValues.length).fill(null);

  const yMin   = Math.min(...displayValues);
  const yRange = Math.max(...displayValues) - yMin || 1;
  const markerY = yMin - yRange * 0.06;

  Object.values(markerMap).forEach(({ idx, buys, sells }) => {
    const hasBuy  = buys.length > 0;
    const hasSell = sells.length > 0;
    markerData[idx]   = markerY;
    markerColors[idx] = hasBuy && hasSell ? "#a78bfa"
                      : hasBuy            ? "#60a5fa"
                                          : "#fb923c";
    markerMeta[idx] = { buys, sells };
  });

  const markerDataset = {
    label: "trades",
    data: markerData,
    pointStyle: "rectRot",
    pointRadius: markerData.map(v => v !== null ? 7 : 0),
    pointHoverRadius: markerData.map(v => v !== null ? 9 : 0),
    pointBackgroundColor: markerColors,
    pointBorderColor: markerColors,
    borderWidth: 0,
    backgroundColor: "transparent",
    showLine: false,
    fill: false,
    order: 1,
    _tradeMeta: markerMeta,
  };

  return [mainDataset, markerDataset];
}

function renderPortfolioChart(labels, values, costBases, trades) {
  const canvas      = document.getElementById("portfolio-chart");
  const placeholder = document.getElementById("chart-placeholder");
  if (!canvas) return;

  if (!labels.length) {
    placeholder.style.display = "flex";
    document.getElementById("chart-placeholder-text").textContent = "No portfolio data for this period.";
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    return;
  }

  placeholder.style.display = "none";
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const ctx = canvas.getContext("2d");
  const datasets = buildChartDatasets(ctx, labels, values, costBases, trades, currentChartMode);
  const sym   = currencySymbol();
  const isPct = currentChartMode === "pct";

  const tradeDataset = datasets.find(d => d.label === "trades");

  const formattedLabels = labels.map(l => {
    try {
      return new Date(l + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    } catch { return l; }
  });

  chartInstance = new Chart(ctx, {
    type: "line",
    data: { labels: formattedLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c2030",
          borderColor: "#252a38",
          borderWidth: 1,
          titleColor: "#6b7490",
          bodyColor: "#e2e6f0",
          titleFont: { family: "'IBM Plex Mono'", size: 11 },
          bodyFont:  { family: "'IBM Plex Mono'", size: 12 },
          padding: 10,
          filter: item => {
            if (item.dataset.label === "trades") return item.parsed.y !== null;
            return true;
          },
          callbacks: {
            label: item => {
              if (item.dataset.label === "trades") {
                const meta = tradeDataset && tradeDataset._tradeMeta
                  ? tradeDataset._tradeMeta[item.dataIndex]
                  : null;
                if (!meta) return "";
                const lines = [];
                meta.buys.forEach(t =>
                  lines.push(` ◆ BUY  ${fmt(t.quantity, 4)} ${t.ticker} @ ${fmt(t.price, 2)} ${t.currency}`)
                );
                meta.sells.forEach(t =>
                  lines.push(` ◆ SELL ${fmt(t.quantity, 4)} ${t.ticker} @ ${fmt(t.price, 2)} ${t.currency}`)
                );
                return lines;
              }
              const v = item.parsed.y;
              return isPct
                ? ` ${v >= 0 ? "+" : ""}${fmt(v, 2)}%`
                : ` ${fmt(v, 2)}${sym}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid:  { color: "#1c2030", drawBorder: false },
          ticks: { color: "#6b7490", font: { family: "'IBM Plex Mono'", size: 10 }, maxTicksLimit: 8, maxRotation: 0 }
        },
        y: {
          position: "right",
          grid:  { color: "#1c2030", drawBorder: false },
          ticks: {
            color: "#6b7490",
            font: { family: "'IBM Plex Mono'", size: 10 },
            callback: v => isPct
              ? `${v >= 0 ? "+" : ""}${fmt(v, 1)}%`
              : `${fmt(v, 0)}${sym}`
          }
        }
      }
    }
  });
}

async function loadPortfolioChart() {
  const placeholder     = document.getElementById("chart-placeholder");
  const placeholderText = document.getElementById("chart-placeholder-text");
  const titleEl         = document.getElementById("chart-title");

  placeholder.style.display = "flex";
  placeholderText.textContent = "Loading…";
  if (titleEl) titleEl.textContent = currentChartMode === "pct" ? "Portfolio Return %" : "Portfolio Value";
  updateModeBtnLabel();

  try {
    const data = await fetchPortfolioHistory(currentWindow, _chartFromDate, _chartToDate);
    const labels = data.labels || [];
    const values = data.values || [];
    const costBases = data.cost_bases || [];
    const trades = data.trades || [];
    if (!labels.length || !values.length) {
      placeholder.style.display = "flex";
      placeholderText.textContent = "No portfolio data for this period.";
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      return;
    }
    renderPortfolioChart(labels, values, costBases, trades);
  } catch (e) {
    console.warn("Portfolio history fetch failed:", e);
    placeholder.style.display = "flex";
    placeholderText.textContent = "Could not load chart data.";
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  }
}

// ── Time window buttons ──
document.querySelectorAll(".tw-btn").forEach(btn => {
  if (btn.id === "btn-apply-custom") return; // skip the apply button (it's not a tw-btn but guard anyway)
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tw-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentWindow = btn.dataset.window;

    const panel = document.getElementById("chart-custom-panel");
    if (currentWindow === "CUSTOM") {
      // Show the dropdown panel
      panel.style.display = "block";
      // Pre-fill: last 30 days
      const today = new Date();
      const prior = new Date(today);
      prior.setDate(prior.getDate() - 30);
      document.getElementById("chart-to").value   = today.toISOString().slice(0, 10);
      document.getElementById("chart-from").value = prior.toISOString().slice(0, 10);
      // Don't auto-load yet — wait for Apply
    } else {
      panel.style.display = "none";
      _chartFromDate = null;
      _chartToDate   = null;
      loadPortfolioChart();
    }
  });
});

// ── Custom Apply ──
document.getElementById("btn-apply-custom")?.addEventListener("click", () => {
  _chartFromDate = document.getElementById("chart-from").value || null;
  _chartToDate   = document.getElementById("chart-to").value   || null;
  if (_chartFromDate || _chartToDate) loadPortfolioChart();
});

// ── Mode toggle ──
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentChartMode = btn.dataset.mode;
    const titleEl = document.getElementById("chart-title");
    if (titleEl) titleEl.textContent = currentChartMode === "pct" ? "Portfolio Return %" : "Portfolio Value";
    updateModeBtnLabel();
    loadPortfolioChart();
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

// ── Trades sort state ─────────────────────────────────────────────
let _sortCol = "date";
let _sortDir = -1;  // -1 = desc (newest first by default), +1 = asc

function _sortTrades(trades) {
  return [...trades].sort((a, b) => {
    let va = a[_sortCol];
    let vb = b[_sortCol];

    // Computed "total" column
    if (_sortCol === "total") {
      va = (parseFloat(a.quantity) || 0) * (parseFloat(a.price) || 0);
      vb = (parseFloat(b.quantity) || 0) * (parseFloat(b.price) || 0);
    }

    // Numeric compare
    const na = parseFloat(va), nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) return _sortDir * (na - nb);

    // String compare
    const sa = String(va ?? "").toLowerCase();
    const sb = String(vb ?? "").toLowerCase();
    return _sortDir * sa.localeCompare(sb);
  });
}

function _updateSortHeaders() {
  document.querySelectorAll("#trades-table th.sortable").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    const icon = th.querySelector(".sort-icon");
    if (icon) icon.textContent = "⇅";
    if (th.dataset.col === _sortCol) {
      const cls = _sortDir === 1 ? "sort-asc" : "sort-desc";
      th.classList.add(cls);
      if (icon) icon.textContent = _sortDir === 1 ? "↑" : "↓";
    }
  });
}

async function loadTrades() {
  const tbody = document.getElementById("trades-body");
  tbody.innerHTML = `<tr><td colspan="10" class="empty">Loading...</td></tr>`;

  try {
    const trades = await fetchTrades();
    _tradesCache = trades;
    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty">No trades yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = _sortTrades(trades).map(buildTradeRow).join("");
    _updateSortHeaders();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty">Error loading trades.</td></tr>`;
    console.error(e);
  }
}

// Wire up sortable column headers (delegated — works after DOM ready)
document.addEventListener("click", (e) => {
  const th = e.target.closest("th.sortable");
  if (!th) return;
  const col = th.dataset.col;
  if (!col) return;

  if (_sortCol === col) {
    // Second click on same column: toggle direction
    _sortDir *= -1;
  } else {
    _sortCol = col;
    _sortDir = 1; // first click = ascending
  }

  // Re-render from cache without a network round-trip
  const tbody = document.getElementById("trades-body");
  if (_tradesCache.length) {
    tbody.innerHTML = _sortTrades(_tradesCache).map(buildTradeRow).join("");
  }
  _updateSortHeaders();
});

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

// ── CSV Export ────────────────────────────────────────────────────
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#btn-export-csv")) return;
  try {
    const res = await fetch(`${API}/trades/export`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `trades_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Trades exported as CSV.");
  } catch (err) {
    showToast(`Export failed: ${err.message}`);
    console.error(err);
  }
});

// ── CSV Import ────────────────────────────────────────────────────
document.addEventListener("change", async (e) => {
  const input = e.target.closest("#input-import-csv");
  if (!input || !input.files.length) return;

  const file    = input.files[0];
  const banner  = document.getElementById("import-result-banner");
  banner.style.display = "none";
  banner.className = "import-banner";

  const formData = new FormData();
  formData.append("file", file);

  try {
    showToast("Importing trades…");
    const res  = await fetch(`${API}/trades/import`, { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      banner.className += " error";
      banner.textContent = `Import failed: ${data.detail || "Unknown error."}`;
      banner.style.display = "block";
      showToast("Import failed.");
      return;
    }

    const { imported, skipped, errors } = data;
    const hasErrors = errors && errors.length > 0;

    if (imported > 0 && !hasErrors) {
      banner.className += " success";
    } else if (imported > 0 && hasErrors) {
      banner.className += " warning";
    } else {
      banner.className += " error";
    }

    let msg = `Imported ${imported} trade${imported !== 1 ? "s" : ""}`;
    if (skipped > 0) msg += `, skipped ${skipped}`;
    msg += ".";
    if (hasErrors) {
      msg += "\n" + errors.slice(0, 10).join("\n");
      if (errors.length > 10) msg += `\n…and ${errors.length - 10} more.`;
    }
    banner.textContent = msg;
    banner.style.display = "block";

    showToast(`Imported ${imported} trade${imported !== 1 ? "s" : ""}.`);
    _tradesCache = [];
    if (imported > 0) loadTrades();
  } catch (err) {
    banner.className += " error";
    banner.textContent = `Import error: ${err.message}`;
    banner.style.display = "block";
    showToast(`Import error: ${err.message}`);
    console.error(err);
  } finally {
    // Reset file input so the same file can be re-imported if needed
    input.value = "";
  }
});

// ── Init ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadDashboard();
});
// ══════════════════════════════════════════════════════════════════════════════
// BENCHMARK TAB
// ══════════════════════════════════════════════════════════════════════════════

const BM = {
  period:          "1y",
  currency:        null,           // falls back to PREFERRED_CURRENCY
  selectedKeys:    new Set(),      // benchmark keys currently toggled on
  available:       [],             // [{key, label}] fetched from API
  allPeriodsCache: null,           // cached all-period portfolio data
  loading:         false,
};

// ── Colour map per benchmark key ─────────────────────────────────────────────
const BM_COLORS = {
  sp500:      "#fbbf24",   // amber
  msci_world: "#a78bfa",   // violet
};

// ── DOM helpers ───────────────────────────────────────────────────────────────

function bmSetLoading(on) {
  BM.loading = on;
  document.getElementById("benchmark-loading").style.display = on ? "flex" : "none";
  document.getElementById("benchmark-kpi-area").style.opacity = on ? "0.3" : "1";
}

function bmShowError(msg) {
  const el = document.getElementById("benchmark-error");
  if (msg) { el.textContent = msg; el.style.display = "block"; }
  else      { el.style.display = "none"; }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function bmFmtPct(val, showSign = true) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  const sign = showSign && val > 0 ? "+" : "";
  return `${sign}${Number(val).toFixed(2)}%`;
}

function bmFmtNum(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  const sign = val > 0 ? "+" : "";
  return `${sign}${Number(val).toFixed(decimals)}`;
}

function bmColorClass(val) {
  if (val === null || val === undefined || isNaN(val)) return "val-neu";
  return val > 0 ? "val-pos" : val < 0 ? "val-neg" : "val-neu";
}

function bmCell(val, fmt) {
  const cls = bmColorClass(val);
  return `<td class="num ${cls}">${fmt(val)}</td>`;
}

// ── Initialise benchmark selector chips ──────────────────────────────────────

async function bmInitSelector() {
  try {
    const res  = await fetch(`${API}/benchmark/available`);
    const data = await res.json();
    BM.available = data.benchmarks || [];
  } catch {
    BM.available = [];
  }

  const container = document.getElementById("benchmark-selector");
  container.innerHTML = "";
  BM.available.forEach(({ key, label }) => {
    const chip = document.createElement("button");
    chip.className = "bm-chip";
    chip.dataset.key = key;
    chip.innerHTML = `<span class="bm-chip-dot" style="background:${BM_COLORS[key] || "var(--accent)"}"></span>${label}`;
    chip.addEventListener("click", () => {
      if (BM.selectedKeys.has(key)) {
        BM.selectedKeys.delete(key);
        chip.classList.remove("active");
      } else {
        BM.selectedKeys.add(key);
        chip.classList.add("active");
      }
      bmLoad();
    });
    container.appendChild(chip);
  });
}

// ── Period button wiring ──────────────────────────────────────────────────────

document.querySelectorAll(".period-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    BM.period = btn.dataset.period;
    BM.allPeriodsCache = null;   // invalidate
    bmLoad();
  });
});

// ── Currency selector ─────────────────────────────────────────────────────────

document.getElementById("bm-currency-select").addEventListener("change", e => {
  BM.currency = e.target.value;
  BM.allPeriodsCache = null;
  bmLoad();
});

// ── Main load ─────────────────────────────────────────────────────────────────

async function bmLoad() {
  if (BM.loading) return;
  const currency = BM.currency || PREFERRED_CURRENCY;

  bmSetLoading(true);
  bmShowError(null);

  try {
    await Promise.all([
      bmLoadAllPeriods(currency),
      bmLoadComparison(currency),
    ]);
  } catch (err) {
    bmShowError(`Failed to load benchmark data: ${err.message}`);
    console.error(err);
  } finally {
    bmSetLoading(false);
  }
}

// ── All-periods table ─────────────────────────────────────────────────────────

const PERIOD_LABELS = { "1y": "1 Year", "3y": "3 Years", "5y": "5 Years", "10y": "10 Years", "max": "Max" };

async function bmLoadAllPeriods(currency) {
  const bmKeys = [...BM.selectedKeys];
  const bmQuery = bmKeys.map(k => `benchmark=${encodeURIComponent(k)}`).join("&");
  const url = `${API}/benchmark/all-periods?currency=${currency}${bmQuery ? "&" + bmQuery : ""}`;

  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  BM.allPeriodsCache = data;

  const tbody = document.getElementById("bm-all-periods-tbody");
  const periods = data.periods || {};
  const bmPeriods = data.benchmark_periods || {};

  // Build header — show benchmark columns if selected
  const thead = document.querySelector("#bm-all-periods-table thead tr");
  thead.innerHTML = `
    <th>Period</th>
    <th class="num">Total Return</th>
    <th class="num">Ann. Return</th>
    <th class="num">Ann. Variance</th>
    <th class="num">Sharpe</th>
    <th class="num">Sortino</th>
  `;

  const rows = Object.entries(PERIOD_LABELS).map(([key, label]) => {
    const kpis = periods[key];
    if (!kpis) {
      return `<tr>
        <td class="bm-period-label">${label}</td>
        <td class="num val-neu" colspan="5">— No data for this period</td>
      </tr>`;
    }

    const activeCls = key === BM.period ? "style='background:rgba(79,158,255,0.05)'" : "";

    return `<tr ${activeCls}>
      <td class="bm-period-label">${label}</td>
      ${bmCell(kpis.total_return,       v => bmFmtPct(v))}
      ${bmCell(kpis.annualised_return,  v => bmFmtPct(v))}
      ${bmCell(kpis.variance,           v => bmFmtNum(v, 4) + "%")}
      ${bmCell(kpis.sharpe,             v => bmFmtNum(v, 3))}
      ${bmCell(kpis.sortino,            v => bmFmtNum(v, 3))}
    </tr>`;
  });

  tbody.innerHTML = rows.join("");
}

// ── Comparison table (current period vs benchmarks) ───────────────────────────

const METRIC_ROWS = [
  { key: "total_return",      label: "Total Return",         fmt: v => bmFmtPct(v) },
  { key: "annualised_return", label: "Annualised Return",    fmt: v => bmFmtPct(v) },
  { key: "variance",          label: "Variance (Ann.)",      fmt: v => bmFmtNum(v, 4) + "%" },
  { key: "sharpe",            label: "Sharpe Ratio",         fmt: v => bmFmtNum(v, 3) },
  { key: "sortino",           label: "Sortino Ratio (XLM)",  fmt: v => bmFmtNum(v, 3) },
];

async function bmLoadComparison(currency) {
  const bmKeys  = [...BM.selectedKeys];
  const bmQuery = bmKeys.map(k => `benchmark=${encodeURIComponent(k)}`).join("&");
  const url = `${API}/benchmark/kpis?period=${BM.period}&currency=${currency}${bmQuery ? "&" + bmQuery : ""}`;

  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Update title
  const title = document.getElementById("bm-comparison-title");
  const periodLabel = PERIOD_LABELS[BM.period] || BM.period;
  const start = data.period_start ? ` (${data.period_start} → ${data.period_end})` : "";
  title.textContent = `${periodLabel} KPI Comparison${start}`;

  // Rebuild column headers
  const headerRow = document.querySelector("#bm-comparison-table thead tr");
  const bmCols = Object.entries(data.benchmarks || {});
  headerRow.innerHTML = `
    <th>Metric</th>
    <th class="num">Portfolio</th>
    ${bmCols.map(([key, bm]) => {
      const color = BM_COLORS[key] || "var(--accent)";
      return `<th class="num" style="color:${color}">${bm.label}</th>`;
    }).join("")}
  `;

  const tbody = document.getElementById("bm-comparison-tbody");
  const portKpis = data.portfolio_kpis;

  if (!portKpis) {
    tbody.innerHTML = `<tr><td colspan="${2 + bmCols.length}" class="bm-empty">No portfolio data for this period.</td></tr>`;
    return;
  }

  const rows = METRIC_ROWS.map(({ key, label, fmt }) => {
    const portVal  = portKpis[key];
    const portCls  = bmColorClass(portVal);

    const bmCells = bmCols.map(([bmKey, bm]) => {
      const bmVal = bm.kpis?.[key];
      const bmCls = bmColorClass(bmVal);
      // Add delta indicator vs portfolio
      let delta = "";
      if (portVal !== null && bmVal !== null && !isNaN(portVal) && !isNaN(bmVal)) {
        const diff = portVal - bmVal;
        const diffCls = bmColorClass(diff);
        if (Math.abs(diff) > 0.001) {
          delta = `<span class="${diffCls}" style="font-size:10px;margin-left:4px;opacity:0.7">(${diff > 0 ? "+" : ""}${Number(diff).toFixed(2)})</span>`;
        }
      }
      return `<td class="num ${bmCls}">${fmt(bmVal)}${delta}</td>`;
    }).join("");

    return `<tr>
      <td class="metric-label">${label}</td>
      <td class="num ${portCls}">${fmt(portVal)}</td>
      ${bmCells}
    </tr>`;
  });

  // Add a divider row with data range info
  const infoRow = `<tr>
    <td class="metric-label val-neu" style="font-size:11px">Data points</td>
    <td class="num val-neu" style="font-size:11px">${portKpis.days ?? "—"} days</td>
    ${bmCols.map(([, bm]) => `<td class="num val-neu" style="font-size:11px">${bm.kpis?.days ?? "—"} days</td>`).join("")}
  </tr>`;

  tbody.innerHTML = rows.join("") + infoRow;
}

// ── Wire tab switch ───────────────────────────────────────────────────────────

// Patch the existing tab navigation to trigger benchmark load
const _origTabClick = Array.from(document.querySelectorAll(".nav-btn"));
_origTabClick.forEach(btn => {
  btn.addEventListener("click", async () => {
    if (btn.dataset.tab === "benchmark") {
      if (!BM.available.length) await bmInitSelector();
      // Sync currency selector to PREFERRED_CURRENCY if not overridden
      if (!BM.currency) {
        const sel = document.getElementById("bm-currency-select");
        if (sel) sel.value = PREFERRED_CURRENCY;
      }
      bmLoad();
    }
  });
});

// Also refresh benchmark when global refresh button is clicked on benchmark tab
const _origRefreshHandler = document.getElementById("btn-global-refresh");
_origRefreshHandler.addEventListener("click", () => {
  const active = document.querySelector(".tab.active")?.id?.replace("tab-", "");
  if (active === "benchmark") {
    BM.allPeriodsCache = null;
    bmLoad();
  }
});
