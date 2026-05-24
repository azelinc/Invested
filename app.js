import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore, collection, doc,
  onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, query, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getDatabase, ref as dbRef, onValue
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

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
  POL:'polygon-ecosystem-token'
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
let _goldPriceUsdPerGram = 0;

async function fetchGoldPrice() {
  const urls = [
    'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d',
    'https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d',
    'https://corsproxy.io/?' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d')
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      const priceOz = meta?.regularMarketPrice || meta?.previousClose || meta?.chartPreviousClose;
      if (!priceOz) continue;
      const priceGramUsd = priceOz / 31.1034768;
      _goldPriceUsdPerGram = priceGramUsd;
      return priceGramUsd * _usdMyr;
    } catch (e) { /* try next */ }
  }
  console.warn('All gold price sources failed');
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
let currentAssets = [];
let currentFilter = 'all';
let currentUid = null;
let spentExpenses = [];

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
}

function detachListeners() {
  if (unsubAssets) { unsubAssets(); unsubAssets = null; }
  if (unsubSpent) { unsubSpent(); unsubSpent = null; }
  currentAssets = [];
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
    { name:'KWSP EPF', ticker:'EPF', category:'retirement', qty:1, price:0, priceSrc:'fixed', value:150000 },
    { name:'PRS Fund', ticker:'PRS', category:'retirement', qty:1, price:0, priceSrc:'fixed', value:25000 },
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

/* ═══════════════════ HOME RENDER ═══════════════════ */
function renderHome() {
  const allAssets = currentAssets.map(a => a.category === 'physical' ? { ...a, category: 'gold' } : a);
  const total = allAssets.reduce((s, a) => s + (a.value || 0), 0);

  document.getElementById('home-net-worth').textContent = fmt(conv(total));
  document.getElementById('home-asset-count').textContent = `${currentAssets.length} assets`;
  document.getElementById('home-last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-MY', {hour:'2-digit', minute:'2-digit'});

  // Category totals
  const cats = ['fund','stock','stock-klse','crypto','ut','gold','retirement'];
  for (const cat of cats) {
    const catTotal = allAssets.filter(a => a.category === cat).reduce((s, a) => s + (a.value || 0), 0);
    const el = document.getElementById(`home-${cat}`);
    if (el) el.textContent = fmt(conv(catTotal));
  }

}

/* ═══════════════════ ASSET RENDER ═══════════════════ */
function renderAssets() {
  const grid = document.getElementById('assets-grid');
  const allAssets = currentAssets.map(a => a.category === 'physical' ? { ...a, category: 'gold' } : a);
  const assets = currentFilter === 'all' ? allAssets : allAssets.filter(a => a.category === currentFilter);
  const total = allAssets.reduce((s, a) => s + (a.value || 0), 0);

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
      html += `
        <div class="asset-card" data-id="${a.id}">
          <div class="asset-left">
            <div class="asset-dot" style="background:${CAT_COLORS[a.category]||'#64748b'}"></div>
            <div class="asset-info">
              <div class="asset-name">${a.name}</div>
              <div class="asset-meta">
                ${a.ticker ? `<span class="ticker">${a.ticker}</span>` : ''}
                ${priceTag}
                <span class="asset-qty">${fmtQty(a.qty)}</span>
              </div>
            </div>
          </div>
          <div class="asset-right">
            <div class="asset-value">${fmt(conv(a.value))}</div>
            <div class="asset-actions-row">
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
  grid.querySelectorAll('.btn-sm.delete').forEach(b => b.onclick = () => deleteAsset(b.dataset.id));
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

/* ── Refresh prices ── */
document.getElementById('btn-refresh').onclick = async () => {
  await getMyrRate();
  const stocks = currentAssets.filter(a => a.category === 'stock' && a.ticker);
  const klseStocks = currentAssets.filter(a => a.category === 'stock-klse' && a.ticker);
  const cryptos = currentAssets.filter(a => a.category === 'crypto' && a.ticker);
  const golds = currentAssets.filter(a => a.category === 'gold' || a.category === 'physical');

  for (const a of stocks) {
    const p = await fetchStockPrice(a.ticker);
    if (p) {
      const v = p * (a.qty || 0);
      await updateDoc(doc(db, `users/${currentUid}/assets`, a.id), { price: p, value: v, lastPriceSync: Date.now() });
    }
  }

  for (const a of klseStocks) {
    const p = await fetchStockPrice(a.ticker, true);
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
};

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

  return `
    <form id="asset-form" onsubmit="return false">
      ${common}
      ${manualField}
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
    if (!name) { alert('Name is required'); return; }

    let price = 0, value = 0, priceSrc = 'fixed';
    if (cat === 'stock' || cat === 'stock-klse' || cat === 'crypto' || cat === 'gold') {
      priceSrc = 'live';
      if (cat === 'stock' && ticker) price = await fetchStockPrice(ticker);
      if (cat === 'stock-klse' && ticker) price = await fetchStockPrice(ticker, true);
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
      name, ticker, category: cat, qty, price, value, priceSrc,
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
      if (cat === 'stock-klse' && ticker) price = await fetchStockPrice(ticker, true);
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
      name, ticker, category: cat, qty, price, value, priceSrc,
      updatedAt: serverTimestamp()
    });
    closeModal();
  };
  document.getElementById('m-cancel').onclick = closeModal;
}

async function deleteAsset(id) {
  await deleteDoc(doc(db, `users/${currentUid}/assets`, id));
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
});
