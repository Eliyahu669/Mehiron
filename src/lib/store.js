// שכבת נתונים: מצב ענן (Firebase) או מצב מקומי (תצוגה מקדימה / לפני חיבור Firebase)
import { DEFAULT_CONFIG } from './defaults.js';

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

const slim = (it) => {
  const { ok, ...rest } = it;
  return rest;
};

// ---------- מצב מקומי ----------
function localStore(seed) {
  let state;
  try { state = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { state = null; }
  if (!state) state = { config: mergeConfig(null), lists: seed?.lists || {} };
  state.config = mergeConfig(state.config);
  const dataSubs = new Set();
  const persist = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* מקום מלא / חסום – ממשיכים בזיכרון */ }
    dataSubs.forEach((cb) => cb({ ...state, ready: true }));
  };
  return {
    mode: 'local',
    onData(cb) { dataSubs.add(cb); cb({ ...state, ready: true }); return () => dataSubs.delete(cb); },
    onAuth(cb) { cb({ user: { email: 'מצב מקומי' }, role: 'admin' }); return () => {}; },
    async signIn() {}, async signOut() {},
    async saveConfig(cfg) { state = { ...state, config: mergeConfig(cfg) }; persist(); },
    async savePriceList(id, items, meta = {}) {
      state = { ...state, lists: { ...state.lists, [id]: { items: items.map(slim), updatedAt: Date.now(), ...meta } } };
      persist();
    },
    async listAllowed() { return []; }, async addAllowed() {}, async removeAllowed() {},
    resetLocal() { try { localStorage.removeItem(LS_KEY); } catch { /* */ } state = { config: mergeConfig(null), lists: seed?.lists || {} }; persist(); },
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
  const authSubs = new Set();
  const dataSubs = new Set();
  let unsubs = [];
  let state = { config: mergeConfig(null), lists: {}, ready: false };
  const emit = () => dataSubs.forEach((cb) => cb(state));

  function startData() {
    unsubs.forEach((u) => u()); unsubs = [];
    let gotCfg = false, gotLists = false;
    unsubs.push(fs.onSnapshot(fs.doc(db, 'app', 'config'), (snap) => {
      gotCfg = true; state = { ...state, config: mergeConfig(snap.exists() ? snap.data() : null), ready: gotLists }; emit();
    }, () => {}));
    unsubs.push(fs.onSnapshot(fs.collection(db, 'pricelists'), (qs) => {
      const lists = {};
      qs.forEach((d) => { lists[d.id] = d.data(); });
      gotLists = true; state = { ...state, lists, ready: gotCfg }; emit();
    }, () => {}));
  }

  au.onAuthStateChanged(auth, async (user) => {
    if (!user) { current = { user: null, role: 'none' }; unsubs.forEach((u) => u()); unsubs = []; authSubs.forEach((cb) => cb(current)); return; }
    let role = 'none';
    try {
      const adminRef = fs.doc(db, 'app', 'admin');
      let a = await fs.getDoc(adminRef);
      if (!a.exists()) { // המשתמש הראשון שמתחבר הופך למנהל
        await fs.setDoc(adminRef, { uid: user.uid, email: user.email });
        a = await fs.getDoc(adminRef);
      }
      if (a.data()?.uid === user.uid) role = 'admin';
      else {
        const al = await fs.getDoc(fs.doc(db, 'allowed', String(user.email).toLowerCase()));
        role = al.exists() ? 'viewer' : 'none';
      }
    } catch { role = 'none'; }
    current = { user: { email: user.email, name: user.displayName }, role };
    authSubs.forEach((cb) => cb(current));
    if (role !== 'none') startData();
  });

  return {
    mode: 'cloud',
    onData(cb) { dataSubs.add(cb); cb(state); return () => dataSubs.delete(cb); },
    onAuth(cb) { authSubs.add(cb); cb(current); return () => authSubs.delete(cb); },
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
    async saveConfig(cfg) { await fs.setDoc(fs.doc(db, 'app', 'config'), JSON.parse(JSON.stringify(cfg))); },
    async savePriceList(id, items, meta = {}) {
      await fs.setDoc(fs.doc(db, 'pricelists', id), JSON.parse(JSON.stringify({ items: items.map(slim), updatedAt: Date.now(), ...meta })));
    },
    async listAllowed() {
      const qs = await fs.getDocs(fs.collection(db, 'allowed'));
      return qs.docs.map((d) => ({ email: d.id, ...d.data() }));
    },
    async addAllowed(email, label = '') {
      await fs.setDoc(fs.doc(db, 'allowed', String(email).trim().toLowerCase()), { label, addedAt: Date.now() });
    },
    async removeAllowed(email) { await fs.deleteDoc(fs.doc(db, 'allowed', email)); },
  };
}

export async function createStore({ firebaseConfig, seed }) {
  if (firebaseConfig && firebaseConfig.apiKey) return cloudStore(firebaseConfig);
  return localStore(seed);
}
