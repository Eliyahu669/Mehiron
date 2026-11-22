// ייצוא וייבוא אקסל: הלוך-חזור, עדכון/הוספה/מחיקה, מחיר ידני ללקוח, מיזוג מול שינויים שקרו אחרי הייצוא
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildWorkbook, readWorkbook, planImport, parseNum, parseStorage, exportRows, hardenExcelJS, repairSheetName } from '../src/lib/excel.js';
import { parseMessage, mergeItems } from '../src/lib/parser.js';
import { mergeConfig } from '../src/lib/store.js';
import { repairGroupKey } from '../src/lib/pricing.js';
import { optionKey } from '../src/lib/repairs.js';
import { CATALOG_ID } from '../src/lib/devices.js';

const T0 = 1795000000000; // זמן הייצוא
const NOW = T0 + 86400000; // זמן הייבוא
const OLD = T0 - 10 * 86400000; // מתי המחירונים עודכנו

const cfg0 = () => mergeConfig({
  suppliers: [
    { id: 'pa', name: 'חלקים א', type: 'parts', phone: '' },
    { id: 'pb', name: 'חלקים ב', type: 'parts', phone: '' },
    { id: 'dv', name: 'מכשירים', type: 'devices', phone: '' },
    { id: 'dw', name: 'מכשירים ב', type: 'devices', phone: '' },
  ],
});
const parts = (t) => mergeItems([], parseMessage(t, { kind: 'parts', partType: 'screen' }), { now: OLD });
const ROWS = [
  { id: 'd1', brand: 'Apple', segment: 'flagship', series: 'iPhone 15', model: 'iPhone 15', storage: 128, version: '', year: 2023, notes: '' },
  { id: 'd2', brand: 'Apple', segment: 'premium', series: 'iPhone 15', model: 'iPhone 15 Pro', storage: 256, version: '', year: 2023, notes: '' },
  { id: 'd3', brand: 'Samsung', segment: 'flagship', series: 'Galaxy S', model: 'Galaxy S24', storage: 128, version: '', year: 2024, notes: '' },
  { id: 'd4', brand: 'Samsung', segment: 'mid', series: 'Galaxy A', model: 'Galaxy A54 5G', storage: 128, version: '', year: 2023, notes: '' },
  { id: 'd5', brand: 'Xiaomi', segment: 'mid', series: 'Redmi Note', model: 'Redmi Note 13 Pro', storage: 256, version: '', year: 2024, notes: '' },
  { id: 'd6', brand: 'Nothing', segment: 'flagship', series: 'Phone', model: 'Phone (3)', storage: 256, version: '', year: 2025, notes: 'נוסף ידנית' },
];
const dp = (row, price) => ({ key: row, row, kind: 'device', price, raw: '', updatedAt: OLD, changedAt: OLD, prevPrice: null });
const lists0 = () => ({
  pa: { updatedAt: OLD, items: parts('Galaxy A54 מקורי ₪200\nGalaxy A54 תחליפי ₪120\niPhone 13 סוללה מקורית ₪150\nGalaxy A34 סאני מקורי ₪180') },
  pb: { updatedAt: OLD, items: parts('Galaxy A54 מקורי ₪210') },
  dv: { updatedAt: OLD, items: [dp('d2', 4000), dp('d3', 2500)] },
  dw: { updatedAt: OLD, items: [dp('d3', 2450)] },
  [CATALOG_ID]: { updatedAt: OLD, items: ROWS.map((r) => ({ ...r })) },
});

// ---- עזרים לעריכת הקובץ כמו שמשתמש עושה באקסל ----
async function exported(lists, cfg) {
  const { wb } = buildWorkbook(ExcelJS, lists, cfg, T0);
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(await wb.xlsx.writeBuffer());
  return w;
}
async function reread(wb, cfg = cfg0()) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(await wb.xlsx.writeBuffer());
  return readWorkbook(w, cfg);
}
const sheet = (wb, name) => wb.getWorksheet(name);
const col = (ws, header) => { let n = 0; ws.getRow(1).eachCell((c, i) => { if (c.value === header) n = i; }); assert.ok(n, `אין עמודה ${header}`); return n; };
function findRow(ws, match) {
  let found = null;
  ws.eachRow((row, i) => {
    if (i === 1 || found) return;
    if (Object.entries(match).every(([h, v]) => row.getCell(col(ws, h)).value === v)) found = row;
  });
  assert.ok(found, `לא נמצאה שורה ${JSON.stringify(match)}`);
  return found;
}
const setCell = (ws, match, header, value) => { findRow(ws, match).getCell(col(ws, header)).value = value; };
function addRow(ws, values) {
  const row = ws.addRow([]);
  for (const [h, v] of Object.entries(values)) row.getCell(col(ws, h)).value = v;
}
const plan = async (wb, lists = lists0(), cfg = cfg0()) => planImport(await reread(wb, cfg), lists, cfg, NOW);
const price = (p, sid, row) => p.lists[sid]?.items.find((x) => x.row === row)?.price ?? null;
const catRow = (p, model) => p.lists[CATALOG_ID]?.items.find((x) => x.model === model);
const find = (items, model, variant) => items.find((x) => x.model === model && (variant == null || x.variant === variant));
const RA = repairSheetName('apple'), RS = repairSheetName('samsung');
const A54_ORIG = { 'דגם': 'Galaxy A54', 'איכות': 'מקורי' }, A54_COPY = { 'דגם': 'Galaxy A54', 'איכות': 'תחליפי' };
const PA = 'מחיר ספק חלקים א', PB = 'מחיר ספק חלקים ב';

// קובץ שנשמר בתוכנה אחרת (כמו openpyxl) עם הערה בתא: ההערות נשמרות בנתיב שאקסל לא משתמש בו
async function savedByOtherApp(wb) {
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  const name = Object.keys(zip.files).find((f) => /^xl\/comments\d+\.xml$/.test(f));
  assert.ok(name, 'יש הערה בקובץ');
  zip.file('xl/comments/comment1.xml', await zip.file(name).async('string'));
  zip.remove(name);
  for (const f of Object.keys(zip.files).filter((x) => x.endsWith('.rels') || x === '[Content_Types].xml')) {
    const t = await zip.file(f).async('string');
    zip.file(f, t.replace(`../${name.slice(3)}`, '/xl/comments/comment1.xml').replace(`/${name}`, '/xl/comments/comment1.xml'));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('אקסל: קובץ עם הערות שנשמר בתוכנה אחרת נקרא (תיקון לבאג של ExcelJS)', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const rep = sheet(wb, RA);
  findRow(rep, { 'דגם': 'iPhone 13' }).getCell(col(rep, PA)).note = 'לבדוק עם הספק';
  setCell(rep, { 'דגם': 'iPhone 13' }, PA, 140);
  const buf = await savedByOtherApp(wb);
  await assert.rejects(new ExcelJS.Workbook().xlsx.load(buf), /comments/, 'בלי התיקון ExcelJS נופל');
  hardenExcelJS(ExcelJS);
  hardenExcelJS(ExcelJS); // פעמיים – בלי לעטוף שוב
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(buf);
  const p = planImport(readWorkbook(w, cfg), lists, cfg, NOW);
  assert.equal(p.summary.updated, 1);
  assert.equal(find(p.lists.pa.items, 'iPhone 13').price, 140);
  assert.deepEqual(p.details.updated[0].what, ['מחיר ספק']);
});

test('אקסל: ייצוא – גיליון תיקונים וגיליון מכשירים לכל חברה, וייבוא בלי שינוי לא משנה כלום', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['תיקונים Apple', 'תיקונים Samsung', 'תיקונים Xiaomi', 'תיקונים אחרים', 'Apple', 'Samsung', 'Xiaomi', 'אחרים', '_ייצוא']);
  assert.equal(wb.getWorksheet('_ייצוא').state, 'veryHidden');
  const rs = sheet(wb, RS);
  assert.equal(rs.views[0].rightToLeft, true);
  assert.deepEqual(rs.getRow(1).values.slice(1, 7), ['יצרן', 'דגם', 'שנת השקה', 'סוג תיקון', 'איכות', 'מסגרת']);
  // שורה לכל דגם + תיקון + איכות; עמודת מחיר לכל ספק חלקים
  assert.deepEqual(['תיקונים Apple', 'תיקונים Samsung', 'תיקונים Xiaomi', 'תיקונים אחרים'].map((n) => sheet(wb, n).rowCount - 1), [1, 3, 0, 0]);
  const a54 = findRow(rs, A54_ORIG);
  assert.equal(a54.getCell(col(rs, PA)).value, 200);
  assert.equal(a54.getCell(col(rs, PB)).value, 210);
  assert.equal(a54.getCell(col(rs, 'עבודה')).value, 120);
  assert.equal(a54.getCell(col(rs, 'מחיר ללקוח')).value, 320, 'החלק הזול מכל הספקים + עבודה, כמו באפליקציה');
  assert.equal(a54.getCell(col(rs, 'שנת השקה')).value, 2023, 'שנה מרשימת המכשירים');
  assert.equal(findRow(rs, { 'דגם': 'Galaxy A34' }).getCell(col(rs, 'איכות')).value, 'מקורי סרוויס', '"סאני מקורי" מאוחד לשם אחד');
  const ip = findRow(sheet(wb, RA), { 'דגם': 'iPhone 13' });
  assert.deepEqual([ip.getCell(col(rs, 'סוג תיקון')).value, ip.getCell(col(rs, 'איכות')).value], ['סוללה', 'מקורית']);
  const sam = sheet(wb, 'Samsung');
  assert.deepEqual(sam.getRow(1).values.slice(1, 8), ['יצרן', 'רמות גימור/סגמנטציה', 'סדרה', 'שם הדגם', 'נפחי אחסון זמינים', 'גרסה', 'שנת השקה'], 'כמו בקובץ המכשירים');
  const s24 = findRow(sam, { 'שם הדגם': 'Galaxy S24' });
  assert.equal(s24.getCell(col(sam, 'נפחי אחסון זמינים')).value, '128GB');
  assert.equal(s24.getCell(col(sam, 'רמות גימור/סגמנטציה')).value, 'מכשירי דגל');
  assert.equal(s24.getCell(col(sam, 'מחיר ספק מכשירים')).value, 2500);
  assert.equal(s24.getCell(col(sam, 'מחיר ספק מכשירים ב')).value, 2450);
  assert.equal(s24.getCell(col(sam, 'מחיר ללקוח')).value, 2650); // הזול (2450) + 8% דגל = 2646 → 2650
  assert.equal(findRow(sam, { 'שם הדגם': 'Galaxy A54 5G' }).getCell(col(sam, 'מחיר ללקוח')).value, null, 'אין מחיר מספק');
  assert.equal(findRow(sheet(wb, 'אחרים'), { 'שם הדגם': 'Phone (3)' }).getCell(col(sam, 'הערות')).value, 'נוסף ידנית');
  const p = await plan(wb, lists, cfg);
  assert.equal(p.hasChanges, false, JSON.stringify(p.summary));
  assert.deepEqual(p.summary.invalid, []);
  assert.deepEqual(p.summary.notes, []);
});

test('אקסל: שינוי מחיר ספק מעדכן רק את הפריט הזה', async () => {
  const lists = lists0();
  const wb = await exported(lists, cfg0());
  setCell(sheet(wb, RS), A54_ORIG, PA, 180);
  const p = await plan(wb, lists);
  assert.equal(p.summary.updated, 1);
  assert.equal(p.summary.priceChanged, 1);
  assert.deepEqual(Object.keys(p.lists), ['pa'], 'רק המחירון של הספק הזה נשמר');
  assert.equal(p.config, null);
  const it = find(p.lists.pa.items, 'Galaxy A54', 'מקורי');
  assert.equal(it.price, 180);
  assert.equal(it.prevPrice, 200);
  assert.equal(it.updatedAt, NOW);
  assert.equal(it.key, find(lists.pa.items, 'Galaxy A54', 'מקורי').key);
  assert.equal(p.lists.pa.items.length, 4);
  assert.equal(find(p.lists.pa.items, 'Galaxy A54', 'תחליפי'), find(lists.pa.items, 'Galaxy A54', 'תחליפי'), 'פריט שלא שונה – אותו אובייקט בדיוק');
  assert.equal(p.lists.pa.updatedAt, OLD, 'תאריך המחירון של הספק לא משתנה');
  // מחיר לספק שלא היה לו את החלק – נוסף אצלו; מחיר שנמחק מהתא – נמחק אצל הספק הזה בלבד
  setCell(sheet(wb, RS), A54_COPY, PB, '₪115');
  setCell(sheet(wb, RS), A54_ORIG, PB, null);
  const pp = await plan(wb, lists);
  const b = find(pp.lists.pb.items, 'Galaxy A54', 'תחליפי');
  assert.deepEqual([b.price, b.partType, b.manual], [115, 'screen', true]);
  assert.equal(find(pp.lists.pb.items, 'Galaxy A54', 'מקורי'), undefined);
  assert.equal(pp.summary.updated, 2);
  // מכשיר: מחיר כטקסט ("₪1,200") נקרא כמספר, ומתעדכן רק אצל הספק הזה – הרשימה עצמה לא משתנה
  setCell(sheet(wb, 'Samsung'), { 'שם הדגם': 'Galaxy S24' }, 'מחיר ספק מכשירים', '₪2,400');
  const p2 = await plan(wb, lists);
  assert.deepEqual(Object.keys(p2.lists).sort(), ['dv', 'pa', 'pb']);
  assert.equal(price(p2, 'dv', 'd3'), 2400);
  assert.equal(p2.lists.dv.items.find((x) => x.row === 'd3').prevPrice, 2500);
  assert.equal(price(p2, 'dv', 'd2'), 4000);
  // מחיר שנמחק מהתא – אין יותר מחיר מהספק הזה; מחיר חדש לשורה שלא היה לה
  setCell(sheet(wb, 'Samsung'), { 'שם הדגם': 'Galaxy S24' }, 'מחיר ספק מכשירים ב', null);
  setCell(sheet(wb, 'Samsung'), { 'שם הדגם': 'Galaxy A54 5G' }, 'מחיר ספק מכשירים ב', 1000);
  const p3 = await plan(wb, lists);
  assert.equal(price(p3, 'dw', 'd3'), null);
  assert.equal(price(p3, 'dw', 'd4'), 1000);
  assert.equal(p3.summary.priceChanged, 1 + 1 + 1 + 2);
});

test('אקסל: שורה שנמחקה נמחקת, שורה חדשה נוספת – גם לדגם חדש עם כמה איכויות', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const rs = sheet(wb, RS);
  rs.spliceRows(findRow(rs, A54_COPY).number, 1);
  addRow(rs, { 'יצרן': 'Samsung', 'דגם': 'Galaxy A55', 'סוג תיקון': 'מסך', 'איכות': 'מקורי', [PA]: 230 });
  const ra = sheet(wb, RA);
  addRow(ra, { 'יצרן': 'Apple', 'דגם': 'iPhone 17 Pro', 'סוג תיקון': 'מסך', 'איכות': 'אינסל', [PB]: 150 });
  addRow(ra, { 'יצרן': 'Apple', 'דגם': 'iPhone 17 Pro', 'סוג תיקון': 'מסך', 'איכות': 'Service Pack', 'מסגרת': 'כולל מסגרת', [PB]: 1170 });
  // פריט שנוסף לאפליקציה אחרי הייצוא – לא בקובץ, ולא נמחק
  const later = { ...lists, pb: { ...lists.pb, items: [...lists.pb.items, ...parts('Galaxy A25 מקורי ₪160')] } };
  const p = await plan(wb, later, cfg);
  assert.equal(p.summary.deleted, 1);
  assert.equal(p.summary.added, 3);
  assert.equal(find(p.lists.pa.items, 'Galaxy A54', 'תחליפי'), undefined);
  const a55 = find(p.lists.pa.items, 'Galaxy A55');
  assert.deepEqual([a55.price, a55.partType, a55.manual, a55.mkey], [230, 'screen', true, 'samsung|galaxy a55']);
  const ip = p.lists.pb.items.filter((x) => x.model === 'iPhone 17 Pro').map((x) => [x.variant, x.price]);
  assert.deepEqual(ip, [['אינסל', 150], ['מקורי סרוויס כולל מסגרת', 1170]]);
  assert.ok(find(p.lists.pb.items, 'Galaxy A25'), 'הפריט שנוסף אחרי הייצוא נשאר');
});

test('אקסל: מחיר ללקוח – שינוי הופך למחיר ידני לשורה (לכל הספקים), מחיקה מחזירה לאוטומטי', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  setCell(sheet(wb, RS), A54_ORIG, 'מחיר ללקוח', 349);
  setCell(sheet(wb, 'Apple'), { 'שם הדגם': 'iPhone 15 Pro' }, 'מחיר ללקוח', 4390);
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.overridesSet, 2);
  assert.equal(p.summary.updated, 0, 'הפריטים עצמם לא השתנו');
  assert.deepEqual(Object.keys(p.lists), []);
  const rk = optionKey('samsung|galaxy a54', 'screen', 'original|');
  assert.equal(p.config.priceOverrides[rk], 349);
  assert.equal(p.config.priceOverrides['row:d2'], 4390);

  // אחרי השמירה: הייצוא מציג את המחיר הידני, ומחיקת המספר מחזירה לאוטומטי – גם מחיר ידני בפורמט הקודם
  const legacy = repairGroupKey('samsung|galaxy a34', 'screen', 'סאני מקורי');
  const cfg2 = { ...p.config, priceOverrides: { ...p.config.priceOverrides, [legacy]: 333 } };
  const rows = exportRows(lists, cfg2);
  assert.equal(rows.repairs.samsung.find((r) => r.model === 'Galaxy A54' && r.quality === 'מקורי').customer, 349);
  assert.equal(rows.repairs.samsung.find((r) => r.model === 'Galaxy A34').customer, 333);
  const wb2 = await exported(lists, cfg2);
  setCell(sheet(wb2, RS), { 'דגם': 'Galaxy A34' }, 'מחיר ללקוח', null);
  setCell(sheet(wb2, 'Apple'), { 'שם הדגם': 'iPhone 15 Pro' }, 'מחיר ללקוח', null);
  const p2 = await plan(wb2, lists, cfg2);
  assert.equal(p2.summary.overridesCleared, 2);
  assert.deepEqual(p2.config.priceOverrides, { [rk]: 349 });
  // מחיר ידני בפורמט הקודם שמשנים – עובר למפתח החדש
  const wb3 = await exported(lists, cfg2);
  setCell(sheet(wb3, RS), { 'דגם': 'Galaxy A34' }, 'מחיר ללקוח', 350);
  const p3 = await plan(wb3, lists, cfg2);
  assert.equal(p3.config.priceOverrides[optionKey('samsung|galaxy a34', 'screen', 'service|')], 350);
  assert.equal(p3.config.priceOverrides[legacy], undefined);
});

test('אקסל: מיזוג – מחיר שהתעדכן מוואטסאפ אחרי הייצוא לא נדרס, ורק מה ששונה בקובץ נכנס', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  setCell(sheet(wb, RS), A54_COPY, PA, 110);
  // אחרי הייצוא: הספק שלח מחירון חדש (Galaxy A54 מקורי ירד ל-190)
  const now2 = T0 + 3600000;
  const newer = { ...lists, pa: { updatedAt: now2, items: mergeItems(lists.pa.items, parseMessage('Galaxy A54 מקורי ₪190', { kind: 'parts', partType: 'screen' }), { replace: false, now: now2 }) } };
  const p = await plan(wb, newer, cfg);
  assert.equal(p.summary.updated, 1);
  assert.equal(find(p.lists.pa.items, 'Galaxy A54', 'מקורי').price, 190, 'המחיר החדש מהספק נשמר');
  assert.equal(find(p.lists.pa.items, 'Galaxy A54', 'תחליפי').price, 110);
  assert.equal(p.summary.overridesSet, 0, 'מחיר ללקוח שלא נגעו בו לא הופך לידני');
});

test('אקסל: שורה מועתקת עם שינוי נוספת כשורה חדשה ברשימה, והמקורית נשארת', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const ap = sheet(wb, 'Apple');
  const src = findRow(ap, { 'שם הדגם': 'iPhone 15 Pro' });
  ap.addRow(src.values);
  const copy = ap.getRow(ap.rowCount);
  copy.getCell(col(ap, 'נפחי אחסון זמינים')).value = '512GB';
  copy.getCell(col(ap, 'מחיר ספק מכשירים')).value = 4700;
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.added, 1);
  assert.equal(p.summary.updated, 0);
  const cat = p.lists[CATALOG_ID].items;
  assert.equal(cat.length, ROWS.length + 1);
  const added = cat.find((x) => x.model === 'iPhone 15 Pro' && x.storage === 512);
  assert.equal(added.segment, 'premium');
  assert.equal(price(p, 'dv', 'd2'), 4000);
  assert.equal(price(p, 'dv', added.id), 4700);
  // שורה כפולה בלי שום שינוי – מדולגת
  const wb2 = await exported(lists, cfg);
  sheet(wb2, 'Samsung').addRow(findRow(sheet(wb2, 'Samsung'), { 'שם הדגם': 'Galaxy S24' }).values);
  const p2 = await plan(wb2, lists, cfg);
  assert.equal(p2.hasChanges, false);
  assert.equal(p2.summary.notes.length, 1);
});

test('אקסל: עריכת מכשיר – נפח, גרסה, רמת גימור והעברה לחברה אחרת; המחירים נשארים לשורה', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const sam = sheet(wb, 'Samsung');
  setCell(sam, { 'שם הדגם': 'Galaxy S24' }, 'נפחי אחסון זמינים', '256GB');
  setCell(sam, { 'שם הדגם': 'Galaxy S24' }, 'גרסה', 'DCS');
  setCell(sam, { 'שם הדגם': 'Galaxy A54 5G' }, 'רמות גימור/סגמנטציה', 'מכשירי כניסה');
  setCell(sheet(wb, 'אחרים'), { 'שם הדגם': 'Phone (3)' }, 'יצרן', 'Xiaomi');
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.updated, 3);
  assert.equal(p.summary.priceChanged, 0);
  assert.deepEqual(Object.keys(p.lists), [CATALOG_ID], 'רק הרשימה משתנה');
  const s24 = catRow(p, 'Galaxy S24');
  assert.deepEqual([s24.id, s24.storage, s24.version], ['d3', 256, 'DCS']);
  assert.equal(catRow(p, 'Galaxy A54 5G').segment, 'entry');
  assert.equal(catRow(p, 'Phone (3)').brand, 'Xiaomi');
  // שינוי שיוצר שורה כפולה – לא מתקבל
  const wb2 = await exported(lists, cfg);
  setCell(sheet(wb2, 'Apple'), { 'שם הדגם': 'iPhone 15' }, 'שם הדגם', 'iPhone 15 Pro');
  setCell(sheet(wb2, 'Apple'), { 'שם הדגם': 'iPhone 15 Pro', 'נפחי אחסון זמינים': '128GB' }, 'נפחי אחסון זמינים', '256GB');
  const p2 = await plan(wb2, lists, cfg);
  assert.match(p2.summary.invalid.map((x) => x.reason).join(), /כבר קיימת שורה כזו/);
});

test('אקסל: שורה חדשה בגיליון החברה נוספת לרשימה; בקובץ בלי מזהים שורה קיימת מתעדכנת ולא מוכפלת', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  addRow(sheet(wb, 'Xiaomi'), { 'יצרן': 'Xiaomi', 'רמות גימור/סגמנטציה': 'מכשירי פרימיום', 'סדרה': 'Xiaomi', 'שם הדגם': 'Xiaomi 15 Ultra', 'נפחי אחסון זמינים': '512GB', 'שנת השקה': 2025, 'מחיר ספק מכשירים ב': 4200 });
  addRow(sheet(wb, 'אחרים'), { 'יצרן': 'Google', 'רמות גימור/סגמנטציה': 'מכשירי דגל', 'שם הדגם': 'Pixel 9', 'נפחי אחסון זמינים': '128GB' });
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.added, 2);
  const x15 = catRow(p, 'Xiaomi 15 Ultra');
  assert.deepEqual([x15.segment, x15.storage, x15.year], ['premium', 512, 2025]);
  assert.equal(price(p, 'dw', x15.id), 4200);
  assert.equal(catRow(p, 'Pixel 9').brand, 'Google');

  // קובץ בפורמט של רשימת המכשירים (בלי מזהים ובלי גיליון הייצוא)
  const own = new ExcelJS.Workbook();
  const ws = own.addWorksheet('Samsung');
  ws.addRow(['יצרן', 'רמות גימור/סגמנטציה', 'סדרה', 'שם הדגם', 'נפחי אחסון זמינים', 'שנת השקה', 'מחיר ספק מכשירים', 'מחיר ספק R.P.Mobile', 'הערות']);
  ws.addRow(['Samsung', 'מכשירי דגל', 'Galaxy S', 'Galaxy S24', '128GB', 2024, 2550, 2400, '']);
  ws.addRow(['Samsung', 'מכשירי ביניים', 'Galaxy A', 'Galaxy A54 5G', '128GB', 2023, null, null, '']);
  const p2 = planImport(await reread(own, cfg), lists, cfg, NOW);
  assert.equal(p2.summary.added, 0);
  assert.equal(p2.summary.deleted, 0);
  assert.equal(price(p2, 'dv', 'd3'), 2550);
  assert.match(p2.summary.notes.join(' '), /R\.P\.Mobile.*לא שייכת/);
  assert.match(p2.summary.notes.join(' '), /"Apple" לא נמצא/);
});

test('אקסל: העברה לספק אחר (מחיר בעמודה של ספק אחר), ושם ספק ששונה אחרי הייצוא לא מוחק את המחירים שלו', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  setCell(sheet(wb, RA), { 'דגם': 'iPhone 13' }, PA, null);
  setCell(sheet(wb, RA), { 'דגם': 'iPhone 13' }, PB, 150);
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.updated, 1);
  assert.equal(find(p.lists.pa.items, 'iPhone 13'), undefined);
  assert.equal(find(p.lists.pb.items, 'iPhone 13').price, 150);
  assert.equal(find(p.lists.pb.items, 'iPhone 13').partType, 'battery');

  const wb2 = await exported(lists, cfg);
  const renamed = { ...cfg, suppliers: cfg.suppliers.map((s) => (s.id === 'pa' ? { ...s, name: 'חלקים א בע"מ' } : s)) };
  const p2 = await plan(wb2, lists, renamed);
  assert.equal(p2.hasChanges, false, JSON.stringify(p2.summary));
  assert.match(p2.summary.notes.join(' '), /"מחיר ספק חלקים א".*לא שייכת/);
});

test('אקסל: שורות לא תקינות לא מיובאות והפריט שלהן נשאר', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const rs = sheet(wb, RS);
  setCell(rs, A54_COPY, PA, 'abc');
  setCell(sheet(wb, RA), { 'דגם': 'iPhone 13' }, 'סוג תיקון', 'מסגרת');
  addRow(rs, { 'יצרן': 'Samsung', 'סוג תיקון': 'מסך', [PA]: 90 });
  addRow(rs, { 'דגם': '17 pro', 'סוג תיקון': 'מסך', [PA]: 90 });
  addRow(rs, { 'יצרן': 'Samsung', 'דגם': 'Galaxy A15', 'סוג תיקון': 'מסך', 'מסגרת': 'חצי', [PA]: 90 });
  const ap = sheet(wb, 'Apple');
  addRow(ap, { 'יצרן': 'Google', 'רמות גימור/סגמנטציה': 'מכשירי דגל', 'שם הדגם': 'Pixel 9', 'נפחי אחסון זמינים': 'הרבה' });
  addRow(ap, { 'יצרן': 'Apple', 'רמות גימור/סגמנטציה': 'יוקרה', 'שם הדגם': 'iPhone 18' });
  setCell(ap, { 'שם הדגם': 'iPhone 15' }, 'מחיר ספק מכשירים', 'אלף');
  const p = await plan(wb, lists, cfg);
  const reasons = p.summary.invalid.map((x) => x.reason).join('|');
  assert.equal(p.summary.invalid.length, 8, reasons);
  assert.match(reasons, /מחיר ספק חלקים א לא תקין: "abc"/);
  assert.match(reasons, /סוג תיקון לא מוכר: "מסגרת"/);
  assert.match(reasons, /חסר דגם/);
  assert.match(reasons, /דגם לא מזוהה: "17 pro"/);
  assert.match(reasons, /מסגרת לא מוכרת: "חצי"/);
  assert.match(reasons, /נפח לא תקין/);
  assert.match(reasons, /רמת גימור לא מוכרת: "יוקרה"/);
  assert.match(reasons, /מחיר ספק מכשירים לא תקין/);
  assert.equal(p.summary.deleted, 0);
  assert.equal(p.summary.added, 0);
  assert.equal(p.hasChanges, false);
  // שורת תיקון שהועברה לגיליון מכשירים (ולהפך) – לא מיובאת ולא נמחקת
  const wb2 = await exported(lists, cfg);
  const src = findRow(sheet(wb2, RA), { 'דגם': 'iPhone 13' });
  const iid = src.getCell(col(sheet(wb2, RA), 'מזהה')).value;
  sheet(wb2, RA).spliceRows(src.number, 1);
  addRow(sheet(wb2, 'Apple'), { 'יצרן': 'Apple', 'רמות גימור/סגמנטציה': 'מכשירי דגל', 'שם הדגם': 'iPhone 13', 'מזהה': iid });
  const dsrc = findRow(sheet(wb2, 'Apple'), { 'שם הדגם': 'iPhone 15' });
  addRow(sheet(wb2, RA), { 'יצרן': 'Apple', 'דגם': 'iPhone 15', 'סוג תיקון': 'מסך', 'מזהה': dsrc.getCell(col(sheet(wb2, 'Apple'), 'מזהה')).value });
  const p2 = await plan(wb2, lists, cfg);
  assert.equal(p2.summary.invalid.length, 2);
  assert.match(p2.summary.invalid.map((x) => x.reason).join(), /שורה של תיקון.*שורה של מכשיר|שורה של מכשיר.*שורה של תיקון/);
  assert.equal(p2.summary.deleted, 0);
  assert.equal(p2.hasChanges, false);
});

test('אקסל: גיליון חסר לא מוחק כלום, מחיקת שורה מוחקת אותה, וקובץ שלא יוצא מהאפליקציה מוחק את מה שלא בו (עם אזהרה)', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  wb.removeWorksheet(sheet(wb, 'Samsung').id);
  wb.removeWorksheet(sheet(wb, RS).id);
  const p = await plan(wb, lists, cfg);
  assert.equal(p.hasChanges, false);
  assert.match(p.summary.notes.join(' '), /"Samsung" לא נמצא/);
  assert.match(p.summary.notes.join(' '), /"תיקונים Samsung" לא נמצא/);
  // מחיקת שורת מכשיר: נמחקת מהרשימה ומהמחירונים של הספקים
  const sam = sheet(wb, 'Apple');
  sam.spliceRows(findRow(sam, { 'שם הדגם': 'iPhone 15 Pro' }).number, 1);
  const pd = await plan(wb, lists, cfg);
  assert.equal(pd.summary.deleted, 1);
  assert.equal(catRow(pd, 'iPhone 15 Pro'), undefined);
  assert.equal(pd.lists[CATALOG_ID].items.length, ROWS.length - 1);
  assert.equal(price(pd, 'dv', 'd2'), null);
  assert.equal(price(pd, 'dv', 'd3'), 2500);
  // מחיקת שורת תיקון: נמחקת אצל כל הספקים
  const wb1 = await exported(lists, cfg);
  sheet(wb1, RS).spliceRows(findRow(sheet(wb1, RS), A54_ORIG).number, 1);
  const pr = await plan(wb1, lists, cfg);
  assert.equal(pr.summary.deleted, 1);
  assert.equal(find(pr.lists.pa.items, 'Galaxy A54', 'מקורי'), undefined);
  assert.equal(find(pr.lists.pb.items, 'Galaxy A54', 'מקורי'), undefined);

  const wb2 = await exported(lists, cfg);
  wb2.removeWorksheet(wb2.getWorksheet('_ייצוא').id);
  sheet(wb2, RA).spliceRows(findRow(sheet(wb2, RA), { 'דגם': 'iPhone 13' }).number, 1);
  const p2 = await plan(wb2, lists, cfg);
  assert.equal(p2.summary.deleted, 1);
  assert.match(p2.summary.notes.join(' '), /לא נוצר בייצוא/);

  // גיליון בלי עמודת מזהה (בקובץ מהאפליקציה) – לא נוגעים בו בכלל
  const wb3 = await exported(lists, cfg);
  sheet(wb3, RS).getRow(1).getCell(col(sheet(wb3, RS), 'מזהה')).value = 'קוד';
  const p3 = await plan(wb3, lists, cfg);
  assert.equal(p3.hasChanges, false);
  assert.equal(p3.summary.invalid.length, 1);

  // גיליון התיקונים בפורמט הקודם – לא מיובא, עם הסבר
  const old = new ExcelJS.Workbook();
  old.addWorksheet('מחירון תיקונים').addRow(['ספק', 'דגם', 'סוג חלק', 'איכות', 'מחיר ספק']);
  const p4 = planImport(await reread(old, cfg), lists, cfg, NOW);
  assert.equal(p4.hasChanges, false);
  assert.match(p4.summary.notes.join(' '), /בפורמט הקודם/);
});

const applyPlan = (lists, p) => ({ ...lists, ...Object.fromEntries(Object.entries(p.lists).map(([id, l]) => [id, { updatedAt: l.updatedAt, items: l.items }])) });

test('אקסל: ייבוא חוזר של אותו קובץ לא משנה שוב ולא מכפיל; שורה שנמחקה ונכתבה מחדש זהה – הפריט נשאר', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const rs = sheet(wb, RS);
  setCell(rs, A54_ORIG, PA, 180);
  setCell(rs, A54_ORIG, 'מחיר ללקוח', 349);
  rs.spliceRows(findRow(rs, { 'דגם': 'Galaxy A34' }).number, 1);
  addRow(rs, { 'יצרן': 'Samsung', 'דגם': 'Galaxy A55', 'סוג תיקון': 'מסך', [PA]: 230 });
  setCell(sheet(wb, 'Samsung'), { 'שם הדגם': 'Galaxy S24' }, 'נפחי אחסון זמינים', '256GB');
  addRow(sheet(wb, 'אחרים'), { 'יצרן': 'Google', 'רמות גימור/סגמנטציה': 'מכשירי דגל', 'שם הדגם': 'Pixel 9', 'נפחי אחסון זמינים': '128GB', 'מחיר ספק מכשירים': 2900 });
  const book = await reread(wb);
  const p1 = planImport(book, lists, cfg, NOW);
  assert.equal(p1.summary.updated, 2);
  assert.equal(p1.summary.added, 2);
  assert.equal(p1.summary.deleted, 1);
  assert.equal(p1.summary.overridesSet, 1);
  const p2 = planImport(book, applyPlan(lists, p1), p1.config, NOW + 1000);
  assert.equal(p2.hasChanges, false, JSON.stringify(p2.summary));
  assert.match(p2.summary.notes.join(' '), /כבר קיימות/);

  const wb3 = await exported(lists, cfg);
  const r3 = sheet(wb3, RA);
  r3.spliceRows(findRow(r3, { 'דגם': 'iPhone 13' }).number, 1);
  addRow(r3, { 'יצרן': 'Apple', 'דגם': 'iPhone 13', 'סוג תיקון': 'סוללה', 'איכות': 'מקורית', [PA]: 150 });
  const p3 = await plan(wb3, lists, cfg);
  assert.equal(p3.hasChanges, false, JSON.stringify(p3.summary));
});

test('אקסל: עמודת "אחוז רווח" – ייצוא, קביעה, מחיקה, ותא בפורמט אחוזים', async () => {
  const lists = lists0();
  const cfg = { ...cfg0(), marginOverrides: { 'row:d2': 5 } };
  const wb = await exported(lists, cfg);
  const ap = sheet(wb, 'Apple'), sam = sheet(wb, 'Samsung');
  assert.equal(findRow(ap, { 'שם הדגם': 'iPhone 15 Pro' }).getCell(col(ap, 'אחוז רווח')).value, 5);
  assert.equal(findRow(ap, { 'שם הדגם': 'iPhone 15 Pro' }).getCell(col(ap, 'מחיר ללקוח')).value, 4200); // 4000 + 5%
  assert.equal(findRow(sam, { 'שם הדגם': 'Galaxy S24' }).getCell(col(sam, 'אחוז רווח')).value, null);
  assert.equal(!sheet(wb, RS).getRow(1).values.includes('אחוז רווח'), true, 'רק בגיליונות המכשירים');
  const p0 = await plan(wb, lists, cfg);
  assert.equal(p0.hasChanges, false);

  setCell(ap, { 'שם הדגם': 'iPhone 15 Pro' }, 'אחוז רווח', null);
  const cell = findRow(sam, { 'שם הדגם': 'Galaxy S24' }).getCell(col(sam, 'אחוז רווח'));
  cell.value = 0.12; cell.numFmt = '0%'; // הקלדה של "12%" באקסל
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.marginsSet, 1);
  assert.equal(p.summary.marginsCleared, 1);
  assert.deepEqual(p.config.marginOverrides, { 'row:d3': 12 });
  assert.equal(p.summary.updated, 0);

  setCell(sam, { 'שם הדגם': 'Galaxy S24' }, 'אחוז רווח', 'הרבה');
  const p2 = await plan(wb, lists, cfg);
  assert.match(p2.summary.invalid.map((x) => x.reason).join(), /אחוז רווח לא תקין/);
});

test('אקסל: קריאת מספרים ונפחים', () => {
  assert.equal(parseNum('₪1,200'), 1200);
  assert.equal(parseNum('1200 ש"ח'), 1200);
  assert.equal(parseNum(' 350 '), 350);
  assert.equal(parseNum(''), null);
  assert.ok(Number.isNaN(parseNum('abc')));
  assert.equal(parseStorage('256GB'), 256);
  assert.equal(parseStorage('1TB'), 1024);
  assert.equal(parseStorage('1 tb'), 1024);
  assert.equal(parseStorage(512), 512);
  assert.equal(parseStorage(''), null);
  assert.ok(Number.isNaN(parseStorage('הרבה')));
});
