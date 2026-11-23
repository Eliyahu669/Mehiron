// מנוע תמחור: חלק + עבודה לתיקונים, עלות + אחוז רווח למכשירים, עיגול לכפולות של 10
import { laborGroupsOf } from './defaults.js';
import { resolveQuality, optionName, groupId, optionKey, repairLabel, qualitiesFor } from './repairs.js';
import { tokenize } from './normalize.js';

export function roundPrice(v, cfg) {
  const step = cfg?.rounding?.step || 10;
  const mode = cfg?.rounding?.mode || 'ceil';
  const f = mode === 'round' ? Math.round : mode === 'floor' ? Math.floor : Math.ceil;
  return f(Math.round((v / step) * 1e6) / 1e6) * step; // בלי שגיאות שבר עשרוני (4050.0000000000005 לא מתעגל ל-4060)
}

// סדרה לפי תחילת השם: "Galaxy A5" → A54, A55; "iPhone 8" → iPhone 8, 8 Plus; "אייפון SE" → iPhone SE
const ALIAS = { ip: 'iphone', apple: 'iphone', samsung: 'galaxy' };
const LEAD_BRANDS = new Set(['iphone', 'galaxy', 'xiaomi']);
const toks = (s) => tokenize(s).map((t) => ALIAS[t] || t);
const prefixCache = new Map();
/** תחילת שם בצורה מנורמלת – להשוואה בין סדרות (אותה תחילת שם בשתי סדרות) */
export function prefixKey(prefix) {
  const k = String(prefix || '');
  let v = prefixCache.get(k);
  if (v === undefined) { v = toks(k); prefixCache.set(k, v); }
  return v.join(' ');
}

/** 0 = השם לא מתחיל כך; אחרת – ככל שהתחילית ארוכה יותר, ההתאמה חזקה יותר */
export function prefixScore(prefix, model) {
  const p = prefixKey(prefix);
  if (!p || !model?.model) return 0;
  const m = toks(model.model);
  if (m.join(' ').startsWith(p)) return p.length + 1;
  // בלי מילת יצרן ("A5"): משווים לשם בלי "Galaxy" / "iPhone" שבתחילתו
  if (prefixCache.get(String(prefix || '')).some((t) => LEAD_BRANDS.has(t))) return 0;
  let i = 0;
  while (i < m.length && LEAD_BRANDS.has(m[i])) i++;
  return i && m.slice(i).join(' ').startsWith(p) ? p.length + 1 : 0;
}

/** הסדרה של הדגם בטבלת העבודה: תחילת השם הארוכה ביותר שמתאימה, מכל הסדרות */
export function groupFor(model, cfg = null) {
  if (!model) return null;
  let best = null, score = 0;
  for (const g of laborGroupsOf(cfg)) for (const p of g.prefixes || []) { const s = prefixScore(p, model); if (s > score) { score = s; best = g.id; } }
  return best;
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

// מפתח "מחיר ידני ללקוח" לתיקון: דגם + סוג תיקון + איכות (לכל הספקים יחד). במכשירים – row:<מזהה שורה>
export const repairGroupKey = (mkey, repair, variant) => `${mkey}|${repair}|${qualityKey(variant)}`;

/** עלות עבודה לדגם ולסוג תיקון. מחזיר { amount, source } או null אם לא מוגדר */
function rulesFor(model, cfg) {
  const rules = (cfg.laborRules || []).filter((r) => ruleMatches(r, model.model));
  // דגם מדויק קודם, אחר כך הסדרה עם השם הארוך ביותר
  return rules.sort((a, b) => (a.scope === 'model' ? -1 : 0) - (b.scope === 'model' ? -1 : 0) || canon(b.match).length - canon(a.match).length);
}

/** הסדרה בפועל: חריג עם "שייך לעמודה" גובר על תחילת השם ועל הזיהוי האוטומטי */
export function laborGroupOf(model, cfg, rules = rulesFor(model, cfg)) {
  const ids = new Set(laborGroupsOf(cfg).map((g) => g.id));
  const r = rules.find((x) => x.group && ids.has(x.group));
  return r ? r.group : groupFor(model, cfg);
}

export function laborFor(model, repair, cfg) {
  const rules = rulesFor(model, cfg);
  const group = laborGroupOf(model, cfg, rules);
  for (const r of rules) {
    if (r.labor && r.labor[repair] != null && r.labor[repair] !== '') {
      return { amount: Number(r.labor[repair]), source: r.scope === 'model' ? `חריג לדגם ${r.match}` : `חריג לסדרה ${r.match}`, group };
    }
  }
  const v = group && cfg.labor?.[group]?.[repair];
  if (v == null || v === '') return null;
  const label = laborGroupsOf(cfg).find((x) => x.id === group)?.label;
  return { amount: Number(v), source: `טבלת עבודה: ${label}`, group };
}

export function freshness(ts, cfg, now = Date.now()) {
  if (!ts) return { level: 'red', days: null };
  const days = Math.floor((now - ts) / 86400000);
  const f = cfg.freshness || { green: 7, orange: 14 };
  return { level: days <= f.green ? 'green' : days <= f.orange ? 'orange' : 'red', days };
}

/** האיכות של פריט חלק (עם ברירת המחדל של הספק לשורות בלי שם איכות) */
export function partQuality(p, cfg) {
  const def = (cfg?.suppliers || []).find((x) => x.id === p.supplierId)?.defaultQuality || '';
  return resolveQuality(p.partType, p.variant, cfg, def);
}

/**
 * הצעת מחיר לתיקון: לכל איכות (+ מסגרת) – החלק הזול ביותר מכל הספקים, ועוד עבודה ותוספות
 * parts: פריטי החלקים של הדגם (עם supplierId). איכויות שנכתבו אחרת אצל ספקים שונים מאוחדות לשם אחד
 */
export function repairQuote(model, repair, parts, cfg, addonIds = []) {
  const relevant = parts.filter((p) => p.mkey === model.mkey && p.partType === repair);
  let labor = laborFor(model, repair, cfg);
  const own = !!labor;
  // סוג תיקון שנוסף בלי עלות עבודה משלו: חלק עם מחיר מחושב עם העבודה של הסוג שהוגדר (למשל מסך חיצוני ← מסך)
  const from = (cfg.customRepairs || []).find((r) => r.id === repair)?.laborFrom;
  if (!labor && from && relevant.length) {
    const l = laborFor(model, from, cfg);
    if (l) labor = { ...l, source: `${l.source} · כמו ${repairLabel(from, cfg)} (אין עלות עבודה ל${repairLabel(repair, cfg)})` };
  }
  const addons = (cfg.addons || []).filter((a) => addonIds.includes(a.id));
  const addonSum = addons.reduce((s, a) => s + Number(a.amount || 0), 0);
  const order = qualitiesFor(repair, cfg).map((x) => x.id);
  const groups = new Map();
  for (const p of relevant) {
    const r = partQuality(p, cfg);
    const gid = groupId(r);
    if (!groups.has(gid)) groups.set(gid, { r, list: [] });
    groups.get(gid).list.push(p);
  }
  const options = [...groups.entries()].map(([gid, { r, list }]) => {
    list.sort((a, b) => a.price - b.price);
    const best = list[0];
    const overrideKey = optionKey(model.mkey, repair, gid);
    // מפתחות ישנים (לפני איחוד שמות האיכות) – מחיר ידני שנקבע אז עדיין תקף
    const legacyKeys = [...new Set(list.flatMap((p) => [repairGroupKey(model.mkey, repair, p.variant), `${model.mkey}|${repair}|${p.variant || 'סטנדרטי'}`]))];
    let ov = cfg.priceOverrides?.[overrideKey];
    if (ov == null || ov === '') ov = legacyKeys.map((k) => cfg.priceOverrides?.[k]).find((v) => v != null && v !== '');
    const override = ov == null || ov === '' ? null : ov;
    const computed = labor ? roundPrice(best.price + labor.amount + addonSum, cfg) : null;
    return {
      quality: optionName(r), qid: r.qid, frame: r.frame, gid, part: best, suppliers: list, overrideKey, legacyKeys,
      final: override != null ? Number(override) : computed,
      computed, overridden: override != null,
      profit: override != null ? Number(override) - best.price : (computed != null ? computed - best.price : null),
      rank: r.qid ? order.indexOf(r.qid) : order.length,
    };
  }).sort((a, b) => (a.final ?? 1e9) - (b.final ?? 1e9) || a.rank - b.rank);
  const laborOnly = labor && own ? roundPrice(labor.amount + addonSum, cfg) : null;
  return { repair, label: repairLabel(repair, cfg), labor, addons, options, laborOnly };
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** רווח בשקלים לפי הכלל. limit: 'min' / 'max' (הוגבל) או 'fixed' (סכום קבוע בלי אחוז). null = אין כלל */
export function profitFor(cost, rule) {
  let amount = rule.pct != null ? (cost * rule.pct) / 100 : rule.min ?? rule.max ?? null;
  if (amount == null) return null;
  let limit = rule.pct == null ? 'fixed' : null;
  if (rule.min != null && amount < rule.min) { amount = rule.min; limit = 'min'; }
  if (rule.max != null && amount > rule.max) { amount = rule.max; limit = 'max'; }
  return { amount, limit };
}

/** כמה נשאר מהרווח אחרי מע"מ (המחירים כוללים מע"מ, ולכן למדינה הולך vat/(100+vat) מהרווח) */
export const afterVat = (profit, cfg) => (profit == null ? null : Math.round(profit / (1 + (num(cfg.vat) ?? 18) / 100)));
