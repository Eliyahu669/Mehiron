// קטלוג דגמים מאוחד מכל הספקים + חיפוש חכם
import { identify, modelKey, searchTokens, normText, tokenize } from './normalize.js';
import { REPAIRS } from './defaults.js';

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
export function buildCatalog(lists, rows = null) {
  const parts = [];
  const models = new Map();
  const partIndex = new Map(); // `${mkey}|${partType}` → חלקים
  for (const [supplierId, doc] of Object.entries(lists || {})) {
    for (const it of doc.items || []) {
      if (it.kind !== 'part') continue;
      const x = { ...it, supplierId };
      parts.push(x);
      const k = `${x.mkey}|${x.partType}`;
      if (!partIndex.has(k)) partIndex.set(k, []);
      partIndex.get(k).push(x);
      if (!models.has(x.mkey)) {
        models.set(x.mkey, {
          mkey: x.mkey, brand: x.brand, model: x.model, family: x.family, tier: x.tier,
          devKind: x.devKind, hasParts: true, tokens: searchTokens(`${x.brand || ''} ${x.model}`),
        });
      }
    }
  }
  for (const r of rows || []) {
    if (!PHONE_SEGMENTS.has(r.segment)) continue;
    const id = identify(r.model, r.brand);
    const mkey = modelKey(id);
    if (!id.model || models.has(mkey)) continue;
    models.set(mkey, {
      mkey, brand: id.brand || r.brand, model: id.model, family: id.family, tier: id.tier,
      devKind: 'phone', hasParts: false, tokens: searchTokens(`${id.brand || r.brand || ''} ${id.model}`),
    });
  }
  return { parts, partIndex, models: [...models.values()] };
}

// מילת תיקון, גם עם תחילית: "למסך", "הסוללה", "בשקע"
const repairOf = (w) => {
  const x = w.toLowerCase();
  for (const r of REPAIRS) if (r.words.includes(x) || (/^[הולבמ][\u0590-\u05ff]/.test(x) && r.words.includes(x.slice(1)))) return r.id;
  return null;
};

export function detectRepair(query) {
  for (const w of String(query || '').split(/[\s,.\-/]+/)) { const r = w && repairOf(w); if (r) return r; }
  return null;
}

function stripRepairWords(query) {
  return String(query || '').split(/\s+/).filter((w) => !repairOf(w)).join(' ');
}

// נפח לא שייך לשם הדגם (64 ומעלה; 16/32 עלולים להיות מספר דגם כמו iPhone 16)
const isStorageTok = (t) => ['64', '128', '256', '512', '1024', 'gb', 'tb'].includes(t);

const BRAND_ORDER = { Apple: 0, Samsung: 1, Xiaomi: 2 };

export function searchModels(query, catalog, { brand = null, kindFilter = null } = {}) {
  const repair = detectRepair(query);
  const rest = stripRepairWords(query);
  const q = searchTokens(rest).filter((t) => !isStorageTok(t));
  const raw = tokenize(rest);
  if (!brand) {
    if (raw.some((t) => ['iphone', 'ip', 'apple', 'airpods', 'ipad'].includes(t))) brand = 'Apple';
    else if (raw.some((t) => ['galaxy', 'samsung'].includes(t))) brand = 'Samsung';
    else if (raw.some((t) => ['xiaomi', 'redmi', 'poco'].includes(t))) brand = 'Xiaomi';
  }
  let list = catalog.models;
  if (brand) list = list.filter((m) => m.brand === brand);
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
        scored.push({ m: { mkey, brand: id.brand, model: id.model, family: id.family, tier: id.tier, devKind: 'phone', hasParts: false, tokens: searchTokens(`${id.brand} ${id.model}`), synthetic: true }, s: q.length * 2 + 1 });
      }
    }
  }
  scored.sort((a, b) => b.s - a.s || (BRAND_ORDER[a.m.brand] ?? 9) - (BRAND_ORDER[b.m.brand] ?? 9) || a.m.model.localeCompare(b.m.model, 'en', { numeric: true }));
  return { repair, models: scored.map((x) => x.m) };
}

export { normText };
