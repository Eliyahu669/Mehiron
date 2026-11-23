// רשימת הדגמים של מחירון התיקונים (pricelists/_rmodels) – השורות של קובצי "חלקי חילוף" של כל הספקים.
// לכל דגם: חברה, שם, דגם יצרן (בסמסונג – למשל A125), שנה (למיון). key – מפתח קבוע של הדגם:
// כך נקשרים אליו מחירי החלקים, מחירים ידניים ועלות העבודה. שינוי שם או דגם יצרן לא משנה את המפתח.
import { identify, modelKey, searchTokens } from './normalize.js';
import { sheetOf } from './devices.js';

export const RMODELS_ID = '_rmodels';
const PHONE_SEGMENTS = new Set(['entry', 'mid', 'flagship', 'premium']);

// אייפונים שלפני רשימת המכשירים (2021 ואילך) – כמו בקובץ הדוגמה, עם שנת ההשקה למיון
export const OLDER_IPHONES = [
  ['iPhone 8/SE', 2017], ['iPhone 8 Plus', 2017], ['iPhone X', 2017], ['iPhone XS', 2018], ['iPhone XS Max', 2018], ['iPhone XR', 2018],
  ['iPhone 11', 2019], ['iPhone 11 Pro', 2019], ['iPhone 11 Pro Max', 2019],
  ['iPhone 12 mini', 2020], ['iPhone 12', 2020], ['iPhone 12 Pro', 2020], ['iPhone 12 Pro Max', 2020],
];

export const rmodelsOf = (lists) => lists?.[RMODELS_ID]?.items || [];
export const normCode = (s) => String(s || '').toUpperCase().replace(/^SM-?/, '').replace(/[^A-Z0-9]/g, '');
const codeList = (s) => String(s || '').split(/[\s/,;|]+/).map(normCode).filter((c) => c.length >= 3);
export const baseKey = (r) => modelKey(identify(r.model, r.brand || null));

// דגם יצרן בטקסט של ספק: "(A125)", "{F711B}", "A137F", "N975F / N976B" (אות + 3 ספרות)
const CODE_RE = /^(?:SM-?)?[A-Z]\d{3}[A-Z0-9]{0,3}$/i;
export function codesIn(text, modelName = '') {
  const own = new Set(String(modelName || '').split(/\s+/).map(normCode));
  const out = [];
  for (const t of String(text || '').split(/[\s()[\]{}/,;|]+/)) {
    if (!CODE_RE.test(t)) continue;
    const c = normCode(t);
    if (!own.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** מפתח חדש לדגם: המפתח של השם, ואם כבר תפוס (אותו שם עם דגם יצרן אחר) – עם דגם היצרן */
export function newKey(rows, row) {
  const base = baseKey(row);
  const taken = new Set(rows.map((r) => r.key));
  if (!taken.has(base)) return base;
  let k = `${base}#${normCode(row.code) || 'x'}`, n = 1;
  while (taken.has(k)) k = `${base}#${normCode(row.code) || 'x'}${++n}`;
  return k;
}
let seq = 0;
export const newRmId = () => 'm' + Date.now().toString(36) + (seq++).toString(36);

/** הדגם כמו שהקטלוג והתמחור צריכים אותו (סדרה ודור לעלות העבודה – לפי השם) */
export function modelOfRow(r) {
  const id = identify(r.model, r.brand || null);
  return {
    mkey: r.key, rid: r.id, brand: r.brand || id.brand || null, model: r.model, code: r.code || '', year: r.year ?? null, series: r.series || '',
    family: id.family, tier: id.tier, devKind: 'phone', hasParts: false, sheet: sheetOf(r.brand || id.brand),
    tokens: searchTokens(`${r.brand || ''} ${r.model} ${r.code || ''}`),
  };
}

const yearOfBase = (deviceRows) => {
  const m = new Map();
  for (const d of deviceRows || []) {
    if (!PHONE_SEGMENTS.has(d.segment)) continue;
    const k = modelKey(identify(d.model, d.brand));
    const cur = m.get(k);
    if (!cur || (d.year != null && d.year < cur.year)) m.set(k, { year: d.year ?? null, series: d.series || '', model: d.model, brand: d.brand });
  }
  return m;
};

/** הטלפונים מרשימת המכשירים שעוד אין להם שורה בתיקונים (לפי השם). removed – דגמים שהמנהל מחק מהתיקונים */
export function missingFromDevices(rows, deviceRows, removed = []) {
  const have = new Set(rows.flatMap((r) => [r.key, baseKey(r)]));
  const skip = new Set(removed);
  const out = [];
  for (const [k, d] of yearOfBase(deviceRows)) {
    if (have.has(k) || skip.has(k)) continue;
    have.add(k);
    out.push({ brand: d.brand, model: d.model, code: '', year: d.year, series: d.series });
  }
  return out;
}

/** מוסיף שורות חדשות (עם מפתח ומזהה) */
export function addRows(rows, adds) {
  const next = [...rows];
  for (const a of adds) next.push({ id: newRmId(), ...a, key: newKey(next, a) });
  return next;
}

/**
 * הרשימה ההתחלתית: הדגמים שכבר יש להם מחיר חלק (עם דגם היצרן שכתוב אצל הספק), כל הטלפונים מרשימת המכשירים,
 * ואייפון 8 עד 12. המפתחות של דגמים שכבר יש להם מחירים נשארים כמו שהם – מחירים ידניים לא הולכים לאיבוד
 */
export function seedRepairModels(deviceRows, partLists) {
  const years = yearOfBase(deviceRows);
  const byKey = new Map();
  for (const doc of partLists) {
    for (const it of doc.items || []) {
      if (it.kind !== 'part' || !it.mkey || !it.model) continue;
      const cur = byKey.get(it.mkey) || { key: it.mkey, brand: it.brand || null, model: it.model, codes: [] };
      if (/samsung/i.test(it.brand || '')) for (const c of codesIn(it.raw, it.model)) if (!cur.codes.includes(c)) cur.codes.push(c);
      byKey.set(it.mkey, cur);
    }
  }
  let rows = [...byKey.values()].map((x) => {
    const y = years.get(x.key);
    return { id: newRmId(), key: x.key, brand: x.brand, model: x.model, code: x.codes.join(' / '), year: y?.year ?? null, series: y?.series || '' };
  });
  rows = addRows(rows, missingFromDevices(rows, deviceRows));
  const have = new Set(rows.flatMap((r) => [r.key, baseKey(r)]));
  rows = addRows(rows, OLDER_IPHONES.filter(([m]) => !have.has(baseKey({ model: m, brand: 'Apple' }))).map(([model, year]) => ({ brand: 'Apple', model, code: '', year, series: '' })));
  return rows;
}

/**
 * לאיזה דגם ברשימה שייכת שורה של ספק: קודם לפי דגם יצרן (סמסונג), אחר כך לפי השם.
 * מחזיר { row } / { rows } (כמה דגמים באותו שם – לבחירה) / null (לא ברשימה)
 */
export function matchRow(item, rows) {
  const codes = codesIn(item.raw, item.model);
  if (codes.length) {
    let best = null, len = 0;
    for (const r of rows) {
      for (const rc of codeList(r.code)) {
        for (const c of codes) {
          if ((c.startsWith(rc) || rc.startsWith(c)) && rc.length > len) { best = r; len = rc.length; }
        }
      }
    }
    if (best) return { row: best };
  }
  const k = item.mkey;
  const exact = rows.find((r) => r.key === k);
  const same = rows.filter((r) => baseKey(r) === k);
  if (same.length > 1) return { rows: same };
  if (exact) return { row: exact };
  if (same.length === 1) return { row: same[0] };
  return null;
}

/** פריט חלק אחרי התאמה לדגם ברשימה: המפתח והשם של הדגם */
export function attachRow(item, row) {
  const m = modelOfRow(row);
  return { ...item, mkey: row.key, model: row.model, name: row.model, brand: m.brand, family: m.family, tier: m.tier };
}

/** מיון כמו בקובץ: לפי שנה (ישנים קודם), ובתוך שנה לפי השם */
export function sortRows(rows) {
  return [...rows].sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || String(a.model).localeCompare(String(b.model), 'en', { numeric: true }));
}

/** מפתחות מחדש אחרי שיוך לדגם ברשימה (שני פריטים זהים מקבלים #2) */
export function rekeyParts(items) {
  const seen = new Map();
  return items.map((it) => {
    const base = `${it.mkey}|${it.partType}|${it.variant}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...it, key: n > 1 ? `${base}#${n}` : base };
  });
}
