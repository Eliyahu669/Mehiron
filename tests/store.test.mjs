// בדיקת שכבת הנתונים מול Firebase מדומה: מי מנהל, מה עובד רואה, דחיסה ופרסום
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/lib/store.js';
import { fakeFirebase, tick } from './fake-firebase.mjs';
import { parseMessage, mergeItems } from '../src/lib/parser.js';

const CFG = { apiKey: 'x' };

async function session(fb) {
  const store = await createStore({ firebaseConfig: CFG, sdk: fb.sdk });
  const st = { auth: null, data: null };
  store.onAuth((a) => { st.auth = a; });
  store.onData((d) => { st.data = d; });
  return { store, st };
}

test('המשתמש הראשון הופך למנהל ורואה הכול; השני לא מורשה עד שמוסיפים אותו', async () => {
  const fb = fakeFirebase();
  const a = await session(fb);
  fb.login({ uid: 'u1', email: 'Owner@Gmail.com', displayName: 'אליהו' });
  await tick(20);
  assert.equal(a.st.auth.role, 'admin');
  assert.equal(fb.docs.get('app/admin').email, 'owner@gmail.com');
  assert.equal(a.st.data.full, true);
  assert.equal(a.st.data.ready, true);

  // מנהל שומר מחירון – נשמר דחוס ונקרא בחזרה
  const items = mergeItems([], parseMessage('Galaxy A54 מקורי ₪200\nGalaxy A54 תחליפי ₪120', { kind: 'parts', partType: 'screen' }));
  await a.store.savePriceList('parts1', items, { supplierName: 'ספק' });
  await tick(20);
  assert.equal(typeof fb.docs.get('pricelists/parts1').z, 'string');
  assert.equal(fb.docs.get('pricelists/parts1').items, undefined, 'בלי רשימה גלויה במסמך');
  assert.equal(a.st.data.lists.parts1.items.length, 2);

  // פרסום לעובדים: דחוס, בלי מחירי ספק
  assert.equal(await a.store.publish(a.st.data.lists, a.st.data.config), true);
  assert.equal(await a.store.publish(a.st.data.lists, a.st.data.config), false, 'בלי שינוי – לא כותבים שוב');
  const cat = fb.docs.get('public/catalog');
  assert.equal(typeof cat.z, 'string');
  assert.ok(!JSON.stringify(cat).includes('"price"'));

  // עובד שלא הוסף
  const fb2 = fb; // אותו "שרת"
  const b = await session(fb2);
  fb2.login({ uid: 'u2', email: 'branch@gmail.com' });
  await tick(20);
  assert.equal(b.st.auth.role, 'none');
});

test('עובד: רואה רק קטלוג סופי; המתג "פירוט פנימי" עובר למצב מלא מיד', async () => {
  const fb = fakeFirebase();
  const admin = await session(fb);
  fb.login({ uid: 'u1', email: 'owner@gmail.com' });
  await tick(20);
  const items = mergeItems([], parseMessage('Galaxy A54 מקורי ₪200', { kind: 'parts', partType: 'screen' }));
  await admin.store.savePriceList('parts1', items, {});
  await tick(10);
  await admin.store.publish(admin.st.data.lists, admin.st.data.config);
  await admin.store.addAllowed('Branch@Gmail.com', 'סניף');
  assert.ok(fb.docs.has('allowed/branch@gmail.com'));

  const emp = await session(fb);
  fb.login({ uid: 'u2', email: 'branch@gmail.com' });
  await tick(20);
  assert.equal(emp.st.auth.role, 'viewer');
  assert.equal(emp.st.auth.showCost, false);
  assert.equal(emp.st.data.full, false);
  assert.equal(emp.st.data.pub.models.length, 1);
  assert.equal(emp.st.data.lists, undefined, 'לעובד אין מחירי ספק');

  // בקשת פירוט ואישור
  await emp.store.createRequest({ what: 'Galaxy A54 – מסך' });
  let open = [];
  const unsub = admin.store.onRequests((r) => { open = r; });
  await tick(20);
  assert.equal(open.length, 1);
  assert.equal(open[0].email, 'branch@gmail.com');
  await admin.store.resolveRequest(open[0].id, true, open[0].email);
  await tick(20);
  assert.equal(open.length, 0);
  assert.equal(emp.st.auth.showCost, true);
  assert.equal(emp.st.data.full, true, 'אחרי אישור – מצב מלא');
  assert.equal(emp.st.data.lists.parts1.items.length, 1);

  await admin.store.setShowCost('branch@gmail.com', false);
  await tick(20);
  assert.equal(emp.st.data.full, false, 'כיבוי המתג מחזיר למחיר סופי בלבד');

  await admin.store.removeAllowed('branch@gmail.com');
  await tick(20);
  assert.equal(emp.st.auth.role, 'none', 'הסרת עובד חוסמת אותו מיד');
  unsub();
});

test('מסמכים בפורמט הישן (לפני דחיסה) עדיין נקראים', async () => {
  const fb = fakeFirebase();
  fb.docs.set('app/admin', { uid: 'u1', email: 'owner@gmail.com' });
  fb.docs.set('pricelists/old', { items: [{ kind: 'part', model: 'X', mkey: 'x', key: 'k', price: 1 }], updatedAt: 1 });
  const s = await session(fb);
  fb.login({ uid: 'u1', email: 'owner@gmail.com' });
  await tick(20);
  assert.equal(s.st.data.lists.old.items.length, 1);
});

test('ייבוא מאקסל נשמר באצווה אחת (מחירונים + הגדרות), גם במצב מקומי', async () => {
  const fb = fakeFirebase();
  const a = await session(fb);
  fb.login({ uid: 'u1', email: 'owner@gmail.com' });
  await tick(20);
  const items = mergeItems([], parseMessage('Galaxy A54 מקורי ₪200', { kind: 'parts', partType: 'screen' }));
  const cfg = { ...a.st.data.config, priceOverrides: { 'samsung|galaxy a54|screen|מקורי': 349 }, suppliers: [...a.st.data.config.suppliers, { id: 'sNew', name: 'חדש', type: 'parts', phone: '' }] };
  await a.store.saveImport({ lists: { parts1: { items, supplierName: 'ספק', updatedAt: 5 }, sNew: { items, supplierName: 'חדש', updatedAt: 6 } }, config: cfg });
  await tick(20);
  assert.deepEqual(fb.writes.find((w) => w.batch).batch.sort(), ['app/config', 'pricelists/parts1', 'pricelists/sNew']);
  assert.equal(typeof fb.docs.get('pricelists/sNew').z, 'string');
  assert.equal(a.st.data.lists.parts1.updatedAt, 5);
  assert.equal(a.st.data.lists.sNew.items.length, 1);
  assert.equal(a.st.data.config.priceOverrides['samsung|galaxy a54|screen|מקורי'], 349);
  assert.ok(a.st.data.config.suppliers.some((s) => s.id === 'sNew'));

  const local = await createStore({ seed: { lists: {} } });
  let data = null;
  local.onData((d) => { data = d; });
  await local.saveImport({ lists: { parts1: { items, supplierName: 'ספק', updatedAt: 7 } }, config: cfg });
  assert.equal(data.lists.parts1.items.length, 1);
  assert.equal(data.lists.parts1.updatedAt, 7);
  assert.equal(data.config.priceOverrides['samsung|galaxy a54|screen|מקורי'], 349);
});
