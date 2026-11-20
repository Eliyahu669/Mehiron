// ייצוא וייבוא אקסל: הלוך-חזור, עדכון/הוספה/מחיקה, מחיר ידני ללקוח, מיזוג מול שינויים שקרו אחרי הייצוא
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildWorkbook, readWorkbook, planImport, parseNum, parseStorage, exportRows, hardenExcelJS, SHEET_REPAIRS, SHEET_DEVICES } from '../src/lib/excel.js';
import { parseMessage, mergeItems } from '../src/lib/parser.js';
import { mergeConfig } from '../src/lib/store.js';
import { repairGroupKey, deviceGroupKey } from '../src/lib/pricing.js';

const T0 = 1795000000000; // זמן הייצוא
const NOW = T0 + 86400000; // זמן הייבוא
const OLD = T0 - 10 * 86400000; // מתי המחירונים עודכנו

const cfg0 = () => mergeConfig({
  suppliers: [
    { id: 'pa', name: 'חלקים א', type: 'parts', phone: '' },
    { id: 'pb', name: 'חלקים ב', type: 'parts', phone: '' },
    { id: 'dv', name: 'מכשירים', type: 'devices', phone: '' },
  ],
});
const parts = (t) => mergeItems([], parseMessage(t, { kind: 'parts', partType: 'screen' }), { now: OLD });
const devices = (t) => mergeItems([], parseMessage(t, { kind: 'devices' }), { now: OLD });
const lists0 = () => ({
  pa: { updatedAt: OLD, items: parts('Galaxy A54 מקורי ₪200\nGalaxy A54 תחליפי ₪120\niPhone 13 סוללה מקורית ₪150\nGalaxy A34 סאני מקורי ₪180') },
  pb: { updatedAt: OLD, items: parts('Galaxy A54 מקורי ₪210') },
  dv: { updatedAt: OLD, items: devices('iPhone 15 Pro 256 ₪4000\nGalaxy S24 128 ₪2500') },
});

// ---- עזרים לעריכת הקובץ כמו שמשתמש עושה באקסל ----
async function exported(lists, cfg) {
  const { wb } = buildWorkbook(ExcelJS, lists, cfg, T0);
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(await wb.xlsx.writeBuffer());
  return w;
}
async function reread(wb) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(await wb.xlsx.writeBuffer());
  return readWorkbook(w);
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
const plan = async (wb, lists = lists0(), cfg = cfg0()) => planImport(await reread(wb), lists, cfg, NOW);
const find = (items, model, variant) => items.find((x) => x.model === model && (variant == null || x.variant === variant));

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
  const rep = sheet(wb, SHEET_REPAIRS);
  findRow(rep, { 'דגם': 'iPhone 13' }).getCell(col(rep, 'מחיר ספק')).note = 'לבדוק עם הספק';
  setCell(rep, { 'דגם': 'iPhone 13' }, 'מחיר ספק', 140);
  const buf = await savedByOtherApp(wb);
  await assert.rejects(new ExcelJS.Workbook().xlsx.load(buf), /comments/, 'בלי התיקון ExcelJS נופל');
  hardenExcelJS(ExcelJS);
  hardenExcelJS(ExcelJS); // פעמיים – בלי לעטוף שוב
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(buf);
  const p = planImport(readWorkbook(w), lists, cfg, NOW);
  assert.equal(p.summary.updated, 1);
  assert.equal(find(p.lists.pa.items, 'iPhone 13').price, 140);
  assert.deepEqual(p.details.updated[0].what, ['מחיר']);
});

test('אקסל: ייצוא ושני גיליונות, וייבוא בלי שינוי לא משנה כלום', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  assert.deepEqual(wb.worksheets.map((w) => w.name), [SHEET_REPAIRS, SHEET_DEVICES, '_ייצוא']);
  assert.equal(wb.getWorksheet('_ייצוא').state, 'veryHidden');
  const rep = sheet(wb, SHEET_REPAIRS);
  assert.equal(rep.views[0].rightToLeft, true);
  assert.equal(rep.rowCount, 1 + 5);
  assert.equal(sheet(wb, SHEET_DEVICES).rowCount, 1 + 2);
  // מחיר ללקוח = המחיר באפליקציה: החלק הזול מכל הספקים + עבודה (Galaxy A: מסך 120), מעוגל ל-10
  assert.equal(findRow(rep, { 'דגם': 'Galaxy A54', 'איכות': 'מקורי', 'ספק': 'חלקים ב' }).getCell(col(rep, 'מחיר ללקוח')).value, 320);
  assert.equal(findRow(rep, { 'דגם': 'iPhone 13' }).getCell(col(rep, 'סוג חלק')).value, 'סוללה');
  const dev = sheet(wb, SHEET_DEVICES);
  const s24 = findRow(dev, { 'דגם': 'Galaxy S24' });
  assert.equal(s24.getCell(col(dev, 'נפח')).value, '128GB');
  assert.equal(s24.getCell(col(dev, 'קטגוריית רווח')).value, 'אוטומטי');
  assert.equal(s24.getCell(col(dev, 'מחיר ללקוח')).value, 2700); // Galaxy S = דגל: 2500 + 8%
  const p = await plan(wb, lists, cfg);
  assert.equal(p.hasChanges, false);
  assert.deepEqual(p.summary.invalid, []);
  assert.deepEqual(p.summary.notes, []);
});

test('אקסל: שינוי מחיר ספק מעדכן רק את הפריט הזה', async () => {
  const lists = lists0();
  const wb = await exported(lists, cfg0());
  setCell(sheet(wb, SHEET_REPAIRS), { 'דגם': 'Galaxy A54', 'איכות': 'מקורי', 'ספק': 'חלקים א' }, 'מחיר ספק', 180);
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
  // מחיר כטקסט ("₪1,200") נקרא כמספר
  setCell(sheet(wb, SHEET_DEVICES), { 'דגם': 'Galaxy S24' }, 'מחיר ספק', '₪2,450');
  const p2 = await plan(wb, lists);
  assert.equal(find(p2.lists.dv.items, 'Galaxy S24').price, 2450);
});

test('אקסל: שורה שנמחקה נמחקת, שורה חדשה נוספת (גם עם ספק חדש)', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const rep = sheet(wb, SHEET_REPAIRS);
  rep.spliceRows(findRow(rep, { 'דגם': 'Galaxy A54', 'איכות': 'תחליפי' }).number, 1);
  addRow(rep, { 'ספק': 'חלקים א', 'דגם': 'Galaxy A55', 'סוג חלק': 'מסך', 'איכות': 'מקורי', 'מחיר ספק': 230 });
  addRow(rep, { 'ספק': 'ספק חדש', 'דגם': 'Galaxy A15', 'סוג חלק': 'סוללה', 'מחיר ספק': 90 });
  // פריט שנוסף לאפליקציה אחרי הייצוא – לא בקובץ, ולא נמחק
  const later = { ...lists, pb: { ...lists.pb, items: [...lists.pb.items, ...parts('Galaxy A25 מקורי ₪160')] } };
  const p = await plan(wb, later, cfg);
  assert.equal(p.summary.deleted, 1);
  assert.equal(p.summary.added, 2);
  assert.equal(find(p.lists.pa.items, 'Galaxy A54', 'תחליפי'), undefined);
  const a55 = find(p.lists.pa.items, 'Galaxy A55');
  assert.equal(a55.price, 230);
  assert.equal(a55.partType, 'screen');
  assert.equal(a55.manual, true);
  assert.equal(p.lists.pb, undefined, 'המחירון של חלקים ב לא השתנה (והפריט שנוסף אחרי הייצוא נשאר)');
  assert.deepEqual(p.summary.newSuppliers, ['ספק חדש']);
  const ns = p.config.suppliers.find((s) => s.name === 'ספק חדש');
  assert.equal(ns.type, 'parts');
  assert.equal(p.lists[ns.id].items[0].partType, 'battery');
  assert.equal(p.lists[ns.id].updatedAt, NOW);
});

test('אקסל: מחיר ללקוח – שינוי הופך למחיר ידני לכל הקבוצה, מחיקה מחזירה לאוטומטי', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  setCell(sheet(wb, SHEET_REPAIRS), { 'דגם': 'Galaxy A54', 'איכות': 'מקורי', 'ספק': 'חלקים א' }, 'מחיר ללקוח', 349);
  setCell(sheet(wb, SHEET_DEVICES), { 'דגם': 'iPhone 15 Pro' }, 'מחיר ללקוח', 4390);
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.overridesSet, 2);
  assert.equal(p.summary.updated, 0, 'הפריטים עצמם לא השתנו');
  assert.deepEqual(Object.keys(p.lists), []);
  const rk = repairGroupKey('samsung|galaxy a54', 'screen', 'מקורי');
  const dk = deviceGroupKey(find(lists.dv.items, 'iPhone 15 Pro'));
  assert.equal(p.config.priceOverrides[rk], 349);
  assert.equal(p.config.priceOverrides[dk], 4390);

  // אחרי השמירה: הייצוא מציג את המחיר הידני, ומחיקת המספר מחזירה לאוטומטי (כולל מפתח בפורמט ישן)
  const cfg2 = { ...p.config, priceOverrides: { ...p.config.priceOverrides, 'samsung|galaxy a34|screen|סאני מקורי': 333 } };
  const rows = exportRows(lists, cfg2);
  assert.equal(rows.repairs.find((r) => r.model === 'Galaxy A54' && r.supplier === 'חלקים ב').customer, 349, 'כל הספקים באותה קבוצה');
  assert.equal(rows.repairs.find((r) => r.model === 'Galaxy A34').customer, 333);
  const wb2 = await exported(lists, cfg2);
  setCell(sheet(wb2, SHEET_REPAIRS), { 'דגם': 'Galaxy A34' }, 'מחיר ללקוח', null);
  setCell(sheet(wb2, SHEET_DEVICES), { 'דגם': 'iPhone 15 Pro' }, 'מחיר ללקוח', null);
  const p2 = await plan(wb2, lists, cfg2);
  assert.equal(p2.summary.overridesCleared, 2);
  assert.deepEqual(p2.config.priceOverrides, { [rk]: 349 });

  // שני מחירים שונים לאותה קבוצה – הראשון נקבע ויש אזהרה
  const wb3 = await exported(lists, cfg);
  setCell(sheet(wb3, SHEET_REPAIRS), { 'דגם': 'Galaxy A54', 'איכות': 'מקורי', 'ספק': 'חלקים א' }, 'מחיר ללקוח', 349);
  setCell(sheet(wb3, SHEET_REPAIRS), { 'דגם': 'Galaxy A54', 'איכות': 'מקורי', 'ספק': 'חלקים ב' }, 'מחיר ללקוח', 359);
  const p3 = await plan(wb3, lists, cfg);
  assert.equal(p3.config.priceOverrides[rk], 349);
  assert.equal(p3.summary.conflicts.length, 1);
});

test('אקסל: מיזוג – מחיר שהתעדכן מוואטסאפ אחרי הייצוא לא נדרס, ורק מה ששונה בקובץ נכנס', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  setCell(sheet(wb, SHEET_REPAIRS), { 'דגם': 'Galaxy A54', 'איכות': 'תחליפי' }, 'מחיר ספק', 110);
  // אחרי הייצוא: הספק שלח מחירון חדש (Galaxy A54 מקורי ירד ל-190)
  const now2 = T0 + 3600000;
  const newer = { ...lists, pa: { updatedAt: now2, items: mergeItems(lists.pa.items, parseMessage('Galaxy A54 מקורי ₪190', { kind: 'parts', partType: 'screen' }), { replace: false, now: now2 }) } };
  const p = await plan(wb, newer, cfg);
  assert.equal(p.summary.updated, 1);
  assert.equal(find(p.lists.pa.items, 'Galaxy A54', 'מקורי').price, 190, 'המחיר החדש מהספק נשמר');
  assert.equal(find(p.lists.pa.items, 'Galaxy A54', 'תחליפי').price, 110);
  assert.equal(p.summary.overridesSet, 0, 'מחיר ללקוח שלא נגעו בו לא הופך לידני');
});

test('אקסל: שורה מועתקת עם שינוי נוספת כפריט חדש, והמקורית נשארת', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const dev = sheet(wb, SHEET_DEVICES);
  const src = findRow(dev, { 'דגם': 'iPhone 15 Pro' });
  dev.addRow(src.values);
  const copy = dev.getRow(dev.rowCount);
  copy.getCell(col(dev, 'נפח')).value = '512GB';
  copy.getCell(col(dev, 'מחיר ספק')).value = 4700;
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.added, 1);
  assert.equal(p.summary.updated, 0);
  assert.equal(p.lists.dv.items.length, 3);
  assert.equal(p.lists.dv.items.find((x) => x.storage === 256).price, 4000);
  assert.equal(p.lists.dv.items.find((x) => x.storage === 512).price, 4700);
  // שורה כפולה בלי שום שינוי – מדולגת
  const wb2 = await exported(lists, cfg);
  sheet(wb2, SHEET_DEVICES).addRow(findRow(sheet(wb2, SHEET_DEVICES), { 'דגם': 'Galaxy S24' }).values);
  const p2 = await plan(wb2, lists, cfg);
  assert.equal(p2.hasChanges, false);
  assert.equal(p2.summary.notes.length, 1);
});

test('אקסל: עריכת מכשיר – נפח, וריאנט וקטגוריית רווח', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const dev = sheet(wb, SHEET_DEVICES);
  setCell(dev, { 'דגם': 'Galaxy S24' }, 'נפח', '256GB');
  setCell(dev, { 'דגם': 'Galaxy S24' }, 'וריאנט', 'DCS');
  setCell(dev, { 'דגם': 'iPhone 15 Pro' }, 'קטגוריית רווח', 'ביניים');
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.updated, 2);
  assert.equal(p.summary.priceChanged, 0);
  const s24 = find(p.lists.dv.items, 'Galaxy S24');
  assert.equal(s24.storage, 256);
  assert.equal(s24.variant, 'DCS');
  assert.equal(s24.key, 'samsung|galaxy s24|256|DCS');
  assert.equal(s24.price, 2500);
  assert.equal(s24.updatedAt, OLD, 'בלי שינוי מחיר – תאריך המחיר לא משתנה');
  assert.equal(find(p.lists.dv.items, 'iPhone 15 Pro').categoryOverride, 'mid');
});

test('אקסל: העברה לספק אחר, ושם ספק ששונה באפליקציה אחרי הייצוא לא נחשב כהעברה', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  setCell(sheet(wb, SHEET_REPAIRS), { 'דגם': 'iPhone 13' }, 'ספק', 'חלקים ב');
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.updated, 1);
  assert.equal(find(p.lists.pa.items, 'iPhone 13'), undefined);
  assert.equal(find(p.lists.pb.items, 'iPhone 13').price, 150);
  assert.deepEqual(p.details.updated[0].what, ['ספק (חלקים ב)']);

  const wb2 = await exported(lists, cfg);
  const renamed = { ...cfg, suppliers: cfg.suppliers.map((s) => (s.id === 'pa' ? { ...s, name: 'חלקים א בע"מ' } : s)) };
  const p2 = await plan(wb2, lists, renamed);
  assert.equal(p2.hasChanges, false);
  assert.deepEqual(p2.summary.newSuppliers, []);
});

test('אקסל: שורות לא תקינות לא מיובאות והפריט שלהן נשאר', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const rep = sheet(wb, SHEET_REPAIRS);
  setCell(rep, { 'דגם': 'Galaxy A54', 'איכות': 'תחליפי' }, 'מחיר ספק', 'abc');
  setCell(rep, { 'דגם': 'iPhone 13' }, 'סוג חלק', 'מסגרת');
  addRow(rep, { 'ספק': 'מכשירים', 'דגם': 'Galaxy A15', 'סוג חלק': 'מסך', 'מחיר ספק': 90 });
  addRow(rep, { 'ספק': 'חלקים א', 'סוג חלק': 'מסך', 'מחיר ספק': 90 });
  addRow(sheet(wb, SHEET_DEVICES), { 'ספק': 'מכשירים', 'דגם': 'Pixel 9', 'נפח': 'הרבה', 'מחיר ספק': 3000 });
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.invalid.length, 5);
  assert.match(p.summary.invalid.map((x) => x.reason).join('|'), /מחיר ספק.*abc/);
  assert.match(p.summary.invalid.map((x) => x.reason).join('|'), /מוגדר כספק מכשירים/);
  assert.equal(p.summary.deleted, 0);
  assert.equal(p.summary.added, 0);
  assert.equal(p.hasChanges, false);
  // פריט שהועבר לגיליון השני
  const wb2 = await exported(lists, cfg);
  const src = findRow(sheet(wb2, SHEET_REPAIRS), { 'דגם': 'iPhone 13' });
  const vals = src.values;
  sheet(wb2, SHEET_REPAIRS).spliceRows(src.number, 1);
  const r = sheet(wb2, SHEET_DEVICES).addRow([]);
  r.getCell(col(sheet(wb2, SHEET_DEVICES), 'ספק')).value = 'חלקים א';
  r.getCell(col(sheet(wb2, SHEET_DEVICES), 'דגם')).value = 'iPhone 13';
  r.getCell(col(sheet(wb2, SHEET_DEVICES), 'מחיר ספק')).value = 150;
  r.getCell(col(sheet(wb2, SHEET_DEVICES), 'מזהה')).value = vals[col(sheet(wb2, SHEET_REPAIRS), 'מזהה')];
  const p2 = await plan(wb2, lists, cfg);
  assert.equal(p2.summary.invalid.length, 1);
  assert.equal(p2.summary.deleted, 0);
});

test('אקסל: גיליון חסר לא מוחק כלום, וקובץ שלא יוצא מהאפליקציה מוחק את מה שלא בו (עם אזהרה)', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  wb.removeWorksheet(sheet(wb, SHEET_DEVICES).id);
  const p = await plan(wb, lists, cfg);
  assert.equal(p.hasChanges, false);
  assert.match(p.summary.notes.join(' '), /מחירון מכשירים.*לא נמצא/);

  const wb2 = await exported(lists, cfg);
  wb2.removeWorksheet(wb2.getWorksheet('_ייצוא').id);
  sheet(wb2, SHEET_REPAIRS).spliceRows(findRow(sheet(wb2, SHEET_REPAIRS), { 'דגם': 'iPhone 13' }).number, 1);
  const p2 = await plan(wb2, lists, cfg);
  assert.equal(p2.summary.deleted, 1);
  assert.match(p2.summary.notes.join(' '), /לא נוצר בייצוא/);

  // גיליון בלי עמודת מזהה (בקובץ מהאפליקציה) – לא נוגעים בו בכלל
  const wb3 = await exported(lists, cfg);
  sheet(wb3, SHEET_REPAIRS).getRow(1).getCell(col(sheet(wb3, SHEET_REPAIRS), 'מזהה')).value = 'קוד';
  const p3 = await plan(wb3, lists, cfg);
  assert.equal(p3.hasChanges, false);
  assert.equal(p3.summary.invalid.length, 1);
});

const applyPlan = (lists, p) => ({ ...lists, ...Object.fromEntries(Object.entries(p.lists).map(([id, l]) => [id, { updatedAt: l.updatedAt, items: l.items }])) });

test('אקסל: ייבוא חוזר של אותו קובץ לא משנה שוב ולא מכפיל; שורה שנמחקה ונכתבה מחדש זהה – הפריט נשאר', async () => {
  const lists = lists0(), cfg = cfg0();
  const wb = await exported(lists, cfg);
  const rep = sheet(wb, SHEET_REPAIRS);
  const a54 = { 'דגם': 'Galaxy A54', 'איכות': 'מקורי', 'ספק': 'חלקים א' };
  setCell(rep, a54, 'מחיר ספק', 180);
  setCell(rep, a54, 'מחיר ללקוח', 349);
  rep.spliceRows(findRow(rep, { 'דגם': 'Galaxy A34' }).number, 1);
  addRow(rep, { 'ספק': 'חלקים א', 'דגם': 'Galaxy A55', 'סוג חלק': 'מסך', 'מחיר ספק': 230 });
  setCell(sheet(wb, SHEET_DEVICES), { 'דגם': 'Galaxy S24' }, 'נפח', '256GB');
  const book = await reread(wb);
  const p1 = planImport(book, lists, cfg, NOW);
  assert.equal(p1.summary.updated, 2);
  assert.equal(p1.summary.added, 1);
  assert.equal(p1.summary.deleted, 1);
  assert.equal(p1.summary.overridesSet, 1);
  const p2 = planImport(book, applyPlan(lists, p1), p1.config, NOW + 1000);
  assert.equal(p2.hasChanges, false, JSON.stringify(p2.summary));
  assert.match(p2.summary.notes.join(' '), /כבר קיימות/);

  const wb3 = await exported(lists, cfg);
  const r3 = sheet(wb3, SHEET_REPAIRS);
  const ip = find(lists.pa.items, 'iPhone 13');
  r3.spliceRows(findRow(r3, { 'דגם': 'iPhone 13' }).number, 1);
  addRow(r3, { 'ספק': 'חלקים א', 'דגם': 'iPhone 13', 'סוג חלק': 'סוללה', 'איכות': ip.variant, 'מחיר ספק': 150 });
  const p3 = await plan(wb3, lists, cfg);
  assert.equal(p3.hasChanges, false, JSON.stringify(p3.summary));
});

test('אקסל: עמודת "אחוז רווח" – ייצוא, קביעה, מחיקה, ותא בפורמט אחוזים', async () => {
  const lists = lists0();
  const ip = find(lists.dv.items, 'iPhone 15 Pro'), s24 = find(lists.dv.items, 'Galaxy S24');
  const cfg = { ...cfg0(), marginOverrides: { [deviceGroupKey(ip)]: 5 } };
  const wb = await exported(lists, cfg);
  const dev = sheet(wb, SHEET_DEVICES);
  assert.equal(findRow(dev, { 'דגם': 'iPhone 15 Pro' }).getCell(col(dev, 'אחוז רווח')).value, 5);
  assert.equal(findRow(dev, { 'דגם': 'iPhone 15 Pro' }).getCell(col(dev, 'מחיר ללקוח')).value, 4200); // 4000 + 5%
  assert.equal(findRow(dev, { 'דגם': 'Galaxy S24' }).getCell(col(dev, 'אחוז רווח')).value, null);
  assert.equal(col(sheet(wb, SHEET_REPAIRS), 'מחיר ספק') > 0 && !sheet(wb, SHEET_REPAIRS).getRow(1).values.includes('אחוז רווח'), true, 'רק בגיליון המכשירים');
  const p0 = await plan(wb, lists, cfg);
  assert.equal(p0.hasChanges, false);

  setCell(dev, { 'דגם': 'iPhone 15 Pro' }, 'אחוז רווח', null);
  const cell = findRow(dev, { 'דגם': 'Galaxy S24' }).getCell(col(dev, 'אחוז רווח'));
  cell.value = 0.12; cell.numFmt = '0%'; // הקלדה של "12%" באקסל
  const p = await plan(wb, lists, cfg);
  assert.equal(p.summary.marginsSet, 1);
  assert.equal(p.summary.marginsCleared, 1);
  assert.deepEqual(p.config.marginOverrides, { [deviceGroupKey(s24)]: 12 });
  assert.equal(p.summary.updated, 0);

  setCell(dev, { 'דגם': 'Galaxy S24' }, 'אחוז רווח', 'הרבה');
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
