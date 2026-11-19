// פירוק הודעת מחירון של ספק (טקסט חופשי מוואטסאפ, או טבלה מ-PDF / גוגל שיטס) לשורות מובנות
import { identify, modelKey, displayName, tokenize } from './normalize.js';

const STORAGE = new Set([16, 32, 64, 128, 256, 512, 1024]);
const MODEL_WORDS = new Set(['iphone', 'ip', 'lp', 'galaxy', 'redmi', 'poco', 'airpods', 'airpod', 'ipad', 'watch', 'mibox',
  'smartag', 'airtag', 'buds', 'tab', 'tablet', 'oneplus', 'pixel', 'nokia', 'motorola', 'honor', 'huawei', 'oppo', 'realme',
  'vivo', 'nothing', 'easytab', 'teclast', 'lenovo', 'flip', 'fold', 'homepod', 'modem', 'camera', 'charger', 'adapter',
  'mi', 'xiaomi', 'tv', 'box', 'pod', 'samsung', 'apple', 'hurricane', 'cable', 'mouse']);
const BRAND_HEADERS = { apple: 'Apple', samsung: 'Samsung', xiaomi: 'Xiaomi', redmi: 'Xiaomi', poco: 'Xiaomi' };

const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍‼⁉]/gu;
const clean = (s) => String(s || '').replace(EMOJI, '').replace(/[‎‏‪-‮]/g, '')
  .replace(/([֐-׿])(\d)/g, '$1 $2').replace(/(\d)([֐-׿])/g, '$1 $2').replace(/\s+/g, ' ').trim();
const num = (s) => Number(String(s).replace(/,/g, ''));

/** מחלץ מחיר משורה. מחזיר { price, rest } או null */
export function extractPrice(line) {
  const s = clean(line);
  // 1. מחיר עם סימן ₪ – קודם מספר שצמוד אחרי ₪, אחר כך מספר שלפני ₪
  const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  for (const re of [new RegExp('₪\\s*' + NUM, 'g'), new RegExp(NUM + '\\s*₪', 'g')]) {
    const all = [...s.matchAll(re)];
    if (!all.length) continue;
    const m = all[all.length - 1];
    const v = num(m[1]);
    if (v > 0) return { price: v, rest: tidy(s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)) };
  }
  // 2. מחיר אחרי מקף: "A54 128-1420" / "Ip 15 pro 128-4850dcs"
  const dash = [...s.matchAll(/-\s*(\d{1,3}(?:,\d{3})+|\d{2,6})(?![\d])/g)].filter((m) => num(m[1]) >= 50 && !/^\s*(g|gb|m|mm|tb)\b/i.test(s.slice(m.index + m[0].length)));
  if (dash.length) {
    const m = dash[dash.length - 1];
    return { price: num(m[1]), rest: tidy(s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)) };
  }
  // 3. מספר בתחילת/בסוף שורה, או מוקף במילים בעברית בלבד: "רשמי 2850." / "Ip x 256-active 1100"
  const toks = s.split(/\s+/);
  const isPriceTok = (t) => {
    const m = t.replace(/^[.\-:]+|[.\-:]+$/g, '').match(/^(\d{1,3}(?:,\d{3})+|\d{3,6})$/);
    if (!m) return null;
    const v = num(m[1]);
    if (STORAGE.has(v) || v < 50) return null;
    return v;
  };
  const latinOther = (skip) => toks.some((t, i) => i !== skip && /[a-z0-9]/i.test(t));
  const take = (i, v) => ({ price: v, rest: tidy(toks.filter((_, j) => j !== i).join(' ')) });
  const end = toks.length - 1;
  const vEnd = isPriceTok(toks[end] || '');
  if (vEnd != null && (!latinOther(end) || vEnd < 2010 || vEnd > 2030)) return take(end, vEnd);
  const vStart = isPriceTok(toks[0] || '');
  if (vStart != null && !latinOther(0)) return take(0, vStart);
  return null;
}

const tidy = (s) => s.replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim();

export function hasModel(text) {
  const tk = tokenize(clean(text));
  return tk.some((t, i) =>
    MODEL_WORDS.has(t) ||
    (/[a-z]/.test(t) && /\d/.test(t) && !/^\d+(gb|g|tb|m|mm)$/.test(t) && !/^\d+g$/.test(t) && !/^[45]g$/.test(t)) ||
    (/^\d{1,2}$/.test(t) && Number(t) >= 1 && Number(t) <= 30 && tk[i + 1] !== 'gb') ||
    ['x', 'xr', 'xs', 'se', 'air', 'pro', 'max', 'plus', 'ultra', 'mini'].includes(t));
}

function headerBrand(text) {
  const tk = tokenize(clean(text));
  for (const t of tk) if (BRAND_HEADERS[t]) return BRAND_HEADERS[t];
  return null;
}

const fixQuality = (s) => clean(s).replace(/מקןרי/g, 'מקורי').replace(/ללאר(?=\s|$)/g, 'ללא').replace(/מסגות/g, 'מסגרת').replace(/סני(?=\s|$)/g, 'סאני');

export function makeItem(name, note, price, ctxBrand, raw, opts) {
  const id = identify(name, ctxBrand);
  const variant = fixQuality([note, hebrewAndTags(id.extra)].filter(Boolean).join(' '));
  const isPart = opts.kind === 'parts';
  const item = {
    kind: isPart ? 'part' : 'device',
    partType: isPart ? opts.partType || 'screen' : null,
    brand: id.brand, model: id.model, storage: isPart ? null : id.storage,
    family: id.family, tier: id.tier, devKind: id.kind, category: id.category,
    name: isPart ? id.model : displayName(id),
    variant: variant || '',
    price, raw: clean(raw),
  };
  item.mkey = modelKey(id);
  item.key = isPart ? `${item.mkey}|${item.partType}|${item.variant}` : `${item.mkey}|${item.storage || ''}|${item.variant}`;
  item.ok = Boolean(item.model && price > 0);
  return item;
}

// תגיות ומילים בעברית שנשארו – לתצוגה כ"וריאנט"
function hebrewAndTags(extra) {
  const map = { dcs: 'DCS', esim: 'eSIM', dualsim: 'Dual SIM', active: 'active', new: 'new', pr: 'pr', nfc: 'NFC', wifi: 'WiFi', gps: 'GPS', cell: 'Cellular', cellular: 'Cellular', sim: 'SIM', oled: 'OLED', no: 'no' };
  return String(extra || '').split(' ').filter(Boolean).map((t) => map[t] || (/^[֐-׿]/.test(t) ? t : null)).filter(Boolean).join(' ').replace(/no active/g, 'no active');
}

/**
 * opts: { kind: 'devices' | 'parts', partType }
 * מחזיר מערך פריטים; פריטים שלא זוהו מסומנים ok=false לתיקון ידני
 */
export function parseMessage(text, opts = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const tabLines = lines.filter((l) => l.includes('\t')).length;
  const items = tabLines >= 3 && tabLines >= lines.filter((l) => l.trim()).length * 0.3 ? parseTable(lines, opts) : parseFree(lines, opts);
  // שורות כפולות אצל אותו ספק (אותו דגם ואיכות) – מקבלות מפתח ייחודי לפי סדר הופעה
  const seen = new Map();
  for (const it of items) {
    const n = (seen.get(it.key) || 0) + 1;
    seen.set(it.key, n);
    if (n > 1) it.key = `${it.key}#${n}`;
  }
  return items;
}

function parseFree(lines, opts) {
  const items = [];
  let ctxBrand = null, pending = [], base = null, last = null;
  const L = lines.map(clean);
  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    if (!line) { pending = []; base = null; last = null; continue; }
    const p = extractPrice(line);
    if (!p) {
      const prevBlank = i === 0 || !L[i - 1];
      const next = L[i + 1] || '';
      const np = next ? extractPrice(next) : null;
      const isHeader = prevBlank && (!next || (np && hasModel(np.rest)) || (!np && hasModel(next) && !hasModel(line)));
      if (isHeader && !/\d/.test(line)) {
        ctxBrand = headerBrand(line);
        pending = []; base = null; last = null;
        continue;
      }
      if (!hasModel(line) && last && !pending.length) { // הערה לפריט הקודם
        last.variant = fixQuality([last.variant, line].filter(Boolean).join(' '));
        last.raw += ' / ' + line;
        last.key = last.kind === 'part' ? `${last.mkey}|${last.partType}|${last.variant}` : `${last.mkey}|${last.storage || ''}|${last.variant}`;
        continue;
      }
      pending.push(line);
      continue;
    }
    let name, note = '';
    if (hasModel(p.rest)) {
      name = p.rest;
      if (pending.length && !hasModel(pending.join(' '))) note = pending.join(' ');
      else if (pending.length) name = pending.join(' ') + ' ' + p.rest;
      pending = [];
      base = name;
    } else {
      if (pending.length) { base = pending.join(' '); pending = []; }
      if (!base) { // מחיר בלי שם – לא ניתן לשייך
        items.push({ ...makeItem(p.rest, '', p.price, ctxBrand, line, opts), ok: false });
        continue;
      }
      name = base; note = p.rest;
    }
    const it = makeItem(name, note, p.price, ctxBrand, (base && base !== name ? base + ' / ' : '') + line, opts);
    items.push(it);
    last = it;
  }
  return items;
}

function parseTable(lines, opts) {
  const items = [];
  let carry = [];
  for (const raw of lines) {
    const cells = raw.split('\t').map(clean).filter(Boolean);
    if (!cells.length) continue;
    const joined = cells.join(' ');
    if (/מחיר|מותג|price|brand/i.test(joined) && !/\d{2,}/.test(joined.replace(/\d+\s*%/, ''))) continue; // שורת כותרת
    let priceCell = -1, price = null;
    for (let j = cells.length - 1; j >= 0; j--) {
      const p = extractPrice(cells[j]);
      if (p && (/₪/.test(cells[j]) || /^\d[\d,]*$/.test(cells[j]))) { priceCell = j; price = p.price; break; }
    }
    if (priceCell < 0) { carry.push(...cells); continue; }
    const all = [...carry, ...cells.filter((_, j) => j !== priceCell)];
    carry = [];
    const words = all.join(' ').replace(/[ְ-ׇ]/g, '').replace(/[()[\]{}]/g, ' ').split(/\s+/).filter(Boolean);
    const latin = words.filter((w) => !/[֐-׿]/.test(w));
    const heb = words.filter((w) => /[֐-׿]/.test(w));
    items.push(makeItem(latin.join(' '), heb.join(' '), price, null, raw, opts));

  }
  return items;
}

/** מיזוג מחירון חדש לקיים: replace = החלפה מלאה, אחרת עדכון חלקי */
export function mergeItems(oldItems, newItems, { replace = true, now = Date.now() } = {}) {
  const byKey = new Map((oldItems || []).map((it) => [it.key, it]));
  const out = replace ? [] : [...(oldItems || [])];
  const idx = new Map(out.map((it, i) => [it.key, i]));
  for (const n of newItems) {
    if (!n.ok) continue;
    const o = byKey.get(n.key);
    const rec = { ...n, updatedAt: now, prevPrice: o && o.price !== n.price ? o.price : (o ? o.prevPrice ?? null : null), changedAt: o && o.price !== n.price ? now : (o ? o.changedAt ?? now : now) };
    if (!replace && idx.has(n.key)) out[idx.get(n.key)] = rec; else { idx.set(n.key, out.length); out.push(rec); }
  }
  return out;
}
