# Investment Tracker App

A personal investment tracking application built to run with a fully self-managed backend and frontend. This project allows you to track, analyze, and manage your portfolio with full control over your data and infrastructure.

---

## 🚀 Features

### ✅ Currently Implemented
- Add, edit, and remove trades  
- Track portfolio performance:
  - Realized gains  
  - Unrealized gains  
  - Total gains  
- Portfolio performance graph
- Overview of open positions  
- Monitor gains/losses per open position  
- Full FX rate compatibility:
  - View portfolio and position values in any currency
- Analytics dashboard:
  - Portfolio benchmarking  
  - Key performance indicators (KPIs)    

---

### 🔧 Planned Features

- Watchlist:
  - Track potential future investments  
- Multiple portfolio accounts:
  - Switch between different portfolios  
- Price alert notifications  
- Automated background tasks:
  - Scheduled data updates and server optimization  

---

## 🛠️ Getting Started

### Prerequisites
- Python 3.8+
- Required dependencies (see `requirements.txt`)

### Installation
1. Clone the repository  
2. Install dependencies:
   
   ```bash
   pip install -r requirements.txt
4. Run the application:
   
   ```bash
   py main.py

---

## 🔌 Third-Party Libraries / APIs

This project uses the following external APIs:

- [yfinance](https://github.com/ranaroussi/yfinance) - Provides stock data  
  Licensed under the Apache License 2.0. Copyright Ran Aroussi

- [Frankfurter](https://github.com/lineofflight/frankfurter) - Currency exchange rates API  
  Licensed under the MIT License. Copyright (c) Patrick Line

## 📄 License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).

You are free to use, modify, and distribute this software, provided that any derivative work is also licensed under the GPL v3.0.
