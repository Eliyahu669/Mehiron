// מחירון תיקונים: סוגי תיקון (קבועים + שהמנהל הוסיף), רמות איכות לכל סוג, ומסגרת
// כל ספק כותב את אותה איכות אחרת ("אינסל", "Incell", "איינסל") – כאן הן מתורגמות לשם אחד,
// כדי להשוות מחירים בין ספקים ולהציג ללקוח שם אחיד
import { REPAIRS } from './defaults.js';

const q = (id, label, words) => ({ id, label, words });
const SERVICE = (label = 'מקורי סרוויס') => q('service', label, ['סרוויס', 'service', 'service pack', 'servicepack', 'sp', 'סאני', 'gh82']);
const ORIGINAL = (label = 'מקורי') => q('original', label, ['מקורי', 'מקורית', 'original', 'orig', 'ori', 'oem']);
const COPY = (label = 'תחליפי') => q('copy', label, ['תחליפי', 'תחליפית', 'חליפי', 'חליפיי', 'תואם', 'תואמת', 'copy', 'aftermarket']);
const SCREEN = () => [
  SERVICE(),
  q('refurb', 'מקורי משופץ', ['משופץ', 'מחודש', 'פירוק', 'refurbished', 'refurb', 'pulled']),
  q('softoled', 'Soft OLED', ['soft oled', 'softoled', 'סופט אולד']),
  q('oled', 'OLED', ['oled', 'אולד', 'hard oled', 'amoled']),
  q('incell', 'אינסל', ['incell', 'in cell', 'אינסל', 'איינסל', 'איינסלי']),
  COPY(),
  ORIGINAL(),
];
// הסדר קובע גם את העדיפות בזיהוי: "מקורי סאני" הוא מקורי סרוויס (לא "מקורי"), "תחליפי OLED" הוא OLED
export const DEFAULT_QUALITIES = {
  screen: SCREEN(),
  outer: SCREEN(),
  battery: [SERVICE('מקורית סרוויס'), ORIGINAL('מקורית'), COPY('תחליפית')],
};
const GENERIC = () => [SERVICE(), ORIGINAL(), COPY()];

// laborFrom: כל עוד לא נקבעה עלות עבודה לסוג הזה, חלק שיש לו מחיר מחושב עם עלות העבודה של סוג אחר
// (עד עכשיו המסך החיצוני של המתקפלים חושב כמו מסך – כך המחירים לא משתנים עד שקובעים לו עלות משלו)
export const DEFAULT_CUSTOM_REPAIRS = [
  { id: 'outer', label: 'מסך חיצוני', words: ['מסך חיצוני', 'חיצוני', 'cover screen', 'outer screen', 'outer'], laborFrom: 'screen' },
];

export const FRAME = { with: 'כולל מסגרת', without: 'ללא מסגרת' };
export const STANDARD = 'סטנדרטי';

/** כל סוגי התיקון: 6 הקבועים + מה שהמנהל הוסיף בהגדרות */
const customs = (cfg) => ((cfg?.customRepairs) || []).filter((r) => r && r.id && r.label)
  .map((r) => ({ ...r, words: [...new Set([r.label, ...(r.words || [])].map((w) => String(w).trim()).filter(Boolean))] }));
export const allRepairs = (cfg) => [...REPAIRS, ...customs(cfg)];
export const repairLabel = (id, cfg) => allRepairs(cfg).find((r) => r.id === id)?.label || id || '';

/** רמות האיכות של סוג תיקון (מההגדרות, או ברירת המחדל) */
export function qualitiesFor(repair, cfg) {
  const own = cfg?.qualities?.[repair];
  if (Array.isArray(own) && own.length) return own;
  return DEFAULT_QUALITIES[repair] || GENERIC();
}
export const qualityLabel = (repair, qid, cfg) => qualitiesFor(repair, cfg).find((x) => x.id === qid)?.label || '';

// ---- פירוק טקסט לטוקנים (עם תחיליות עבריות: "והמקורי" → "מקורי") ----
// "סאניללא מסגרת" (מילים שנדבקו במחירון) → "סאני ללא מסגרת"
const toks = (s) => String(s || '').toLowerCase().replace(/([\u0590-\u05ff]{2,})(ללא|כולל)(?=[^\u0590-\u05ff]|$)/g, '$1 $2')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
const longestFirst = (words) => [...words].sort((a, b) => toks(b).length - toks(a).length);
const variants = (t) => {
  const out = [t];
  let x = t;
  for (let i = 0; i < 2 && /^[והבלמש][֐-׿]{3,}/.test(x); i++) { x = x.slice(1); out.push(x); }
  return out;
};
/** מחפש ביטוי (מילה או כמה מילים ברצף) בטקסט. מחזיר [התחלה, אורך] או null */
function findPhrase(tk, phrase) {
  const p = toks(phrase);
  if (!p.length) return null;
  for (let i = 0; i + p.length <= tk.length; i++) {
    let ok = true;
    for (let j = 0; j < p.length && ok; j++) ok = variants(tk[i + j]).includes(p[j]);
    if (ok) return [i, p.length];
  }
  return null;
}
const without = (tk, hit) => (hit ? [...tk.slice(0, hit[0]), ...tk.slice(hit[0] + hit[1])] : tk);

// מסגרת: "כולל מסגרת" (גם בשגיאות כתיב שבמחירונים: כוולל, כוול, כלל) / "ללא מסגרת" / "עם מסגרת"
const FRAME_WORDS = ['מסגרת', 'frame'];
const WITHOUT_WORDS = ['ללא', 'בלי', 'without', 'no', 'wo'];
const WITH_WORDS = ['כולל', 'כוולל', 'כוול', 'כלל', 'כול', 'עם', 'with', 'w', 'incl'];
function takeFrame(tk) {
  for (let i = 0; i < tk.length; i++) {
    if (!variants(tk[i]).some((v) => FRAME_WORDS.includes(v))) continue;
    const prev = tk[i - 1];
    if (prev && WITHOUT_WORDS.includes(prev)) return { frame: 'without', tk: [...tk.slice(0, i - 1), ...tk.slice(i + 1)] };
    if (prev && WITH_WORDS.includes(prev)) return { frame: 'with', tk: [...tk.slice(0, i - 1), ...tk.slice(i + 1)] };
    return { frame: 'with', tk: [...tk.slice(0, i), ...tk.slice(i + 1)] };
  }
  return { frame: null, tk };
}

// מילים שלא אומרות כלום על האיכות (לא נשאלים עליהן)
const FILLER = new Set(['מסך', 'מסכים', 'screen', 'lcd', 'display', 'סוללה', 'battery', 'ל', 'של', 'עם', 'כולל', 'חדש', 'new', 'מלאי', 'מוגבל', 'במלאי', 'יש', 'ללא', 'בלי']);

/**
 * מה האיכות של פריט: { qid, label, frame, note }
 * qid = '' כשלא זוהתה איכות מהרשימה. note = מה שנשאר מהטקסט (מילה שאולי היא איכות שלא מוכרת)
 * defaultQid – איכות לשורות בלי שם איכות (לפי הגדרת הספק)
 */
export function resolveQuality(repair, variant, cfg, defaultQid = '') {
  const list = qualitiesFor(repair, cfg);
  let tk = toks(variant);
  const fr = takeFrame(tk);
  tk = fr.tk;
  // מילים של סוג התיקון עצמו ("מסך חיצוני") לא שייכות לאיכות
  for (const r of allRepairs(cfg)) for (const w of longestFirst(r.words || [])) tk = without(tk, findPhrase(tk, w));
  let found = null, hit = null;
  for (const x of list) {
    for (const w of longestFirst([x.label, ...(x.words || [])])) { hit = findPhrase(tk, w); if (hit) break; }
    if (hit) { found = x; break; }
  }
  const noise = new Set((cfg?.qualityNoise || []).flatMap((w) => toks(w)));
  const rest = without(tk, hit).filter((t) => !FILLER.has(t) && !noise.has(t) && !/^\d+$/.test(t));
  if (!found && defaultQid) found = list.find((x) => x.id === defaultQid) || null;
  return { qid: found?.id || '', label: found?.label || '', frame: fr.frame, note: rest.join(' ') };
}

/** שם האפשרות שהלקוח רואה: "מקורי סרוויס · כולל מסגרת" */
export function optionName(r) {
  const base = r.label || r.note || STANDARD;
  return r.frame ? `${base} · ${FRAME[r.frame]}` : base;
}

/** מפתח קבוצה: אותה איכות + מסגרת אצל כל הספקים */
export const groupId = (r) => (r.qid ? `${r.qid}|${r.frame || ''}` : `?${toks(r.note).sort().join(' ')}|${r.frame || ''}`);
export const optionKey = (mkey, repair, gid) => `${mkey}|${repair}|q:${gid}`;

/** הטקסט שנשמר בפריט כשמזינים ידנית (חוזר לאותה איכות בזיהוי) */
export const variantText = (repair, qid, frame, cfg) => [qualityLabel(repair, qid, cfg), frame ? FRAME[frame] : ''].filter(Boolean).join(' ');

/** סוג תיקון שהמנהל הוסיף, אם המילים שלו מופיעות בטקסט ("מסך חיצוני") */
export function customRepairOf(text, cfg) {
  const tk = toks(text);
  for (const r of customs(cfg)) {
    if (r.words.some((w) => findPhrase(tk, w))) return r.id;
  }
  return null;
}

/** סוג התיקון של פריט: סוג שהמנהל הוסיף גובר אם המילים שלו מופיעות בטקסט (גם בפריטים שנשמרו לפני שהסוג נוסף) */
export function effectivePartType(it, cfg) {
  if (it.manual) return it.partType;
  return customRepairOf(`${it.variant || ''} ${it.raw || ''}`, cfg) || it.partType;
}

/** מילת תיקון בחיפוש / בשורה של ספק – קודם ביטויים ארוכים ("מסך חיצוני") */
export function findRepairIn(text, cfg) {
  const tk = toks(text);
  const cands = [];
  for (const r of allRepairs(cfg)) for (const w of r.words || []) cands.push([r.id, w]);
  cands.sort((a, b) => toks(b[1]).length - toks(a[1]).length);
  for (const [id, w] of cands) {
    const hit = findPhrase(tk, w);
    if (hit) return { id, hit, tokens: tk };
  }
  return null;
}

/** מסיר מהחיפוש את מילות התיקון ומשאיר את שאר המילים כמו שנכתבו ("Note 13 Pro+ מסך" → "Note 13 Pro+") */
export function stripRepairWords(text, cfg) {
  const f = findRepairIn(text, cfg);
  if (!f) return String(text || '');
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const per = words.map((w) => toks(w));
  let seen = 0;
  const keep = [];
  for (let i = 0; i < words.length; i++) {
    const from = seen, to = seen + per[i].length;
    seen = to;
    const inHit = per[i].length > 0 && from >= f.hit[0] && to <= f.hit[0] + f.hit[1];
    if (!inHit) keep.push(words[i]);
  }
  return keep.join(' ');
}

/**
 * תשובה של ספק על דגם אחד ("אינסל 150, אולד 250, מקורי סרוויס 1170") → שורות איכות + מסגרת + מחיר.
 * extractPrice / splitMulti מועברים מבחוץ (parser.js) כדי לא ליצור תלות מעגלית
 */
export function parseReply(text, repair, cfg, { extractPrice, splitMulti }) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    for (const seg of splitMulti(line.trim())) {
      if (!seg) continue;
      const p = extractPrice(seg);
      if (!p) continue;
      const r = resolveQuality(repair, p.rest, cfg);
      out.push({ qid: r.qid, frame: r.frame, note: r.note, price: p.price, raw: seg });
    }
  }
  return out;
}

/** פריט חלק שהוזן ידנית לדגם מסוים (מעמוד הדגם / מהאקסל) */
export function manualPart({ model, repair, qid, frame, price, variant = null, prev = null, cfg, now = Date.now() }) {
  const v = variant != null ? variant : variantText(repair, qid, frame, cfg);
  const changed = !prev || prev.price !== price;
  return {
    kind: 'part', partType: repair, brand: model.brand || null, model: model.model, name: model.model,
    family: model.family || null, tier: model.tier || null, devKind: model.devKind || 'phone', category: null, storage: null,
    mkey: model.mkey, variant: v, price, raw: prev?.raw && prev.raw !== 'ידני' ? prev.raw : 'ידני', manual: true,
    key: `${model.mkey}|${repair}|${v}`,
    updatedAt: now, prevPrice: prev ? (changed ? prev.price : prev.prevPrice ?? null) : null, changedAt: changed ? now : prev.changedAt ?? now,
  };
}

// ---------- עמודות החלקים בקובץ "חלקי חילוף" ובטבלת הספק ----------
// לכל עמודה: סוג תיקון, איכות (id מהרשימה; '' = בלי שם איכות; '*' = כל איכות), ומסגרת:
// '' = ללא / לא צוין, 'with' = כולל מסגרת, '*' = לא משנה (המחיר הזול מביניהם)
const col = (label, repair, qid = '*', frame = '*') => ({ label, repair, qid, frame });
const SCREEN_Q = [['', 'מסך'], ['copy', 'מסך תחליפי'], ['incell', 'מסך אינסל'], ['oled', 'מסך OLED'], ['softoled', 'מסך Soft OLED'],
  ['refurb', 'מסך מקורי משופץ'], ['service', 'מסך מקורי סרוויס'], ['original', 'מסך מקורי']];
const withFrames = () => SCREEN_Q.flatMap(([qid, label]) => [col(label, 'screen', qid, ''), col(`${label} כולל מסגרת`, 'screen', qid, 'with')]);
const ANDROID = () => [...withFrames(), col('מסך חיצוני', 'outer'), col('סוללה', 'battery'), col('שקע טעינה', 'port'), col('גב אחורי', 'back'), col('מצלמה', 'camera'), col('החלפת גוף', 'housing')];
export const DEFAULT_PART_COLUMNS = {
  // כמו בקובץ הדוגמה
  apple: [
    col('מסך תחליפי', 'screen', 'copy'), col('מסך אינסל', 'screen', 'incell'), col('מסך OLED', 'screen', 'oled'), col('מסך Soft OLED', 'screen', 'softoled'),
    col('מסך מקורי משופץ', 'screen', 'refurb'), col('מסך מקורי סרוויס', 'screen', 'service'), col('מסך מקורי', 'screen', 'original'),
    col('סוללה חליפית', 'battery', 'copy'), col('סוללה מקורית', 'battery', 'original'), col('שקע טעינה', 'port'), col('מצלמה אחורית', 'camera'),
    col('גב תחליפי', 'back', 'copy'), col('גב מקורי', 'back', 'original'),
  ],
  // עמודה לכל איכות מסך + "כולל מסגרת" (במחירון של סמסונג יש לרוב כמה מסכים לדגם)
  samsung: ANDROID(),
  xiaomi: ANDROID(),
  other: ANDROID(),
};
export function partColumns(sheet, cfg) {
  const own = cfg?.partColumns?.[sheet];
  return Array.isArray(own) && own.length ? own : DEFAULT_PART_COLUMNS[sheet] || DEFAULT_PART_COLUMNS.other;
}
const frameOk = (cf, f) => cf === '*' || (cf === 'with' ? f === 'with' : f !== 'with');
/** באיזו עמודה מופיע פריט (סוג תיקון + איכות + מסגרת). -1 = אין עמודה מתאימה */
export function columnOf(cols, repair, qid, frame) {
  let i = cols.findIndex((c) => c.repair === repair && c.qid === (qid || '') && frameOk(c.frame, frame));
  if (i < 0) i = cols.findIndex((c) => c.repair === repair && c.qid === '*' && frameOk(c.frame, frame));
  return i;
}
/** האיכות והמסגרת של פריט חדש שנכתב בעמודה */
export const columnTarget = (c) => ({ repair: c.repair, qid: c.qid === '*' ? '' : c.qid, frame: c.frame === 'with' ? 'with' : null });
