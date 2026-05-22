# Invested

Personal net worth tracking portal.

- **Equity holdings** — stocks, funds, ETFs
- **Properties** — real estate assets & valuations
- **Net worth** — total portfolio summary & trends

> Simple static portal today, app-ready tomorrow.

## Tech
- Static HTML / CSS / JS
- GitHub Pages friendly
- PWA-ready structure (service worker + manifest for future app conversion)

## Run locally
```bash
# Any static server
cd Invested
python3 -m http.server 8080
```

## Future
- Add backend API for live price sync
- Convert to PWA / mobile app (Capacitor / TWA)
- Data persistence (Firebase, Supabase, or self-hosted)
