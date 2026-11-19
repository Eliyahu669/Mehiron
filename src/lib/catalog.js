// קטלוג דגמים מאוחד מכל הספקים + חיפוש חכם
import { identify, modelKey, searchTokens, normText, tokenize } from './normalize.js';
import { REPAIRS } from './defaults.js';

export function buildCatalog(lists) {
  const devices = [], parts = [];
  const models = new Map();
  for (const [supplierId, doc] of Object.entries(lists || {})) {
    for (const it of doc.items || []) {
      const x = { ...it, supplierId };
      (x.kind === 'part' ? parts : devices).push(x);
      if (!models.has(x.mkey)) {
        models.set(x.mkey, {
          mkey: x.mkey, brand: x.brand, model: x.model, family: x.family, tier: x.tier,
          category: x.category, devKind: x.devKind, hasParts: false, hasDevices: false,
          tokens: searchTokens(`${x.brand || ''} ${x.model}`),
        });
      }
      const m = models.get(x.mkey);
      if (x.kind === 'part') m.hasParts = true; else m.hasDevices = true;
    }
  }
  return { devices, parts, models: [...models.values()] };
}

export function detectRepair(query) {
  const words = String(query || '').toLowerCase().split(/[\s,.\-/]+/).filter(Boolean);
  for (const r of REPAIRS) if (words.some((w) => r.words.includes(w))) return r.id;
  return null;
}

function stripRepairWords(query) {
  const all = new Set(REPAIRS.flatMap((r) => r.words));
  return String(query || '').split(/\s+/).filter((w) => !all.has(w.toLowerCase())).join(' ');
}

const BRAND_ORDER = { Apple: 0, Samsung: 1, Xiaomi: 2 };

export function searchModels(query, catalog, { brand = null, kindFilter = null } = {}) {
  const repair = detectRepair(query);
  const rest = stripRepairWords(query);
  const q = searchTokens(rest);
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
  if (q.length) {
    const id = identify(rest);
    if (id.family && id.kind === 'phone') {
      const mkey = modelKey(id);
      if (!scored.some((x) => x.m.mkey === mkey) && (!brand || brand === id.brand)) {
        scored.push({ m: { mkey, brand: id.brand, model: id.model, family: id.family, tier: id.tier, category: id.category, devKind: 'phone', hasParts: false, hasDevices: false, tokens: searchTokens(`${id.brand} ${id.model}`), synthetic: true }, s: q.length * 2 + 1 });
      }
    }
  }
  scored.sort((a, b) => b.s - a.s || (BRAND_ORDER[a.m.brand] ?? 9) - (BRAND_ORDER[b.m.brand] ?? 9) || a.m.model.localeCompare(b.m.model, 'en', { numeric: true }));
  return { repair, models: scored.map((x) => x.m) };
}

export { normText };
