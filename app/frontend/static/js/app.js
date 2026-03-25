/**
 * app.js — Investment Tracker frontend
 * Styled after the Portfolio Tracker UI pattern.
 * Backend: POST/GET /api/v1/trades
 * Trade shape: { ticker, action, quantity, price }
 */

const API = "http://127.0.0.1:8000/api/v1";

// ── Helpers ──────────────────────────────────────────────

function fmt(value, decimals = 2) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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

// ── Shared: fetch all trades ──────────────────────────────

async function fetchTrades() {
  const res = await fetch(`${API}/trades`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.trades || [];
}

// ── Trade row builder ─────────────────────────────────────

function buildRow(trade) {
  const action = (trade.action || "buy").toLowerCase();
  const total  = (trade.quantity != null && trade.price != null)
    ? fmt(trade.quantity * trade.price)
    : "—";

  return `
    <tr>
      <td class="ticker-cell">${trade.ticker}</td>
      <td><span class="badge badge-${action}">${action.toUpperCase()}</span></td>
      <td class="mono">${trade.quantity != null ? fmt(trade.quantity, 4) : "—"}</td>
      <td class="mono">${trade.price    != null ? fmt(trade.price,    4) : "—"}</td>
      <td class="mono">${total}</td>
    </tr>
  `;
}

// ── Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
  const tbody = document.getElementById("dashboard-body");
  tbody.innerHTML = `<tr><td colspan="5" class="empty">Loading...</td></tr>`;

  try {
    const trades = await fetchTrades();

    // Summary stats
    const totalInvested = trades
      .filter(t => (t.action || "buy").toLowerCase() === "buy")
      .reduce((sum, t) => sum + (t.quantity ?? 0) * (t.price ?? 0), 0);

    const tickers = new Set(trades.map(t => t.ticker));
    const lastTicker = trades.length ? trades[trades.length - 1].ticker : "—";

    document.getElementById("total-invested").textContent  = `€ ${fmt(totalInvested)}`;
    document.getElementById("open-positions").textContent  = tickers.size;
    document.getElementById("total-trades").textContent    = trades.length;
    document.getElementById("last-trade").textContent      = lastTicker;

    // Show 5 most recent
    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">No trades yet. Add a trade to get started.</td></tr>`;
      return;
    }

    tbody.innerHTML = trades.slice(-5).reverse().map(buildRow).join("");

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Error loading data.</td></tr>`;
    console.error(e);
  }
}

document.getElementById("btn-refresh").addEventListener("click", () => {
  loadDashboard();
  showToast("Refreshed.");
});

// ── Trades tab ────────────────────────────────────────────

async function loadTrades() {
  const tbody = document.getElementById("trades-body");
  tbody.innerHTML = `<tr><td colspan="5" class="empty">Loading...</td></tr>`;

  try {
    const trades = await fetchTrades();

    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">No trades yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = [...trades].reverse().map(buildRow).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Error loading trades.</td></tr>`;
    console.error(e);
  }
}

// ── Add trade form ────────────────────────────────────────

// Auto-uppercase ticker while typing
document.getElementById("f-ticker").addEventListener("input", function () {
  const pos = this.selectionStart;
  this.value = this.value.toUpperCase();
  this.setSelectionRange(pos, pos);
});

// Live preview
["f-ticker", "f-amount"].forEach(id => {
  document.getElementById(id).addEventListener("input", updatePreview);
});

function updatePreview() {
  const ticker  = document.getElementById("f-ticker").value.trim();
  const amount  = parseFloat(document.getElementById("f-amount").value);
  const preview = document.getElementById("trade-preview");

  if (ticker && !isNaN(amount) && amount > 0) {
    preview.textContent = `BUY ${ticker} — € ${fmt(amount)}`;
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
  const amount = parseFloat(document.getElementById("f-amount").value);

  if (!ticker || isNaN(amount) || amount <= 0) {
    msgEl.className = "err";
    msgEl.textContent = "Please fill in all fields correctly.";
    return;
  }

  try {
    const res = await fetch(`${API}/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, amount }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    msgEl.className = "";
    msgEl.textContent = `✓ Trade saved: BUY ${ticker} — € ${fmt(amount)}`;
    document.getElementById("add-form").reset();
    document.getElementById("trade-preview").textContent = "";
    showToast("Trade saved!");
  } catch (err) {
    msgEl.className = "err";
    msgEl.textContent = `Error: ${err.message}`;
  }
});

// ── Init ──────────────────────────────────────────────────

loadDashboard();