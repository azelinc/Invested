# Invested — Net Worth & Portfolio Tracker (PWA)

## What This Is
Net worth tracking PWA. Tracks assets across categories: stocks (US/KLSE), gold, crypto, funds, retirement. Includes SPENT spending-health dashboard tab (read-only view of Expensed/SPENT data).

## Key URLs
- **Staging:** https://azelinc.github.io/Invested-staging/
- **Production:** https://azelinc.github.io/Invested/
- **GitHub (prod):** `azelinc/Invested.git`
- **GitHub (staging):** `azelinc/Invested-staging.git`
- **Local (prod):** `/opt/data/home/Invested-prod/`
- **Local (staging):** `/opt/data/home/Invested-staging/`
- **Firebase project:** `ainvested-703ec`

## File Structure
- `index.html` — PWA shell
- `app.js` — main app logic, `APP_VER` constant
- `style.css` — styles (versioned: `?v=46` etc.)
- `sw.js` — service worker
- `manifest.json` — PWA manifest

## Deploy Flow
**Two repos (separate repos, not branches):**

| Env | Repo | Branch | URL |
|-----|------|--------|-----|
| Staging | `azelinc/Invested-staging` | `main` | `https://azelinc.github.io/Invested-staging/` |
| Production | `azelinc/Invested` | `main` | `https://azelinc.github.io/Invested/` |

**Staging:** Push `main` to `Invested-staging.git` → auto-deploys
**Production:** Push `main` to `Invested.git` → GitHub Actions auto-deploys

### Version Bump (three places):
1. `app.js` → `const APP_VER = 'XX'`
2. `index.html` → update `?v=N` cache busters on CSS/JS tags
3. `sw.js` → update `CACHE_NAME` constant
4. `index.html` → update BOTH version badges (auth screen `<small>vXX</small>` + topbar `<small>vXX</small>`) — grep with `grep -n 'v[0-9]' index.html | grep -v '?v='`

## Database
**Two databases:**
1. **Firestore** (`ainvested-703ec`) — Asset records at `users/{uid}/assets/{doc_id}`
2. **Firebase RTDB** (same project) — Reads SPENT/Expensed expense data for the dashboard tab

### Asset Schema (Firestore)
```
{
  name: "Physical PB Gold",
  ticker: "PBGOLD",
  category: "gold" | "stock" | "stock-klse" | "crypto" | "fund" | "ut" | "retirement",
  qty: number,
  price: number,
  value: number (qty * price),
  priceSrc: "live" | "fixed",
  excluded: boolean,
  lastPriceSync: epoch_ms
}
```

**Firestore quirks:**
- Fields are wrapped in type keys: `{ "stringValue": "...", "doubleValue": N }`
- `qty` can be `doubleValue` or `integerValue`
- Patching requires `updateMask.fieldPaths` + `currentDocument.exists=true`
- Doc IDs are auto-generated — read all, match by `ticker`

### Known Assets
**Gold:** PBGOLD (113.5g), MIGAGOLD (43.13g), BURSAGOLD (4.76g)
**US Stocks:** TSLA, XPEV, SOUN, NVDA, NKE, MRVL, INTC, AMD, HSAI, AAPL, MSFT, MU, V, AMZN
**KLSE Stocks:** 0215.kl (SLVEST), 5347.kl (TNB), 4456.kl (DNEX), 5305.kl (SENHENG), 0010.kl (IRIS), 9237.kl (SCIB), 1651.kl (MRCB), 5281.kl (ADVCON), 5115.kl (ALAM), 5218.kl (VANTNRG), 0170.kl (KANGER), 5255.kl (LFG), 7031.kl (AMTEL), 0182.kl (LKL), 0150.kl (FINTEC)
**Crypto:** BTC, ETH, SOL, BNB, ADA, XRP, TRX, AXS, CAKE, LTC
**Funds:** ASB, ASBF
**Retirement:** EPF, EPF F, EPF F i-Inv, EPF i-Inv, PRS, PRS F

## Price Sync Logic (sync_prices.py)
- `"stock"` → Yahoo Finance, USD→MYR via BNM rate
- `"stock-klse"` → Yahoo Finance (`.KL` suffix), MYR direct
- `"crypto"` → CoinGecko, USD→MYR
- `"gold"` / `"physical"` → COMEX GC=F via Yahoo, USD/oz → MYR/g
- `"fixed"` → skip

## SPENT Dashboard Tab (Read-Only)
Invested embeds a read-only spending-health dashboard using SPENT expense data. Widgets: hero row (month total + count), daily burn + projection, YTD monthly trend chart, top 4 YTD categories with % share, biggest expense, investment rate ring chart.

## Key Gotchas
- **Two repos, not branches** — always verify with `git remote get-url origin | grep -- '-staging'`
- **INDEX.html version badges**: Both auth screen + topbar `<small>` elements MUST match APP_VER. Use `grep -n 'vOLD' index.html | grep -v '?v='` to find them (NOT replace_all which catches cache busters too)
- **Firestore fields are wrapped** in type keys — not simple JSON
- **Price sync**: KLSE tickers use `.KL` suffix (not `.kl` in some cases)
- **Gold conversion**: COMEX futures in USD/oz → MYR/g (31.1035g per troy oz)
