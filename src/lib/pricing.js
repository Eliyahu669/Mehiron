// מנוע תמחור: חלק + עבודה לתיקונים, עלות + אחוז רווח למכשירים, עיגול לכפולות של 10
import { LABOR_GROUPS, REPAIRS } from './defaults.js';
import { tokenize } from './normalize.js';

export function roundPrice(v, cfg) {
  const step = cfg?.rounding?.step || 10;
  const mode = cfg?.rounding?.mode || 'ceil';
  const f = mode === 'round' ? Math.round : mode === 'floor' ? Math.floor : Math.ceil;
  return f(v / step) * step;
}

export function groupFor(model) {
  if (!model) return null;
  const g = LABOR_GROUPS.find((g) => (g.families ? g.families.includes(model.family) : g.family === model.family) && (!g.tier || g.tier === model.tier));
  return g ? g.id : null;
}

// השוואה לפי מילים מנורמלות: "אייפון 15" = "iPhone 15", "A54" = "Galaxy A54"
const BRAND_WORDS = new Set(['galaxy', 'iphone', 'ip', 'apple', 'samsung', 'xiaomi']);
const canon = (s) => tokenize(s).filter((t) => !BRAND_WORDS.has(t));
function ruleMatches(rule, modelName) {
  const r = canon(rule.match), m = canon(modelName);
  if (!r.length) return false;
  if (rule.scope === 'model') return r.length === m.length && r.every((t, i) => t === m[i]);
  return r.length <= m.length && r.every((t, i) => t === m[i]);
}

// איכות חלק: "מקורי סאני" = "סאני מקורי" (ספקים שונים כותבים בסדר שונה)
export function qualityKey(q) {
  return String(q || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ') || 'סטנדרטי';
}

// מפתחות "מחיר ידני ללקוח": תיקון = דגם + סוג תיקון + איכות; מכשיר = דגם + נפח + וריאנט (לכל הספקים יחד)
export const repairGroupKey = (mkey, repair, variant) => `${mkey}|${repair}|${qualityKey(variant)}`;
export const deviceGroupKey = (it) => `${it.mkey}|${it.storage || ''}|${it.variant || ''}`;

/** עלות עבודה לדגם ולסוג תיקון. מחזיר { amount, source } או null אם לא מוגדר */
export function laborFor(model, repair, cfg) {
  const rules = (cfg.laborRules || []).filter((r) => ruleMatches(r, model.model));
  // דגם מדויק קודם, אחר כך הסדרה עם השם הארוך ביותר
  rules.sort((a, b) => (a.scope === 'model' ? -1 : 0) - (b.scope === 'model' ? -1 : 0) || canon(b.match).length - canon(a.match).length);
  let group = groupFor(model);
  for (const r of rules) {
    if (r.labor && r.labor[repair] != null && r.labor[repair] !== '') {
      return { amount: Number(r.labor[repair]), source: r.scope === 'model' ? `חריג לדגם ${r.match}` : `חריג לסדרה ${r.match}`, group };
    }
  }
  const g = rules.find((r) => r.group);
  if (g) group = g.group;
  const v = group && cfg.labor?.[group]?.[repair];
  if (v == null || v === '') return null;
  const label = LABOR_GROUPS.find((x) => x.id === group)?.label;
  return { amount: Number(v), source: `טבלת עבודה: ${label}`, group };
}

export function freshness(ts, cfg, now = Date.now()) {
  if (!ts) return { level: 'red', days: null };
  const days = Math.floor((now - ts) / 86400000);
  const f = cfg.freshness || { green: 7, orange: 14 };
  return { level: days <= f.green ? 'green' : days <= f.orange ? 'orange' : 'red', days };
}

/**
 * הצעת מחיר לתיקון: לכל רמת איכות – החלק הזול ביותר מכל הספקים
 * parts: כל פריטי החלקים של כל הספקים (עם supplierId)
 */
export function repairQuote(model, repair, parts, cfg, addonIds = []) {
  const labor = laborFor(model, repair, cfg);
  const addons = (cfg.addons || []).filter((a) => addonIds.includes(a.id));
  const addonSum = addons.reduce((s, a) => s + Number(a.amount || 0), 0);
  const relevant = parts.filter((p) => p.mkey === model.mkey && p.partType === repair);
  const byQuality = new Map();
  for (const p of relevant) {
    const k = qualityKey(p.variant);
    if (!byQuality.has(k)) byQuality.set(k, []);
    byQuality.get(k).push(p);
  }
  const options = [...byQuality.entries()].map(([qk, list]) => {
    list.sort((a, b) => a.price - b.price);
    const best = list[0];
    const quality = best.variant || 'סטנדרטי';
    const overrideKey = repairGroupKey(model.mkey, repair, best.variant);
    const legacyKey = `${model.mkey}|${repair}|${quality}`; // מפתח ישן (לפני איחוד שמות איכות)
    const ov = cfg.priceOverrides?.[overrideKey] ?? cfg.priceOverrides?.[legacyKey];
    const override = ov == null || ov === '' ? null : ov;
    const computed = labor ? roundPrice(best.price + labor.amount + addonSum, cfg) : null;
    return {
      quality, part: best, suppliers: list, overrideKey, legacyKey,
      final: override != null ? Number(override) : computed,
      computed, overridden: override != null,
      profit: override != null ? Number(override) - best.price : (computed != null ? computed - best.price : null),
    };
  }).sort((a, b) => (a.final ?? 1e9) - (b.final ?? 1e9));
  const laborOnly = labor ? roundPrice(labor.amount + addonSum, cfg) : null;
  return { repair, label: REPAIRS.find((r) => r.id === repair)?.label, labor, addons, options, laborOnly };
}

export function categoryFor(item, cfg) {
  const rules = (cfg.laborRules || []).filter((r) => r.category && ruleMatches(r, item.model));
  rules.sort((a, b) => (a.scope === 'model' ? -1 : 0) - (b.scope === 'model' ? -1 : 0) || canon(b.match).length - canon(a.match).length);
  return item.categoryOverride || rules[0]?.category || item.category || 'other';
}

export function marginFor(item, cfg) {
  const cat = categoryFor(item, cfg);
  const m = cfg.margins?.[cat];
  return m == null || m === '' ? null : Number(m);
}

/** הצעת מחיר למכשיר למכירה: לכל וריאנט – הספק הזול ביותר */
export function deviceQuotes(model, devices, cfg) {
  const relevant = devices.filter((d) => d.mkey === model.mkey);
  const groups = new Map();
  for (const d of relevant) {
    const k = `${d.storage || ''}|${d.variant || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  return [...groups.values()].map((list) => {
    list.sort((a, b) => a.price - b.price);
    const best = list[0];
    const margin = marginFor(best, cfg);
    const overrideKey = deviceGroupKey(best);
    const ov = cfg.priceOverrides?.[overrideKey] ?? cfg.priceOverrides?.[best.key];
    const override = ov == null || ov === '' ? null : ov;
    const computed = margin != null ? roundPrice(best.price * (1 + margin / 100), cfg) : null;
    return {
      item: best, suppliers: list, margin, overrideKey, legacyKey: best.key,
      final: override != null ? Number(override) : computed,
      computed, overridden: override != null,
      profit: (override != null ? Number(override) : computed) != null ? (override != null ? Number(override) : computed) - best.price : null,
    };
  }).sort((a, b) => (a.item.storage || 0) - (b.item.storage || 0) || (a.final ?? 1e9) - (b.final ?? 1e9));
}
