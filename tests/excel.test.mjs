// קובץ אקסל לכל ספק: "חלקי חילוף" (דגם בשורה, חלק בעמודה) לספק חלקים, ומחירון מכשירים לספק מכשירים.
// הלוך-חזור, עדכון/הוספה/מחיקה, שם ודגם יצרן, קובץ של ספק אחר, מיזוג מול שינויים שקרו אחרי הייצוא
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildWorkbook, readWorkbook, planImport, parseNum, parseStorage, hardenExcelJS, exportFileName } from '../src/lib/excel.js';
import { parseMessage, mergeItems } from '../src/lib/parser.js';
import { mergeConfig } from '../src/lib/store.js';
import { CATALOG_ID } from '../src/lib/devices.js';
import { RMODELS_ID } from '../src/lib/rmodels.js';

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
const parts = (t, partType = 'screen') => mergeItems([], parseMessage(t, { kind: 'parts', partType }), { now: OLD });
const ROWS = [
  { id: 'd1', brand: 'Apple', segment: 'flagship', series: 'iPhone 15', model: 'iPhone 15', storage: 128, version: '', year: 2023, notes: '' },
  { id: 'd2', brand: 'Apple', segment: 'premium', series: 'iPhone 15', model: 'iPhone 15 Pro', storage: 256, version: '', year: 2023, notes: '' },
  { id: 'd3', brand: 'Samsung', segment: 'flagship', series: 'Galaxy S', model: 'Galaxy S24', storage: 128, version: '', year: 2024, notes: '' },
  { id: 'd4', brand: 'Samsung', segment: 'mid', series: 'Galaxy A', model: 'Galaxy A54 5G', storage: 128, version: '', year: 2023, notes: '' },
  { id: 'd5', brand: 'Xiaomi', segment: 'mid', series: 'Redmi Note', model: 'Redmi Note 13 Pro', storage: 256, version: '', year: 2024, notes: '' },
  { id: 'd6', brand: 'Nothing', segment: 'flagship', series: 'Phone', model: 'Phone (3)', storage: 256, version: '', year: 2025, notes: 'נוסף ידנית' },
];
// רשימת הדגמים לתיקון (משותפת לכל ספקי החלקים)
const RM = [
  { id: 'm1', key: 'apple|iphone 13', brand: 'Apple', model: 'iPhone 13', code: '', year: 2021 },
  { id: 'm2', key: 'apple|iphone 17 pro', brand: 'Apple', model: 'iPhone 17 Pro', code: '', year: 2025 },
  { id: 'm3', key: 'samsung|galaxy a54', brand: 'Samsung', model: 'Galaxy A54', code: 'A546', year: 2023 },
  { id: 'm4', key: 'samsung|galaxy a12', brand: 'Samsung', model: 'Galaxy A12', code: 'A125', year: 2020 },
  { id: 'm5', key: 'samsung|galaxy a12#A127', brand: 'Samsung', model: 'Galaxy A12 Nacho', code: 'A127', year: 2021 },
];
const dp = (row, price) => ({ key: row, row, kind: 'device', price, raw: '', updatedAt: OLD, changedAt: OLD, prevPrice: null });
const lists0 = () => ({
  pa: { updatedAt: OLD, items: [...parts('Galaxy A54 מקורי סאני ₪200\nGalaxy A54 תחליפי כולל מסגרת ₪120'), ...parts('iPhone 13 סוללה מקורית ₪150', 'battery')] },
  pb: { updatedAt: OLD, items: parts('Galaxy A54 Service Pack ₪210\niPhone 17 Pro אינסל ₪150\niPhone 17 Pro OLED ₪250') },
  dv: { updatedAt: OLD, items: [dp('d2', 4000), dp('d3', 2500)] },
  dw: { updatedAt: OLD, items: [dp('d3', 2450)] },
  [CATALOG_ID]: { updatedAt: OLD, items: ROWS.map((r) => ({ ...r })) },
  [RMODELS_ID]: { updatedAt: OLD, items: RM.map((r) => ({ ...r })) },
});

async function exported(lists, cfg, sid) {
  const { wb } = buildWorkbook(ExcelJS, lists, cfg, sid, T0);
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(await wb.xlsx.writeBuffer());
  return w;
}
async function reread(wb, cfg, sid) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(await wb.xlsx.writeBuffer());
  return readWorkbook(w, cfg, sid);
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
const plan = async (wb, sid, lists = lists0(), cfg = cfg0()) => planImport(await reread(wb, cfg, sid), lists, cfg, NOW);
const price = (p, sid, row) => p.lists[sid]?.items.find((x) => x.row === row)?.price ?? null;
const catRow = (p, model) => p.lists[CATALOG_ID]?.items.find((x) => x.model === model);
const partOf = (items, mkey, variant) => items.find((x) => x.mkey === mkey && (variant == null || x.variant === variant));
const PA_A = 'חלקי חילוף Apple', PA_S = 'חלקי חילוף Samsung';
const A54 = { 'דגם': 'Galaxy A54' }, IP13 = { 'דגם': 'iPhone 13' }, IP17P = { 'דגם': 'iPhone 17 Pro' };
const applyPlan = (lists, p) => ({ ...lists, ...Object.fromEntries(Object.entries(p.lists).map(([id, l]) => [id, { updatedAt: l.updatedAt, items: l.items }])) });

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
  const wb = await exported(lists, cfg, 'pa');
  const ap = sheet(wb, PA_A);
  findRow(ap, IP13).getCell(col(ap, 'סוללה מקורית')).note = 'לבדוק עם הספק';
  setCell(ap, IP13, 'סוללה מקורית', 140);
  const buf = await savedByOtherApp(wb);
  await assert.rejects(new ExcelJS.Workbook().xlsx.load(buf), /comments/, 'בלי התיקון ExcelJS נופל');
  hardenExcelJS(ExcelJS);
  hardenExcelJS(ExcelJS); // פעמיים – בלי לעטוף שוב
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(buf);
  const p = planImport(readWorkbook(w, cfg, 'pa'), lists, cfg, NOW);
  assert.equal(p.summary.updated, 1);
  assert.equal(partOf(p.lists.pa.items, 'apple|iphone 13').price, 140);
});

test('קובץ ספק חלקים: 3 גיליונות "חלקי חילוף", דגם בשורה וחלק בעמודה, כמו בקובץ הדוגמה', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg, 'pa');
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['חלקי חילוף Apple', 'חלקי חילוף Samsung', 'חלקי חילוף Xiaomi', '_ייצוא'], 'אין דגמים של חברה אחרת – בלי "אחרים"');
  assert.equal(wb.getWorksheet('_ייצוא').state, 'veryHidden');
  const ap = sheet(wb, PA_A);
  assert.equal(ap.views[0].rightToLeft, true);
  assert.deepEqual(ap.getRow(1).values.slice(1, 15), ['דגם', 'מסך תחליפי', 'מסך אינסל', 'מסך OLED', 'מסך Soft OLED', 'מסך מקורי משופץ', 'מסך מקורי סרוויס', 'מסך מקורי', 'סוללה חליפית', 'סוללה מקורית', 'שקע טעינה', 'מצלמה אחורית', 'גב תחליפי', 'גב מקורי']);
  assert.equal(ap.getColumn(col(ap, 'מזהה')).hidden, true, 'המזהה מוסתר');
  assert.deepEqual([ap.getRow(2).getCell(1).value, ap.getRow(3).getCell(1).value], ['iPhone 13', 'iPhone 17 Pro'], 'ישנים קודם, כמו בקובץ הדוגמה');
  assert.equal(findRow(ap, IP13).getCell(col(ap, 'סוללה מקורית')).value, 150);
  assert.match(String(ap.getColumn(col(ap, 'סוללה מקורית')).numFmt), /₪/);
  const sm = sheet(wb, PA_S);
  assert.deepEqual(sm.getRow(1).values.slice(1, 6), ['דגם', 'דגם יצרן', 'מסך', 'מסך כולל מסגרת', 'מסך תחליפי']);
  const a54 = findRow(sm, A54);
  assert.equal(a54.getCell(col(sm, 'דגם יצרן')).value, 'A546');
  assert.equal(a54.getCell(col(sm, 'מסך מקורי סרוויס')).value, 200, '"מקורי סאני" → מקורי סרוויס');
  assert.equal(a54.getCell(col(sm, 'מסך תחליפי כולל מסגרת')).value, 120);
  assert.equal(a54.getCell(col(sm, 'מסך תחליפי')).value, null);
  assert.equal(findRow(sm, { 'דגם': 'Galaxy A12 Nacho' }).getCell(col(sm, 'דגם יצרן')).value, 'A127', 'דגם בלי מחירים מופיע (ריק)');
  assert.equal(sm.getColumn(col(sm, 'מזהה')).hidden, true);
  // הקובץ של ספק אחר – המחירים שלו
  const wb2 = await exported(lists, cfg, 'pb');
  assert.equal(findRow(sheet(wb2, PA_A), IP17P).getCell(col(ap, 'מסך אינסל')).value, 150);
  assert.equal(findRow(sheet(wb2, PA_A), IP17P).getCell(col(ap, 'מסך OLED')).value, 250);
  assert.equal(findRow(sheet(wb2, PA_S), A54).getCell(col(sm, 'מסך מקורי סרוויס')).value, 210);
  assert.match(exportFileName(cfg.suppliers[0], T0), /^מחירון תיקונים - חלקים א - \d{4}-\d\d-\d\d\.xlsx$/);
  // ייבוא בלי שינוי
  const p = await plan(wb, 'pa', lists, cfg);
  assert.equal(p.hasChanges, false, JSON.stringify(p.summary));
  assert.deepEqual(p.summary.invalid, []);
  assert.deepEqual(p.summary.notes, []);
});

test('קובץ ספק חלקים: מחיר בתא מתעדכן / נוסף / נמחק רק אצל הספק הזה', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg, 'pa');
  setCell(sheet(wb, PA_S), A54, 'מסך מקורי סרוויס', 180);
  setCell(sheet(wb, PA_S), A54, 'מסך תחליפי כולל מסגרת', null);
  setCell(sheet(wb, PA_A), IP17P, 'מסך אינסל', '₪140');
  const p = await plan(wb, 'pa', lists, cfg);
  assert.deepEqual(Object.keys(p.lists), ['pa'], 'רק המחירון של הספק הזה');
  assert.equal(p.summary.updated, 2);
  assert.equal(p.summary.priceChanged, 3);
  const items = p.lists.pa.items;
  const sv = partOf(items, 'samsung|galaxy a54', 'מקורי סאני');
  assert.deepEqual([sv.price, sv.prevPrice, sv.key], [180, 200, partOf(lists.pa.items, 'samsung|galaxy a54', 'מקורי סאני').key]);
  assert.equal(partOf(items, 'samsung|galaxy a54', 'תחליפי כולל מסגרת'), undefined);
  const inc = partOf(items, 'apple|iphone 17 pro');
  assert.deepEqual([inc.price, inc.partType, inc.variant, inc.manual], [140, 'screen', 'אינסל', true]);
  assert.equal(p.lists.pa.updatedAt, OLD, 'תאריך המחירון של הספק לא משתנה');
  assert.equal(partOf(items, 'apple|iphone 13'), partOf(lists.pa.items, 'apple|iphone 13'), 'פריט שלא שונה – אותו אובייקט');
});

test('קובץ ספק חלקים: שם ודגם יצרן נערכים ברשימה המשותפת; שורה חדשה = דגם חדש לכל הספקים; שורה שנמחקה – רק המחירים של הספק', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg, 'pa');
  const sm = sheet(wb, PA_S);
  setCell(sm, { 'דגם': 'Galaxy A12' }, 'דגם יצרן', 'A125F');
  setCell(sm, { 'דגם': 'Galaxy A12 Nacho' }, 'דגם', 'Galaxy A12 (A127)');
  addRow(sm, { 'דגם': 'Galaxy A55', 'דגם יצרן': 'A556', 'מסך מקורי סרוויס': 300 });
  sm.spliceRows(findRow(sm, A54).number, 1);
  const p = await plan(wb, 'pa', lists, cfg);
  const rm = p.lists[RMODELS_ID].items;
  assert.equal(rm.find((r) => r.id === 'm4').code, 'A125F');
  assert.deepEqual([rm.find((r) => r.id === 'm5').model, rm.find((r) => r.id === 'm5').key], ['Galaxy A12 (A127)', 'samsung|galaxy a12#A127'], 'המפתח לא משתנה');
  const a55 = rm.find((r) => r.model === 'Galaxy A55');
  assert.deepEqual([a55.brand, a55.code, a55.key], ['Samsung', 'A556', 'samsung|galaxy a55']);
  assert.ok(rm.find((r) => r.id === 'm3'), 'Galaxy A54 נשאר ברשימה (אצל ספקים אחרים)');
  assert.equal(partOf(p.lists.pa.items, 'samsung|galaxy a55').price, 300);
  assert.equal(p.lists.pa.items.filter((x) => x.mkey === 'samsung|galaxy a54').length, 0, 'המחירים של הספק הזה ל-A54 נמחקו');
  assert.equal(p.lists.pb, undefined, 'ספק ב לא נגעו בו');
  assert.deepEqual([p.summary.added, p.summary.cleared, p.summary.updated], [1, 1, 2]);
  // שורה בלי מזהה לדגם שכבר ברשימה – מתעדכנת, לא מוכפלת
  const wb2 = await exported(lists, cfg, 'pb');
  addRow(sheet(wb2, PA_S), { 'דגם': 'Galaxy A12 Nacho', 'מסך מקורי סרוויס': 170 });
  const p2 = await plan(wb2, 'pb', lists, cfg);
  assert.equal(p2.lists[RMODELS_ID], undefined);
  assert.equal(partOf(p2.lists.pb.items, 'samsung|galaxy a12#A127').price, 170);
});

test('קובץ של ספק אחר / מחירון מכשירים במקום חלקי חילוף – לא מיובא', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg, 'pa');
  assert.match((await plan(wb, 'pb', lists, cfg)).error, /של "חלקים א", לא של "חלקים ב"/);
  const dev = await exported(lists, cfg, 'dv');
  dev.removeWorksheet(dev.getWorksheet('_ייצוא').id);
  assert.match((await plan(dev, 'pa', lists, cfg)).error, /מחירון מכשירים/);
});

test('קובץ ספק חלקים: עמודה שלא מוגדרת ושורות לא תקינות', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg, 'pa');
  const sm = sheet(wb, PA_S);
  sm.getRow(1).getCell(sm.columnCount + 1).value = 'מסך זהב';
  setCell(sm, A54, 'מסך מקורי סרוויס', 'abc');
  addRow(sm, { 'דגם יצרן': 'A999', 'מסך': 100 });
  const p = await plan(wb, 'pa', lists, cfg);
  assert.equal(p.hasChanges, false);
  assert.equal(p.summary.invalid.length, 2);
  assert.match(p.summary.invalid.map((x) => x.reason).join('|'), /"abc" הוא לא מחיר.*\|חסר שם דגם|חסר שם דגם.*"abc" הוא לא מחיר/);
  assert.match(p.summary.notes.join(' '), /"מסך זהב".*לא מוגדרת/);
});

test('קובץ ספק חלקים: מיזוג – מחיר שהתעדכן מוואטסאפ אחרי הייצוא לא נדרס; ייבוא חוזר לא משנה שוב', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg, 'pa');
  setCell(sheet(wb, PA_S), A54, 'מסך תחליפי כולל מסגרת', 110);
  const now2 = T0 + 3600000;
  const newer = { ...lists, pa: { updatedAt: now2, items: mergeItems(lists.pa.items, parseMessage('Galaxy A54 מקורי סאני ₪190', { kind: 'parts', partType: 'screen' }), { replace: false, now: now2 }) } };
  const p = await plan(wb, 'pa', newer, cfg);
  assert.equal(p.summary.updated, 1);
  assert.equal(partOf(p.lists.pa.items, 'samsung|galaxy a54', 'מקורי סאני').price, 190, 'המחיר החדש מהספק נשמר');
  assert.equal(partOf(p.lists.pa.items, 'samsung|galaxy a54', 'תחליפי כולל מסגרת').price, 110);
  const book = await reread(wb, cfg, 'pa');
  const p2 = planImport(book, applyPlan(newer, p), cfg, NOW + 1000);
  assert.equal(p2.hasChanges, false, JSON.stringify(p2.summary));
});

test('קובץ ספק מכשירים: רשימת המכשירים עם עמודת המחיר של הספק בלבד', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg, 'dv');
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Apple', 'Samsung', 'Xiaomi', 'אחרים', '_ייצוא'], 'יש מכשיר של חברה אחרת – יש "אחרים"');
  const sam = sheet(wb, 'Samsung');
  assert.deepEqual(sam.getRow(1).values.slice(1, 10), ['יצרן', 'רמות גימור/סגמנטציה', 'סדרה', 'שם הדגם', 'נפחי אחסון זמינים', 'גרסה', 'שנת השקה', 'מחיר', 'הערות']);
  assert.equal(findRow(sam, { 'שם הדגם': 'Galaxy S24' }).getCell(col(sam, 'מחיר')).value, 2500);
  assert.equal(findRow(sam, { 'שם הדגם': 'Galaxy A54 5G' }).getCell(col(sam, 'מחיר')).value, null);
  assert.equal(sam.getColumn(col(sam, 'מזהה')).hidden, true);
  assert.match(exportFileName(cfg.suppliers[2], T0), /^מחירון מכשירים - מכשירים - /);
  assert.equal((await plan(wb, 'dv', lists, cfg)).hasChanges, false);
  // מחיר, עריכת מכשיר, מכשיר חדש, ושורה שנמחקה
  setCell(sam, { 'שם הדגם': 'Galaxy S24' }, 'מחיר', '₪2,400');
  setCell(sam, { 'שם הדגם': 'Galaxy A54 5G' }, 'נפחי אחסון זמינים', '256GB');
  addRow(sheet(wb, 'Xiaomi'), { 'יצרן': 'Xiaomi', 'רמות גימור/סגמנטציה': 'מכשירי פרימיום', 'שם הדגם': 'Xiaomi 15 Ultra', 'נפחי אחסון זמינים': '512GB', 'שנת השקה': 2025, 'מחיר': 4200 });
  const ap = sheet(wb, 'Apple');
  ap.spliceRows(findRow(ap, { 'שם הדגם': 'iPhone 15 Pro' }).number, 1);
  const p = await plan(wb, 'dv', lists, cfg);
  assert.equal(price(p, 'dv', 'd3'), 2400);
  assert.equal(p.lists.dv.items.find((x) => x.row === 'd3').prevPrice, 2500);
  assert.equal(catRow(p, 'Galaxy A54 5G').storage, 256);
  const x15 = catRow(p, 'Xiaomi 15 Ultra');
  assert.deepEqual([x15.segment, x15.storage, x15.year], ['premium', 512, 2025]);
  assert.equal(price(p, 'dv', x15.id), 4200);
  assert.equal(price(p, 'dv', 'd2'), null, 'המחיר של הספק למכשיר שנמחק מהקובץ נמחק');
  assert.ok(catRow(p, 'iPhone 15 Pro'), 'המכשיר עצמו נשאר ברשימה');
  assert.equal(p.lists.dw, undefined, 'ספק המכשירים השני לא נגעו בו');
  assert.deepEqual([p.summary.added, p.summary.cleared], [1, 1]);
  const book = await reread(wb, cfg, 'dv');
  assert.equal(planImport(book, applyPlan(lists, p), cfg, NOW + 1000).hasChanges, false, 'ייבוא חוזר');
});

test('קובץ ספק מכשירים: שורות לא תקינות לא מיובאות', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg, 'dv');
  const ap = sheet(wb, 'Apple');
  addRow(ap, { 'יצרן': 'Google', 'רמות גימור/סגמנטציה': 'מכשירי דגל', 'שם הדגם': 'Pixel 9', 'נפחי אחסון זמינים': 'הרבה' });
  addRow(ap, { 'יצרן': 'Apple', 'רמות גימור/סגמנטציה': 'יוקרה', 'שם הדגם': 'iPhone 18' });
  setCell(ap, { 'שם הדגם': 'iPhone 15' }, 'מחיר', 'אלף');
  const p = await plan(wb, 'dv', lists, cfg);
  const reasons = p.summary.invalid.map((x) => x.reason).join('|');
  assert.equal(p.summary.invalid.length, 3, reasons);
  assert.match(reasons, /נפח לא תקין/);
  assert.match(reasons, /רמת גימור לא מוכרת: "יוקרה"/);
  assert.match(reasons, /מחיר לא תקין/);
  assert.equal(p.hasChanges, false);
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
