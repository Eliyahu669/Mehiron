// קטלוג "מחירים סופיים בלבד" לעובדים: בלי מחירי ספק, בלי שמות ספקים ובלי אחוזי רווח
import { buildCatalog, activeLists } from './catalog.js';
import { repairQuote, laborFor, roundPrice } from './pricing.js';
import { REPAIRS } from './defaults.js';
import { searchTokens } from './normalize.js';
import { CATALOG_ID, defaultCatalog, priceIndex, rowQuote, buildDeviceModels, sheetOf } from './devices.js';

/** רשימת המכשירים השמורה (או ההתחלתית, אם עדיין לא נשמרה) */
export const catalogRows = (lists) => lists?.[CATALOG_ID]?.items || defaultCatalog();

/** קטלוג מלא (מנהל / עובד עם פירוט): תיקונים מספקי החלקים + רשימת המכשירים עם מחירי הספקים */
export function buildFullCatalog(allLists, cfg) {
  const lists = activeLists(allLists, cfg);
  const rows = catalogRows(allLists);
  const cat = buildCatalog(lists, rows);
  const prices = priceIndex(lists, cfg);
  return { ...cat, lite: false, rows, prices, devModels: buildDeviceModels(rows, prices) };
}

/** הגדרות שמותר לעובדים לראות (טבלת העבודה היא מחירון הטכנאי עצמו) */
export function publicConfig(cfg) {
  return {
    labor: cfg.labor,
    laborRules: (cfg.laborRules || []).map(({ id, scope, match, group, labor }) => ({ id, scope, match, group: group || null, labor: labor || {} })),
    addons: cfg.addons,
    rounding: cfg.rounding,
    freshness: cfg.freshness,
    adminPhone: cfg.adminPhone || '',
  };
}

export function buildPublicCatalog(allLists, cfg) {
  const lists = activeLists(allLists, cfg);
  const cat = buildFullCatalog(allLists, cfg);
  const models = cat.models.map((m) => {
    const r = {};
    for (const rep of REPAIRS) {
      const q = repairQuote(m, rep.id, cat.partIndex.get(`${m.mkey}|${rep.id}`) || [], cfg);
      const o = q.options.filter((x) => x.final != null).map((x) => ({ q: x.quality, f: x.final, u: x.part.updatedAt || null }));
      if (o.length) r[rep.id] = { o };
      else if (q.laborOnly != null) r[rep.id] = { o: [], l: q.laborOnly };
    }
    return { k: m.mkey, b: m.brand || null, m: m.model, fa: m.family || null, t: m.tier || null, dk: m.devKind || null, hp: m.hasParts, r };
  }).filter((m) => m.hp || Object.keys(m.r).length); // דגם מהרשימה שאין לו אף מחיר תיקון – לא נשלח
  // מכשירים למכירה: רק מחיר סופי לכל נפח / גרסה
  const devices = cat.devModels.map((g) => {
    const d = g.rows.map((row) => rowQuote(row, cat.prices.get(row.id), cfg)).filter((q) => q.final != null)
      .map((q) => ({ s: q.row.storage || null, v: q.row.version || '', sg: q.row.segment, f: q.final, u: q.best?.updatedAt || null }));
    return d.length ? { b: g.brand, m: g.model, se: g.series || '', sg: g.segment, y: g.year ?? null, d } : null;
  }).filter(Boolean);
  const updatedAt = Math.max(0, ...Object.values(lists || {}).map((l) => l.updatedAt || 0));
  return { v: 2, updatedAt, models, devices };
}

/** הופך את הקטלוג המפורסם למבנה שהממשק והחיפוש מכירים */
export function liteCatalog(pub) {
  const models = (pub?.models || []).map((x) => ({
    mkey: x.k, brand: x.b, model: x.m, family: x.fa, tier: x.t, devKind: x.dk,
    hasParts: x.hp, tokens: searchTokens(`${x.b || ''} ${x.m}`), r: x.r || {},
  }));
  const devModels = (pub?.devices || []).map((x) => {
    const key = `${String(x.b || '').toLowerCase()}|${String(x.m).toLowerCase()}`;
    return {
      key, mkey: key, brand: x.b, sheet: sheetOf(x.b), model: x.m, series: x.se, segment: x.sg, year: x.y,
      segments: [...new Set(x.d.map((r) => r.sg || x.sg))], tokens: searchTokens(`${x.b || ''} ${x.m} ${x.se || ''}`),
      hasDevices: true, priced: true, lite: x.d,
    };
  });
  return { lite: true, models, devModels, parts: [], updatedAt: pub?.updatedAt || 0 };
}

export function liteRepairQuote(model, repair, pcfg, addonIds = []) {
  const addons = (pcfg.addons || []).filter((a) => addonIds.includes(a.id));
  const sum = addons.reduce((s, a) => s + Number(a.amount || 0), 0);
  const label = REPAIRS.find((r) => r.id === repair)?.label;
  const r = model.r?.[repair];
  let options = [], laborOnly = null;
  if (r) {
    options = (r.o || []).map((o) => ({ quality: o.q, final: roundPrice(o.f + sum, pcfg), part: { updatedAt: o.u }, suppliers: [] }));
    if (r.l != null) laborOnly = roundPrice(r.l + sum, pcfg);
  } else if (model.synthetic || !model.r) {
    const l = laborFor(model, repair, pcfg);
    if (l) laborOnly = roundPrice(l.amount + sum, pcfg);
  }
  return { repair, label, labor: options.length || laborOnly != null ? { amount: null, source: '' } : null, addons, options, laborOnly };
}

export function liteDeviceQuotes(model) {
  return (model.lite || []).map((x) => ({
    row: { id: null, brand: model.brand, model: model.model, storage: x.s, version: x.v, segment: x.sg }, final: x.f, best: { updatedAt: x.u }, suppliers: [], overridden: false,
  }));
}

/** נקודת כניסה אחת לממשק – מלא או מצומצם */
export function getRepairQuote(model, repair, catalog, cfg, addonIds = []) {
  if (catalog.lite) return liteRepairQuote(model, repair, cfg, addonIds);
  const parts = catalog.partIndex ? catalog.partIndex.get(`${model.mkey}|${repair}`) || [] : catalog.parts;
  return repairQuote(model, repair, parts, cfg, addonIds);
}
/** מחיר ללקוח לכל שורה (נפח / גרסה) של דגם ברשימת המכשירים */
export function getDeviceQuotes(model, catalog, cfg) {
  if (catalog.lite) return liteDeviceQuotes(model);
  return (model.rows || []).map((row) => rowQuote(row, catalog.prices?.get(row.id), cfg));
}

// חתימה פשוטה לזיהוי שינוי (כדי לא לכתוב לשרת בלי צורך)
export function sig(obj) {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${s.length}:${h >>> 0}`;
}
