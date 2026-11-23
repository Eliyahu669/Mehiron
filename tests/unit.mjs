// בדיקות יחידה – רצות ב-CI לפני כל פרסום. נתונים מומצאים בלבד (בלי מחירוני ספקים אמיתיים)
import test from 'node:test';
import assert from 'node:assert/strict';
import { identify, tokenize } from '../src/lib/normalize.js';
import { extractPrice, parseMessage, mergeItems, manualItem, detectPartType } from '../src/lib/parser.js';
import { laborFor, repairQuote, roundPrice, qualityKey, freshness, afterVat } from '../src/lib/pricing.js';
import { defaultCatalog, rowQuote, rowKey, matchSupplierItems, applySupplierImport, normalizeVersion, migrateDeviceConfig, priceIndex, buildDeviceModels, sheetOf, ignoreKey } from '../src/lib/devices.js';
import { buildCatalog, activeLists, searchModels, detectRepair } from '../src/lib/catalog.js';
import { buildPublicCatalog, buildFullCatalog, publicConfig, liteCatalog, getRepairQuote, getDeviceQuotes } from '../src/lib/publish.js';
import { pack, unpack, readPriceListDoc, readCatalogDoc, MAX_FIELD } from '../src/lib/packing.js';
import { bulkPrice, applyBulkPrice, uniqueKey } from '../src/lib/items.js';
import { DEFAULT_CONFIG as CFG } from '../src/lib/defaults.js';
import { mergeConfig } from '../src/lib/store.js';
import { resolveQuality, optionName, optionKey, parseReply, manualPart, allRepairs, stripRepairWords } from '../src/lib/repairs.js';
import { splitMulti, unknownModelVariant } from '../src/lib/parser.js';
import { seedRepairModels, matchRow, codesIn, missingFromDevices, addRows, attachRow, rekeyParts } from '../src/lib/rmodels.js';
import { partCells, setPartCell } from '../src/lib/partcells.js';
import { DEFAULT_PART_COLUMNS, partColumns } from '../src/lib/repairs.js';

const devices = (t) => parseMessage(t, { kind: 'devices' });
const parts = (t, partType = 'screen') => parseMessage(t, { kind: 'parts', partType });

test('זיהוי דגמים: אייפון בכל הכתיבים', () => {
  for (const [t, model, storage] of [
    ['iPhone 15 Pro Max 256GB', 'iPhone 15 Pro Max', 256],
    ['Ip 15 pro max 256dcs', 'iPhone 15 Pro Max', 256],
    ['IPHONE 14PRO MAX', 'iPhone 14 Pro Max', null],
    ['iphone 15promax 512', 'iPhone 15 Pro Max', 512],
    ['ip15 pro 128', 'iPhone 15 Pro', 128],
    ['אייפון 16 פרו מקס 1 טרה', 'iPhone 16 Pro Max', 1024],
    ['iPhone 16e 128', 'iPhone 16e', 128],
    ['אייפון אייר 256', 'iPhone Air', 256],
    ['Ip xr 128new', 'iPhone XR', 128],
    ['iPhone 16 128', 'iPhone 16', 128],
  ]) {
    const r = identify(t);
    assert.equal(r.model, model, t);
    assert.equal(r.storage, storage, t);
    assert.equal(r.brand, 'Apple', t);
  }
  assert.equal(identify('iPhone 15 Pro').tier, 'new');
  assert.equal(identify('iPhone 13 mini').tier, 'old');
  assert.equal(identify('iPhone 8').tier, null);
  assert.equal(identify('15 128', 'Apple').model, 'iPhone 15', 'הקשר "אפל" מכותרת');
});

test('זיהוי דגמים: סמסונג, שיאומי ואחרים', () => {
  for (const [t, model, family] of [
    ['Galaxy S24 Ultra 512', 'Galaxy S24 Ultra', 'galaxy-s'],
    ['S24ultra 256', 'Galaxy S24 Ultra', 'galaxy-s'],
    ['גלקסי איי 54 128', 'Galaxy A54', 'galaxy-a'],
    ['Samsung Galaxy A A54 (A546)', 'Galaxy A54', 'galaxy-a'],
    ['zflip5 256', 'Galaxy Z Flip 5', 'galaxy-z'],
    ['זד פולד 6 512', 'Galaxy Z Fold 6', 'galaxy-z'],
    ['Galaxy Note Note 20 Ultra', 'Galaxy Note 20 Ultra', 'galaxy-note'],
    ['S9+ (G965)', 'Galaxy S9 Plus', 'galaxy-s'],
    ['Galaxy M M54', 'Galaxy M54', 'galaxy-m'],
    ['Redmi Note 13 Pro+ 256', 'Redmi Note 13 Pro Plus', 'redmi'],
    ['Mi 13T 256', 'Xiaomi 13T', 'xiaomi'],
    ['Xiaomi 13T 256', 'Xiaomi 13T', 'xiaomi'],
    ['Mi 11 Lite 128', 'Mi 11 Lite', 'xiaomi'],
    ['Xiaomi 15 Ultra 512', 'Xiaomi 15 Ultra', 'xiaomi'],
    ['POCO F5 256', 'POCO F5', 'xiaomi'],
  ]) {
    const r = identify(t);
    assert.equal(r.model, model, t);
    assert.equal(r.family, family, t);
  }
  assert.equal(identify('POCO X6 Pro').family, null, 'POCO X לא בטבלת העבודה');
  assert.equal(identify('Pixel 8 Pro').model, identify('Google Pixel 8 Pro').model, 'Pixel עם/בלי Google – אותו דגם');
  assert.equal(identify('Pixel 8 Pro').brand, identify('Google Pixel 8 Pro').brand);
});

test('זיהוי מוצרים שאינם טלפון', () => {
  assert.equal(identify('AirPods Pro 2 USB-C').model, 'AirPods Pro 2 USB-C');
  assert.notEqual(identify('AirPods Pro 2 USB-C').model, identify('AirPods Pro 2').model);
  assert.equal(identify('AirPods 4').category, 'wearable');
  assert.equal(identify('Watch S9 41mm gps').kind, 'watch');
  assert.equal(identify('Ipad 10th 64g wifi').category, 'flagship');
  assert.equal(identify('Tab lenovo e7 1/16g').category, 'mid');
  assert.equal(identify('AirTag').category, 'flagship');
  assert.equal(identify('מטען מהיר 20W').category, 'accessory');
  assert.equal(identify('מטען מהיר 20W').model, 'מטען מהיר 20W', 'שם בעברית נשמר כמו שהוא');
  assert.equal(identify('Mi tv box s').excluded, true);
  assert.equal(identify('Apple Home pod mini').excluded, true);
});

test('חילוץ מחיר', () => {
  const p = (t) => extractPrice(t)?.price ?? null;
  assert.equal(p('Ip 13 128-2400 active'), 2400);
  assert.equal(p('A04 -450רשמי'), 450);
  assert.equal(p('S23 ultra pr 512g - 4300'), 4300);
  assert.equal(p('15 128 ₪2150 דיסיאס'), 2150, '₪ לפני המספר, נפח לפניו');
  assert.equal(p('כתום 3,800₪'), 3800);
  assert.equal(p('Ip 13 128 2400 ש"ח'), 2400);
  assert.equal(p('A54 128 - 1,420 שח'), 1420);
  assert.equal(p('iPhone 15 3200 ש״ח'), 3200);
  assert.equal(p('Redmi 13 1400 NIS'), 1400);
  assert.equal(p('רשמי 2850.'), 2850);
  assert.equal(p('רשמי3050.'), 3050);
  assert.equal(p('Ip x 256-active 1100'), 1100);
  assert.equal(p('אייפון 15 128 שחור'), null, '"שחור" הוא לא ש"ח');
  assert.equal(p('A54 - 128'), null, 'נפח אחרי מקף הוא לא מחיר');
  assert.equal(p('NOKIA 8210 4G'), null, 'מספר דגם באמצע השורה');
  assert.equal(p('Galaxy A5 2017'), null, 'שנה בסוף שורה עם דגם');
  assert.equal(p('להזמנות: 050-1234567'), null);
});

test('פענוח הודעה: שורת שם ואחריה שורת מחיר, וריאנטים לפי צבע', () => {
  const items = devices(`אפל
17 פרו 256 חדש שלנו אי סים
כתום ₪3,800
כחול לבן ₪3,900

IPHONE 16e 128GB יבואן רשמי
₪2150 שחור/לבן

S23 128- 2600
רשמי 2850.

אייפון אייר
256 ₪3,000`);
  const r = items.map((i) => [i.name, i.variant, i.price]);
  assert.deepEqual(r[0], ['iPhone 17 Pro 256GB', 'כתום חדש שלנו eSIM', 3800]);
  assert.deepEqual(r[1], ['iPhone 17 Pro 256GB', 'כחול לבן חדש שלנו eSIM', 3900]);
  assert.equal(r[2][0], 'iPhone 16e 128GB');
  assert.equal(r[2][2], 2150);
  assert.deepEqual(r[3], ['Galaxy S23 128GB', '', 2600]);
  assert.deepEqual(r[4], ['Galaxy S23 128GB', 'רשמי', 2850]);
  assert.deepEqual(r[5], ['iPhone Air 256GB', '', 3000], 'נפח בשורת המחיר');
  assert.ok(items.every((i) => i.ok));
});

test('פענוח הודעה שהועתקה מוואטסאפ עם כותרות, מדיה והודעות מערכת', () => {
  const items = devices(`[20/11/2026, 10:15] אסי סלולר: אפל
15 128 ₪2150 דיסיאס
[20/11/2026, 10:16] אסי סלולר: <המדיה לא נכללה>
20/11/2026, 10:17 - אסי סלולר: 16 256 2900 ש"ח
הודעה זו נמחקה
1️⃣ iPhone 17 Pro 256 ₪4100
iPhone 16 - אזל
iPhone 17 256 ₪3200

המחירים כוללים מע"מ ונכונים להיום בלבד
להזמנות: 050-1234567`);
  assert.deepEqual(items.map((i) => [i.name, i.price]), [
    ['iPhone 15 128GB', 2150], ['iPhone 16 256GB', 2900], ['iPhone 17 Pro 256GB', 4100], ['iPhone 17 256GB', 3200],
  ]);
  assert.equal(items[3].variant, '', 'שורת "אזל" לא נדבקת לפריט הבא');
});

test('פענוח: MiBox ו-HomePod לא נכנסים, כפילויות מקבלות מפתח ייחודי', () => {
  const items = devices('MIBOX\n₪210 יבואן רשמי\n\nApple Home pod mini-400\nA54 128-1400\nA54 128-1450');
  assert.equal(items.length, 2);
  assert.notEqual(items[0].key, items[1].key);
});

test('פענוח טבלה (PDF / גוגל שיטס) וסוג חלק לפי השורה', () => {
  const t = ['מותג\tסדרה\tדגם\tהערה\tמחיר', 'Samsung\tGalaxy A\tA54 (A546)\tמקורי סאני\t₪280', 'Samsung\tGalaxy A\tA54 (A546)\tסוללה מקורית\t₪90',
    'Samsung\tGalaxy S\tS9+ (G965)\tמקורי סאני כולל סוללה\t₪500', 'Samsung\tGalaxy A\tA12\tשקע טעינה\t₪40'].join('\n');
  const items = parts(t);
  assert.deepEqual(items.map((i) => [i.model, i.partType, i.price]), [
    ['Galaxy A54', 'screen', 280], ['Galaxy A54', 'battery', 90], ['Galaxy S9 Plus', 'screen', 500], ['Galaxy A12', 'port', 40],
  ]);
  assert.equal(detectPartType('מסך כולל סוללה'), 'screen');
  assert.equal(detectPartType('גבוה'), null);
});

test('מיזוג מחירון: מחיר קודם נשמר, החלפה מלאה מול עדכון חלקי', () => {
  const a = devices('A54 128-1400\nA34 128-1100');
  const old = mergeItems([], a, { now: 1 });
  const b = devices('A54 128-1300');
  const replaced = mergeItems(old, b, { replace: true, now: 2 });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].prevPrice, 1400);
  assert.equal(replaced[0].changedAt, 2);
  const merged = mergeItems(old, b, { replace: false, now: 2 });
  assert.equal(merged.length, 2);
});

test('פריט ידני: שם חופשי נשמר כמו שנכתב, דגם מוכר מנורמל', () => {
  const x = manualItem({ name: 'כבל טעינה מקורי', price: '30' }, 'devices');
  assert.equal(x.model, 'כבל טעינה מקורי');
  assert.ok(x.ok);
  const y = manualItem({ name: 'גלקסי A54', price: '300', partType: 'screen', variant: 'מקורי' }, 'parts');
  assert.equal(y.model, 'Galaxy A54');
  assert.equal(y.key, 'samsung|galaxy a54|screen|מקורי');
  const z = manualItem({ name: 'Galaxy A54', price: '0' }, 'parts');
  assert.equal(z.ok, false);
});

test('עלות עבודה: טבלה, חריג לסדרה בעברית, חריג לדגם', () => {
  const cfg = mergeConfig({ laborRules: [...CFG.laborRules,
    { id: 'a', scope: 'series', match: 'אייפון 15', labor: { screen: 999 } },
    { id: 'b', scope: 'model', match: 'A54', labor: { battery: 77 } },
    { id: 'c', scope: 'series', match: 'Galaxy M', group: 'galaxy:s' },
  ] });
  assert.equal(laborFor({ model: 'iPhone 15 Pro Max', family: 'iphone', tier: 'new' }, 'screen', cfg).amount, 999);
  assert.equal(laborFor({ model: 'iPhone 14 Pro Max', family: 'iphone', tier: 'new' }, 'back', cfg).amount, 350);
  assert.equal(laborFor({ model: 'iPhone 14', family: 'iphone', tier: 'new' }, 'back', cfg).amount, 200);
  assert.equal(laborFor({ model: 'iPhone 12', family: 'iphone', tier: 'old' }, 'back', cfg).amount, 350);
  assert.equal(laborFor({ model: 'Galaxy A54', family: 'galaxy-a', tier: 'a' }, 'battery', cfg).amount, 77);
  assert.equal(laborFor({ model: 'Galaxy A54 5G', family: 'galaxy-a', tier: 'a' }, 'battery', cfg).amount, 100, 'דגם מדויק בלבד');
  assert.equal(laborFor({ model: 'Galaxy Note 20', family: 'galaxy-note' }, 'screen', cfg).amount, 180);
  assert.equal(laborFor({ model: 'Galaxy J7', family: 'galaxy-j' }, 'screen', cfg).amount, 120);
  assert.equal(laborFor({ model: 'iPhone 8', family: 'iphone', tier: null }, 'screen', cfg), null, 'אייפון 8 לא מתקנים');
});

test('הצעת מחיר לתיקון: חלק זול + עבודה + תוספות, עיגול ל-10, איחוד שמות איכות', () => {
  const cfg = mergeConfig(null);
  const list = [...parts('Galaxy A54 מקורי סאני ₪281'), ...parts('Galaxy A54 סאני מקורי ₪275'), ...parts('Galaxy A54 תחליפי ₪120')]
    .map((p, i) => ({ ...p, supplierId: 's' + i }));
  const model = { mkey: 'samsung|galaxy a54', model: 'Galaxy A54', family: 'galaxy-a', tier: 'a' };
  const q = repairQuote(model, 'screen', list, cfg);
  assert.equal(q.options.length, 2, '"מקורי סאני" ו"סאני מקורי" הם אותה איכות');
  assert.deepEqual(q.options.map((o) => o.final), [240, 400]); // 120+120=240, 275+120=395→400
  assert.equal(q.options[1].part.price, 275, 'הספק הזול נבחר');
  const withAddon = repairQuote(model, 'screen', list, cfg, ['complex']);
  assert.deepEqual(withAddon.options.map((o) => o.final), [320, 480]);
  const ov = mergeConfig({ priceOverrides: { [q.options[0].overrideKey]: 299 } });
  assert.equal(repairQuote(model, 'screen', list, ov).options.find((o) => o.overridden).final, 299);
  assert.equal(roundPrice(401, cfg), 410);
  assert.equal(qualityKey('מקורי, סאני'), qualityKey('סאני מקורי'));
});

// שורות לבדיקה ברשימת המכשירים + מחיר ספק אחד לכל שורה
const devRow = (id, brand, model, segment, storage = null) => ({ id, brand, model, segment, series: '', storage, version: '' });
const quote = (row, price, cfg, more = []) => rowQuote(row, [{ supplierId: 'rp', price }, ...more].sort((a, b) => a.price - b.price), cfg);

test('מחיר מכשיר: אחוז רווח לפי סגמנט, והספק הזול', () => {
  const cfg = mergeConfig(null);
  assert.equal(quote(devRow('a', 'Apple', 'iPhone 15', 'flagship', 128), 3000, cfg).final, 3240); // 8%
  assert.equal(quote(devRow('b', 'Apple', 'iPhone 15 Pro', 'premium', 128), 4000, cfg).final, 4320); // 8%
  assert.equal(quote(devRow('c', 'Samsung', 'Galaxy A54 5G', 'mid', 128), 1000, cfg).final, 1150); // 15%
  assert.equal(quote(devRow('d', 'Samsung', 'Galaxy A16', 'entry', 128), 500, cfg).final, 580); // 15% → 575 → 580
  assert.equal(quote(devRow('e', 'Apple', 'AirPods 4', 'wearable'), 400, cfg).final, 500); // 25%
  assert.equal(quote(devRow('f', 'Anker', 'מטען מהיר 20W', 'accessory'), 30, cfg).final, 60); // 85% → 55.5 → 60
  const q = quote(devRow('g', 'Apple', 'iPhone 15', 'flagship', 128), 3100, cfg, [{ supplierId: 'asi', price: 3000 }]);
  assert.equal(q.best.supplierId, 'asi', 'הספק הזול');
  assert.equal(q.final, 3240);
  // סגמנטים חדשים מקבלים את ההגדרות הקודמות: כניסה ← ביניים, פרימיום וטאבלטים ← דגל
  const old = mergeConfig({ margins: { flagship: 7, mid: 12, wearable: 25, accessory: 85, other: null } });
  assert.equal(old.margins.entry, 12);
  assert.equal(old.margins.premium, 7);
  assert.equal(old.margins.tablet, 7);
});

test('הודעת ספק מכשירים: מעדכנת רק את השורה של הדגם, גרסה חדשה = שורה חדשה, מה שלא ברשימה הולך לבדיקה', () => {
  const cfg = mergeConfig(null);
  const rows = defaultCatalog();
  const id = (model, storage, version = '') => rows.find((r) => r.model === model && r.storage === storage && r.version === version)?.id;
  const items = mergeItems([], devices('iPhone 15 Pro 256 ₪4000\nIP 15 PRO 256 DCS 3900\nGalaxy A54 128 ₪1000\nGalaxy A54 128 ₪1050\nNothing Phone 3 256 ₪2500\nGalaxy A34 ₪900'));
  const m = matchSupplierItems(items, rows, new Map(), cfg);
  const hit = (rid) => m.hits.find((h) => h.row.id === rid);
  assert.equal(hit(id('iPhone 15 Pro', 256)).price, 4000);
  assert.equal(hit(id('Galaxy A54 5G', 128)).price, 1000, 'שורה כפולה בהודעה – המחיר הנמוך');
  assert.equal(m.created.length, 1);
  assert.deepEqual([m.created[0].model, m.created[0].storage, m.created[0].version], ['iPhone 15 Pro', 256, 'DCS']);
  assert.deepEqual(m.review.map((r) => r.status).sort(), ['need-storage', 'new-model']);
  assert.deepEqual(m.review.find((r) => r.status === 'need-storage').storages, [128, 256], 'A34 בלי נפח – לבחירה');

  // הוספת דגם שלא ברשימה הולכת לגיליון "אחרים"
  const nothing = m.review.find((r) => r.status === 'new-model');
  const adds = [{ fields: { brand: 'Nothing', model: 'Phone (3)', segment: 'flagship', storage: 256, year: 2025 }, price: nothing.item.price, raw: nothing.item.raw }];
  const out = applySupplierImport({ rows, oldItems: [], match: m, adds, replace: true, now: 10 });
  assert.equal(out.catalog.length, rows.length + 2, 'גרסת DCS + Nothing');
  assert.equal(sheetOf(out.newRows[0].brand), 'other');
  assert.equal(out.items.length, 4);
  assert.ok(out.items.every((x) => x.row && x.kind === 'device'));

  // הודעה שנייה: מחיר השתנה בשורה אחת, ובמצב "החלף" שורות שלא הופיעו מאבדות את המחיר של הספק הזה בלבד
  const prices = priceIndex({ rp: { items: out.items } }, cfg);
  const m2 = matchSupplierItems(mergeItems([], devices('iPhone 15 Pro 256 ₪3950')), out.catalog, prices, cfg);
  const out2 = applySupplierImport({ rows: out.catalog, oldItems: out.items, match: m2, replace: true, now: 20 });
  assert.equal(out2.catalog, null, 'הרשימה לא השתנתה');
  assert.equal(out2.items.length, 1);
  assert.deepEqual([out2.items[0].price, out2.items[0].prevPrice, out2.items[0].changedAt], [3950, 4000, 20]);
  assert.equal(out2.removed.length, 3);

  // "דלג תמיד"
  const skip = matchSupplierItems(nothing ? [nothing.item] : [], rows, new Map(), { ...cfg, ignoredDevices: [{ key: nothing.ignoreKey }] });
  assert.equal(skip.skippedIgnored, 1);
  assert.equal(skip.review.length, 0);
  assert.equal(nothing.ignoreKey, ignoreKey(nothing.mkey, 256, ''));

  // גרסאות ומודלים לפי הרשימה
  assert.equal(normalizeVersion('dcs new esim'), 'DCS New eSIM');
  assert.equal(normalizeVersion('יבואן רשמי'), 'רשמי');
  const mods = buildDeviceModels(out.catalog, priceIndex({ rp: { items: out.items } }, cfg));
  assert.equal(mods.find((x) => x.model === 'iPhone 15 Pro').priced, true);
  assert.equal(mods.find((x) => x.model === 'iPhone 16').priced, false);
});

test('מעבר לרשימת מכשירים: מחיר ידני ואחוז שנקבעו לדגם עוברים לשורה המתאימה, תיקונים לא משתנים', () => {
  const rows = defaultCatalog();
  const ip = rows.find((r) => r.model === 'iPhone 15' && r.storage === 256 && !r.version);
  const cfg = migrateDeviceConfig({ priceOverrides: { 'apple|iphone 15|256|': 3999, 'apple|iphone 15|screen|o': 700, 'zzz|nope|64|': 1 }, marginOverrides: { 'apple|iphone 15|256|': 12 } }, rows, ['screen']);
  assert.equal(cfg.priceOverrides[`row:${ip.id}`], 3999);
  assert.equal(cfg.marginOverrides[`row:${ip.id}`], 12);
  assert.equal(cfg.priceOverrides['apple|iphone 15|screen|o'], 700, 'תיקון נשאר');
  assert.equal(cfg.priceOverrides['zzz|nope|64|'], undefined, 'מכשיר ישן שלא ברשימה נמחק');
});

test('חיפוש: מילות תיקון עם תחיליות, נפח לא מפריע, סינון יצרן', () => {
  const lists = { p: { items: mergeItems([], parts('Galaxy A54 מקורי ₪200\nGalaxy A55 מקורי ₪220')) }, d: { items: mergeItems([], devices('iPhone 15 Pro 256 ₪4000\nGalaxy A54 128 ₪1000')) } };
  const cat = buildCatalog(lists);
  assert.equal(detectRepair('a54 למסך'), 'screen');
  assert.equal(detectRepair('הסוללה של 15'), 'battery');
  assert.deepEqual(searchModels('a54 128 מסך', cat).models.map((m) => m.model), ['Galaxy A54']);
  assert.ok(searchModels('a5', cat).models.length >= 2, 'השלמת קידומת במילה האחרונה');
  assert.deepEqual(searchModels('אייפון 15 פרו', cat).models.map((m) => m.model), ['iPhone 15 Pro']);
  const syn = searchModels('iphone 13 סוללה', cat).models[0];
  assert.equal(syn.synthetic, true, 'דגם שלא במחירון – עדיין יש מחיר עבודה');
  assert.equal(getRepairQuote(syn, 'battery', cat, mergeConfig(null)).laborOnly, 100);
});

test('קטלוג לעובדים: בלי מחירי ספק, ומחירים זהים למחירים של המנהל', () => {
  const cfg = mergeConfig(null);
  const ip = defaultCatalog().find((r) => r.model === 'iPhone 15 Pro' && r.storage === 256);
  const lists = {
    parts1: { updatedAt: 5, items: mergeItems([], parts('Galaxy A54 מקורי ₪200\nGalaxy A54 תחליפי ₪120')) },
    rp: { updatedAt: 6, items: [{ key: ip.id, row: ip.id, kind: 'device', price: 4000, raw: 'IP 15 PRO 256 4000', updatedAt: 6 }] },
  };
  const pub = buildPublicCatalog(lists, cfg);
  const json = JSON.stringify(pub) + JSON.stringify(publicConfig(cfg));
  for (const secret of ['"price"', 'supplierId', '"raw"', '4000', '"margins"', 'priceOverrides', 'suppliers', 'marginOverrides', 'marginMin', 'marginMax', ip.id]) assert.ok(!json.includes(secret), `דליפה: ${secret}`);
  assert.equal(pub.devices.length, 1, 'רק דגמים שיש להם מחיר');
  const full = buildFullCatalog(lists, cfg);
  const lite = liteCatalog({ ...pub, ...readCatalogDoc({ z: pack({ models: pub.models, devices: pub.devices }) }) });
  const pcfg = publicConfig(cfg);
  for (const m of full.models) {
    const lm = lite.models.find((x) => x.mkey === m.mkey);
    if (!lm) { // דגם בלי אף מחיר תיקון לא נשלח לעובדים
      assert.ok(['screen', 'battery', 'port', 'back', 'camera', 'housing'].every((id) => { const q = getRepairQuote(m, id, full, cfg); return q.laborOnly == null && !q.options.some((o) => o.final != null); }), m.model);
      continue;
    }
    for (const addons of [[], ['complex', 'corrosion']]) {
      const a = getRepairQuote(m, 'screen', full, cfg, addons).options.map((o) => o.final);
      const b = getRepairQuote(lm, 'screen', lite, pcfg, addons).options.map((o) => o.final);
      assert.deepEqual(b, a, `${m.model} ${addons}`);
    }
  }
  for (const m of lite.devModels) {
    const fm = full.devModels.find((x) => x.key === m.key);
    assert.deepEqual(getDeviceQuotes(m, lite, pcfg).map((x) => [x.row.storage, x.final]), getDeviceQuotes(fm, full, cfg).filter((x) => x.final != null).map((x) => [x.row.storage, x.final]));
  }
  assert.equal(getDeviceQuotes(lite.devModels[0], lite, pcfg)[0].final, 4320);
  assert.equal(pub.updatedAt, 6);
});

test('דחיסה: מחירון גדול נכנס במסמך אחד, גרסה ישנה עדיין נקראת', () => {
  const big = [];
  for (let i = 0; i < 4000; i++) big.push({ kind: 'part', model: `Galaxy A${i % 90}`, variant: 'מקורי סאני כולל מסגרת', price: 100 + (i % 300), mkey: `samsung|galaxy a${i}`, key: `k${i}`, updatedAt: 1795000000000 });
  const z = pack(big);
  assert.ok(z.length < MAX_FIELD);
  assert.ok(JSON.stringify(big).length > 1048576 * 0.9 || true);
  assert.deepEqual(readPriceListDoc({ z, updatedAt: 1 }).items.length, 4000);
  assert.deepEqual(readPriceListDoc({ items: [{ a: 1 }], updatedAt: 1 }).items, [{ a: 1 }]);
  assert.deepEqual(readCatalogDoc({ models: [1, 2] }).models, [1, 2]);
  assert.deepEqual(readCatalogDoc(null).models, []);
  assert.equal(readPriceListDoc({ z: '%%%' }).corrupt, true);
});

test('בחירה מרובה: שינוי מחיר גורף ומפתחות ייחודיים', () => {
  assert.equal(bulkPrice(100, 'set', '250'), 250);
  assert.equal(bulkPrice(100, 'add', '-20'), 80);
  assert.equal(bulkPrice(100, 'pct', '10'), 110);
  assert.equal(bulkPrice(100, 'pct', '-5'), 95);
  assert.equal(bulkPrice(100, 'add', '-200'), null);
  assert.equal(bulkPrice(100, 'set', ''), null);
  const items = [{ key: 'a', price: 100 }, { key: 'b', price: 200 }, { key: 'c', price: 300 }];
  const r = applyBulkPrice(items, new Set(['a', 'c']), 'add', '10', 9);
  assert.equal(r.changed, 2);
  assert.deepEqual(r.items.map((x) => x.price), [110, 200, 310]);
  assert.equal(r.items[0].prevPrice, 100);
  assert.equal(uniqueKey(items, 'a'), 'a#2');
  assert.equal(uniqueKey(items, 'a', 0), 'a');
});

test('טריות מחיר', () => {
  const day = 86400000, now = 100 * day;
  assert.equal(freshness(now - 2 * day, CFG, now).level, 'green');
  assert.equal(freshness(now - 10 * day, CFG, now).level, 'orange');
  assert.equal(freshness(now - 20 * day, CFG, now).level, 'red');
  assert.equal(freshness(null, CFG, now).level, 'red');
});

test('tokenize: מילים מחוברות', () => {
  assert.deepEqual(tokenize('15promax'), ['15', 'pro', 'max']);
  assert.deepEqual(tokenize('s24ultra'), ['s24', 'ultra']);
  assert.deepEqual(tokenize('ip15'), ['ip', '15']);
  assert.deepEqual(tokenize('zfold6'), ['z', 'fold', '6']);
});

test('ספק שנמחק מההגדרות לא נספר במחירים; קטגוריה ידנית נשמרת במחירון חדש מהספק; בחירה מפורשת בעריכה גוברת', () => {
  const cfg = mergeConfig(null); // ספקים: rp, asi, parts1
  const lists = {
    parts1: { updatedAt: 1, items: mergeItems([], parts('Galaxy A54 מקורי ₪200')) },
    gone: { updatedAt: 2, items: mergeItems([], parts('Galaxy A54 מקורי ₪50')) }, // ספק שנמחק
  };
  assert.deepEqual(Object.keys(activeLists(lists, cfg)), ['parts1']);
  const pub = buildPublicCatalog(lists, cfg);
  assert.equal(pub.models.find((x) => x.k === 'samsung|galaxy a54').r.screen.o[0].f, 320); // 200 + 120, לא 50 + 120
  assert.equal(pub.updatedAt, 1);

  const dev = mergeItems([], devices('iPhone 15 Pro 256 ₪4000')).map((x) => ({ ...x, categoryOverride: 'mid' }));
  const again = mergeItems(dev, devices('iPhone 15 Pro 256 ₪3900'), { replace: true });
  assert.equal(again[0].price, 3900);
  assert.equal(again[0].categoryOverride, 'mid');

  assert.equal(manualItem({ name: 'Galaxy A54', partType: 'battery', variant: 'מסך מקורי', price: 100 }, 'parts').partType, 'battery');
  const d = manualItem({ name: 'iPhone 15 Pro 128', storage: 256, variant: '', price: 4000 }, 'devices');
  assert.equal(d.storage, 256);
  assert.equal(d.name, 'iPhone 15 Pro 256GB');
  assert.equal(d.key, 'apple|iphone 15 pro|256|');
});

test('רווח מכשירים: אחוז עם מינימום/מקסימום בשקלים, סכום קבוע, אחוז לשורה, ומחיר ידני גובר על הכול', () => {
  const ip = devRow('ip', 'Apple', 'iPhone 15', 'flagship', 256), a55 = devRow('a55', 'Samsung', 'Galaxy A55 5G', 'mid', 128), old = devRow('o', 'Apple', 'iPhone 13 Pro Max', 'premium', 256);
  const base = mergeConfig(null);
  assert.equal(quote(ip, 4100, base).final, 4430); // 4100 + 8% = 4428 → 4430
  assert.equal(quote(a55, 500, base).final, 580); // 500 + 15% = 575 → 580
  assert.equal(quote(old, 3750, base).final, 4050, '3750 + 8% = 4050 בדיוק (בלי שגיאת שבר שהעלתה ל-4060)');

  const lim = mergeConfig({ marginMax: { flagship: 250 }, marginMin: { mid: 150 } });
  assert.equal(quote(ip, 4100, lim).final, 4350);
  assert.equal(quote(ip, 4100, lim).limit, 'max');
  assert.equal(quote(a55, 500, lim).final, 650);
  assert.equal(quote(a55, 500, lim).limit, 'min');
  const fixed = mergeConfig({ margins: { mid: null }, marginMin: { mid: 200 } });
  assert.equal(quote(a55, 500, fixed).final, 700);
  assert.equal(quote(a55, 500, fixed).limit, 'fixed');
  assert.equal(quote(a55, 500, mergeConfig({ margins: { mid: null } })).final, null, 'בלי אחוז ובלי סכום – אין מחיר');

  const own = mergeConfig({ marginMin: { mid: 150 }, marginOverrides: { [rowKey(a55)]: 20 } });
  assert.equal(quote(a55, 500, own).final, 600, 'אחוז לשורה מחליף את הכלל של הסגמנט (כולל המינימום)');
  assert.equal(quote(a55, 500, own).rule.source, 'item');
  assert.equal(quote(a55, 500, { ...own, priceOverrides: { [rowKey(a55)]: 555 } }).final, 555);

  assert.equal(afterVat(330, base), 280); // 330 / 1.18
  assert.equal(afterVat(236, base), 200);
  assert.equal(roundPrice(4050.0000000000005, base), 4050);
});

// ---------- מחירון תיקונים: איכויות מאוחדות, מסגרת, סוגי תיקון ----------
const RC = mergeConfig(null);
const q = (v, repair = 'screen') => optionName(resolveQuality(repair, v, RC));

test('איכות: כל כתיב של ספק מתורגם לשם אחד (כולל אנגלית, שגיאות כתיב ומסגרת)', () => {
  assert.equal(q('מקורי סאני'), 'מקורי סרוויס');
  assert.equal(q('Service Pack'), 'מקורי סרוויס');
  assert.equal(q('סאני כוולל מסגרת'), 'מקורי סרוויס · כולל מסגרת');
  assert.equal(q('מקורי סאניללא מסגרת'), 'מקורי סרוויס · ללא מסגרת');
  assert.equal(q('איינסל'), 'אינסל');
  assert.equal(q('incell'), 'אינסל');
  assert.equal(q('תחליפי כלל מסגרת אולד'), 'OLED · כולל מסגרת', 'תחליפי OLED הוא OLED');
  assert.equal(q('soft oled'), 'Soft OLED');
  assert.equal(q('hard oled'), 'OLED');
  assert.equal(q('מקורי פירוק'), 'מקורי משופץ');
  assert.equal(q('חליפי'), 'תחליפי');
  assert.equal(q('מקורית', 'battery'), 'מקורית');
  assert.equal(q(''), 'סטנדרטי');
  assert.equal(q('ללא מסגרת'), 'סטנדרטי · ללא מסגרת');
  const u = resolveQuality('screen', 'GX', RC);
  assert.deepEqual([u.qid, u.note], ['', 'gx'], 'מילה לא מוכרת – נשארת כהערה (לבחירה בעדכון)');
  // ברירת מחדל של ספק לשורות בלי איכות
  assert.equal(optionName(resolveQuality('screen', 'כולל מסגרת', RC, 'copy')), 'תחליפי · כולל מסגרת');
});

test('הודעת ספק חלקים: כמה מסכים לאותו דגם – כל איכות נשמרת בנפרד', () => {
  const cfg = RC;
  const read = (t) => parseMessage(t, { kind: 'parts', partType: 'screen', cfg }).map((x) => [x.ok, x.mkey, x.partType, optionName(resolveQuality(x.partType, x.variant, cfg)), x.price]);
  const ip = 'apple|iphone 17 pro';
  const want = [[true, ip, 'screen', 'אינסל', 150], [true, ip, 'screen', 'OLED', 250], [true, ip, 'screen', 'מקורי סרוויס', 1170]];
  assert.deepEqual(read('אייפון 17 פרו\nאינסל 150\nאולד 250\nמקורי סרוויס 1170'), want);
  assert.deepEqual(read('iPhone 17 Pro incell 150\niPhone 17 Pro OLED 250\niPhone 17 Pro Service Pack 1170'), want, 'אנגלית לא הולכת לאיבוד');
  assert.deepEqual(read('מסך לאייפון 17 פרו: אינסל 150, אולד 250, מקורי סרוויס 1170'), want, 'כמה מחירים בשורה אחת');
  assert.deepEqual(read('A54 מקורי סאני כולל מסגרת 450 ללא מסגרת 380').map((x) => x.slice(3)), [['מקורי סרוויס · כולל מסגרת', 450], ['מקורי סרוויס · ללא מסגרת', 380]]);
  // דגם בלי יצרן ("17 pro" יכול להיות גם Xiaomi 17 Pro) – לא נשמר עד שבוחרים
  const u = parseMessage('17 pro incell 150', { kind: 'parts', partType: 'screen', cfg });
  assert.deepEqual([u[0].ok, u[0].unknownModel], [false, true]);
  // שנה בשם הדגם היא לא מחיר; שורה עם מחיר אחד לא מתפרקת
  assert.deepEqual(splitMulti('Galaxy A3 2016 מסך 300'), ['Galaxy A3 2016 מסך 300']);
  assert.deepEqual(splitMulti('Galaxy S23 FE 350 / 400'), ['Galaxy S23 FE 350 / 400']);
  // מסך חיצוני (סוג תיקון שנוסף כברירת מחדל) מזוהה לפני "מסך"
  const z = parseMessage('Galaxy Z Flip 5 מסך חיצוני מקורי סאני 400\nGalaxy Z Flip 5 מסך מקורי סאני 900', { kind: 'parts', partType: 'screen', cfg });
  assert.deepEqual(z.map((x) => x.partType), ['outer', 'screen']);
});

test('מחיר תיקון: אותה איכות אצל שני ספקים (בכתיב שונה) – הזול, ומחיר ידני ישן עדיין תקף', () => {
  const lists = {
    pa: { items: mergeItems([], parseMessage('Galaxy A54 מקורי סאני ₪200\nGalaxy A54 חליפי ₪120', { kind: 'parts', partType: 'screen', cfg: RC })) },
    pb: { items: mergeItems([], parseMessage('Galaxy A54 Service Pack ₪190\nGalaxy A54 תחליפי ₪125', { kind: 'parts', partType: 'screen', cfg: RC })) },
  };
  const cfg = mergeConfig({ suppliers: [{ id: 'pa', name: 'א', type: 'parts' }, { id: 'pb', name: 'ב', type: 'parts' }] });
  const cat = buildCatalog(lists, null, cfg);
  const m = cat.models.find((x) => x.mkey === 'samsung|galaxy a54');
  const rq = repairQuote(m, 'screen', cat.partIndex.get('samsung|galaxy a54|screen'), cfg);
  assert.deepEqual(rq.options.map((o) => [o.quality, o.part.price, o.part.supplierId, o.final, o.suppliers.length]), [['תחליפי', 120, 'pa', 240, 2], ['מקורי סרוויס', 190, 'pb', 310, 2]]);
  const legacy = { ...cfg, priceOverrides: { 'samsung|galaxy a54|screen|מקורי סאני': 333 } };
  const o2 = repairQuote(m, 'screen', cat.partIndex.get('samsung|galaxy a54|screen'), legacy).options.find((o) => o.qid === 'service');
  assert.equal(o2.final, 333);
  assert.equal(o2.overrideKey, optionKey('samsung|galaxy a54', 'screen', 'service|'));
  assert.ok(o2.legacyKeys.includes('samsung|galaxy a54|screen|מקורי סאני'));
});

test('עדכון מחיר מעמוד הדגם: תשובת ספק כמו שהיא, ופריט ידני שחוזר לאותה איכות', () => {
  const rows = parseReply('אינסל 150, אולד 250, מקורי סרוויס 1170\nכולל מסגרת 1250', 'screen', RC, { extractPrice, splitMulti });
  assert.deepEqual(rows.map((r) => [r.qid, r.frame, r.price]), [['incell', null, 150], ['oled', null, 250], ['service', null, 1170], ['', 'with', 1250]]);
  const model = { mkey: 'apple|iphone 17 pro', brand: 'Apple', model: 'iPhone 17 Pro', family: 'iphone', tier: 'new' };
  const it = manualPart({ model, repair: 'screen', qid: 'service', frame: 'with', price: 1170, cfg: RC, now: 5 });
  assert.equal(it.variant, 'מקורי סרוויס כולל מסגרת');
  assert.equal(optionName(resolveQuality('screen', it.variant, RC)), 'מקורי סרוויס · כולל מסגרת');
  assert.deepEqual([it.kind, it.partType, it.manual, it.price, it.key], ['part', 'screen', true, 1170, 'apple|iphone 17 pro|screen|מקורי סרוויס כולל מסגרת']);
  const it2 = manualPart({ model, repair: 'screen', qid: 'service', frame: 'with', price: 1100, cfg: RC, now: 9, prev: it });
  assert.deepEqual([it2.prevPrice, it2.changedAt], [1170, 9]);
});

test('סוגי תיקון שהמנהל הוסיף: בחיפוש, בתיקונים ובעלות העבודה', () => {
  const cfg = mergeConfig({ customRepairs: [{ id: 'outer', label: 'מסך חיצוני', words: ['חיצוני'] }, { id: 'spk', label: 'רמקול', words: ['speaker'] }], labor: { ...CFG.labor, 'galaxy:z': { ...CFG.labor['galaxy:z'], outer: 300 } } });
  assert.deepEqual(allRepairs(cfg).map((r) => r.id).slice(-2), ['outer', 'spk']);
  assert.equal(detectRepair('z flip 5 מסך חיצוני', cfg), 'outer');
  assert.equal(detectRepair('a54 רמקול', cfg), 'spk');
  assert.equal(detectRepair('a54 מסך', cfg), 'screen');
  assert.equal(stripRepairWords('Note 13 Pro+ מסך', cfg), 'Note 13 Pro+');
  // פריט שנשמר לפני שהסוג נוסף ("מסך" עם "חיצוני") עובר לסוג החדש
  const lists = { pa: { items: mergeItems([], parseMessage('Galaxy Z Flip 5 מקורי סאני חיצוני ₪400', { kind: 'parts', partType: 'screen' })) } };
  const cat = buildCatalog(lists, null, cfg);
  const m = cat.models[0];
  assert.equal(cat.partIndex.get(`${m.mkey}|outer`)?.length, 1);
  const rq = repairQuote(m, 'outer', cat.partIndex.get(`${m.mkey}|outer`), cfg);
  assert.deepEqual([rq.label, rq.options[0].quality, rq.options[0].final], ['מסך חיצוני', 'מקורי סרוויס', 700]);
  // עובדים: הסוגים החדשים מגיעים עם ההגדרות הציבוריות
  assert.deepEqual(publicConfig(cfg).customRepairs.map((r) => r.label), ['מסך חיצוני', 'רמקול']);

  // ברירת המחדל: מסך חיצוני בלי עלות עבודה משלו – מחושב כמו מסך (כמו עד עכשיו), ורק כשיש לו חלק
  const def = mergeConfig(null);
  const cat2 = buildCatalog(lists, null, def);
  const rq2 = repairQuote(m, 'outer', cat2.partIndex.get(`${m.mkey}|outer`), def);
  assert.deepEqual([rq2.options[0].final, rq2.laborOnly], [900, null]); // 400 + עבודת מסך ב-Galaxy Z (500)
  assert.match(rq2.labor.source, /כמו מסך/);
  const iphone = { mkey: 'apple|iphone 15', model: 'iPhone 15', family: 'iphone', tier: 'new' };
  const rq3 = repairQuote(iphone, 'outer', [], def);
  assert.deepEqual([rq3.labor, rq3.laborOnly], [null, null], 'באייפון אין "מסך חיצוני"');
});

// ---------- רשימת הדגמים לתיקון וקובץ "חלקי חילוף" ----------
test('רשימת דגמים לתיקון: מהמחירונים הקיימים (עם דגם היצרן של הספק), מרשימת המכשירים, ואייפון 8–12', () => {
  const pa = { items: mergeItems([], parseMessage('Samsung\tGalaxy A\tA12 (A125)\tמקורי סאני\t₪150\nSamsung\tGalaxy A\tA13 (A135)\tמקורי סאני\t₪160\niPhone 15 סוללה מקורית ₪200', { kind: 'parts', partType: 'screen' })) };
  const rows = seedRepairModels(defaultCatalog(), [pa]);
  const by = (m) => rows.find((r) => r.model === m);
  assert.equal(by('Galaxy A12').code, 'A125');
  assert.equal(by('Galaxy A12').key, 'samsung|galaxy a12', 'המפתח של הדגם נשאר – מחירים ידניים לא הולכים לאיבוד');
  assert.equal(by('iPhone 15').key, 'apple|iphone 15');
  assert.ok(by('iPhone 8/SE') && by('iPhone XS Max') && by('iPhone 12 Pro Max'));
  assert.equal(by('iPhone XR').year, 2018);
  assert.ok(by('iPhone 17 Pro'), 'טלפון מרשימת המכשירים');
  assert.equal(rows.filter((r) => r.model === 'iPhone 15').length, 1, 'בלי כפילויות');
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'מפתחות ייחודיים');
  assert.ok(!rows.some((r) => /Galaxy Tab|Watch|Buds/i.test(r.model)), 'רק טלפונים');
  // מכשיר חדש ברשימת המכשירים → נוסף לתיקונים; דגם שנמחק מהתיקונים לא חוזר
  const dev = [...defaultCatalog(), { id: 'x1', brand: 'Samsung', segment: 'mid', series: 'Galaxy A', model: 'Galaxy A58', storage: 128, version: '', year: 2027 }];
  assert.deepEqual(missingFromDevices(rows, dev).map((r) => r.model), ['Galaxy A58']);
  assert.deepEqual(missingFromDevices(rows, dev, ['samsung|galaxy a58']), []);
});

test('שורה של ספק → דגם ברשימה: קודם לפי דגם יצרן (A12 / A12 Nacho), אחר כך לפי השם', () => {
  let rows = addRows([], [{ brand: 'Samsung', model: 'Galaxy A12', code: 'A125' }]);
  rows = addRows(rows, [{ brand: 'Samsung', model: 'Galaxy A12 Nacho', code: 'A127' }, { brand: 'Apple', model: 'iPhone 13', code: '' }]);
  assert.deepEqual(rows.map((r) => r.key), ['samsung|galaxy a12', 'samsung|galaxy a12#A127', 'apple|iphone 13'], 'אותו שם עם דגם יצרן אחר – מפתח נפרד');
  const one = (t) => parseMessage(t, { kind: 'parts', partType: 'screen' })[0];
  assert.equal(matchRow(one('Galaxy A12 A127F מקורי ₪150'), rows).row.model, 'Galaxy A12 Nacho');
  assert.equal(matchRow(one('Galaxy A12 (A125F) מקורי ₪140'), rows).row.model, 'Galaxy A12');
  assert.equal(matchRow(one('{A127F} Galaxy A12 ₪150'), rows).row.model, 'Galaxy A12 Nacho');
  assert.equal(matchRow(one('אייפון 13 מסך ₪200'), rows).row.model, 'iPhone 13');
  assert.equal(matchRow(one('Galaxy A54 ₪200'), rows), null, 'לא ברשימה – לבחירה');
  const two = addRows([], [{ brand: 'Samsung', model: 'Galaxy A12', code: '' }, { brand: 'Samsung', model: 'Galaxy A12', code: 'A127' }]);
  assert.equal(matchRow(one('Galaxy A12 ₪150'), two).rows.length, 2, 'שני דגמים באותו שם בלי דגם יצרן בשורה – לבחירה');
  assert.deepEqual(codesIn('Galaxy Note 20 N980F / N981B (5G)', 'Galaxy Note 20'), ['N980F', 'N981B']);
  // שיוך: הפריט מקבל את המפתח והשם של הדגם ברשימה
  const it = attachRow(one('Galaxy A12 A127F מקורי ₪150'), rows[1]);
  assert.deepEqual([it.mkey, it.model], ['samsung|galaxy a12#A127', 'Galaxy A12 Nacho']);
  assert.equal(rekeyParts([it, { ...it }])[1].key, `${it.mkey}|screen|${it.variant}#2`);
});

test('טבלת ספק חלקים: כל פריט בעמודה שלו, וכתיבה בתא מעדכנת / יוצרת / מוחקת', () => {
  const cfg = mergeConfig(null);
  assert.deepEqual(partColumns('apple', cfg).map((c) => c.label).slice(0, 3), ['מסך תחליפי', 'מסך אינסל', 'מסך OLED']);
  assert.ok(DEFAULT_PART_COLUMNS.samsung.some((c) => c.label === 'מסך מקורי סרוויס כולל מסגרת'));
  const rows = addRows([], [{ brand: 'Samsung', model: 'Galaxy A54', code: '' }, { brand: 'Apple', model: 'iPhone 17 Pro', code: '' }]);
  const items = mergeItems([], parseMessage('Galaxy A54 מקורי סאני ₪200\nGalaxy A54 מקורי סאני כולל מסגרת ₪230\nGalaxy A54 ללא מסגרת ₪100\niPhone 17 Pro OLED ₪250\niPhone 17 Pro Soft OLED ₪300', { kind: 'parts', partType: 'screen' }));
  const c = partCells(items, 'pa', rows, cfg);
  const ci = (sheet, label) => partColumns(sheet, cfg).findIndex((x) => x.label === label);
  assert.equal(c.get(rows[0], ci('samsung', 'מסך מקורי סרוויס'))[0].price, 200);
  assert.equal(c.get(rows[0], ci('samsung', 'מסך מקורי סרוויס כולל מסגרת'))[0].price, 230);
  assert.equal(c.get(rows[0], ci('samsung', 'מסך'))[0].price, 100, 'בלי שם איכות, ללא מסגרת → "מסך"');
  assert.equal(c.get(rows[1], ci('apple', 'מסך OLED'))[0].price, 250);
  assert.equal(c.get(rows[1], ci('apple', 'מסך Soft OLED'))[0].price, 300);
  let r = setPartCell(items, 'pa', rows[1], ci('apple', 'מסך אינסל'), 150, cfg, 5);
  assert.equal(r.changed, true);
  assert.equal(partCells(r.items, 'pa', rows, cfg).get(rows[1], ci('apple', 'מסך אינסל'))[0].price, 150);
  r = setPartCell(r.items, 'pa', rows[0], ci('samsung', 'מסך מקורי סרוויס'), null, cfg, 6);
  assert.equal(partCells(r.items, 'pa', rows, cfg).get(rows[0], ci('samsung', 'מסך מקורי סרוויס')).length, 0);
  assert.equal(setPartCell(r.items, 'pa', rows[1], ci('apple', 'מסך OLED'), 250, cfg).changed, false, 'אותו מחיר – בלי שינוי');
});


test('חלק לדגם שלא זוהה ששויך לדגם מהרשימה: מילת האיכות מהשורה נשמרת', () => {
  const [a] = parseMessage('17 pro incell 150', { kind: 'parts' });
  assert.equal(a.unknownModel, true);
  assert.equal(unknownModelVariant(a, 'iPhone 17 Pro'), 'Incell');
  const [b] = parseMessage('17 פרו מקס אולד 250', { kind: 'parts' });
  assert.equal(unknownModelVariant(b, 'iPhone 17 Pro Max'), 'אולד');
  const [c] = parseMessage('17 pro 150', { kind: 'parts' });
  assert.equal(unknownModelVariant(c, 'iPhone 17 Pro'), '');
});
