# Invested

Personal net worth tracking portal.

- **Equity holdings** — stocks, funds, ETFs
- **Properties** — real estate assets & valuations
- **Net worth** — total portfolio summary & trends

## 🔥 Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Firestore Database** → Create database → Start in **test mode** (lock rules before going live).
3. **Build → Authentication** → Sign-in method → Enable **Email/Password**.
4. **Project Settings → General** → Add **Web app** → copy the config object.
5. Paste the config into `app.js` (replace the `firebaseConfig` placeholder).

### Firestore Security Rules

In **Firestore Database → Rules**, paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Then click **Publish**.

## Tech
- Vanilla HTML / CSS / JS
- Firebase Auth + Firestore
- GitHub Pages friendly
- PWA-ready (service worker + manifest)

## Run locally
```bash
cd Invested
python3 -m http.server 8080
```

## Future
- Backend API for live price sync
- Data persistence done
- Next: history tracking & charts
