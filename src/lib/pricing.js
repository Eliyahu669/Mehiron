// מנוע תמחור: חלק + עבודה לתיקונים, עלות + אחוז רווח למכשירים, עיגול לכפולות של 10
import { LABOR_GROUPS, REPAIRS } from './defaults.js';

export function roundPrice(v, cfg) {
  const step = cfg?.rounding?.step || 10;
  const mode = cfg?.rounding?.mode || 'ceil';
  const f = mode === 'round' ? Math.round : mode === 'floor' ? Math.floor : Math.ceil;
  return f(v / step) * step;
}

export function groupFor(model) {
  if (!model) return null;
  const g = LABOR_GROUPS.find((g) => g.family === model.family && (!g.tier || g.tier === model.tier));
  return g ? g.id : null;
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function ruleMatches(rule, modelName) {
  const m = norm(modelName), r = norm(rule.match);
  if (!r) return false;
  return rule.scope === 'model' ? m === r : m === r || m.startsWith(r + ' ');
}

/** עלות עבודה לדגם ולסוג תיקון. מחזיר { amount, source } או null אם לא מוגדר */
export function laborFor(model, repair, cfg) {
  const rules = (cfg.laborRules || []).filter((r) => ruleMatches(r, model.model));
  // דגם מדויק קודם, אחר כך הסדרה עם השם הארוך ביותר
  rules.sort((a, b) => (a.scope === 'model' ? -1 : 0) - (b.scope === 'model' ? -1 : 0) || norm(b.match).length - norm(a.match).length);
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
    const q = p.variant || 'סטנדרטי';
    if (!byQuality.has(q)) byQuality.set(q, []);
    byQuality.get(q).push(p);
  }
  const options = [...byQuality.entries()].map(([quality, list]) => {
    list.sort((a, b) => a.price - b.price);
    const best = list[0];
    const overrideKey = `${model.mkey}|${repair}|${quality}`;
    const override = cfg.priceOverrides?.[overrideKey];
    const computed = labor ? roundPrice(best.price + labor.amount + addonSum, cfg) : null;
    return {
      quality, part: best, suppliers: list, overrideKey,
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
  rules.sort((a, b) => (a.scope === 'model' ? -1 : 0) - (b.scope === 'model' ? -1 : 0) || norm(b.match).length - norm(a.match).length);
  return rules[0]?.category || item.category || 'other';
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
    const override = cfg.priceOverrides?.[best.key];
    const computed = margin != null ? roundPrice(best.price * (1 + margin / 100), cfg) : null;
    return {
      item: best, suppliers: list, margin, overrideKey: best.key,
      final: override != null ? Number(override) : computed,
      computed, overridden: override != null,
      profit: (override != null ? Number(override) : computed) != null ? (override != null ? Number(override) : computed) - best.price : null,
    };
  }).sort((a, b) => (a.item.storage || 0) - (b.item.storage || 0) || (a.final ?? 1e9) - (b.final ?? 1e9));
}
