const API_URL = "http://127.0.0.1:8000/api/v1";

async function addTrade() {
    const ticker = document.getElementById("ticker").value;
    const amount = document.getElementById("amount").value;

    const response = await fetch(`${API_URL}/trades`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            ticker: ticker,
            amount: parseFloat(amount)
        })
    });

    if (response.ok) {
        loadTrades();
    } else {
        alert("Error adding trade");
    }
}

async function loadTrades() {
    const response = await fetch(`${API_URL}/trades`);
    const data = await response.json();

    const trades = data.trades;

    const list = document.getElementById("trade-list");
    list.innerHTML = "";

    trades.forEach(trade => {
        const li = document.createElement("li");

        li.textContent =
            `${trade.ticker} | ` +
            `${trade.action} | ` +
            `${trade.quantity} @ ${trade.price} €`;

        list.appendChild(li);
    });
}

loadTrades();