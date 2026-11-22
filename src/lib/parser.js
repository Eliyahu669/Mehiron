// פירוק הודעת מחירון של ספק (טקסט חופשי מוואטסאפ, או טבלה מ-PDF / גוגל שיטס) לשורות מובנות
import { identify, modelKey, displayName, tokenize, fmtStorage } from './normalize.js';
import { customRepairOf, resolveQuality } from './repairs.js';

const STORAGE = new Set([16, 32, 64, 128, 256, 512, 1024]);
const MODEL_WORDS = new Set(['iphone', 'ip', 'lp', 'galaxy', 'redmi', 'poco', 'airpods', 'airpod', 'ipad', 'watch', 'mibox',
  'smartag', 'airtag', 'buds', 'tab', 'tablet', 'oneplus', 'pixel', 'nokia', 'motorola', 'honor', 'huawei', 'oppo', 'realme',
  'vivo', 'nothing', 'easytab', 'teclast', 'lenovo', 'flip', 'fold', 'homepod', 'modem', 'camera', 'charger', 'adapter',
  'mi', 'xiaomi', 'tv', 'box', 'pod', 'samsung', 'apple', 'hurricane', 'cable', 'mouse']);
const BRAND_HEADERS = { apple: 'Apple', samsung: 'Samsung', xiaomi: 'Xiaomi', redmi: 'Xiaomi', poco: 'Xiaomi' };
const HEADER_WORDS = new Set(['apple', 'samsung', 'xiaomi', 'redmi', 'poco', 'galaxy', 'iphone', 'מכשירי', 'מכשירים', 'טלפונים']);

const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F\u200D\u20E3\u203C\u2049]/gu;
const KEYCAP = /[0-9#*]\uFE0F?\u20E3/g;
const clean = (s) => String(s || '').replace(KEYCAP, ' ').replace(EMOJI, '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
  .replace(/([\u0590-\u05ff])(\d)/g, '$1 $2').replace(/(\d)([\u0590-\u05ff])/g, '$1 $2').replace(/\s+/g, ' ').trim();
// ש"ח / ש״ח / שח / שקל / NIS – כמו ₪ (בלי lookbehind, בשביל Safari ישן)
const CUR_HEB = /(^|[^\u0590-\u05ff])(ש["\u05F4'\u05F3]{1,2}ח|שח|שקלים|שקל)(?=$|[^\u0590-\u05ff])/g;
const CUR_LAT = /\b(nis|ils)\b/gi;
const toShekel = (s) => s.replace(CUR_HEB, '$1₪').replace(CUR_LAT, '₪');
// כותרת של הודעה שהועתקה מוואטסאפ: "[20/11/2026, 10:15] ספק:" / "20.11.26, 10:15 - ספק:"
const WA_HEADER = /^\[?\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:-\s*)?(?:[^:]{1,40}:(?:\s|$))?/;
const WA_SYSTEM = /<\s*(?:המדיה לא נכללה|מדיה הושמטה|Media omitted)\s*>|הודעה זו נמחקה|This message was deleted|ההודעה נמחקה/i;
const num = (s) => Number(String(s).replace(/,/g, ''));

/** מחלץ מחיר משורה. מחזיר { price, rest } או null */
export function extractPrice(line) {
  const s = toShekel(clean(line));
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
  const dash = [...s.matchAll(/-\s*(\d{1,3}(?:,\d{3})+|\d{2,6})(?![\d])/g)].filter((m) => num(m[1]) >= 50 && !STORAGE.has(num(m[1])) && !/^\s*(g|gb|m|mm|tb)\b/i.test(s.slice(m.index + m[0].length)));
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

const fixQuality = (s) => clean(s).replace(/מקןרי/g, 'מקורי').replace(/ללאר(?=\s|$)/g, 'ללא').replace(/מסגות/g, 'מסגרת').replace(/סני(?=\s|$)/g, 'סאני')
  .replace(/([\u0590-\u05ff]{2,})(ללא|כולל)(?=\s|$)/g, '$1 $2');

const NOTE_STORAGE = /(^|\s)(64|128|256|512)\s*(gb|g|גיגה|ג'יגה)?(?=\s|$)|(^|\s)([12])\s*(tb|t|טרה)(?=\s|$)/i;
const HB = '(^|[^\u0590-\u05ff])[הולבמ]?';
const HE = '(?=$|[^\u0590-\u05ff])';
// סוג חלק לפי מילים בשורה (מסך קודם: "מסך כולל סוללה" הוא מסך)
const PART_WORDS = [
  ['screen', new RegExp(`${HB}(מסך|מסכים|תצוגה)${HE}|\\b(screen|lcd|oled|amoled|incell|display)\\b`, 'i')],
  ['battery', new RegExp(`${HB}(סוללה|סוללות|בטריה)${HE}|\\b(battery|batt)\\b`, 'i')],
  ['port', new RegExp(`${HB}(שקע|שקעים|שקע טעינה)${HE}|\\b(charging port|charge port|charging board|usb board)\\b`, 'i')],
  ['camera', new RegExp(`${HB}(מצלמה|מצלמות)${HE}|\\b(camera|cam)\\b`, 'i')],
  ['back', new RegExp(`${HB}(גב|גבים|זכוכית אחורית)${HE}|\\b(back glass|back cover|backglass)\\b`, 'i')],
  ['housing', new RegExp(`${HB}(גוף|שלדה)${HE}|\\bhousing\\b`, 'i')],
];
export function detectPartType(text, cfg = null) {
  // "כולל סוללה" / "עם מסגרת" מתארים את החלק, לא קובעים את הסוג
  const t = String(text || '').replace(/(^|\s)(כולל|עם|ללא|בלי|\+)\s*\S+/g, ' ');
  const own = cfg && customRepairOf(t, cfg); // סוג שהמנהל הוסיף ("מסך חיצוני") קודם
  if (own) return own;
  for (const [id, re] of PART_WORDS) if (re.test(t)) return id;
  return null;
}

export function makeItem(name, note, price, ctxBrand, raw, opts) {
  const isPart = opts.kind === 'parts';
  const id = identify(name, ctxBrand);
  if (!isPart && id.storage == null && note) { // "אייפון אייר" / "256 ₪3,000" – הנפח בשורת המחיר
    const m = String(note).match(NOTE_STORAGE);
    if (m && (id.family || id.kind === 'tablet')) {
      id.storage = m[2] ? Number(m[2]) : Number(m[5]) * 1024;
      note = String(note).replace(m[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }
  // בחלקים נשמרות גם מילים באנגלית (Incell, Service Pack…) – הן אומרות מה האיכות.
  // dropExtra: שורה שירשה את שם הדגם משורה קודמת עם מחיר – המילים הנוספות שם היו האיכות של השורה ההיא
  const partType = isPart ? detectPartType(`${name} ${note || ''}`, opts.cfg) || opts.partType || 'screen' : null;
  // ...אלא אם בשורה הזו אין איכות בכלל ("כולל מסגרת 450 ללא מסגרת 380") – אז היא ממשיכה את האיכות של הקודמת
  const keepExtra = !opts.dropExtra || !resolveQuality(partType, note, opts.cfg).qid;
  const extra = isPart ? (keepExtra ? partsExtra(id.extra) : '') : hebrewAndTags(id.extra);
  const variant = fixQuality([note, extra].filter(Boolean).join(' '));
  const item = {
    kind: isPart ? 'part' : 'device',
    partType,
    brand: id.brand, model: id.model, storage: isPart ? null : id.storage,
    family: id.family, tier: id.tier, devKind: id.kind, category: id.category,
    name: isPart ? id.model : displayName(id),
    variant: variant || '',
    price, raw: clean(raw),
  };
  item.mkey = modelKey(id);
  item.key = isPart ? `${item.mkey}|${item.partType}|${item.variant}` : `${item.mkey}|${item.storage || ''}|${item.variant}`;
  item.ok = Boolean(item.model && price > 0);
  // חלק לדגם שלא זוהה (בלי יצרן ובלי סדרה, למשל "17 pro" בלי "אייפון") – לא נשמר עד שבוחרים דגם
  if (isPart && !id.family && !id.brand) { item.ok = false; item.unknownModel = true; }
  if (id.excluded) item.excluded = true;
  return item;
}

const PART_TAGS = { oled: 'OLED', amoled: 'AMOLED', incell: 'Incell', lcd: 'LCD', tft: 'TFT', sp: 'SP' };
// עברית נשארת; באנגלית – רק מילים (בלי מספרים ובלי אות בודדת: "A" מכותרת "Galaxy A", "A065" קוד דגם)
const NOT_QUALITY = new Set(['note', 'plus', 'pro', 'max', 'ultra', 'mini', 'lite', 'fe', 'edge', 'neo', 'prime']);
const partsExtra = (extra) => String(extra || '').split(' ').filter(Boolean)
  .filter((t) => /[\u0590-\u05ff]/.test(t) || (/^[a-z]{2,}$/i.test(t) && !MODEL_WORDS.has(t.toLowerCase()) && !NOT_QUALITY.has(t.toLowerCase())))
  .map((t) => PART_TAGS[t] || t).join(' ');

// שורה עם כמה מחירים: "אינסל 150, אולד 250, מקורי סרוויס 1170" → שלוש שורות
export function splitMulti(line) {
  const tk = toShekel(line).split(/\s+/).filter(Boolean);
  const val = (t) => {
    const m = t.replace(/^[₪:,;|/(\-]+|[₪.,;|/):\-]+$/g, '').match(/^(\d{1,3}(?:,\d{3})+|\d{2,6})$/);
    if (!m) return null;
    const v = num(m[1]);
    return v >= 50 && !STORAGE.has(v) ? v : null;
  };
  let at = tk.map((t, i) => (val(t) != null ? i : -1)).filter((i) => i >= 0);
  at = at.filter((i, k) => !(k < at.length - 1 && /^20[1-3]\d$/.test(String(val(tk[i]))))); // שנה ("A3 2016") ולא מחיר
  if (at.length < 2) return [line];
  const segs = [];
  let start = 0;
  at.forEach((i, k) => {
    let end = i;
    if (tk[end + 1] === '₪') end++;
    if (k === at.length - 1) end = tk.length - 1;
    segs.push(tk.slice(start, end + 1).join(' ').replace(/^[,;|/\-–\s]+|[,;|\s]+$/g, ''));
    start = end + 1;
  });
  // כל חלק צריך מילה לפני המחיר, אחרת זו לא רשימת איכויות
  if (segs.some((g) => !/[\p{L}]/u.test(g.replace(/₪/g, '')))) return [line];
  return segs;
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
  const lines = String(text || '').split(/\r?\n/)
    .filter((l) => !WA_SYSTEM.test(l))
    .map((l) => {
      const c = l.replace(/^[\s\u200e\u200f\u202a-\u202e\u2066-\u2069]+/, '');
      const m = c.match(WA_HEADER);
      return m && m[0].trim() ? c.slice(m[0].length) : l;
    });
  const tabLines = lines.filter((l) => l.includes('\t')).length;
  const items = tabLines >= 3 && tabLines >= lines.filter((l) => l.trim()).length * 0.3 ? parseTable(lines, opts) : parseFree(lines, opts);
  const kept = items.filter((it) => !it.excluded);
  items.length = 0; items.push(...kept);
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
  let ctxBrand = null, pending = [], base = null, last = null, basePriced = false;
  const L = opts.kind === 'parts' ? lines.map(clean).flatMap((l) => (l ? splitMulti(l) : [l])) : lines.map(clean);
  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    if (!line) { pending = []; base = null; last = null; continue; }
    const p = extractPrice(line);
    if (!p) {
      const prevBlank = i === 0 || !L[i - 1];
      const next = L[i + 1] || '';
      const np = next ? extractPrice(next) : null;
      // שורה שהיא רק שם יצרן ("אפל", "Samsung.") היא תמיד כותרת של קטע
      const brandOnly = !!headerBrand(line) && tokenize(line).every((t) => HEADER_WORDS.has(t) || /^[\u0590-\u05ff]+$/.test(t));
      const isHeader = brandOnly || (prevBlank && (!next || (np && hasModel(np.rest)) || (!np && hasModel(next) && !hasModel(line))));
      if (isHeader && !/\d/.test(line)) {
        ctxBrand = headerBrand(line);
        pending = []; base = null; last = null;
        continue;
      }
      const shortNote = line.split(' ').length <= 5 && !/\d{5,}|\d{2,4}[-/]\d{3,}/.test(line);
      if (!hasModel(line) && last && !pending.length && shortNote) { // הערה לפריט הקודם
        last.variant = fixQuality([last.variant, line].filter(Boolean).join(' '));
        last.raw += ' / ' + line;
        last.key = last.kind === 'part' ? `${last.mkey}|${last.partType}|${last.variant}` : `${last.mkey}|${last.storage || ''}|${last.variant}`;
        continue;
      }
      pending.push(line);
      continue;
    }
    let name, note = '', fromBase = false;
    if (hasModel(p.rest)) {
      name = p.rest;
      if (pending.length && !hasModel(pending.join(' '))) note = pending.join(' ');
      else if (pending.length && !identify(p.rest, ctxBrand).family) name = pending.join(' ') + ' ' + p.rest;
      pending = [];
      base = name; basePriced = true;
    } else {
      if (pending.length) { base = pending.join(' '); pending = []; basePriced = false; }
      if (!base) { // מחיר בלי שם – לא ניתן לשייך
        items.push({ ...makeItem(p.rest, '', p.price, ctxBrand, line, opts), ok: false });
        continue;
      }
      name = base; note = p.rest; fromBase = true;
    }
    const it = makeItem(name, note, p.price, ctxBrand, (fromBase ? base + ' / ' : '') + line, fromBase && basePriced ? { ...opts, dropExtra: true } : opts);
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
    if (o?.categoryOverride && !rec.categoryOverride) rec.categoryOverride = o.categoryOverride; // קטגוריית רווח שנקבעה ידנית נשמרת גם כשהספק שולח מחירון חדש
    if (!replace && idx.has(n.key)) out[idx.get(n.key)] = rec; else { idx.set(n.key, out.length); out.push(rec); }
  }
  return out;
}

/** פריט שנוצר או נערך ידנית. אם השם לא מזוהה כדגם מוכר – נשמר בדיוק כפי שנכתב */
export function manualItem(f, kind, prev = null, now = Date.now()) {
  const opts = { kind: kind === 'parts' ? 'parts' : 'devices', partType: f.partType || 'screen' };
  const name = String(f.name || '').trim();
  const storageTxt = opts.kind === 'devices' && f.storage ? ` ${f.storage}` : '';
  const it = makeItem(name + storageTxt, f.variant || '', Number(f.price), null, prev?.raw || 'ידני', opts);
  if (opts.kind === 'parts' && f.partType) it.partType = f.partType; // סוג חלק שנבחר במפורש גובר על זיהוי מהטקסט
  if (opts.kind === 'devices' && f.storage && it.family) { // נפח שהוזן במפורש גובר על נפח שזוהה מהשם
    it.storage = Number(f.storage);
    it.name = [it.model, fmtStorage(it.storage)].filter(Boolean).join(' ');
  }
  if (!it.family) { // לא זוהה דגם מובנה – שם חופשי
    it.model = name;
    it.mkey = `${(it.brand || '').toLowerCase()}|${name.toLowerCase()}`;
    it.name = opts.kind === 'parts' ? name : [name, f.storage ? (f.storage >= 1024 ? `${f.storage / 1024}TB` : `${f.storage}GB`) : ''].filter(Boolean).join(' ');
    it.storage = opts.kind === 'devices' && f.storage ? Number(f.storage) : null;
    it.key = opts.kind === 'parts' ? `${it.mkey}|${it.partType}|${it.variant}` : `${it.mkey}|${it.storage || ''}|${it.variant}`;
  }
  it.variant = String(f.variant || '').trim();
  it.key = opts.kind === 'parts' ? `${it.mkey}|${it.partType}|${it.variant}` : `${it.mkey}|${it.storage || ''}|${it.variant}`;
  if (f.categoryOverride) it.categoryOverride = f.categoryOverride;
  it.manual = true;
  delete it.unknownModel; // בהזנה ידנית שם חופשי מותר
  it.ok = Boolean(it.model && it.price > 0);
  const priceChanged = prev && prev.price !== it.price;
  return {
    ...it,
    updatedAt: now,
    prevPrice: priceChanged ? prev.price : prev?.prevPrice ?? null,
    changedAt: priceChanged || !prev ? now : prev.changedAt ?? now,
  };
}
