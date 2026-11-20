// Firebase מדומה בזיכרון – לבדיקת שכבת הנתונים בלי רשת
export function fakeFirebase() {
  const docs = new Map(); // path → data
  const listeners = new Set();
  let user = null;
  const authCbs = new Set();
  const writes = [];

  const snapDoc = (path) => ({
    id: path.split('/').pop(),
    exists: () => docs.has(path),
    data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined),
    metadata: { fromCache: false },
  });
  const inColl = (coll, p) => p.startsWith(coll + '/') && p.split('/').length === coll.split('/').length + 1;
  const snapQuery = (ref) => {
    const list = [...docs.keys()].filter((p) => inColl(ref.path, p)).filter((p) => !ref.filter || docs.get(p)[ref.filter.f] === ref.filter.v)
      .map((p) => ({ id: p.split('/').pop(), data: () => structuredClone(docs.get(p)) }));
    return { docs: list, forEach: (cb) => list.forEach(cb) };
  };
  const emitAll = () => { for (const l of listeners) l.fire(); };

  const fs = {
    initializeFirestore: () => ({}), getFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    doc: (_db, ...segs) => ({ path: segs.join('/'), kind: 'doc' }),
    collection: (_db, name) => ({ path: name, kind: 'coll' }),
    where: (f, op, v) => ({ f, op, v }),
    query: (ref, w) => ({ ...ref, filter: w }),
    onSnapshot(ref, a, b, c) {
      const [next] = typeof a === 'function' ? [a, b] : [b, c];
      const l = { fire: () => next(ref.kind === 'doc' ? snapDoc(ref.path) : snapQuery(ref)) };
      listeners.add(l);
      queueMicrotask(l.fire);
      return () => listeners.delete(l);
    },
    async getDoc(ref) { return snapDoc(ref.path); },
    async getDocs(ref) { return snapQuery(ref); },
    async setDoc(ref, data, opts) {
      writes.push({ path: ref.path, data });
      docs.set(ref.path, opts?.merge ? { ...(docs.get(ref.path) || {}), ...structuredClone(data) } : structuredClone(data));
      queueMicrotask(emitAll);
    },
    async addDoc(ref, data) { const id = 'id' + Math.random().toString(36).slice(2); return fs.setDoc({ path: `${ref.path}/${id}` }, data); },
    async deleteDoc(ref) { docs.delete(ref.path); queueMicrotask(emitAll); },
    writeBatch() {
      const ops = [];
      return {
        set(ref, data) { ops.push([ref, structuredClone(data)]); return this; },
        async commit() {
          writes.push({ batch: ops.map(([r]) => r.path) });
          for (const [ref, data] of ops) docs.set(ref.path, data);
          queueMicrotask(emitAll);
        },
      };
    },
  };
  const au = {
    getAuth: () => ({}), setPersistence: async () => {}, browserLocalPersistence: {}, getRedirectResult: async () => null,
    onAuthStateChanged: (_a, cb) => { authCbs.add(cb); queueMicrotask(() => cb(user)); return () => authCbs.delete(cb); },
    GoogleAuthProvider: class { setCustomParameters() {} },
    signInWithPopup: async () => {}, signInWithRedirect: async () => {},
    signOut: async () => { user = null; authCbs.forEach((cb) => cb(null)); },
  };
  return {
    sdk: [{ initializeApp: () => ({}) }, fs, au],
    docs, writes,
    login(u) { user = u; authCbs.forEach((cb) => cb(u)); },
  };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
