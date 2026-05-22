import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore, collection, doc,
  onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ═══════════════════════════════════════════════
// 🔥 PASTE YOUR FIREBASE CONFIG HERE
// ═══════════════════════════════════════════════
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "YOUR-PROJECT.firebaseapp.com",
  projectId:         "YOUR-PROJECT",
  storageBucket:     "YOUR-PROJECT.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456..."
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ═══════════════════ AUTH UI ═══════════════════ */
const els = {
  authSection: document.getElementById('auth-section'),
  appSection:  document.getElementById('app-section'),
  email:       document.getElementById('email'),
  password:    document.getElementById('password'),
  authError:   document.getElementById('auth-error'),
  userEmail:   document.getElementById('user-email'),
};

document.getElementById('btn-login').onclick = async () => {
  try { await signInWithEmailAndPassword(auth, els.email.value.trim(), els.password.value); }
  catch(e) { els.authError.textContent = e.message; }
};

document.getElementById('btn-register').onclick = async () => {
  try { await createUserWithEmailAndPassword(auth, els.email.value.trim(), els.password.value); }
  catch(e) { els.authError.textContent = e.message; }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

onAuthStateChanged(auth, user => {
  if (user) {
    els.authSection.style.display = 'none';
    els.appSection.style.display  = 'block';
    els.userEmail.textContent = user.email;
    els.authError.textContent = '';
    attachListeners(user.uid);
  } else {
    els.authSection.style.display = 'block';
    els.appSection.style.display  = 'none';
    detachListeners();
  }
});

/* ═══════════════════ DATA / FIRESTORE ═══════════════════ */
let unsubHoldings   = null;
let unsubProperties = null;
let holdings   = [];
let properties = [];

function attachListeners(uid) {
  const hRef = collection(db, 'users', uid, 'holdings');
  const pRef = collection(db, 'users', uid, 'properties');

  unsubHoldings = onSnapshot(hRef, snap => {
    holdings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, console.error);

  unsubProperties = onSnapshot(pRef, snap => {
    properties = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, console.error);
}

function detachListeners() {
  if (unsubHoldings)   { unsubHoldings();   unsubHoldings   = null; }
  if (unsubProperties) { unsubProperties(); unsubProperties = null; }
  holdings = []; properties = []; render();
}

/* ═══════════════════ RENDER ═══════════════════ */
function fmt(n) {
  return 'RM ' + Number(n || 0).toLocaleString('en-MY', { maximumFractionDigits: 0 });
}

function render() {
  const hGrid = document.getElementById('holdings-grid');
  hGrid.innerHTML = '';
  let hTotal = 0;

  holdings.forEach(item => {
    hTotal += Number(item.value || 0);
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <button class="btn-delete" data-id="${item.id}" data-kind="holding">✕</button>
      <div class="name">${item.name}</div>
      <div class="value">${fmt(item.value)}</div>
      <div class="detail">${item.qty ?? '-'} × ${item.type ?? 'stock'}</div>
    `;
    div.onclick = e => { if (!e.target.closest('.btn-delete')) editHolding(item.id, item.value); };
    hGrid.appendChild(div);
  });

  const pGrid = document.getElementById('properties-grid');
  pGrid.innerHTML = '';
  let pTotal = 0;

  properties.forEach(item => {
    pTotal += Number(item.value || 0);
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <button class="btn-delete" data-id="${item.id}" data-kind="property">✕</button>
      <div class="name">${item.name}</div>
      <div class="value">${fmt(item.value)}</div>
      <div class="detail">${item.type ?? 'residential'}</div>
    `;
    div.onclick = e => { if (!e.target.closest('.btn-delete')) editProperty(item.id, item.value); };
    pGrid.appendChild(div);
  });

  // Delete handlers
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const uid = auth.currentUser.uid;
      const col = btn.dataset.kind === 'holding' ? 'holdings' : 'properties';
      await deleteDoc(doc(db, 'users', uid, col, btn.dataset.id));
    };
  });

  document.getElementById('net-worth').textContent = fmt(hTotal + pTotal);
  document.getElementById('net-change').textContent = '+0.00%';
}

/* ═══════════════════ CRUD ═══════════════════ */
async function editHolding(id, cur) {
  const nv = prompt('Update value for holding:', cur);
  if (nv === null || nv === '' || isNaN(nv)) return;
  await updateDoc(doc(db, 'users', auth.currentUser.uid, 'holdings', id), { value: Number(nv) });
}

async function editProperty(id, cur) {
  const nv = prompt('Update value for property:', cur);
  if (nv === null || nv === '' || isNaN(nv)) return;
  await updateDoc(doc(db, 'users', auth.currentUser.uid, 'properties', id), { value: Number(nv) });
}

document.getElementById('add-holding').onclick = async () => {
  const name  = prompt('Ticker / Name:');
  if (!name) return;
  const qty   = Number(prompt('Quantity:', 1));
  const value = Number(prompt('Value (RM):', 0));
  await addDoc(collection(db, 'users', auth.currentUser.uid, 'holdings'), {
    name, qty: isNaN(qty) ? 0 : qty, value: isNaN(value) ? 0 : value, type: 'stock', createdAt: serverTimestamp()
  });
};

document.getElementById('add-property').onclick = async () => {
  const name  = prompt('Property name / address:');
  if (!name) return;
  const value = Number(prompt('Estimated value (RM):', 0));
  await addDoc(collection(db, 'users', auth.currentUser.uid, 'properties'), {
    name, value: isNaN(value) ? 0 : value, type: 'residential', createdAt: serverTimestamp()
  });
};
