// שכבת נתונים: מצב ענן (Firebase) או מצב מקומי (תצוגה מקדימה)
// full = מנהל, או עובד שהמנהל הפעיל לו "הצג פירוט פנימי" – מקבל מחירי ספק והגדרות מלאות
// lite = עובד רגיל – מקבל רק קטלוג מחירים סופיים (public/catalog) והגדרות ציבוריות (app/public)
import { DEFAULT_CONFIG } from './defaults.js';
import { buildPublicCatalog, publicConfig, sig } from './publish.js';

const LS_KEY = 'mehiron:v2';

export function mergeConfig(c) {
  const d = DEFAULT_CONFIG;
  c = c || {};
  return {
    ...d, ...c,
    labor: { ...d.labor, ...(c.labor || {}) },
    margins: { ...d.margins, ...(c.margins || {}) },
    rounding: { ...d.rounding, ...(c.rounding || {}) },
    freshness: { ...d.freshness, ...(c.freshness || {}) },
    laborRules: c.laborRules || d.laborRules,
    addons: c.addons || d.addons,
    suppliers: c.suppliers || d.suppliers,
    priceOverrides: c.priceOverrides || {},
  };
}

export function mergePublicConfig(p) {
  const d = publicConfig(DEFAULT_CONFIG);
  p = p || {};
  return { ...d, ...p, rounding: { ...d.rounding, ...(p.rounding || {}) }, freshness: { ...d.freshness, ...(p.freshness || {}) } };
}

const slim = (it) => {
  const { ok, ...rest } = it;
  return rest;
};
const clean = (o) => JSON.parse(JSON.stringify(o));

// ---------- מצב מקומי (תצוגה מקדימה) ----------
function localStore(seed) {
  let state;
  try { state = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { state = null; }
  if (!state) state = { config: mergeConfig(null), lists: seed?.lists || {} };
  state.config = mergeConfig(state.config);
  state.requests = state.requests || [];
  state.users = state.users || [{ email: 'branch.netanya@gmail.com', label: 'סניף נתניה (דוגמה)', showCost: false }];
  let previewAs = null; // null = מנהל, אחרת אימייל של עובד לתצוגה מקדימה
  const dataSubs = new Set(), authSubs = new Set(), reqSubs = new Set();
  const viewer = () => state.users.find((u) => u.email === previewAs);
  const snapshot = () => {
    const v = viewer();
    if (!previewAs || v?.showCost) return { full: true, config: state.config, lists: state.lists, ready: true };
    return { full: false, pcfg: mergePublicConfig(publicConfig(state.config)), pub: buildPublicCatalog(state.lists, state.config), ready: true };
  };
  const auth = () => (previewAs ? { user: { email: previewAs }, role: 'viewer', showCost: !!viewer()?.showCost } : { user: { email: 'מצב מקומי' }, role: 'admin' });
  const persist = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* חסום – ממשיכים בזיכרון */ }
    dataSubs.forEach((cb) => cb(snapshot()));
    authSubs.forEach((cb) => cb(auth()));
    reqSubs.forEach((cb) => cb(state.requests.filter((r) => r.status === 'open')));
  };
  return {
    mode: 'local',
    onData(cb) { dataSubs.add(cb); cb(snapshot()); return () => dataSubs.delete(cb); },
    onAuth(cb) { authSubs.add(cb); cb(auth()); return () => authSubs.delete(cb); },
    onRequests(cb) { reqSubs.add(cb); cb(state.requests.filter((r) => r.status === 'open')); return () => reqSubs.delete(cb); },
    async signIn() {}, async signOut() { previewAs = null; persist(); },
    async saveConfig(cfg) { state = { ...state, config: mergeConfig(cfg) }; persist(); },
    async savePriceList(id, items, meta = {}) {
      state = { ...state, lists: { ...state.lists, [id]: { items: items.map(slim), updatedAt: Date.now(), ...meta } } };
      persist();
    },
    async publish() {},
    async listAllowed() { return state.users; },
    async addAllowed(email, label = '') { state.users = [...state.users.filter((u) => u.email !== email), { email: email.toLowerCase(), label, showCost: false }]; persist(); },
    async removeAllowed(email) { state.users = state.users.filter((u) => u.email !== email); persist(); },
    async setShowCost(email, on) { state.users = state.users.map((u) => (u.email === email ? { ...u, showCost: !!on } : u)); persist(); },
    async createRequest(req) { state.requests = [...state.requests, { id: 'q' + Date.now(), email: previewAs || 'מקומי', status: 'open', at: Date.now(), ...req }]; persist(); },
    async resolveRequest(id, approve) {
      const r = state.requests.find((x) => x.id === id);
      if (approve && r) state.users = state.users.map((u) => (u.email === r.email ? { ...u, showCost: true } : u));
      state.requests = state.requests.map((x) => (x.id === id ? { ...x, status: approve ? 'approved' : 'dismissed' } : x));
      persist();
    },
    // תצוגה מקדימה בלבד: לראות את האפליקציה כמו עובד
    previewAs(email) { previewAs = email || null; persist(); },
    resetLocal() { try { localStorage.removeItem(LS_KEY); } catch { /* */ } state = { config: mergeConfig(null), lists: seed?.lists || {}, requests: [], users: [] }; persist(); },
  };
}

// ---------- מצב ענן ----------
async function cloudStore(firebaseConfig) {
  const [{ initializeApp }, fs, au] = await Promise.all([
    import('firebase/app'), import('firebase/firestore'), import('firebase/auth'),
  ]);
  const app = initializeApp(firebaseConfig);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(app);
  }
  const auth = au.getAuth(app);
  try { await au.setPersistence(auth, au.browserLocalPersistence); } catch { /* */ }
  try { await au.getRedirectResult(auth); } catch { /* */ }

  let current = { user: null, role: 'pending' };
  const authSubs = new Set(), dataSubs = new Set();
  let dataUnsubs = [], selfUnsub = null;
  let state = { ready: false };
  let lastSig = null;
  const emit = () => dataSubs.forEach((cb) => cb(state));
  const emitAuth = () => authSubs.forEach((cb) => cb(current));
  const stopData = () => { dataUnsubs.forEach((u) => u()); dataUnsubs = []; };

  function startFull() {
    stopData();
    state = { full: true, config: mergeConfig(null), lists: {}, ready: false };
    let gotCfg = false, gotLists = false;
    dataUnsubs.push(fs.onSnapshot(fs.doc(db, 'app', 'config'), (snap) => {
      gotCfg = true; state = { ...state, config: mergeConfig(snap.exists() ? snap.data() : null), ready: gotLists }; emit();
    }, () => {}));
    dataUnsubs.push(fs.onSnapshot(fs.collection(db, 'pricelists'), (qs) => {
      const lists = {};
      qs.forEach((d) => { lists[d.id] = d.data(); });
      gotLists = true; state = { ...state, lists, ready: gotCfg }; emit();
    }, () => {}));
  }

  function startLite() {
    stopData();
    state = { full: false, pcfg: mergePublicConfig(null), pub: { models: [] }, ready: false };
    let gotCfg = false, gotCat = false;
    dataUnsubs.push(fs.onSnapshot(fs.doc(db, 'app', 'public'), (snap) => {
      gotCfg = true; state = { ...state, pcfg: mergePublicConfig(snap.exists() ? snap.data() : null), ready: gotCat }; emit();
    }, () => {}));
    dataUnsubs.push(fs.onSnapshot(fs.doc(db, 'public', 'catalog'), (snap) => {
      gotCat = true; state = { ...state, pub: snap.exists() ? snap.data() : { models: [] }, ready: gotCfg }; emit();
    }, () => {}));
  }

  au.onAuthStateChanged(auth, async (user) => {
    if (selfUnsub) { selfUnsub(); selfUnsub = null; }
    if (!user) { current = { user: null, role: 'none' }; stopData(); emitAuth(); return; }
    const email = String(user.email).toLowerCase();
    try {
      const adminRef = fs.doc(db, 'app', 'admin');
      let a = await fs.getDoc(adminRef);
      if (!a.exists()) { // המשתמש הראשון שמתחבר הופך למנהל
        await fs.setDoc(adminRef, { uid: user.uid, email });
        a = await fs.getDoc(adminRef);
      }
      if (a.data()?.uid === user.uid) {
        current = { user: { email, name: user.displayName }, role: 'admin' };
        emitAuth(); startFull();
        return;
      }
    } catch { /* ממשיכים לבדיקת עובד */ }
    // עובד: מאזינים למסמך ההרשאה שלו – כשהמנהל מדליק/מכבה את המתג זה מתעדכן מיד
    selfUnsub = fs.onSnapshot(fs.doc(db, 'allowed', email), (snap) => {
      if (!snap.exists()) { current = { user: { email }, role: 'none' }; stopData(); emitAuth(); return; }
      const showCost = snap.data()?.showCost === true;
      const changed = current.role !== 'viewer' || current.showCost !== showCost;
      current = { user: { email, name: user.displayName }, role: 'viewer', showCost };
      emitAuth();
      if (changed) (showCost ? startFull : startLite)();
    }, () => { current = { user: { email }, role: 'none' }; emitAuth(); });
  });

  return {
    mode: 'cloud',
    onData(cb) { dataSubs.add(cb); cb(state); return () => dataSubs.delete(cb); },
    onAuth(cb) { authSubs.add(cb); cb(current); return () => authSubs.delete(cb); },
    onRequests(cb) {
      const q = fs.query(fs.collection(db, 'requests'), fs.where('status', '==', 'open'));
      return fs.onSnapshot(q, (qs) => cb(qs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at)), () => cb([]));
    },
    async signIn() {
      const provider = new au.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try { await au.signInWithPopup(auth, provider); }
      catch (e) {
        if (String(e?.code).includes('popup')) await au.signInWithRedirect(auth, provider);
        else throw e;
      }
    },
    async signOut() { await au.signOut(auth); },
    async saveConfig(cfg) { await fs.setDoc(fs.doc(db, 'app', 'config'), clean(cfg)); },
    async savePriceList(id, items, meta = {}) {
      await fs.setDoc(fs.doc(db, 'pricelists', id), clean({ items: items.map(slim), updatedAt: Date.now(), ...meta }));
    },
    /** מנהל בלבד: מפרסם לעובדים קטלוג מחירים סופיים. נכתב רק אם משהו השתנה */
    async publish(lists, cfg) {
      const pcfg = publicConfig(cfg);
      const pub = buildPublicCatalog(lists, cfg);
      const s = sig([pcfg, pub]);
      if (s === lastSig) return false;
      if (lastSig === null) {
        const cur = await fs.getDoc(fs.doc(db, 'public', 'catalog')).catch(() => null);
        if (cur?.exists() && cur.data().sig === s) { lastSig = s; return false; }
      }
      await fs.setDoc(fs.doc(db, 'app', 'public'), clean(pcfg));
      await fs.setDoc(fs.doc(db, 'public', 'catalog'), clean({ ...pub, sig: s }));
      lastSig = s;
      return true;
    },
    async listAllowed() {
      const qs = await fs.getDocs(fs.collection(db, 'allowed'));
      return qs.docs.map((d) => ({ email: d.id, ...d.data() }));
    },
    async addAllowed(email, label = '') {
      await fs.setDoc(fs.doc(db, 'allowed', String(email).trim().toLowerCase()), { label, addedAt: Date.now(), showCost: false });
    },
    async removeAllowed(email) { await fs.deleteDoc(fs.doc(db, 'allowed', email)); },
    async setShowCost(email, on) { await fs.setDoc(fs.doc(db, 'allowed', email), { showCost: !!on }, { merge: true }); },
    async createRequest(req) {
      await fs.addDoc(fs.collection(db, 'requests'), clean({ ...req, email: current.user?.email || '', status: 'open', at: Date.now() }));
    },
    async resolveRequest(id, approve, email) {
      if (approve && email) await fs.setDoc(fs.doc(db, 'allowed', email), { showCost: true }, { merge: true });
      await fs.setDoc(fs.doc(db, 'requests', id), { status: approve ? 'approved' : 'dismissed', resolvedAt: Date.now() }, { merge: true });
    },
  };
}

export async function createStore({ firebaseConfig, seed }) {
  if (firebaseConfig && firebaseConfig.apiKey) return cloudStore(firebaseConfig);
  return localStore(seed);
}
