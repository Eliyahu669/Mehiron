// שכבת נתונים: מצב ענן (Firebase) או מצב מקומי (תצוגה מקדימה)
// full = מנהל, או עובד שהמנהל הפעיל לו "הצג פירוט פנימי" – מקבל מחירי ספק והגדרות מלאות
// lite = עובד רגיל – מקבל רק קטלוג מחירים סופיים (public/catalog) והגדרות ציבוריות (app/public)
import { DEFAULT_CONFIG } from './defaults.js';
import { buildPublicCatalog, publicConfig, sig } from './publish.js';
import { pack, readPriceListDoc, readCatalogDoc } from './packing.js';

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
  const { ok, _id, ...rest } = it;
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
    const built = buildPublicCatalog(state.lists, state.config);
    return { full: false, pcfg: mergePublicConfig(publicConfig(state.config)), pub: { ...readCatalogDoc({ z: pack(built.models, 'הקטלוג') }), updatedAt: built.updatedAt }, ready: true };
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
      pack(items.map(slim)); // אותה בדיקת גודל כמו בענן
      state = { ...state, lists: { ...state.lists, [id]: { items: items.map(slim), updatedAt: Date.now(), ...meta } } };
      persist();
    },
    /** ייבוא מאקסל: כל המחירונים וההגדרות נשמרים יחד (הכול או כלום) */
    async saveImport({ lists = {}, config = null }) {
      const next = { ...state.lists };
      for (const [id, { items, ...meta }] of Object.entries(lists)) {
        pack(items.map(slim), `המחירון של ${meta.supplierName || id}`);
        next[id] = { items: items.map(slim), updatedAt: Date.now(), ...meta };
      }
      state = { ...state, lists: next, ...(config ? { config: mergeConfig(config) } : {}) };
      persist();
    },
    async publish() { return false; },
    async listAllowed() { return state.users; },
    async addAllowed(email, label = '') { state.users = [...state.users.filter((u) => u.email !== email), { email: email.trim().toLowerCase(), label, showCost: false }]; persist(); },
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
async function cloudStore(firebaseConfig, sdk = null) {
  // sdk: אפשר להזריק מימוש מדומה לבדיקות; אחרת נטען Firebase האמיתי
  const [{ initializeApp }, fs, au] = sdk || await Promise.all([
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
  let dataUnsubs = [], roleUnsubs = [];
  let dataMode = null; // 'full' | 'lite' | null
  let state = { ready: false };
  let lastSig = null;
  const emit = () => dataSubs.forEach((cb) => cb(state));
  const emitAuth = () => authSubs.forEach((cb) => cb(current));
  const stopData = () => { dataUnsubs.forEach((u) => u()); dataUnsubs = []; dataMode = null; };
  const onErr = (e) => { state = { ...state, error: e?.code || 'error' }; emit(); };

  function startFull() {
    if (dataMode === 'full') return;
    stopData(); dataMode = 'full';
    state = { full: true, config: mergeConfig(null), lists: {}, ready: false };
    let gotCfg = false, gotLists = false;
    dataUnsubs.push(fs.onSnapshot(fs.doc(db, 'app', 'config'), (snap) => {
      gotCfg = true; state = { ...state, error: null, config: mergeConfig(snap.exists() ? snap.data() : null), ready: gotLists }; emit();
    }, onErr));
    dataUnsubs.push(fs.onSnapshot(fs.collection(db, 'pricelists'), (qs) => {
      const lists = {};
      qs.forEach((d) => { lists[d.id] = readPriceListDoc(d.data()); });
      gotLists = true; state = { ...state, error: null, lists, ready: gotCfg }; emit();
    }, onErr));
  }

  function startLite() {
    if (dataMode === 'lite') return;
    stopData(); dataMode = 'lite';
    state = { full: false, pcfg: mergePublicConfig(null), pub: { models: [] }, ready: false };
    let gotCfg = false, gotCat = false;
    dataUnsubs.push(fs.onSnapshot(fs.doc(db, 'app', 'public'), (snap) => {
      gotCfg = true; state = { ...state, error: null, pcfg: mergePublicConfig(snap.exists() ? snap.data() : null), ready: gotCat }; emit();
    }, onErr));
    dataUnsubs.push(fs.onSnapshot(fs.doc(db, 'public', 'catalog'), (snap) => {
      gotCat = true; state = { ...state, error: null, pub: readCatalogDoc(snap.exists() ? snap.data() : null), ready: gotCfg }; emit();
    }, onErr));
  }

  au.onAuthStateChanged(auth, (user) => {
    roleUnsubs.forEach((u) => u()); roleUnsubs = [];
    if (!user) { current = { user: null, role: 'none' }; stopData(); emitAuth(); return; }
    const email = String(user.email || '').toLowerCase();
    const who = { email, name: user.displayName };
    let isAdmin = null; // לא ידוע עדיין
    let allowed = null; // null = לא ידוע, false = אין, { showCost }
    const decide = () => {
      if (isAdmin === true) {
        if (current.role !== 'admin') { current = { user: who, role: 'admin' }; emitAuth(); }
        startFull();
      } else if (isAdmin === false && allowed !== null) {
        if (!allowed) { current = { user: who, role: 'none' }; stopData(); emitAuth(); return; }
        const changed = current.role !== 'viewer' || current.showCost !== allowed.showCost;
        current = { user: who, role: 'viewer', showCost: allowed.showCost };
        if (changed) emitAuth();
        (allowed.showCost ? startFull : startLite)();
      }
    };
    const adminRef = fs.doc(db, 'app', 'admin');
    roleUnsubs.push(fs.onSnapshot(adminRef, { includeMetadataChanges: true }, (snap) => {
      if (!snap.exists()) {
        if (snap.metadata.fromCache) return; // לא ידוע בלי שרת – מחכים
        // המשתמש הראשון שמתחבר הופך למנהל (החוקים מאפשרים רק אם עדיין אין מנהל)
        fs.setDoc(adminRef, { uid: user.uid, email }).catch(() => { isAdmin = false; decide(); });
        return;
      }
      isAdmin = snap.data()?.uid === user.uid;
      decide();
    }, (e) => { if (isAdmin === null) { isAdmin = false; decide(); } onErr(e); }));
    // עובד: מסמך ההרשאה שלו – כשהמנהל מדליק/מכבה את המתג זה מתעדכן מיד
    roleUnsubs.push(fs.onSnapshot(fs.doc(db, 'allowed', email), (snap) => {
      allowed = snap.exists() ? { showCost: snap.data()?.showCost === true } : false;
      decide();
    }, () => { allowed = false; decide(); }));
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
      const z = pack(items.map(slim));
      await fs.setDoc(fs.doc(db, 'pricelists', id), clean({ z, v: 2, count: items.length, updatedAt: Date.now(), ...meta }));
    },
    /** ייבוא מאקסל: כל המחירונים וההגדרות נכתבים באצווה אחת (הכול או כלום) */
    async saveImport({ lists = {}, config = null }) {
      const batch = fs.writeBatch(db);
      for (const [id, { items, ...meta }] of Object.entries(lists)) {
        const z = pack(items.map(slim), `המחירון של ${meta.supplierName || id}`);
        batch.set(fs.doc(db, 'pricelists', id), clean({ z, v: 2, count: items.length, updatedAt: Date.now(), ...meta }));
      }
      if (config) batch.set(fs.doc(db, 'app', 'config'), clean(config));
      await batch.commit();
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
      const z = pack(pub.models, 'קטלוג המחירים');
      await fs.setDoc(fs.doc(db, 'app', 'public'), clean(pcfg));
      await fs.setDoc(fs.doc(db, 'public', 'catalog'), { v: 2, z, updatedAt: pub.updatedAt, count: pub.models.length, sig: s });
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
      await fs.addDoc(fs.collection(db, 'requests'), clean({ what: String(req.what || '').slice(0, 200), email: current.user?.email || '', status: 'open', at: Date.now() }));
    },
    async resolveRequest(id, approve, email) {
      if (approve && email) await fs.setDoc(fs.doc(db, 'allowed', email), { showCost: true }, { merge: true });
      await fs.setDoc(fs.doc(db, 'requests', id), { status: approve ? 'approved' : 'dismissed', resolvedAt: Date.now() }, { merge: true });
    },
  };
}

export async function createStore({ firebaseConfig, seed, sdk }) {
  if (firebaseConfig && firebaseConfig.apiKey) return cloudStore(firebaseConfig, sdk);
  return localStore(seed);
}
