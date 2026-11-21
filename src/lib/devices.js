// רשימת המכשירים (המחירון של המכשירים למכירה): שורה לכל דגם + נפח + גרסה, בגיליונות לפי חברה.
// המחירים של כל ספק נשמרים במחירון של הספק (pricelists/<ספק>) ומצביעים על שורה ברשימה.
// הרשימה עצמה נשמרת במסמך pricelists/_catalog (כך שאותן הרשאות חלות עליה).
import { identify, modelKey, normText, searchTokens, fmtStorage } from './normalize.js';
import { profitFor, roundPrice } from './pricing.js';
import DEFAULT_ROWS from '../data/devices-default.js';

export const CATALOG_ID = '_catalog';

export const SEGMENTS = [
  { id: 'entry', label: 'מכשירי כניסה' },
  { id: 'mid', label: 'מכשירי ביניים' },
  { id: 'flagship', label: 'מכשירי דגל' },
  { id: 'premium', label: 'מכשירי פרימיום' },
  { id: 'tablet', label: 'טאבלטים' },
  { id: 'wearable', label: 'אוזניות ושעונים' },
  { id: 'accessory', label: 'אביזרים' },
];
export const segmentLabel = (id) => SEGMENTS.find((s) => s.id === id)?.label || '';
export const segmentFromLabel = (v) => {
  const s = String(v || '').trim();
  return SEGMENTS.find((x) => x.label === s || x.id === s || x.label.replace('מכשירי ', '') === s)?.id || null;
};

export const SHEETS = [
  { id: 'apple', label: 'Apple', brand: 'Apple' },
  { id: 'samsung', label: 'Samsung', brand: 'Samsung' },
  { id: 'xiaomi', label: 'Xiaomi', brand: 'Xiaomi' },
  { id: 'other', label: 'אחרים', brand: null },
];
export const sheetOf = (brand) => SHEETS.find((s) => s.brand && s.brand.toLowerCase() === String(brand || '').trim().toLowerCase())?.id || 'other';

export const defaultCatalog = () => DEFAULT_ROWS.map((r) => ({ ...r }));
export const newRowId = (n = 0) => 'd' + Date.now().toString(36) + n.toString(36) + Math.random().toString(36).slice(2, 5);

/** מפתח השוואה לדגם – אותו זיהוי שהפענוח של הודעות הספקים משתמש בו */
export function devKey(brand, model) {
  const id = identify(String(model || ''), brand || null);
  if (id.model && id.brand) return modelKey(id);
  return `${String(brand || '').trim().toLowerCase()}|${normText(model)}`;
}

// ---------- גרסה (רשמי / מקביל / Active / New / סלולר ...) ----------
const VERSION_RULES = [
  ['imp', 'רשמי', /רשמי|יבואן|סאני|official/i],
  ['imp', 'מקביל', /(^|[^a-z])pr([^a-z]|$)|פרלל|מקביל|parallel/i],
  ['imp', 'DCS', /dcs|דיסיאס/i],
  ['cond', 'New', /no\s*-?\s*active|לא\s*מוקטב|(^|[^a-z])new([^a-z]|$)|חדש/i],
  ['cond', 'Active', /active|אקטיב|מוקטב/i],
  ['net', 'סלולר', /cellular|סלולר|(^|[^a-z])lte([^a-z]|$)/i],
  ['net', 'GPS', /(^|[^a-z])gps([^a-z]|$)/i],
  ['net', 'WiFi', /wi-?fi|וויפי/i],
  ['sim', 'eSIM', /e-?sim/i],
  ['sim', 'Dual SIM', /dual\s*-?\s*sim/i],
  ['nfc', 'NFC', /(^|[^a-z])nfc([^a-z]|$)/i],
];
/** מהטקסט שליד המחיר (צבעים וכו' לא נחשבים) */
export function normalizeVersion(text) {
  const s = String(text || '');
  const got = {};
  for (const [g, label, re] of VERSION_RULES) if (!got[g] && re.test(s)) got[g] = label;
  return ['imp', 'cond', 'net', 'sim', 'nfc'].map((g) => got[g]).filter(Boolean).join(' ');
}
export const verKey = (v) => normalizeVersion(v) || String(v || '').trim().toLowerCase();

/** נפח מטקסט: "128GB", "1TB", "512", 256 → ג'יגה. ריק = null, לא תקין = NaN */
export function parseStorage(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  const s = String(v).toLowerCase().replace(/\s/g, '');
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(gb|g|ג׳?יגה|tb|t|טרה)?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  return m[2] && /^(tb|t|טרה)$/.test(m[2]) ? n * 1024 : n;
}

// ---------- הצעות לשורה חדשה (לפי הכללים של הסגמנטים) ----------
export function suggestSegment(brand, model) {
  const m = String(model || '').toLowerCase();
  if (/ipad|galaxy tab|\btab\b|\bpad\b|טאבלט/.test(m)) return 'tablet';
  if (/airpods|buds|watch|band|שעון|אוזניות|headphone|earbuds/.test(m)) return 'wearable';
  if (/airtag|smarttag|smart tag|charger|cable|case|מטען|כבל|כיסוי|מגן/.test(m)) return 'accessory';
  if (/iphone/.test(m)) {
    if (/\bse\b/.test(m)) return 'entry';
    if (/mini|\d+e\b/.test(m)) return 'mid';
    if (/pro|duo/.test(m)) return 'premium';
    return 'flagship';
  }
  if (/galaxy/.test(m) || brand === 'Samsung') {
    if (/fold|flip|ultra/.test(m)) return 'premium';
    if (/\bfe\b/.test(m)) return 'mid';
    if (/\bs\d{2}/.test(m)) return 'flagship';
    const a = m.match(/\ba(\d)\d/);
    if (a) return Number(a[1]) <= 2 ? 'entry' : 'mid';
  }
  if (/poco/.test(m)) return /ultra/.test(m) ? 'flagship' : 'mid';
  if (/redmi/.test(m)) return /note/.test(m) ? 'mid' : 'entry';
  if (/xiaomi|\bmi\b/.test(m) || brand === 'Xiaomi') return /pro|ultra/.test(m) && !/\d+t\b/.test(m) ? 'premium' : 'flagship';
  return 'mid';
}
export function suggestSeries(brand, model) {
  const m = String(model || '');
  let x;
  if ((x = m.match(/iphone\s+(\d+)/i))) return `iPhone ${x[1]}`;
  if (/iphone\s+se/i.test(m)) return 'iPhone SE';
  if ((x = m.match(/galaxy\s+(z|s|a|m|tab)\b/i))) return `Galaxy ${x[1].length > 1 ? 'Tab' : x[1].toUpperCase()}`;
  if (/redmi\s+note/i.test(m)) return 'Redmi Note';
  if (/redmi/i.test(m)) return 'Redmi';
  if (/poco/i.test(m)) return 'POCO';
  if (/xiaomi|^mi\s/i.test(m)) return 'Xiaomi';
  return brand || '';
}

// ---------- מבנה לתצוגה ולחישוב ----------

/** מחירי הספקים לכל שורה: rowId → [{ supplierId, price, updatedAt, prevPrice, changedAt }] (מהזול) */
export function priceIndex(lists, cfg) {
  const idx = new Map();
  for (const s of cfg.suppliers || []) {
    if (s.type === 'parts') continue;
    for (const it of lists?.[s.id]?.items || []) {
      if (!it.row) continue; // פריט בפורמט הישן (לפני רשימת המכשירים)
      if (!idx.has(it.row)) idx.set(it.row, []);
      idx.get(it.row).push({ ...it, supplierId: s.id });
    }
  }
  for (const arr of idx.values()) arr.sort((a, b) => a.price - b.price);
  return idx;
}

export const rowKey = (row) => `row:${row.id}`;
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** כלל הרווח לשורה: אחוז לשורה (אם נקבע) או לפי הסגמנט, עם מינימום/מקסימום בשקלים */
export function rowRule(row, cfg) {
  const own = num(cfg.marginOverrides?.[rowKey(row)]);
  if (own != null) return { pct: own, min: null, max: null, source: 'item', segment: row.segment };
  const g = row.segment;
  return { pct: num(cfg.margins?.[g]), min: num(cfg.marginMin?.[g]), max: num(cfg.marginMax?.[g]), source: 'segment', segment: g };
}

/** מחיר ללקוח לשורה */
export function rowQuote(row, prices, cfg) {
  const suppliers = prices || [];
  const best = suppliers[0] || null;
  const key = rowKey(row);
  const rule = rowRule(row, cfg);
  const pr = best ? profitFor(best.price, rule) : null;
  const computed = pr ? roundPrice(best.price + pr.amount, cfg) : null;
  const ov = num(cfg.priceOverrides?.[key]);
  const final = ov ?? computed;
  return { row, suppliers, best, rule, limit: pr?.limit ?? null, key, computed, overridden: ov != null, final, profit: final != null && best ? final - best.price : null };
}

export const rowLabel = (row) => [row.model, fmtStorage(row.storage), row.version].filter(Boolean).join(' · ');
const yearOf = (y) => num(y) ?? 9999; // בלי שנה – בראש (כנראה חדש)

/** דגמים לתצוגה: קבוצה לכל חברה + שם דגם, עם השורות (נפח / גרסה) */
export function buildDeviceModels(rows, prices) {
  const map = new Map();
  for (const r of rows || []) {
    const k = `${String(r.brand || '').toLowerCase()}|${String(r.model || '').toLowerCase()}`;
    if (!map.has(k)) {
      map.set(k, {
        key: k, mkey: k, brand: r.brand, sheet: sheetOf(r.brand), model: r.model, series: r.series, segment: r.segment, year: r.year,
        rows: [], tokens: searchTokens(`${r.brand || ''} ${r.model} ${r.series || ''}`), hasDevices: true,
      });
    }
    map.get(k).rows.push(r);
  }
  const out = [...map.values()];
  for (const m of out) {
    m.rows.sort((a, b) => (a.storage || 0) - (b.storage || 0) || String(a.version || '').localeCompare(String(b.version || ''), 'he'));
    m.segments = [...new Set(m.rows.map((r) => r.segment))];
    if (prices) m.priced = m.rows.some((r) => prices.has(r.id));
  }
  return out;
}

// סדרה עם מספר דור (iPhone 17) – החדשה קודם; סדרה בלי מספר (Galaxy A / S / Z) – לפי א"ב
const seriesCmp = (a, b) => {
  const x = String(a || ''), y = String(b || '');
  const c = x.localeCompare(y, 'en', { numeric: true });
  return /\d/.test(x) && /\d/.test(y) ? -c : c;
};
export const sortDeviceModels = (list) => [...list].sort((a, b) => yearOf(b.year) - yearOf(a.year) || seriesCmp(a.series, b.series) || String(a.model).localeCompare(String(b.model), 'en', { numeric: true }));

// ---------- התאמת שורות מהודעת ספק לרשימה ----------

export function rowIndex(rows) {
  const idx = new Map();
  for (const r of rows) {
    const k = devKey(r.brand, r.model);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(r);
  }
  return idx;
}

export const ignoreKey = (mkey, storage, ver) => `${mkey}|${storage || ''}|${ver || ''}`;

/**
 * מתאים פריטים שפוענחו מהודעת ספק מכשירים לרשימה. לא שומר כלום.
 * - נמצא דגם + נפח + גרסה → עדכון מחיר
 * - דגם + נפח קיימים, גרסה חדשה → שורת גרסה נוספת (שורה בלי גרסה ובלי מחירים "מקבלת" את הגרסה)
 * - דגם לא ברשימה / נפח שאין לדגם / בלי נפח כשיש לדגם כמה נפחים → "לא ברשימה" (הוסף / דלג / דלג תמיד)
 */
export function matchSupplierItems(items, rows, prices, cfg) {
  const idx = rowIndex(rows);
  const ignored = new Set((cfg.ignoredDevices || []).map((x) => x.key));
  const claimed = new Map(); // שורה בלי גרסה שקיבלה גרסה בפענוח הזה
  const created = [];
  const hits = new Map(); // rowId → { row, price, raw, count }
  const review = [];
  let skippedIgnored = 0;
  const hasPrices = (r) => (prices?.get(r.id) || []).length > 0;

  for (const it of items) {
    if (!it.ok) continue;
    const ver = normalizeVersion(it.variant);
    const ik = ignoreKey(it.mkey, it.storage, ver);
    if (ignored.has(ik)) { skippedIgnored++; continue; }
    const models = idx.get(it.mkey);
    const base = { item: it, ver, ignoreKey: ik, mkey: it.mkey };
    if (!models) { review.push({ ...base, status: 'new-model' }); continue; }
    let st = it.storage || null;
    const storages = [...new Set(models.map((r) => r.storage || null))];
    if (!st) {
      if (storages.length === 1) st = storages[0];
      else { review.push({ ...base, status: 'need-storage', models, storages }); continue; }
    }
    const atSt = models.filter((r) => (r.storage || null) === st);
    if (!atSt.length) { review.push({ ...base, status: 'new-storage', models, storage: st }); continue; }
    let row = atSt.find((r) => verKey(r.version) === ver && !(claimed.has(r.id) && claimed.get(r.id) !== ver));
    if (!row) {
      const blank = atSt.find((r) => !String(r.version || '').trim() && !hasPrices(r) && !claimed.has(r.id) && !hits.has(r.id));
      if (blank && ver) { claimed.set(blank.id, ver); row = { ...blank, version: ver }; replaceRow(models, row); replaceRow(atSt, row); }
      else {
        row = { ...atSt[0], id: newRowId(created.length), version: ver };
        models.push(row); created.push(row);
      }
    }
    const h = hits.get(row.id);
    if (!h || it.price < h.price) hits.set(row.id, { row, price: it.price, raw: it.raw, count: (h?.count || 0) + 1 });
    else h.count++;
  }
  return { hits: [...hits.values()], created, claimed: [...claimed.entries()].map(([id, version]) => ({ id, version })), review, skippedIgnored };
}
function replaceRow(arr, row) { const i = arr.findIndex((r) => r.id === row.id); if (i >= 0) arr[i] = row; }

/** שורה חדשה מפריט שבחרו "הוסף" (השדות כבר נערכו בממשק) */
export function rowFromReview(f, n = 0) {
  return {
    id: newRowId(n), brand: String(f.brand || '').trim(), segment: f.segment || 'mid', series: String(f.series || '').trim(),
    model: String(f.model || '').trim(), storage: num(f.storage), version: String(f.version || '').trim(), year: num(f.year), notes: String(f.notes || '').trim(),
  };
}

/** ברירת מחדל לטופס "הוסף" של פריט שלא ברשימה */
export function reviewDefaults(r) {
  const it = r.item;
  const ref = r.models?.[0];
  const brand = ref?.brand || it.brand || '';
  const model = ref?.model || it.model || it.name || '';
  return {
    brand, model,
    segment: ref?.segment || suggestSegment(brand, model),
    series: ref?.series || suggestSeries(brand, model),
    year: ref?.year ?? '',
    storage: r.storage ?? it.storage ?? (r.storages?.[0] ?? ''),
    version: r.ver || '',
    notes: '',
  };
}

/**
 * מה שנשמר מייבוא הודעת ספק מכשירים.
 * adds: פריטים מ"לא ברשימה" שבחרו להוסיף – [{ fields, price, raw }]
 * מחזיר catalog (הרשימה המעודכנת, או null אם לא השתנתה), items (המחירון של הספק), newRows, removed (שורות שהמחיר של הספק יימחק מהן)
 */
export function applySupplierImport({ rows, oldItems, match, adds = [], replace, now = Date.now() }) {
  const claimed = new Map(match.claimed.map((c) => [c.id, c.version]));
  const list = rows.map((r) => (claimed.has(r.id) ? { ...r, version: claimed.get(r.id) } : r)).concat(match.created);
  const keyOf = new Map();
  const k = (r) => { if (!keyOf.has(r.id)) keyOf.set(r.id, `${devKey(r.brand, r.model)}|${r.storage ?? ''}|${verKey(r.version)}`); return keyOf.get(r.id); };
  const newRows = [];
  const allHits = [...match.hits];
  adds.forEach((a, n) => {
    const want = rowFromReview(a.fields, n);
    let row = list.find((r) => k(r) === k(want));
    if (!row) { row = want; list.push(row); newRows.push(row); }
    allHits.push({ row, price: a.price, raw: a.raw });
  });
  const catalog = claimed.size || match.created.length || newRows.length ? list : null;

  const prev = new Map((oldItems || []).filter((x) => x.row).map((x) => [x.row, x]));
  const best = new Map();
  for (const h of allHits) { const b = best.get(h.row.id); if (!b || h.price < b.price) best.set(h.row.id, h); }
  const next = new Map();
  for (const [rowId, h] of best) {
    const o = prev.get(rowId);
    const changed = !o || o.price !== h.price;
    next.set(rowId, { key: rowId, row: rowId, kind: 'device', price: h.price, raw: h.raw || '', updatedAt: now, prevPrice: o && changed ? o.price : o?.prevPrice ?? null, changedAt: changed ? now : o.changedAt ?? now });
  }
  const exists = new Set(list.map((r) => r.id));
  const removed = [];
  for (const [rowId, o] of prev) {
    if (next.has(rowId) || !exists.has(rowId)) continue;
    if (replace) removed.push(list.find((r) => r.id === rowId));
    else next.set(rowId, o);
  }
  return { catalog, items: [...next.values()], newRows, removed };
}

/**
 * מעבר לרשימת המכשירים: מחירים ידניים ואחוזי רווח שנקבעו למכשירים בפורמט הקודם (דגם|נפח|וריאנט)
 * עוברים לשורה המתאימה ברשימה (row:<מזהה>), ומה שאין לו שורה מתאימה נמחק. מחירים ידניים של תיקונים לא נוגעים.
 */
export function migrateDeviceConfig(cfg, rows, repairIds) {
  const idx = rowIndex(rows);
  const target = (key) => {
    const p = String(key).split('|');
    if (p.length < 3 || key.startsWith('row:')) return { keep: true };
    if (repairIds.includes(p[2])) return { keep: true }; // מחיר ידני של תיקון
    if (p[2] !== '' && !/^\d+$/.test(p[2])) return { keep: true };
    const mkey = `${p[0]}|${p[1]}`, storage = p[2] ? Number(p[2]) : null, ver = normalizeVersion(p.slice(3).join('|').replace(/#\d+$/, ''));
    const row = (idx.get(mkey) || []).find((r) => (r.storage ?? null) === storage && verKey(r.version) === ver);
    return { to: row ? rowKey(row) : null };
  };
  const move = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      const t = target(k);
      if (t.keep) out[k] = v; else if (t.to && out[t.to] == null) out[t.to] = v;
    }
    return out;
  };
  return { ...cfg, priceOverrides: move(cfg.priceOverrides), marginOverrides: move(cfg.marginOverrides) };
}
