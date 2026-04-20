import requests
from app.core.config import RF_API

def get_risk_free_rate():
    url = RF_API
    
    params = {
        "fields": "security_desc,avg_interest_rate_amt,record_date",
        "sort": "-record_date",
        "page[size]": 10
    }

    response = requests.get(url, params=params)
    response.raise_for_status()
    data = response.json()["data"]

    # Pick Treasury Bills as short-term risk-free proxy
    for entry in data:
        if entry["security_desc"] == "Treasury Bills":
            rate = float(entry["avg_interest_rate_amt"]) / 100.0  # convert % → decimal
            return rate, entry["record_date"]

    raise ValueError("Treasury Bills rate not found")