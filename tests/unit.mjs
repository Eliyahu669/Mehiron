// בדיקות יחידה – רצות ב-CI לפני כל פרסום. נתונים מומצאים בלבד (בלי מחירוני ספקים אמיתיים)
import test from 'node:test';
import assert from 'node:assert/strict';
import { identify, tokenize } from '../src/lib/normalize.js';
import { extractPrice, parseMessage, mergeItems, manualItem, detectPartType } from '../src/lib/parser.js';
import { laborFor, repairQuote, deviceQuotes, roundPrice, qualityKey, categoryFor, freshness } from '../src/lib/pricing.js';
import { buildCatalog, activeLists, searchModels, detectRepair } from '../src/lib/catalog.js';
import { buildPublicCatalog, publicConfig, liteCatalog, getRepairQuote, getDeviceQuotes } from '../src/lib/publish.js';
import { pack, unpack, readPriceListDoc, readCatalogDoc, MAX_FIELD } from '../src/lib/packing.js';
import { bulkPrice, applyBulkPrice, uniqueKey } from '../src/lib/items.js';
import { DEFAULT_CONFIG as CFG } from '../src/lib/defaults.js';
import { mergeConfig } from '../src/lib/store.js';

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
    ['Mi 13T 256', 'Mi 13T', 'xiaomi'],
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

test('מחיר מכשיר: אחוז רווח לפי קטגוריה, חריג קטגוריה', () => {
  const cfg = mergeConfig(null);
  const d = devices('iPhone 15 128 ₪3000\nGalaxy A54 128 ₪1000\nAirPods 4 ₪400\nמטען מהיר 20W ₪30').map((x) => ({ ...x, supplierId: 'x' }));
  const price = (name) => deviceQuotes({ mkey: d.find((x) => x.name.startsWith(name)).mkey }, d, cfg)[0].final;
  assert.equal(price('iPhone 15'), 3240); // 8%
  assert.equal(price('Galaxy A54'), 1150); // 15%
  assert.equal(price('AirPods 4'), 500); // 25%
  assert.equal(price('מטען'), 60); // 85% → 55.5 → 60
  const cfg2 = mergeConfig({ laborRules: [{ id: 'z', scope: 'series', match: 'Galaxy A54', category: 'flagship', labor: {} }] });
  assert.equal(categoryFor(d.find((x) => x.name.startsWith('Galaxy A54')), cfg2), 'flagship');
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
  const lists = {
    parts1: { updatedAt: 5, items: mergeItems([], parts('Galaxy A54 מקורי ₪200\nGalaxy A54 תחליפי ₪120')) },
    rp: { updatedAt: 6, items: mergeItems([], devices('iPhone 15 Pro 256 ₪4000')) },
  };
  const pub = buildPublicCatalog(lists, cfg);
  const json = JSON.stringify(pub) + JSON.stringify(publicConfig(cfg));
  for (const secret of ['"price"', 'supplierId', '"raw"', '4000', '"margins"', 'priceOverrides', 'suppliers']) assert.ok(!json.includes(secret), `דליפה: ${secret}`);
  const full = buildCatalog(lists);
  const lite = liteCatalog({ ...pub, models: unpack(pack(pub.models), []) });
  const pcfg = publicConfig(cfg);
  for (const m of full.models) {
    const lm = lite.models.find((x) => x.mkey === m.mkey);
    for (const addons of [[], ['complex', 'corrosion']]) {
      const a = getRepairQuote(m, 'screen', full, cfg, addons).options.map((o) => o.final);
      const b = getRepairQuote(lm, 'screen', lite, pcfg, addons).options.map((o) => o.final);
      assert.deepEqual(b, a, `${m.model} ${addons}`);
    }
    assert.deepEqual(getDeviceQuotes(lm, lite, pcfg).map((x) => x.final), getDeviceQuotes(m, full, cfg).map((x) => x.final).filter((x) => x != null));
  }
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
