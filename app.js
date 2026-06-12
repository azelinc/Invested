import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore, collection, doc,
  onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, query, getDocs,
  getDoc, setDoc, orderBy, limit
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getDatabase, ref as dbRef, onValue
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

const APP_VER = 'v46';

// ═══════════════════════════════════════════════
// 🔥 LIVE FIREBASE CONFIG
// ═══════════════════════════════════════════════
const firebaseConfig = {
  apiKey:            "AIzaSyC2fezwrXSOeDCytG84RES-dJ04teLvmuo",
  authDomain:        "ainvested-703ec.firebaseapp.com",
  databaseURL:       "https://ainvested-703ec-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "ainvested-703ec",
  storageBucket:     "ainvested-703ec.firebasestorage.app",
  messagingSenderId: "453797298902",
  appId:             "1:453797298902:web:ea0018b9a52dd73eaaff77",
  measurementId:     "G-HD4J2B5T80"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

/* ═══════════════════ UTILS ═══════════════════ */
let _usdMyr = 4.45;
let currency = 'myr';
let sortMode = 'value';

function toMyr(v) { return v || 0; }
function toUsd(v) { return (v || 0) / _usdMyr; }
function conv(v) { return currency === 'usd' ? toUsd(v) : toMyr(v); }

const fmt = n => new Intl.NumberFormat('en-MY', {
  style: 'currency',
  currency: currency.toUpperCase()
}).format(n || 0);

const fmtQty = n => new Intl.NumberFormat('en-MY', { maximumFractionDigits: 6 }).format(n || 0);

const CRYPTO_MAP = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', XRP:'ripple', ADA:'cardano',
  DOT:'polkadot', AVAX:'avalanche-2', MATIC:'matic-network', BNB:'binancecoin',
  DOGE:'dogecoin', LINK:'chainlink', UNI:'uniswap', LTC:'litecoin',
  BCH:'bitcoin-cash', XLM:'stellar', ALGO:'algorand', VET:'vechain',
  FIL:'filecoin', TRX:'tron', ETC:'ethereum-classic', XMR:'monero',
  ICP:'internet-computer', APT:'aptos', NEAR:'near', ARB:'arbitrum',
  OP:'optimism', SUI:'sui', TIA:'celestia', SEI:'sei-network',
  INJ:'injective-protocol', RNDR:'render-token', FET:'fetch-ai',
  GRT:'the-graph', AAVE:'aave', MKR:'maker', LDO:'lido-dao',
  SAND:'the-sandbox', MANA:'decentraland', AXS:'axie-infinity',
  GALA:'gala', CHZ:'chiliz', ENJ:'enjincoin', BAT:'basic-attention-token',
  CRV:'curve-dao-token', COMP:'compound-governance-token', YFI:'yearn-finance',
  SNX:'havven', '1INCH':'1inch', ZRX:'0x', BAL:'balancer',
  KNC:'kyber-network-crystal', GNO:'gnosis', LRC:'loopring',
  POL:'polygon-ecosystem-token',
  CAKE:'pancakeswap-token'
};

async function getMyrRate() {
  try {
    const r = await fetch('https://api.bnm.gov.my/public/exchange-rate', {
      headers: { Accept: 'application/vnd.BNM.API.v1+json' },
      cache: 'no-store'
    });
    const d = await r.json();
    const usd = d?.data?.find(x => x.currency_code === 'USD');
    if (usd?.rate?.middle_rate) _usdMyr = usd.rate.middle_rate;
    else throw new Error('USD rate not found');
  } catch (e) {
    console.warn('BNM rate failed, falling back', e);
    try {
      const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { cache: 'no-store' });
      const d = await r.json();
      if (d?.rates?.MYR) _usdMyr = d.rates.MYR;
    } catch (e2) { console.warn('Fallback rate failed', e2); }
  }
  return _usdMyr;
}

async function fetchStockPrice(ticker, isKlse=false) {
  const suffix = ticker.toUpperCase().endsWith('.KL') ? '.KL' : '';
  const isBursa = isKlse || suffix === '.KL';
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
    `https://corsproxy.io/?${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`)}`
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) continue;
      const d = await r.json();
      const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price != null) return isBursa ? price : price * _usdMyr;
    } catch (e) { /* try next */ }
  }
  console.warn('All Yahoo sources failed for', ticker);
  return null;
}

async function fetchCryptoPrices(ids) {
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`, {
      headers: { accept: 'application/json' }
    });
    return await r.json();
  } catch(e) { console.warn('CoinGecko fail', e); return {}; }
}

/* ═══════════════════ GOLD PRICE ═══════════════════ */
let _goldPriceMyrPerGram = 0;

async function fetchGoldPrice() {
  // Primary: Bursa Gold Dinar WebSocket (live buy price)
  try {
    const price = await new Promise((resolve, reject) => {
      const ws = new WebSocket('wss://bgd-adam.bursamalaysia.com/bgd/pricestream');
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WS timeout'));
      }, 8000);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.bursaBuyPrice && data.bursaBuyPrice > 0) {
            clearTimeout(timeout);
            ws.close();
            resolve(data.bursaBuyPrice);
          }
        } catch (_) { /* skip malformed message */ }
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('WS error')); };
      ws.onclose = () => { clearTimeout(timeout); reject(new Error('WS closed')); };
    });
    _goldPriceMyrPerGram = price;
    return price;
  } catch (e) {
    console.warn('Bursa WS gold price failed — fallback to COMEX', e);
  }
  // Fallback: COMEX GC=F via Yahoo
  const fallbackUrls = [
    'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d',
    'https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d',
    'https://corsproxy.io/?' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d')
  ];
  for (const url of fallbackUrls) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      const priceOz = meta?.regularMarketPrice || meta?.previousClose || meta?.chartPreviousClose;
      if (!priceOz) continue;
      const priceGramUsd = priceOz / 31.1034768;
      _goldPriceMyrPerGram = priceGramUsd * _usdMyr;
      return _goldPriceMyrPerGram;
    } catch (e) { /* try next */ }
  }
  return null;
}

/* ═══════════════════ KLSE SCREENER PRICE ═══════════════════ */
async function fetchKlsePrice(ticker) {
  // Try Yahoo Finance first (ticker already includes .KL)
  const p = await fetchStockPrice(ticker, true);
  if (p) return p;
  // Fallback: KLSE Screener via CORS proxy
  const code = ticker.toUpperCase().replace('.KL', '');
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(`https://www.klsescreener.com/v2/stocks/view/${code}`)}`;
  try {
    const r = await fetch(proxyUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const m = html.match(/([0-9]+\.[0-9]{3})\s*[↑↓]/);
    if (m) return parseFloat(m[1]);
  } catch (_) { /* ignore */ }
  return null;
}

/* ═══════════════════ AUTH UI ═══════════════════ */
const els = {
  authSection:  document.getElementById('auth-section'),
  appSection:   document.getElementById('app-section'),
  loginPanel:   document.getElementById('login-panel'),
  registerPanel:document.getElementById('register-panel'),
  email:        document.getElementById('email'),
  password:     document.getElementById('password'),
  authError:    document.getElementById('auth-error'),
  regEmail:     document.getElementById('reg-email'),
  regPassword:  document.getElementById('reg-password'),
  regPassword2: document.getElementById('reg-password2'),
  regError:     document.getElementById('reg-error'),
  userEmail:    document.getElementById('user-email'),
};

function showLogin() {
  els.loginPanel.style.display = 'block';
  els.registerPanel.style.display = 'none';
}
function showRegister() {
  els.loginPanel.style.display = 'none';
  els.registerPanel.style.display = 'block';
}

document.getElementById('link-register').onclick = e => { e.preventDefault(); showRegister(); };
document.getElementById('link-login').onclick = e => { e.preventDefault(); showLogin(); };

document.getElementById('btn-login').onclick = async () => {
  try {
    await signInWithEmailAndPassword(auth, els.email.value.trim(), els.password.value);
  } catch(e) { els.authError.textContent = e.message; }
};

document.getElementById('btn-register').onclick = async () => {
  if (els.regPassword.value !== els.regPassword2.value) {
    els.regError.textContent = 'Passwords do not match'; return;
  }
  try {
    await createUserWithEmailAndPassword(auth, els.regEmail.value.trim(), els.regPassword.value);
  } catch(e) { els.regError.textContent = e.message; }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

/* ═══════════════════ TABS ═══════════════════ */
let currentTab = 'home';

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.main-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'home') renderHome();
  if (tab === 'asset') renderAssets();
  if (tab === 'spent') renderSpent();
}

document.getElementById('main-tabs').addEventListener('click', e => {
  if (!e.target.matches('.main-tab')) return;
  switchTab(e.target.dataset.tab);
});

/* Click home cards → jump to Asset tab filtered */
document.getElementById('home-categories').addEventListener('click', e => {
  const card = e.target.closest('.home-card');
  if (!card) return;
  const cat = card.dataset.cat;
  currentFilter = cat;
  // Update asset tab filter buttons
  document.querySelectorAll('#category-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.filter === cat));
  switchTab('asset');
});

/* ═══════════════════ DATA / RENDER ═══════════════════ */
let unsubAssets = null;
let unsubSpent = null;
let unsubTrades = null;
let currentAssets = [];
let currentTrades = [];
let currentFilter = 'all';
let currentUid = null;
let spentExpenses = [];
let editMode = false;

const CAT_COLORS = {
  fund:'#10b981', stock:'#3b82f6', crypto:'#f59e0b',
  'stock-klse':'#84cc16',
  ut:'#8b5cf6', gold:'#06b6d4', retirement:'#f43f5e', unknown:'#64748b'
};
const CAT_LABELS = {
  fund:'Fund', stock:'Stock', 'stock-klse':'Stock KLSE', crypto:'Crypto',
  ut:'Unit Trust', gold:'Gold', retirement:'Retirement', unknown:'Unknown'
};

function attachListeners(uid) {
  currentUid = uid;

  // Firestore assets
  const q = query(collection(db, `users/${uid}/assets`));
  unsubAssets = onSnapshot(q, snap => {
    currentAssets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    seedIfEmpty(uid);
    if (currentTab === 'home') renderHome();
    if (currentTab === 'asset') renderAssets();
  }, console.error);

  // RTDB expenses from SPENT
  const spentRef = dbRef(rtdb, `users/${uid}/expenses`);
  unsubSpent = onValue(spentRef, snap => {
    const val = snap.val() || {};
    spentExpenses = Object.entries(val).map(([id, o]) => ({ id, ...o }));
    if (currentTab === 'home' || currentTab === 'spent') {
      if (currentTab === 'home') renderHome();
      if (currentTab === 'spent') renderSpent();
    }
  }, console.error);

  // Firestore trades
  const tq = query(collection(db, `users/${uid}/trades`), orderBy('date', 'desc'));
  unsubTrades = onSnapshot(tq, snap => {
    currentTrades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (currentTab === 'asset-detail') renderAssetDetail(currentDetailTicker);
    if (currentTab === 'asset') renderAssets();
    // Sync asset qty from trades for any assets that have trade records
    syncAllAssetsFromTrades();
  }, console.error);
}

function detachListeners() {
  if (unsubAssets) { unsubAssets(); unsubAssets = null; }
  if (unsubSpent) { unsubSpent(); unsubSpent = null; }
  if (unsubTrades) { unsubTrades(); unsubTrades = null; }
  currentAssets = [];
  currentTrades = [];
  spentExpenses = [];
  currentUid = null;
}

async function seedIfEmpty(uid) {
  const q = query(collection(db, `users/${uid}/assets`));
  const snap = await getDocs(q);
  if (!snap.empty) return;

  const seed = [
    { name:'ASB', ticker:'ASB', category:'fund', qty:277000, price:1, priceSrc:'fixed', value:277000 },
    { name:'Tesla', ticker:'TSLA', category:'stock', qty:120, price:0, priceSrc:'live', value:0 },
    { name:'XPeng', ticker:'XPEV', category:'stock', qty:800, price:0, priceSrc:'live', value:0 },
    { name:'BYD', ticker:'BYD', category:'stock', qty:500, price:0, priceSrc:'live', value:0 },
    { name:'Bitcoin', ticker:'BTC', category:'crypto', qty:0.18, price:0, priceSrc:'live', value:0 },
    { name:'Ethereum', ticker:'ETH', category:'crypto', qty:1.5, price:0, priceSrc:'live', value:0 },
    { name:'Solana', ticker:'SOL', category:'crypto', qty:45, price:0, priceSrc:'live', value:0 },
    { name:'Public Mutual', ticker:'PMUT', category:'ut', qty:5000, price:1, priceSrc:'fixed', value:5000 },
    { name:'Gold Bars', ticker:'GOLD', category:'gold', qty:50, price:380, priceSrc:'live', value:19000 },
    { name:'KWSP EPF', ticker:'EPF', category:'retirement', qty:1, price:0, priceSrc:'fixed', value:150000, excluded:true },
    { name:'PRS Fund', ticker:'PRS', category:'retirement', qty:1, price:0, priceSrc:'fixed', value:25000, excluded:true },
    { name:'Maybank', ticker:'1155.KL', category:'stock-klse', qty:500, price:0, priceSrc:'live', value:0 },
    { name:'Public Bank', ticker:'1295.KL', category:'stock-klse', qty:1000, price:0, priceSrc:'live', value:0 },
    { name:'CIMB', ticker:'1023.KL', category:'stock-klse', qty:800, price:0, priceSrc:'live', value:0 },
  ];

  for (const a of seed) {
    await addDoc(collection(db, `users/${uid}/assets`), { ...a, createdAt: serverTimestamp() });
  }
}

/* ── Sorting ── */
function sortAssets(items) {
  if (sortMode === 'alpha') {
    return [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }
  return [...items].sort((a, b) => (b.value || 0) - (a.value || 0));
}

/* ── Unrealised P/L from trades ── */
function getAssetPL(asset) {
  const ticker = (asset.ticker || '').toUpperCase();
  if (!ticker) return { cost: 0, curValue: 0, pl: 0, pct: 0, hasTrades: false };
  const trades = currentTrades.filter(t => (t.ticker || '').toUpperCase() === ticker)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!trades.length) return { cost: 0, curValue: 0, pl: 0, pct: 0, hasTrades: false };
  let qty = 0, totalCost = 0;
  for (const t of trades) {
    const total = (t.qty || 0) * (t.price || 0) + (t.fees || 0);
    if (t.type === 'buy') {
      qty += (t.qty || 0);
      totalCost += total;
    } else {
      const avgCost = qty > 0 ? totalCost / qty : 0;
      const soldCost = avgCost * (t.qty || 0);
      qty -= (t.qty || 0);
      totalCost -= soldCost;
    }
  }
  const curValue = (asset.price || 0) * qty;
  const pl = curValue - totalCost;
  const pct = totalCost > 0 ? (pl / totalCost * 100) : 0;
  return { cost: totalCost, curValue, pl, pct, hasTrades: true };
}

/* ═══════════════════ HOME RENDER ═══════════════════ */
async function renderHome() {
  const allAssets = currentAssets.map(a => a.category === 'physical' ? { ...a, category: 'gold' } : a);
  const includedAssets = allAssets.filter(a => !a.excluded);
  const total = includedAssets.reduce((s, a) => s + (a.value || 0), 0);
  const excludedTotal = allAssets.filter(a => a.excluded).reduce((s, a) => s + (a.value || 0), 0);

  document.getElementById('home-net-worth').textContent = fmt(conv(total));
  document.getElementById('home-asset-count').textContent = `${currentAssets.length} assets`;
  document.getElementById('home-last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-MY', {hour:'2-digit', minute:'2-digit'});

  // Show excluded amount if any
  let excludedEl = document.getElementById('home-excluded');
  if (!excludedEl) {
    const heroDiv = document.getElementById('home-net-worth').parentElement;
    excludedEl = document.createElement('div');
    excludedEl.id = 'home-excluded';
    excludedEl.style.cssText = 'font-size:.7rem;color:var(--muted);margin-top:.15rem;';
    heroDiv.appendChild(excludedEl);
  }
  const grandTotal = total + excludedTotal;
  excludedEl.textContent = excludedTotal ? `${fmt(conv(grandTotal))} total (incl. illiquid)` : '';

  // Category totals
  const cats = ['fund','stock','stock-klse','crypto','ut','gold','retirement'];
  for (const cat of cats) {
    const catTotal = allAssets.filter(a => a.category === cat).reduce((s, a) => s + (a.value || 0), 0);
    const el = document.getElementById(`home-${cat}`);
    if (el) el.textContent = fmt(conv(catTotal));
  }

  // Capture daily snapshot — then render chart
  await captureSnapshot(allAssets);
  await renderChart();

}

/* ═══════════════ DAILY SNAPSHOT ═══════════════ */
async function captureSnapshot(allAssets) {
  if (!currentUid) return;
  const today = new Date().toISOString().slice(0,10); // YYYY-MM-DD
  try {
    const snapRef = doc(db, `users/${currentUid}/snapshots`, today);
    const existing = await getDoc(snapRef);
    if (existing.exists()) return; // already captured today
    const total = allAssets.reduce((s,a) => s + (a.value||0), 0);
    if (total === 0) return; // don't record zero snapshots
    const liquid = allAssets.filter(a => !a.excluded).reduce((s,a) => s + (a.value||0), 0);
    const excluded = allAssets.filter(a => a.excluded).reduce((s,a) => s + (a.value||0), 0);
    await setDoc(snapRef, { date: today, total, liquid, excluded, timestamp: Date.now() });
  } catch(e) { console.warn('Snapshot skipped', e); }
}

/* ── Force override today's snapshot ── */
async function forceSnapshotToday() {
  if (!currentUid) return;
  const allAssets = currentAssets.map(a => a.category === 'physical' ? { ...a, category: 'gold' } : a);
  const today = new Date().toISOString().slice(0,10);
  const total = allAssets.reduce((s,a) => s + (a.value||0), 0);
  if (total === 0) { showToast("No assets to record"); return; }
  const liquid = allAssets.filter(a => !a.excluded).reduce((s,a) => s + (a.value||0), 0);
  const excluded = allAssets.filter(a => a.excluded).reduce((s,a) => s + (a.value||0), 0);
  try {
    const snapRef = doc(db, `users/${currentUid}/snapshots`, today);
    await setDoc(snapRef, { date: today, total, liquid, excluded, timestamp: Date.now() });
    showToast("📌 Today's snapshot updated");
    await renderChart();
  } catch(e) { console.warn('Force snapshot failed', e); showToast("Failed to save snapshot"); }
}

/* ═══════════════ NET WORTH CHART ═══════════════ */
let chartInstance = null;

async function renderChart() {
  const canvas = document.getElementById('networth-chart');
  if (!canvas) return;

  // Query last 30 snapshots
  let snapshots = [];
  try {
    const q = query(collection(db, `users/${currentUid}/snapshots`), orderBy('date','desc'), limit(30));
    const snap = await getDocs(q);
    snapshots = snap.docs.map(d => d.data()).reverse(); // oldest first
  } catch(e) { console.warn('Chart query failed', e); return; }

  if (snapshots.length < 1) return;

  // Exclude days where net worth is 0 (app not opened — no snapshot taken)
  const filtered = snapshots.filter(s => (s.total || 0) !== 0 || (s.liquid || 0) !== 0);

  if (filtered.length < 1) return;

  const labels = filtered.map(s => {
    const d = new Date(s.date + 'T00:00:00');
    return d.toLocaleDateString('en-MY', {day:'numeric', month:'short'});
  });
  const totalData = filtered.map(s => conv(s.total || 0));
  const liquidData = filtered.map(s => conv(s.liquid || 0));

  const ctx = canvas.getContext('2d');

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Net Worth',
          data: liquidData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: '#10b981',
          yAxisID: 'y',
        },
        {
          label: 'Net Worth (All)',
          data: totalData,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: '#3b82f6',
          yAxisID: 'y1',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: {
          labels: { color:'#94a3b8', font: { size:11 }, boxWidth: 12, padding: 12 }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color:'#64748b', font: { size:9 }, maxTicksLimit: 8 },
          grid: { color:'rgba(255,255,255,0.05)' }
        },
        y: {
          position: 'left',
          ticks: {
            color:'#10b981',
            font: { size: 9 },
            callback: v => v >= 1000 ? (v/1000).toFixed(0)+'k' : v
          },
          grid: { color:'rgba(255,255,255,0.05)' }
        },
        y1: {
          position: 'right',
          ticks: {
            color:'#3b82f6',
            font: { size: 9 },
            callback: v => v >= 1000 ? (v/1000).toFixed(0)+'k' : v
          },
          grid: { display: false }
        }
      }
    }
  });
}

/* ═══════════════════ SHARE ═══════════════════ */
async function sharePortfolio() {
  if (!currentAssets.length) {
    showToast("No assets to share.");
    return;
  }
  const allAssets = currentAssets.map(a => a.category === 'physical' ? { ...a, category: 'gold' } : a);
  const includedAssets = allAssets.filter(a => !a.excluded);
  const total = includedAssets.reduce((s, a) => s + (a.value || 0), 0);
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const excludedTotal = allAssets.filter(a => a.excluded).reduce((s, a) => s + (a.value || 0), 0);

  let text = `Invested Portfolio — ${now}\nNet Worth: ${fmt(conv(total))} (${(currency || 'myr').toUpperCase()})\n`;
  if (excludedTotal) text += `Excluded (illiquid): ${fmt(conv(excludedTotal))}\n`;
  text += `${allAssets.length} Assets\n\n`;

  const cats = ['fund','stock','stock-klse','crypto','ut','gold','retirement'];
  for (const cat of cats) {
    const items = allAssets.filter(a => a.category === cat).sort((a, b) => (b.value || 0) - (a.value || 0));
    if (!items.length) continue;
    const catTotal = items.reduce((s, a) => s + (a.value || 0), 0);
    text += `📊 ${CAT_LABELS[cat] || cat}\n`;
    for (const a of items) {
      text += `  • ${a.name}: ${fmt(conv(a.value || 0))}${a.qty ? ` (${fmtQty(a.qty)} ${a.category === 'gold' ? 'g' : 'units'} @ ${fmt(conv(a.price || 0))})` : ''}\n`;
    }
    text += `  Subtotal: ${fmt(conv(catTotal))} (${((catTotal/total)*100).toFixed(1)}%)\n\n`;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("✅ Portfolio copied to clipboard!");
  } catch (e) {
    prompt("Copy this summary:", text);
  }
}

/* ═══════════════════ ASSET RENDER ═══════════════════ */
function renderAssets() {
  const grid = document.getElementById('assets-grid');
  const allAssets = currentAssets.map(a => a.category === 'physical' ? { ...a, category: 'gold' } : a);
  const assets = currentFilter === 'all' ? allAssets : allAssets.filter(a => a.category === currentFilter);
  const includedAssets = allAssets.filter(a => !a.excluded);
  const total = includedAssets.reduce((s, a) => s + (a.value || 0), 0);

  // Populate summary row
  const nwEl = document.getElementById('asset-net-worth');
  const cntEl = document.getElementById('asset-asset-count');
  const updEl = document.getElementById('asset-last-updated');
  if (nwEl) nwEl.textContent = fmt(conv(total));
  if (cntEl) cntEl.textContent = `${allAssets.length} assets`;
  if (updEl) updEl.textContent = 'Updated ' + new Date().toLocaleTimeString('en-MY', {hour:'2-digit', minute:'2-digit'});

  // Update sort/currency buttons
  const sortBtn = document.getElementById('btn-sort');
  if (sortBtn) sortBtn.textContent = sortMode === 'alpha' ? '↕ A–Z' : '↕ Value';
  const curBtn = document.getElementById('btn-currency');
  if (curBtn) {
    curBtn.textContent = currency.toUpperCase();
    curBtn.classList.toggle('active', currency === 'myr');
  }

  if (!assets.length) {
    grid.innerHTML = `<div class="empty">No assets yet. Click <strong>+ Add Asset</strong> to get started.</div>`;
    return;
  }

  // Group by category
  const byCat = {};
  for (const a of assets) {
    const cat = a.category || 'unknown';
    byCat[cat] = byCat[cat] || [];
    byCat[cat].push(a);
  }

  let html = '';
  for (const cat of Object.keys(byCat).sort((a,b) => {
    const order = ['fund','stock','stock-klse','crypto','ut','gold','retirement','unknown'];
    return order.indexOf(a) - order.indexOf(b);
  })) {
    const items = sortAssets(byCat[cat]);
    const catTotal = byCat[cat].reduce((s, a) => s + (a.value || 0), 0);
    html += `<div class="cat-section">
      <div class="cat-header">
        <h3>${CAT_LABELS[cat] || cat}</h3>
        <span class="cat-total">${fmt(conv(catTotal))}</span>
      </div>
      <div class="cat-list">`;

    for (const a of items) {
      const unitLabel = a.category === 'gold' ? 'gram' : 'unit';
      const priceLabel = a.price ? `${fmt(conv(a.price))} / ${unitLabel}` : '';
      const priceTag = a.priceSrc === 'live' ? `<span class="price-tag">${priceLabel}</span>` : '';
      const pl = getAssetPL(a);
      const plHtml = pl.hasTrades
        ? `<div class="asset-pl ${pl.pl >= 0 ? 'pf-up' : 'pf-down'}" style="font-size:.62rem;display:${editMode ? 'none' : 'block'}">${pl.pl >= 0 ? '+' : ''}${fmt(conv(Math.abs(pl.pl)))} (${pl.pl >= 0 ? '+' : ''}${pl.pct.toFixed(1)}%)</div>`
        : '';
      html += `
        <div class="asset-card${a.excluded ? ' excluded' : ''}" data-id="${a.id}">
          <div class="asset-left">
            <div class="asset-dot" style="background:${CAT_COLORS[a.category]||'#64748b'}"></div>
            <div class="asset-info">
              <div class="asset-name">${a.name}${a.excluded ? '<span class="excluded-badge">(Excluded)</span>' : ''}</div>
              <div class="asset-meta">
                ${a.ticker ? `<span class="ticker">${a.ticker}</span>` : ''}
                ${priceTag}
                <span class="asset-qty">${fmtQty(a.qty)}</span>
              </div>
            </div>
          </div>
          <div class="asset-right">
            <div class="asset-value">${fmt(conv(a.value))}</div>
            ${plHtml}
            <div class="asset-actions-row" style="display:${editMode ? 'flex' : 'none'}">
              <button class="btn-sm edit" data-id="${a.id}">Edit</button>
              <button class="btn-sm delete" data-id="${a.id}">×</button>
            </div>
          </div>
        </div>`;
    }
    html += `</div></div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.btn-sm.edit').forEach(b => b.onclick = () => editAsset(b.dataset.id));
  grid.querySelectorAll('.btn-sm.delete').forEach(b => b.onclick = () => { b.stopPropagation(); deleteAsset(b.dataset.id); });
  // Tap asset card → detail view (skip when in edit mode)
  grid.querySelectorAll('.asset-card').forEach(c => {
    c.style.cursor = editMode ? 'default' : 'pointer';
    if (editMode) {
      c.onclick = null;
    } else {
      c.onclick = () => openAssetDetail(c.dataset.id);
    }
  });
}

/* ── Asset tab sub-filters ── */
document.getElementById('category-tabs').addEventListener('click', e => {
  if (!e.target.matches('.tab')) return;
  document.querySelectorAll('#category-tabs .tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  currentFilter = e.target.dataset.filter;
  renderAssets();
});

document.getElementById('btn-sort').onclick = () => {
  sortMode = sortMode === 'value' ? 'alpha' : 'value';
  renderAssets();
};

document.getElementById('btn-currency').onclick = () => {
  currency = currency === 'myr' ? 'usd' : 'myr';
  renderHome();
  renderAssets();
  if (currentTab === 'spent') renderSpent();
};

/* ── Asset Edit Mode Toggle ── */
function toggleAssetEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('btn-edit-assets');
  if (btn) {
    btn.textContent = editMode ? '✓' : '✎';
    btn.classList.toggle('active', editMode);
  }
  renderAssets();
  // Re-attach card click handlers — don't navigate to detail in edit mode
  const grid = document.getElementById('assets-grid');
  if (grid) {
    grid.querySelectorAll('.asset-card').forEach(c => {
      c.style.cursor = editMode ? 'default' : 'pointer';
      if (editMode) {
        c.onclick = null;
      } else {
        c.onclick = () => openAssetDetail(c.dataset.id);
      }
    });
  }
}
document.getElementById('btn-edit-assets').onclick = toggleAssetEditMode;

/* ── Share listeners ── */
document.getElementById('btn-share-home').onclick = sharePortfolio;
document.getElementById('btn-share-asset').onclick = sharePortfolio;

/* ── Refresh prices ── */
async function refreshPrices() {
  await getMyrRate();
  const stocks = currentAssets.filter(a => a.category === 'stock' && a.ticker);
  const cryptos = currentAssets.filter(a => a.category === 'crypto' && a.ticker);
  const golds = currentAssets.filter(a => a.category === 'gold' || a.category === 'physical');
  // Catch gold-named assets that slipped into stock-klse (e.g. Bursa Gold ETF)
  const klseStocks = currentAssets.filter(a => {
    if (a.category !== 'stock-klse' || !a.ticker) return false;
    const nameGold = (a.name || '').toLowerCase().includes('gold');
    const tickGold = (a.ticker || '').toLowerCase().includes('gold');
    if (nameGold || tickGold) {
      golds.push(a); // use unified gold price instead
      return false;
    }
    return true;
  });

  for (const a of stocks) {
    const p = await fetchStockPrice(a.ticker);
    if (p) {
      const v = p * (a.qty || 0);
      await updateDoc(doc(db, `users/${currentUid}/assets`, a.id), { price: p, value: v, lastPriceSync: Date.now() });
    }
  }

  for (const a of klseStocks) {
    const p = await fetchKlsePrice(a.ticker);
    if (p) {
      const v = p * (a.qty || 0);
      await updateDoc(doc(db, `users/${currentUid}/assets`, a.id), { price: p, value: v, lastPriceSync: Date.now() });
    }
  }

  if (cryptos.length) {
    const ids = cryptos.map(a => CRYPTO_MAP[a.ticker?.toUpperCase()]).filter(Boolean);
    const prices = await fetchCryptoPrices(ids);
    for (const a of cryptos) {
      const id = CRYPTO_MAP[a.ticker?.toUpperCase()];
      const pUsd = prices[id]?.usd;
      if (pUsd) {
        const p = pUsd * _usdMyr;
        const v = p * (a.qty || 0);
        await updateDoc(doc(db, `users/${currentUid}/assets`, a.id), { price: p, value: v, lastPriceSync: Date.now() });
      }
    }
  }

  if (golds.length) {
    const pMyrGram = await fetchGoldPrice();
    if (pMyrGram) {
      for (const a of golds) {
        const v = pMyrGram * (a.qty || 0);
        await updateDoc(doc(db, `users/${currentUid}/assets`, a.id), { price: pMyrGram, value: v, lastPriceSync: Date.now() });
      }
    }
  }
  showToast('✅ Prices updated');
}

document.getElementById('btn-refresh').onclick = refreshPrices;
const refreshBtn2 = document.getElementById('btn-refresh-asset');
if (refreshBtn2) refreshBtn2.onclick = refreshPrices;
document.getElementById('btn-snap-now').onclick = forceSnapshotToday;

/* ═══════════════════ SPENT RENDER ═══════════════════ */
function renderSpent() {
  const today = new Date();
  const monthPrefix = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  const approved = spentExpenses.filter(e => e.status === 'approved' && e.date?.startsWith(monthPrefix));
  const spentTotal = approved.reduce((s, e) => s + (e.amount || 0), 0);

  document.getElementById('spent-month').textContent = fmt(conv(spentTotal));
  document.getElementById('spent-count').textContent = `${approved.length} transactions`;

  // Category breakdown
  const catSpend = {};
  for (const e of approved) {
    catSpend[e.category || 'Others'] = (catSpend[e.category || 'Others'] || 0) + (e.amount || 0);
  }
  const sortedCats = Object.entries(catSpend).sort((a,b) => b[1] - a[1]);
  const maxCat = sortedCats.length ? sortedCats[0][1] : 1;

  let catHtml = '';
  for (const [cat, val] of sortedCats) {
    const pct = maxCat > 0 ? (val / maxCat * 100) : 0;
    catHtml += `
      <div class="spent-cat-row">
        <span class="spent-cat-name">${cat}</span>
        <div class="spent-cat-bar-wrap">
          <div class="spent-cat-bar" style="width:${pct}%"></div>
        </div>
        <span class="spent-cat-val">${fmt(conv(val))}</span>
      </div>`;
  }
  document.getElementById('spent-cat-list').innerHTML = catHtml || '<div class="empty">No spending this month</div>';

  // Recent transactions
  const recent = approved.sort((a,b) => (b.timestamp||0) - (a.timestamp||0)).slice(0,15);
  let recentHtml = '';
  for (const e of recent) {
    recentHtml += `
      <div class="spent-recent-item">
        <div class="spent-recent-left">
          <div class="spent-recent-merchant">${e.merchant || '—'}</div>
          <div class="spent-recent-meta">${e.category || 'Others'} · ${e.date || ''}</div>
        </div>
        <span class="spent-recent-amount">${fmt(conv(e.amount))}</span>
      </div>`;
  }
  document.getElementById('spent-recent-list').innerHTML = recentHtml || '<div class="empty">No recent transactions</div>';
}

/* ═══════════════════ ASSET DETAIL VIEW ═══════════════════ */
let currentDetailTicker = null;

async function openAssetDetail(assetId) {
  const asset = currentAssets.find(a => a.id === assetId);
  if (!asset) return;
  const ticker = (asset.ticker || '').toUpperCase();
  if (!ticker) { showToast('No ticker for this asset'); return; }
  currentDetailTicker = ticker;
  switchTab('asset-detail');
  renderAssetDetail(ticker);
  // Background price refresh — if it works, Firestore listener updates the view
  if (asset.priceSrc === 'live' && ticker) {
    try {
      await getMyrRate();
      let freshPrice = null;
      if (ticker.endsWith('.KL')) freshPrice = await fetchStockPrice(ticker, true);
      else if (asset.category === 'crypto') {
        const id = CRYPTO_MAP[ticker];
        if (id) { const pr = await fetchCryptoPrices([id]); freshPrice = (pr[id]?.usd || 0) * _usdMyr; }
      } else if (asset.category === 'gold' || asset.category === 'physical') freshPrice = await fetchGoldPrice();
      else freshPrice = await fetchStockPrice(ticker);
      if (freshPrice) {
        const newValue = freshPrice * (asset.qty || 0);
        await updateDoc(doc(db, `users/${currentUid}/assets`, asset.id), { price: freshPrice, value: newValue, lastPriceSync: Date.now() });
      }
    } catch (_) { /* Firestore price is already current */ }
  }
}

function renderAssetDetail(ticker) {
  const container = document.getElementById('asset-detail-content');
  if (!container) return;

  // Find asset by ticker
  const asset = currentAssets.find(a => (a.ticker || '').toUpperCase() === ticker);
  if (!asset) {
    container.innerHTML = '<div class="empty">Asset not found.</div>';
    return;
  }

  // Filter trades for this ticker
  const trades = currentTrades.filter(t => (t.ticker || '').toUpperCase() === ticker)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // Compute position from trades
  let qty = 0, totalCost = 0, realizedPL = 0;
  for (const t of trades) {
    const total = (t.qty || 0) * (t.price || 0) + (t.fees || 0);
    if (t.type === 'buy') {
      qty += (t.qty || 0);
      totalCost += total;
    } else {
      const avgCost = qty > 0 ? totalCost / qty : 0;
      const soldCost = avgCost * (t.qty || 0);
      qty -= (t.qty || 0);
      totalCost -= soldCost;
      realizedPL += total - soldCost;
    }
  }

  const curPrice = asset.price || 0;
  const curValue = curPrice * qty;
  const avgCost = qty > 0 ? totalCost / qty : 0;
  const unrealizedPL = curValue - totalCost;
  const totalReturn = unrealizedPL + realizedPL;
  const plPct = totalCost > 0 ? (unrealizedPL / totalCost * 100) : 0;
  const isUp = unrealizedPL >= 0;

  // Price source label
  const assetQty = qty; // use trade-computed position
  const unitLabel = asset.category === 'gold' ? 'g' : 'units';

  let html = `
    <!-- Asset header -->
    <section class="detail-header card">
      <div class="detail-header-left">
        <div class="detail-name">${asset.name}</div>
        <div class="detail-ticker">${ticker}</div>
        <div class="detail-meta">
          <span class="pill">${CAT_LABELS[asset.category] || asset.category}</span>
          <span class="pill">${fmtQty(assetQty)} ${unitLabel}</span>
        </div>
      </div>
      <div class="detail-header-right">
        <div class="detail-cur-value">${fmt(conv(asset.value || 0))}</div>
        <div class="detail-cur-price">${fmt(conv(curPrice))} / ${unitLabel}</div>
      </div>
    </section>

    <!-- Position summary -->
    <section class="card detail-pl-summary">
      <div class="detail-pl-item">
        <div class="detail-pl-label">Position Qty</div>
        <div class="detail-pl-val">${fmtQty(qty)} ${unitLabel}</div>
      </div>
      <div class="detail-pl-item">
        <div class="detail-pl-label">Avg Cost</div>
        <div class="detail-pl-val">${fmt(conv(avgCost))}</div>
      </div>
      <div class="detail-pl-item">
        <div class="detail-pl-label">Current Price</div>
        <div class="detail-pl-val">${fmt(conv(curPrice))}</div>
      </div>
      <div class="detail-pl-item">
        <div class="detail-pl-label">Cost Basis</div>
        <div class="detail-pl-val">${fmt(conv(totalCost))}</div>
      </div>
      <div class="detail-pl-item">
        <div class="detail-pl-label">Current Value</div>
        <div class="detail-pl-val">${fmt(conv(curValue))}</div>
      </div>
      <div class="detail-pl-item">
        <div class="detail-pl-label">Unrealized P&L</div>
        <div class="detail-pl-val ${isUp ? 'pf-up' : 'pf-down'}">${fmt(conv(unrealizedPL))}${totalCost > 0 ? ` (${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%)` : ''}</div>
      </div>
      <div class="detail-pl-item">
        <div class="detail-pl-label">Realized P&L</div>
        <div class="detail-pl-val ${realizedPL >= 0 ? 'pf-up' : 'pf-down'}">${fmt(conv(realizedPL))}</div>
      </div>
    </section>

    <!-- Record Trade button -->
    <div class="detail-actions">
      <button class="btn-primary" id="btn-detail-add-trade">+ Record Trade</button>
    </div>

    <!-- Trade history -->
    <div class="detail-section-title">Trade History (${trades.length})</div>`;

  if (!trades.length) {
    html += '<div class="empty">No trades recorded for this asset.</div>';
  } else {
    // Display newest first
    const displayTrades = [...trades].reverse();
    html += '<div class="detail-trade-list">';
    for (const t of displayTrades) {
      const isBuy = t.type === 'buy';
      const total = (t.qty || 0) * (t.price || 0);
      html += `
        <div class="detail-trade-item">
          <div class="detail-trade-left">
            <span class="detail-trade-type ${isBuy ? 'pf-buy' : 'pf-sell'}">${isBuy ? 'BUY' : 'SELL'}</span>
            <span class="detail-trade-date">${t.date || ''}</span>
          </div>
          <div class="detail-trade-mid">
            <span>${fmtQty(t.qty || 0)} @ ${fmt(conv(t.price || 0))}</span>
            ${t.fees ? `<span class="detail-trade-fees">Fees: ${fmt(conv(t.fees))}</span>` : ''}
          </div>
          <div class="detail-trade-right">
            <span class="detail-trade-total">${fmt(conv(total))}</span>
            <button class="btn-sm edit-trade" data-id="${t.id}" style="font-size:.6rem;padding:.12rem .28rem;background:#334155;color:#f8fafc;border:none;border-radius:3px;cursor:pointer;line-height:1">✎</button>
            <button class="btn-sm delete detail-del-trade" data-id="${t.id}">×</button>
          </div>
        </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // Wire up delete trade buttons — pass ticker so asset qty syncs
  container.querySelectorAll('.detail-del-trade').forEach(b => b.onclick = () => {
    deleteTrade(b.dataset.id, ticker);
  });

  // Wire up edit trade buttons
  container.querySelectorAll('.btn-sm.edit-trade').forEach(b => b.onclick = () => {
    editTrade(b.dataset.id, ticker);
  });

  // Wire up record trade button
  document.getElementById('btn-detail-add-trade').onclick = () => showRecordTradeForAsset(ticker, asset.name, asset.category);
}

/* ── Record Trade for a specific asset ── */
function getCurrencyForCategory(cat) {
  return cat === 'stock' ? 'USD' : 'RM';
}

function showRecordTradeForAsset(ticker, name, category) {
  const today = new Date().toISOString().slice(0, 10);
  const cur = getCurrencyForCategory(category);
  openModal('Record Trade',
    `<form id="trade-form" onsubmit="return false">
      <div class="field">
        <label>Asset</label>
        <input type="text" value="${name} (${ticker})" disabled style="background:#0b1221;color:var(--muted)">
      </div>
      <div class="field">
        <label>Type</label>
        <select id="t-type">
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </div>
      <div class="field">
        <label>Date</label>
        <input type="date" id="t-date" value="${today}">
      </div>
      <div class="field">
        <label>Quantity</label>
        <input type="number" id="t-qty" step="any" placeholder="Number of units">
      </div>
      <div class="field">
        <label>Price per unit (${cur})</label>
        <input type="number" id="t-price" step="any" placeholder="Price in ${cur}">
      </div>
      <div class="field">
        <label>Fees (${cur})</label>
        <input type="number" id="t-fees" value="0" step="any">
      </div>
      <div class="field">
        <label>Notes</label>
        <input type="text" id="t-notes" placeholder="Optional">
      </div>
    </form>`,
    `<button class="btn-primary" id="t-save">Save Trade</button>
     <button class="btn-secondary" id="t-cancel">Cancel</button>`
  );
  document.getElementById('t-cancel').onclick = closeModal;
  document.getElementById('t-save').onclick = async () => {
    const type = document.getElementById('t-type').value;
    const date = document.getElementById('t-date').value;
    const qty = parseFloat(document.getElementById('t-qty').value) || 0;
    const rawPrice = parseFloat(document.getElementById('t-price').value) || 0;
    const rawFees = parseFloat(document.getElementById('t-fees').value) || 0;
    const notes = document.getElementById('t-notes').value.trim();
    if (!qty || !rawPrice) { showToast('Qty & price required'); return; }
    // Convert USD to MYR for internal storage (all prices stored as MYR)
    const price = cur === 'USD' ? rawPrice * _usdMyr : rawPrice;
    const fees = cur === 'USD' ? rawFees * _usdMyr : rawFees;
    await addDoc(collection(db, `users/${currentUid}/trades`), {
      name, ticker, type, date, qty, price, fees, notes,
      createdAt: serverTimestamp()
    });
    closeModal();
    await syncAssetFromTrades(ticker);
    showToast(`✅ ${type === 'buy' ? 'Buy' : 'Sell'} recorded`);
  };
}

async function deleteTrade(id, ticker) {
  if (!confirm('Delete this trade?')) return;
  await deleteDoc(doc(db, `users/${currentUid}/trades`, id));
  if (ticker) await syncAssetFromTrades(ticker);
}

/* ── Edit Trade ── */
async function editTrade(id, ticker) {
  const trade = currentTrades.find(t => t.id === id);
  if (!trade) { showToast('Trade not found'); return; }
  const name = trade.name || '';
  const today = new Date().toISOString().slice(0, 10);
  const asset = currentAssets.find(a => (a.ticker || '').toUpperCase() === (ticker || '').toUpperCase());
  const cur = getCurrencyForCategory(asset?.category);
  openModal('Edit Trade',
    `<form id="trade-form" onsubmit="return false">
      <div class="field">
        <label>Asset</label>
        <input type="text" value="${name} (${ticker})" disabled style="background:#0b1221;color:var(--muted)">
      </div>
      <div class="field">
        <label>Type</label>
        <select id="t-type">
          <option value="buy" ${trade.type === 'buy' ? 'selected' : ''}>Buy</option>
          <option value="sell" ${trade.type === 'sell' ? 'selected' : ''}>Sell</option>
        </select>
      </div>
      <div class="field">
        <label>Date</label>
        <input type="date" id="t-date" value="${trade.date || today}">
      </div>
      <div class="field">
        <label>Quantity</label>
        <input type="number" id="t-qty" step="any" value="${trade.qty || ''}" placeholder="Number of units">
      </div>
      <div class="field">
        <label>Price per unit (${cur})</label>
        <input type="number" id="t-price" step="any" value="${cur === 'USD' ? ((trade.price || 0) / _usdMyr).toFixed(2) : (trade.price || '')}" placeholder="Price in ${cur}">
      </div>
      <div class="field">
        <label>Fees (${cur})</label>
        <input type="number" id="t-fees" value="${cur === 'USD' ? ((trade.fees || 0) / _usdMyr).toFixed(2) : (trade.fees || 0)}" step="any">
      </div>
      <div class="field">
        <label>Notes</label>
        <input type="text" id="t-notes" value="${trade.notes || ''}" placeholder="Optional">
      </div>
    </form>`,
    `<button class="btn-primary" id="t-save">Update Trade</button>
     <button class="btn-secondary" id="t-cancel">Cancel</button>`
  );
  document.getElementById('t-cancel').onclick = closeModal;
  document.getElementById('t-save').onclick = async () => {
    const type = document.getElementById('t-type').value;
    const date = document.getElementById('t-date').value;
    const qty = parseFloat(document.getElementById('t-qty').value) || 0;
    const rawPrice = parseFloat(document.getElementById('t-price').value) || 0;
    const rawFees = parseFloat(document.getElementById('t-fees').value) || 0;
    const notes = document.getElementById('t-notes').value.trim();
    if (!qty || !rawPrice) { showToast('Qty & price required'); return; }
    // Convert USD to MYR for internal storage
    const price = cur === 'USD' ? rawPrice * _usdMyr : rawPrice;
    const fees = cur === 'USD' ? rawFees * _usdMyr : rawFees;
    await updateDoc(doc(db, `users/${currentUid}/trades`, id), {
      type, date, qty, price, fees, notes,
      updatedAt: serverTimestamp()
    });
    closeModal();
    await syncAssetFromTrades(ticker);
    showToast('✅ Trade updated');
  };
}

/* ── Sync asset qty from trades ── */
async function syncAssetFromTrades(ticker) {
  if (!currentUid || !ticker) return;
  const key = ticker.toUpperCase();
  // Compute net position from all trades for this ticker
  const ts = currentTrades.filter(t => (t.ticker || '').toUpperCase() === key);
  let netQty = 0;
  for (const t of ts) {
    if (t.type === 'buy') netQty += (t.qty || 0);
    else netQty -= (t.qty || 0);
  }
  // Find matching asset doc
  const asset = currentAssets.find(a => (a.ticker || '').toUpperCase() === key);
  if (!asset) return;
  const qty = Math.max(0, netQty);
  const value = qty * (asset.price || 0);
  await updateDoc(doc(db, `users/${currentUid}/assets`, asset.id), { qty, value });
}

/* ── Sync all asset qties from trades ── */
async function syncAllAssetsFromTrades() {
  if (!currentUid || !currentTrades.length) return;
  const tickers = [...new Set(currentTrades.map(t => (t.ticker || '').toUpperCase()).filter(Boolean))];
  for (const t of tickers) {
    await syncAssetFromTrades(t);
  }
}

/* ── Back button for asset detail ── */
document.getElementById('btn-asset-detail-back').onclick = () => {
  currentDetailTicker = null;
  switchTab('asset');
};

/* ═══════════════════ MODAL CRUD ═══════════════════ */
const overlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalFooter = document.getElementById('modal-footer');
const modalClose = document.getElementById('modal-close');

function openModal(title, bodyHtml, footerHtml, onClose) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalFooter.innerHTML = footerHtml || '';
  overlay.style.display = 'flex';
  overlay.onClose = onClose;
  const first = modalBody.querySelector('input, select, button');
  if (first) first.focus();
}

function closeModal() {
  overlay.style.display = 'none';
  if (overlay.onClose) overlay.onClose();
}

modalClose.onclick = closeModal;
overlay.onclick = e => { if (e.target === overlay) closeModal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function buildAssetForm(asset, isEdit) {
  const cats = Object.keys(CAT_LABELS).filter(c => c !== 'unknown');
  const catOpts = cats.map(c => `<option value="${c}"${asset?.category === c ? ' selected' : ''}>${CAT_LABELS[c]}</option>`).join('');
  const catSelect = `
    <div class="field">
      <label>Category</label>
      <select id="m-category">${catOpts}</select>
    </div>`;

  const common = `
    ${catSelect}
    <div class="field">
      <label>Name</label>
      <input type="text" id="m-name" value="${asset?.name || ''}" placeholder="e.g. ASB">
    </div>
    <div class="field">
      <label>Ticker / Symbol</label>
      <input type="text" id="m-ticker" value="${asset?.ticker || ''}" placeholder="e.g. AAPL">
    </div>
    <div class="field">
      <label>Quantity</label>
      <input type="number" id="m-qty" value="${asset?.qty ?? ''}" placeholder="Amount / Units">
    </div>`;

  const isManual = (['fund','ut','retirement'].includes(asset?.category));
  const manualField = `
    <div class="field" id="m-value-wrap">
      <label>Value (RM)</label>
      <input type="number" id="m-value" value="${asset?.value ?? ''}" placeholder="Total value in RM">
    </div>`;
  const excludedCheck = `
    <div class="field" style="display:flex;align-items:center;gap:.5rem;margin-top:.3rem">
      <input type="checkbox" id="m-excluded" ${asset?.excluded ? 'checked' : ''}>
      <label for="m-excluded" style="margin:0;font-size:.82rem;color:var(--muted)">Exclude from net-worth calculation (e.g. illiquid)</label>
    </div>`;

  return `
    <form id="asset-form" onsubmit="return false">
      ${common}
      ${manualField}
      ${excludedCheck}
      <div class="field" id="m-price-wrap" style="display:${isManual ? 'none' : 'block'}">
        <label>Price per gram (RM) – auto-fetched for Gold, optional manual for Stock/Crypto</label>
        <input type="number" id="m-price" value="${asset?.price ?? ''}" placeholder="Auto-fetched for Gold; optional fallback for Stock/Crypto">
      </div>
    </form>`;
}

function wireCategoryToggle() {
  const sel = document.getElementById('m-category');
  const toggle = () => {
    const manual = ['fund','ut','retirement'].includes(sel.value);
    const isGold = sel.value === 'gold';
    document.getElementById('m-value-wrap').style.display = manual ? 'block' : 'none';
    document.getElementById('m-price-wrap').style.display = isGold ? 'block' : (manual ? 'none' : 'block');
  };
  sel.onchange = toggle;
  toggle();
}

document.getElementById('btn-add').onclick = () => {
  openModal('Add Asset',
    buildAssetForm({ category: 'stock' }),
    `<button class="btn-primary" id="m-save">Save</button>
     <button class="btn-secondary" id="m-cancel">Cancel</button>`
  );
  wireCategoryToggle();

  document.getElementById('m-save').onclick = async () => {
    const cat = document.getElementById('m-category').value;
    const name = document.getElementById('m-name').value.trim();
    const ticker = document.getElementById('m-ticker').value.trim();
    const qty = parseFloat(document.getElementById('m-qty').value) || 0;
    if (!name) { showToast('Name is required'); return; }

    let price = 0, value = 0, priceSrc = 'fixed';
    if (cat === 'stock' || cat === 'stock-klse' || cat === 'crypto' || cat === 'gold') {
      priceSrc = 'live';
      if (cat === 'stock' && ticker) price = await fetchStockPrice(ticker);
      if (cat === 'stock-klse' && ticker) {
        // Gold-named assets on KLSE should use unified gold price
        const isGold = (name || '').toLowerCase().includes('gold') || (ticker || '').toLowerCase().includes('gold');
        if (isGold) {
          price = await fetchGoldPrice();
        } else {
          price = await fetchKlsePrice(ticker);
        }
      }
      if (cat === 'crypto' && ticker) {
        const id = CRYPTO_MAP[ticker.toUpperCase()];
        if (id) {
          const pr = await fetchCryptoPrices([id]);
          price = (pr[id]?.usd || 0) * _usdMyr;
        }
      }
      if (cat === 'gold') price = await fetchGoldPrice();
      if (!price) {
        const fallback = parseFloat(document.getElementById('m-price').value);
        if (fallback) { price = fallback; priceSrc = 'fixed'; }
      }
      value = price * qty;
    } else {
      value = parseFloat(document.getElementById('m-value').value) || 0;
      price = qty ? value / qty : 0;
    }

    await addDoc(collection(db, `users/${currentUid}/assets`), {
      name, ticker, category: cat, qty, price, value, priceSrc, excluded: !!document.getElementById('m-excluded').checked,
      createdAt: serverTimestamp()
    });
    closeModal();
  };
  document.getElementById('m-cancel').onclick = closeModal;
};

async function editAsset(id) {
  const a = currentAssets.find(x => x.id === id);
  if (!a) return;
  openModal('Edit Asset',
    buildAssetForm(a, true),
    `<button class="btn-primary" id="m-save">Update</button>
     <button class="btn-secondary" id="m-cancel">Cancel</button>`
  );
  wireCategoryToggle();

  document.getElementById('m-save').onclick = async () => {
    const cat = document.getElementById('m-category').value;
    const name = document.getElementById('m-name').value.trim();
    const ticker = document.getElementById('m-ticker').value.trim();
    const qty = parseFloat(document.getElementById('m-qty').value) || 0;
    if (!name) return;

    let price = a.price, value = a.value, priceSrc = a.priceSrc;
    if (cat === 'stock' || cat === 'stock-klse' || cat === 'crypto' || cat === 'gold') {
      priceSrc = 'live';
      if (cat === 'stock' && ticker) price = await fetchStockPrice(ticker);
      if (cat === 'stock-klse' && ticker) {
        // Gold-named assets on KLSE should use unified gold price
        const isGold = (name || '').toLowerCase().includes('gold') || (ticker || '').toLowerCase().includes('gold');
        if (isGold) {
          price = await fetchGoldPrice();
        } else {
          price = await fetchKlsePrice(ticker);
        }
      }
      if (cat === 'crypto' && ticker) {
        const id = CRYPTO_MAP[ticker.toUpperCase()];
        if (id) {
          const pr = await fetchCryptoPrices([id]);
          price = (pr[id]?.usd || 0) * _usdMyr;
        }
      }
      if (cat === 'gold') price = await fetchGoldPrice();
      if (!price) {
        const fallback = parseFloat(document.getElementById('m-price').value);
        if (fallback) { price = fallback; priceSrc = 'fixed'; }
      }
      value = price * qty;
    } else {
      value = parseFloat(document.getElementById('m-value').value) || 0;
      price = qty ? value / qty : 0;
    }

    await updateDoc(doc(db, `users/${currentUid}/assets`, id), {
      name, ticker, category: cat, qty, price, value, priceSrc, excluded: !!document.getElementById('m-excluded').checked,
      updatedAt: serverTimestamp()
    });
    closeModal();
  };
  document.getElementById('m-cancel').onclick = closeModal;
}

async function deleteAsset(id) {
  await deleteDoc(doc(db, `users/${currentUid}/assets`, id));
}

/* ═══════════════════ TOAST ═══════════════════ */
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = 'position:fixed;bottom:66px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f8fafc;padding:.5rem 1rem;border-radius:8px;font-size:.82rem;z-index:2000;box-shadow:0 4px 20px rgba(0,0,0,.5);transition:opacity .25s;max-width:90vw;white-space:nowrap;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._hide);
  toast._hide = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

/* ═══════════════════ AUTH STATE ═══════════════════ */
onAuthStateChanged(auth, user => {
  if (user) {
    currentUid = user.uid;
    els.authSection.style.display = 'none';
    els.appSection.style.display = 'block';
    els.userEmail.textContent = user.email;
    els.authError.textContent = '';
    attachListeners(user.uid);
    switchTab('home');
  } else {
    els.authSection.style.display = 'block';
    els.appSection.style.display = 'none';
    detachListeners();
    showLogin();
  }
  // Global version badge
  const vEl = document.getElementById('global-version');
  if (vEl) vEl.textContent = APP_VER;
});
