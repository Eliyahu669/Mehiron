// קטלוג דגמים מאוחד מכל הספקים + חיפוש חכם
import { identify, modelKey, searchTokens, normText, tokenize } from './normalize.js';
import { findRepairIn, effectivePartType, stripRepairWords } from './repairs.js';
import { sheetOf } from './devices.js';
import { modelOfRow, baseKey } from './rmodels.js';

/** רק מחירונים של ספקים שמוגדרים בהגדרות – ספק שנמחק לא נספר במחירים */
export function activeLists(lists, cfg) {
  const ids = new Set((cfg?.suppliers || []).map((s) => s.id));
  const out = {};
  for (const [id, doc] of Object.entries(lists || {})) if (ids.has(id)) out[id] = doc;
  return out;
}

const PHONE_SEGMENTS = new Set(['entry', 'mid', 'flagship', 'premium']);

/**
 * קטלוג התיקונים: דגמים ממחירוני ספקי החלקים, ועוד כל הטלפונים שברשימת המכשירים (rows) –
 * כדי שגם דגם בלי חלק מספק יופיע עם מחיר עבודה. המכשירים למכירה עצמם מנוהלים ב-devices.js
 */
export function buildCatalog(lists, rows = null, cfg = null, rmRows = null) {
  const parts = [];
  const models = new Map();
  // רשימת הדגמים של התיקונים קובעת את הדגמים (שם, דגם יצרן). דגם שיש לו חלק ואינו ברשימה – נוסף כמו קודם
  for (const r of rmRows || []) models.set(r.key, modelOfRow(r));
  const partIndex = new Map(); // `${mkey}|${partType}` → חלקים
  for (const [supplierId, doc] of Object.entries(lists || {})) {
    for (const it of doc.items || []) {
      if (it.kind !== 'part') continue;
      const x = { ...it, supplierId, partType: effectivePartType(it, cfg) };
      parts.push(x);
      const k = `${x.mkey}|${x.partType}`;
      if (!partIndex.has(k)) partIndex.set(k, []);
      partIndex.get(k).push(x);
      if (models.has(x.mkey)) models.get(x.mkey).hasParts = true;
      else {
        models.set(x.mkey, {
          mkey: x.mkey, brand: x.brand, model: x.model, family: x.family, tier: x.tier,
          devKind: x.devKind, hasParts: true, sheet: sheetOf(x.brand), tokens: searchTokens(`${x.brand || ''} ${x.model}`),
        });
      }
    }
  }
  const byBase = new Map();
  if (rmRows?.length) for (const m of models.values()) if (m.rid) { const b = baseKey(m); if (!byBase.has(b)) byBase.set(b, m); }
  for (const r of rows || []) {
    if (!PHONE_SEGMENTS.has(r.segment)) continue;
    if (rmRows?.length) { // הטלפונים כבר ברשימת התיקונים – רק שנה וסדרה למיון
      const m = byBase.get(modelKey(identify(r.model, r.brand)));
      if (m && m.year == null && r.year != null) { m.year = r.year; m.series = m.series || r.series || ''; }
      continue;
    }
    const id = identify(r.model, r.brand);
    const mkey = modelKey(id);
    if (!id.model) continue;
    const m = models.get(mkey);
    if (m) { // דגם שיש לו חלקים: מקבל שנה וסדרה מרשימת המכשירים (למיון)
      if (m.year == null || (r.year != null && r.year < m.year)) { m.year = r.year ?? m.year; m.series = m.series || r.series || ''; }
      continue;
    }
    models.set(mkey, {
      mkey, brand: id.brand || r.brand, model: id.model, family: id.family, tier: id.tier, year: r.year ?? null, series: r.series || '',
      devKind: 'phone', hasParts: false, sheet: sheetOf(id.brand || r.brand), tokens: searchTokens(`${id.brand || r.brand || ''} ${id.model}`),
    });
  }
  return { parts, partIndex, models: [...models.values()] };
}

// מילת תיקון בחיפוש, גם עם תחילית ("למסך", "הסוללה") וגם ביטוי של כמה מילים ("מסך חיצוני")
export function detectRepair(query, cfg = null) {
  return findRepairIn(query, cfg)?.id || null;
}



// נפח לא שייך לשם הדגם (64 ומעלה; 16/32 עלולים להיות מספר דגם כמו iPhone 16)
const isStorageTok = (t) => ['64', '128', '256', '512', '1024', 'gb', 'tb'].includes(t);

const BRAND_ORDER = { Apple: 0, Samsung: 1, Xiaomi: 2 };

export function searchModels(query, catalog, { brand = null, sheet = null, kindFilter = null, cfg = null } = {}) {
  const repair = detectRepair(query, cfg);
  const rest = stripRepairWords(query, cfg);
  const q = searchTokens(rest).filter((t) => !isStorageTok(t));
  const raw = tokenize(rest);
  if (!brand) {
    if (raw.some((t) => ['iphone', 'ip', 'apple', 'airpods', 'ipad'].includes(t))) brand = 'Apple';
    else if (raw.some((t) => ['galaxy', 'samsung'].includes(t))) brand = 'Samsung';
    else if (raw.some((t) => ['xiaomi', 'redmi', 'poco'].includes(t))) brand = 'Xiaomi';
  }
  let list = catalog.models;
  if (brand) list = list.filter((m) => m.brand === brand);
  if (sheet) list = list.filter((m) => (m.sheet || sheetOf(m.brand)) === sheet);
  if (kindFilter === 'repairs') list = list.filter((m) => m.devKind === 'phone' || m.hasParts);
  if (kindFilter === 'devices') list = list.filter((m) => m.hasDevices);
  const scored = [];
  for (const m of list) {
    if (!q.length) { scored.push({ m, s: 0 }); continue; }
    let ok = true, s = 0;
    q.forEach((t, i) => {
      const last = i === q.length - 1;
      if (m.tokens.includes(t)) s += 2;
      else if (last && t.length >= 2 && m.tokens.some((x) => x.startsWith(t))) s += 1;
      else ok = false;
    });
    if (ok) scored.push({ m, s: s - (m.tokens.length - q.length) * 0.5 });
  }
  // דגם שלא קיים במחירונים אבל מזוהה (למשל אייפון בלי מחירון חלקים) – עדיין אפשר לחשב עבודה
  if (q.length && kindFilter !== 'devices') {
    const id = identify(rest);
    if (id.family && id.kind === 'phone') {
      const mkey = modelKey(id);
      if (!scored.some((x) => x.m.mkey === mkey) && (!brand || brand === id.brand)) {
        if (!sheet || sheetOf(id.brand) === sheet) scored.push({ m: { mkey, brand: id.brand, model: id.model, family: id.family, tier: id.tier, devKind: 'phone', hasParts: false, sheet: sheetOf(id.brand), tokens: searchTokens(`${id.brand} ${id.model}`), synthetic: true }, s: q.length * 2 + 1 });
      }
    }
  }
  scored.sort((a, b) => b.s - a.s || (BRAND_ORDER[a.m.brand] ?? 9) - (BRAND_ORDER[b.m.brand] ?? 9) || a.m.model.localeCompare(b.m.model, 'en', { numeric: true }));
  return { repair, models: scored.map((x) => x.m) };
}

export { normText };
