// קטלוג "מחירים סופיים בלבד" לעובדים: בלי מחירי ספק, בלי שמות ספקים ובלי אחוזי רווח
import { buildCatalog } from './catalog.js';
import { repairQuote, deviceQuotes, laborFor, roundPrice } from './pricing.js';
import { REPAIRS } from './defaults.js';
import { searchTokens } from './normalize.js';

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

export function buildPublicCatalog(lists, cfg) {
  const cat = buildCatalog(lists);
  const models = cat.models.map((m) => {
    const r = {};
    for (const rep of REPAIRS) {
      const q = repairQuote(m, rep.id, cat.parts, cfg);
      const o = q.options.filter((x) => x.final != null).map((x) => ({ q: x.quality, f: x.final, u: x.part.updatedAt || null }));
      if (o.length) r[rep.id] = { o };
      else if (q.laborOnly != null) r[rep.id] = { o: [], l: q.laborOnly };
    }
    const d = m.hasDevices
      ? deviceQuotes(m, cat.devices, cfg).filter((x) => x.final != null)
        .map((x) => ({ n: x.item.name, v: x.item.variant || '', s: x.item.storage || null, f: x.final, u: x.item.updatedAt || null }))
      : [];
    return { k: m.mkey, b: m.brand || null, m: m.model, fa: m.family || null, t: m.tier || null, dk: m.devKind || null, hp: m.hasParts, hd: d.length > 0, r, d };
  });
  const updatedAt = Math.max(0, ...Object.values(lists || {}).map((l) => l.updatedAt || 0));
  return { v: 1, updatedAt, models };
}

/** הופך את הקטלוג המפורסם למבנה שהממשק והחיפוש מכירים */
export function liteCatalog(pub) {
  const models = (pub?.models || []).map((x) => ({
    mkey: x.k, brand: x.b, model: x.m, family: x.fa, tier: x.t, devKind: x.dk,
    hasParts: x.hp, hasDevices: x.hd, tokens: searchTokens(`${x.b || ''} ${x.m}`), r: x.r || {}, d: x.d || [],
  }));
  return { lite: true, models, devices: [], parts: [], updatedAt: pub?.updatedAt || 0 };
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
  return (model.d || []).map((x) => ({
    item: { name: x.n, variant: x.v, storage: x.s, updatedAt: x.u }, final: x.f, suppliers: [], margin: 1, overridden: false,
  }));
}

/** נקודת כניסה אחת לממשק – מלא או מצומצם */
export function getRepairQuote(model, repair, catalog, cfg, addonIds = []) {
  return catalog.lite ? liteRepairQuote(model, repair, cfg, addonIds) : repairQuote(model, repair, catalog.parts, cfg, addonIds);
}
export function getDeviceQuotes(model, catalog, cfg) {
  return catalog.lite ? liteDeviceQuotes(model) : deviceQuotes(model, catalog.devices, cfg);
}

// חתימה פשוטה לזיהוי שינוי (כדי לא לכתוב לשרת בלי צורך)
export function sig(obj) {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${s.length}:${h >>> 0}`;
}
