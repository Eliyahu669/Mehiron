// ייצוא וייבוא של כל הפריטים לקובץ אקסל (xlsx) – שני גיליונות: "מחירון תיקונים" ו"מחירון מכשירים".
//
// בכל שורה נשמרת עמודה מוסתרת עם הערכים שיוצאו ("_מקור"), ובקובץ יש גיליון מוסתר עם רשימת הפריטים
// שיוצאו. כך הייבוא משנה רק את מה שבאמת שונה בקובץ – גם אם בינתיים המחירון עודכן מוואטסאפ –
// ומוחק רק פריטים שהיו בקובץ ונמחקו ממנו (ולא פריטים שנוספו לאפליקציה אחרי הייצוא).
import { REPAIRS } from './defaults.js';
import { buildCatalog, activeLists } from './catalog.js';
import { repairQuote, deviceQuotes, qualityKey, repairGroupKey, deviceGroupKey } from './pricing.js';
import { manualItem, detectPartType } from './parser.js';
import { fmtStorage } from './normalize.js';
import { uniqueKey } from './items.js';

export const SHEET_REPAIRS = 'מחירון תיקונים';
export const SHEET_DEVICES = 'מחירון מכשירים';
const SHEET_META = '_ייצוא';

// קטגוריות רווח בשמות קצרים (רשימה נפתחת באקסל מוגבלת ל-255 תווים)
export const CAT_SHORT = { flagship: 'דגל', mid: 'ביניים', wearable: 'אוזניות ושעונים', accessory: 'אביזרים', other: 'אחר' };
const AUTO = 'אוטומטי';

export const COLS = {
  repairs: [
    { key: 'supplier', header: 'ספק', width: 22 },
    { key: 'model', header: 'דגם', width: 26 },
    { key: 'partType', header: 'סוג חלק', width: 13 },
    { key: 'variant', header: 'איכות', width: 26 },
    { key: 'price', header: 'מחיר ספק', width: 11, num: true },
    { key: 'customer', header: 'מחיר ללקוח', width: 12, num: true },
    { key: 'updated', header: 'עודכן', width: 12, date: true },
    { key: 'id', header: 'מזהה', width: 18 },
    { key: 'orig', header: '_מקור', width: 10, hidden: true },
  ],
  devices: [
    { key: 'supplier', header: 'ספק', width: 22 },
    { key: 'model', header: 'דגם', width: 26 },
    { key: 'storage', header: 'נפח', width: 9 },
    { key: 'variant', header: 'וריאנט', width: 26 },
    { key: 'category', header: 'קטגוריית רווח', width: 15 },
    { key: 'margin', header: 'אחוז רווח', width: 10 },
    { key: 'price', header: 'מחיר ספק', width: 11, num: true },
    { key: 'customer', header: 'מחיר ללקוח', width: 12, num: true },
    { key: 'updated', header: 'עודכן', width: 12, date: true },
    { key: 'id', header: 'מזהה', width: 18 },
    { key: 'orig', header: '_מקור', width: 10, hidden: true },
  ],
};

// הסברים שמופיעים באקסל כשבוחרים תא בעמודה (הודעת קלט של אימות נתונים – בלי "הערות", שתוכנות אחרות שומרות בצורה שלא תמיד נקראת)
const PROMPTS = {
  supplier: 'בחירה מהרשימה. שם ספק שלא קיים ייצור ספק חדש.',
  customer: 'ריק = מחיר אוטומטי. מספר = מחיר ידני ללקוח, לאותו דגם ואיכות אצל כל הספקים. מחיקת המספר מחזירה לאוטומטי.',
  storage: 'למשל 128GB או 1TB. ריק = בלי נפח.',
  category: 'אוטומטי = לפי סוג המכשיר.',
  margin: 'ריק = לפי הקטגוריה. מספר = אחוז רווח לפריט הזה, לאותו דגם, נפח ווריאנט אצל כל הספקים. מחיקת המספר מחזירה לקטגוריה.',
  id: 'לא לשנות. בשורה חדשה – להשאיר ריק. מחיקת שורה מוחקת את הפריט מהאפליקציה.',
};

export const idOf = (supplierId, key) => `${supplierId}~${key}`;
const numOrNull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const partLabel = (id) => REPAIRS.find((r) => r.id === id)?.label || id || '';
const itemLabel = (it) => [it.name || it.model, it.kind === 'part' ? partLabel(it.partType) : '', it.variant].filter(Boolean).join(' · ');
// תאריך מקומי (בלי שעה), כדי שאקסל לא יזיז אותו ביום בגלל אזור הזמן
const excelDate = (ts) => { if (!ts) return null; const d = new Date(ts); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

/** מחיר ללקוח (הסופי, כמו באפליקציה) לפריט – לפי הקבוצה שלו: דגם + תיקון + איכות / דגם + נפח + וריאנט */
function customerPricer(catalog, cfg) {
  const models = new Map(catalog.models.map((m) => [m.mkey, m]));
  const rq = new Map(), dq = new Map();
  return (it) => {
    const model = models.get(it.mkey) || it;
    if (it.kind === 'part') {
      const k = `${it.mkey}|${it.partType}`;
      if (!rq.has(k)) rq.set(k, repairQuote(model, it.partType, catalog.partIndex.get(k) || [], cfg));
      return rq.get(k).options.find((o) => qualityKey(o.quality) === qualityKey(it.variant))?.final ?? null;
    }
    if (!dq.has(it.mkey)) dq.set(it.mkey, deviceQuotes(model, catalog.deviceIndex.get(it.mkey) || [], cfg));
    return dq.get(it.mkey).find((g) => deviceGroupKey(g.item) === deviceGroupKey(it))?.final ?? null;
  };
}

/** שורות הייצוא (נתונים בלבד) */
export function exportRows(lists, cfg) {
  const act = activeLists(lists, cfg);
  const priceOf = customerPricer(buildCatalog(act), cfg);
  const out = { repairs: [], devices: [] };
  for (const s of cfg.suppliers || []) {
    for (const it of act[s.id]?.items || []) {
      const kind = it.kind === 'part' ? 'repairs' : 'devices';
      const customer = priceOf(it);
      const model = it.model || it.name || '';
      const row = { supplier: s.name, model, variant: it.variant || '', price: it.price, customer, updated: excelDate(it.updatedAt), id: idOf(s.id, it.key) };
      if (kind === 'repairs') row.partType = partLabel(it.partType);
      else {
        row.storage = fmtStorage(it.storage) || null;
        row.category = (it.categoryOverride && CAT_SHORT[it.categoryOverride]) || AUTO;
        row.margin = numOrNull(cfg.marginOverrides?.[deviceGroupKey(it)]);
      }
      row.orig = JSON.stringify({ s: s.id, n: s.name, m: model, t: it.partType || null, g: it.storage || null, q: row.variant, k: it.categoryOverride || null, p: it.price, c: customer, r: row.margin ?? null });
      out[kind].push(row);
    }
  }
  return out;
}

/** בונה את חוברת האקסל. ExcelJS מועבר מבחוץ (נטען רק כשצריך) */
export function buildWorkbook(ExcelJS, lists, cfg, now = Date.now()) {
  const rows = exportRows(lists, cfg);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'מחירון';
  wb.created = new Date(now);
  const listFormula = (values) => {
    const safe = values.filter((v) => v && !/[,"]/.test(v));
    const f = `"${safe.join(',')}"`;
    return safe.length && f.length <= 255 ? [f] : null;
  };
  const add = (name, kind) => {
    const cols = COLS[kind];
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, hidden: !!c.hidden }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFF4' } }; });
    for (const r of rows[kind]) ws.addRow(r);
    cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.num) col.numFmt = '#,##0';
      if (c.date) col.numFmt = 'dd/mm/yyyy';
      if (c.key === 'id' || c.key === 'updated') col.font = { color: { argb: 'FF8E8E93' } };
    });
    const last = rows[kind].length + 500; // מקום גם לשורות חדשות
    const range = (key) => { const l = String.fromCharCode(65 + cols.findIndex((c) => c.key === key)); return `${l}2:${l}${last}`; };
    const prompt = (key, title) => (PROMPTS[key] ? { showInputMessage: true, promptTitle: title, prompt: PROMPTS[key] } : {});
    const sup = listFormula((cfg.suppliers || []).filter((s) => (s.type === 'parts') === (kind === 'repairs')).map((s) => s.name));
    ws.dataValidations.add(range('supplier'), { ...(sup ? { type: 'list', formulae: sup } : { type: 'any' }), allowBlank: true, showErrorMessage: false, ...prompt('supplier', 'ספק') });
    const positive = (title) => ({ type: 'decimal', operator: 'greaterThan', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: title, error: 'מספר גדול מ-0' });
    ws.dataValidations.add(range('price'), positive('מחיר ספק'));
    ws.dataValidations.add(range('customer'), { ...positive('מחיר ללקוח'), ...prompt('customer', 'מחיר ללקוח') });
    ws.dataValidations.add(range('id'), { type: 'any', ...prompt('id', 'מזהה') });
    if (kind === 'repairs') {
      ws.dataValidations.add(range('partType'), { type: 'list', allowBlank: true, showErrorMessage: true, errorTitle: 'סוג חלק', error: 'בחר מהרשימה', formulae: listFormula(REPAIRS.map((r) => r.label)) });
    } else {
      ws.dataValidations.add(range('storage'), { type: 'any', ...prompt('storage', 'נפח') });
      ws.dataValidations.add(range('category'), { type: 'list', allowBlank: true, showErrorMessage: true, errorTitle: 'קטגוריית רווח', error: 'בחר מהרשימה', formulae: listFormula([AUTO, ...Object.values(CAT_SHORT)]), ...prompt('category', 'קטגוריית רווח') });
      ws.dataValidations.add(range('margin'), { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: 'אחוז רווח', error: 'מספר (0 ומעלה)', ...prompt('margin', 'אחוז רווח') });
    }
  };
  add(SHEET_REPAIRS, 'repairs');
  add(SHEET_DEVICES, 'devices');
  const meta = wb.addWorksheet(SHEET_META);
  meta.state = 'veryHidden';
  meta.addRow(['exportedAt', now]);
  for (const r of [...rows.repairs, ...rows.devices]) meta.addRow([r.id]);
  return { wb, counts: { repairs: rows.repairs.length, devices: rows.devices.length } };
}

export function exportFileName(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `מחירון-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
}

// ---------- קריאת הקובץ ----------

/**
 * ExcelJS נופל ("reading 'comments'") על קבצים שתוכנות אחרות שמרו עם הערות בתאים, כי הוא מכיר רק את המבנה של אקסל.
 * לייבוא ההערות לא חשובות – מדלגים על הערות שלא נמצאו במקום שהוא מצפה.
 */
export function hardenExcelJS(ExcelJS) {
  const proto = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx);
  if (!proto || proto.__mehironSafe || typeof proto.reconcile !== 'function') return ExcelJS;
  const original = proto.reconcile;
  const safe = (o) => new Proxy(o || {}, { get: (t, k) => (typeof k === 'string' && !(k in t) ? { comments: [] } : t[k]) });
  proto.reconcile = function reconcile(model, options) {
    if (model) { model.comments = safe(model.comments); model.vmlDrawings = safe(model.vmlDrawings); }
    return original.call(this, model, options);
  };
  proto.__mehironSafe = true;
  return ExcelJS;
}

function cellValue(v) {
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return v.text;
    return null; // שגיאה / נוסחה בלי ערך
  }
  return v;
}

const str = (v) => (v == null || v instanceof Date ? '' : String(v).replace(/\s+/g, ' ').trim());

export function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v).replace(/ש["״׳']?ח|שקל(ים)?|nis/gi, '').replace(/[₪,%\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function parseStorage(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  const s = String(v).toLowerCase().replace(/\s/g, '');
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(gb|g|ג׳?יגה|tb|t|טרה)?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  return m[2] && /^(tb|t|טרה)$/.test(m[2]) ? n * 1024 : n;
}

const isPercentFmt = (f) => typeof f === 'string' && f.replace(/"[^"]*"/g, '').includes('%');

/** קורא חוברת אקסל לשורות. גיליון שלא נמצא = null (לא נוגעים בסוג הזה בכלל) */
export function readWorkbook(wb) {
  const metaWs = wb.worksheets.find((ws) => ws.name === SHEET_META);
  let manifest = null;
  if (metaWs) {
    const ids = new Set();
    let exportedAt = null;
    metaWs.eachRow((row, n) => {
      const v = str(cellValue(row.getCell(1).value));
      if (n === 1 && v === 'exportedAt') exportedAt = Number(cellValue(row.getCell(2).value)) || null;
      else if (v) ids.add(v);
    });
    manifest = { ids, exportedAt };
  }
  const visible = wb.worksheets.filter((ws) => ws.name !== SHEET_META);
  const read = (ws, kind) => {
    if (!ws) return null;
    const colOf = {};
    ws.getRow(1).eachCell((cell, n) => {
      const c = COLS[kind].find((x) => x.header === str(cellValue(cell.value)));
      if (c && !colOf[c.key]) colOf[c.key] = n;
    });
    if (!colOf.model || !colOf.price) return { error: `בגיליון "${ws.name}" לא נמצאו העמודות "דגם" ו"מחיר ספק" בשורה הראשונה` };
    if (manifest && !colOf.id) return { error: `בגיליון "${ws.name}" חסרה העמודה "מזהה" – בלעדיה אי אפשר לדעת איזו שורה שייכת לאיזה פריט` };
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const r = { row: n };
      for (const c of COLS[kind]) if (colOf[c.key]) r[c.key] = cellValue(row.getCell(colOf[c.key]).value);
      if (typeof r.margin === 'number' && isPercentFmt(row.getCell(colOf.margin).numFmt)) r.margin = Math.round(r.margin * 1e6) / 1e4; // "8%" באקסל = 0.08
      if (COLS[kind].some((c) => c.key !== 'orig' && c.key !== 'updated' && str(r[c.key]) !== '')) rows.push(r);
    });
    return { rows, name: ws.name };
  };
  return {
    repairs: read(visible.find((ws) => /תיקונ|מחירות/.test(ws.name)), 'repairs'),
    devices: read(visible.find((ws) => /מכשיר/.test(ws.name)), 'devices'),
    manifest,
  };
}

// ---------- תכנון הייבוא (בלי לשמור) ----------

const normName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const catFromCell = (v) => {
  const s = str(v);
  if (!s || s === AUTO) return { ok: true, value: null };
  const k = Object.keys(CAT_SHORT).find((x) => CAT_SHORT[x] === s || x === s);
  return k ? { ok: true, value: k } : { ok: false };
};
const partFromCell = (v) => {
  const s = str(v);
  if (!s) return null;
  return REPAIRS.find((x) => x.label === s || x.id === s)?.id || detectPartType(s);
};

// כל המפתחות של "מחיר ידני ללקוח" שחלים על אותה קבוצה (כולל מפתחות בפורמט ישן)
function groupOverrideKeys(po, item) {
  const out = [];
  if (item.kind === 'part') {
    const pre = `${item.mkey}|${item.partType}|`;
    const qk = qualityKey(item.variant);
    for (const k of Object.keys(po)) if (k.startsWith(pre) && qualityKey(k.slice(pre.length)) === qk) out.push(k);
  } else {
    const gk = deviceGroupKey(item);
    for (const k of Object.keys(po)) if (k.replace(/#\d+$/, '') === gk) out.push(k);
  }
  return out;
}

/**
 * משווה את הקובץ למצב הנוכחי ומחזיר מה ישתנה. לא שומר כלום.
 * מחזיר { lists: {supplierId: {items, supplierName, updatedAt}}, config (או null), summary, details, hasChanges }
 */
export function planImport(book, lists, cfg, now = Date.now()) {
  const act = activeLists(lists, cfg);
  const suppliers = (cfg.suppliers || []).map((s) => ({ ...s }));
  const supById = new Map(suppliers.map((s) => [s.id, s]));
  // ספק לפי שם (אם יש שניים באותו שם – קודם מהסוג של הגיליון)
  const findSup = (name, isPart) => {
    const all = suppliers.filter((s) => normName(s.name) === normName(name));
    return all.find((s) => (s.type === 'parts') === isPart) || all[0] || null;
  };
  const priceOf = customerPricer(buildCatalog(act), cfg);
  const existing = new Map(); // מזהה → { s, it }
  for (const s of suppliers) for (const it of act[s.id]?.items || []) existing.set(idOf(s.id, it.key), { s, it });
  const exportedIds = book.manifest?.ids || null;

  const invalid = [], notes = [], conflicts = [];
  const seenAll = new Set(); // מזהים שמופיעים בקובץ (גם בשורות לא תקינות – הפריט שלהן נשמר כמו שהוא)
  const kindsRead = [];
  const entries = [];

  // ---- שלב 1: קריאת כל השורות, בדיקת תקינות וזיהוי מה שונה (בלי לשנות כלום) ----
  for (const [kind, sheetName] of [['repairs', SHEET_REPAIRS], ['devices', SHEET_DEVICES]]) {
    const sheet = book[kind];
    if (!sheet) { notes.push(`הגיליון "${sheetName}" לא נמצא בקובץ – הפריטים שלו לא שונו`); continue; }
    if (sheet.error) { invalid.push({ sheet: sheetName, row: 1, reason: sheet.error }); continue; }
    kindsRead.push(kind);
    const isPart = kind === 'repairs';
    for (const r of sheet.rows) {
      const bad = (reason) => invalid.push({ sheet: sheetName, row: r.row, reason, name: str(r.model) });
      const id = str(r.id);
      if (id) seenAll.add(id);
      const known = id ? existing.get(id) || null : null;
      if (known && (known.it.kind === 'part') !== isPart) { bad(`הפריט שייך לגיליון "${isPart ? SHEET_DEVICES : SHEET_REPAIRS}" – אי אפשר להעביר בין הגיליונות`); continue; }
      let orig = null;
      try { const o = r.orig ? JSON.parse(String(r.orig)) : null; if (o && typeof o === 'object' && o.s) orig = o; } catch { orig = null; }

      const supCell = str(r.supplier);
      if (!supCell) { bad('חסר ספק'); continue; }
      const model = str(r.model);
      if (!model) { bad('חסר דגם'); continue; }
      const price = parseNum(r.price);
      if (price == null || Number.isNaN(price) || price <= 0) { bad(`מחיר ספק חסר או לא תקין${str(r.price) ? `: "${str(r.price)}"` : ''}`); continue; }
      const variant = str(r.variant);
      let partType = null, storage = null, category = null;
      if (isPart) {
        partType = partFromCell(r.partType);
        if (!partType) { bad(str(r.partType) ? `סוג חלק לא מוכר: "${str(r.partType)}"` : 'חסר סוג חלק'); continue; }
      } else {
        storage = parseStorage(r.storage);
        if (Number.isNaN(storage)) { bad(`נפח לא תקין: "${str(r.storage)}"`); continue; }
        const c = catFromCell(r.category);
        if (!c.ok) { bad(`קטגוריית רווח לא מוכרת: "${str(r.category)}"`); continue; }
        category = c.value;
      }
      const customer = parseNum(r.customer);
      if (Number.isNaN(customer) || (customer != null && customer <= 0)) { bad(`מחיר ללקוח לא תקין: "${str(r.customer)}"`); continue; }
      const margin = isPart ? null : parseNum(r.margin);
      if (Number.isNaN(margin) || (margin != null && margin < 0)) { bad(`אחוז רווח לא תקין: "${str(r.margin)}"`); continue; }

      // הערכים שיוצאו (מהעמודה המוסתרת; אם חסרה – הערכים הנוכחיים של הפריט)
      const base = orig
        ? { s: orig.s, n: orig.n ?? supById.get(orig.s)?.name ?? '', m: str(orig.m), t: orig.t || null, g: orig.g || null, q: str(orig.q), k: orig.k || null, p: Number(orig.p), c: orig.c ?? null, r: orig.r ?? null }
        : known
          ? { s: known.s.id, n: known.s.name, m: str(known.it.model || known.it.name), t: known.it.partType || null, g: known.it.storage || null, q: str(known.it.variant), k: known.it.categoryOverride || null, p: known.it.price, c: priceOf(known.it), r: isPart ? null : numOrNull(cfg.marginOverrides?.[deviceGroupKey(known.it)]) }
          : null;
      // ספק: אם השם לא שונה בקובץ – אותו ספק (גם אם בינתיים שמו שונה באפליקציה)
      const sameName = !!base && normName(supCell) === normName(base.n);
      const sup = sameName && supById.has(base.s) ? supById.get(base.s) : findSup(supCell, isPart);
      const ch = base && {
        supplier: !sameName && (!sup || sup.id !== base.s),
        model: base.m !== model,
        partType: isPart && base.t !== partType,
        storage: !isPart && (base.g || null) !== (storage || null),
        variant: base.q !== variant,
        category: !isPart && (base.k || null) !== (category || null),
        price: !(Math.abs(base.p - price) < 0.005),
        customer: base.c == null ? customer != null : customer == null || Math.round(customer) !== Math.round(base.c),
        margin: !isPart && (base.r == null ? margin != null : margin == null || Math.abs(margin - base.r) > 1e-9),
      };
      entries.push({ r, kind, sheetName, isPart, id, known, sup, supCell, ch, changed: !!ch && Object.values(ch).some(Boolean), v: { model, price, variant, partType, storage, category, customer, margin }, bad });
    }
  }

  // שורה שהועתקה (אותו מזהה פעמיים): הפריט הקיים נשאר לשורה שלא שונתה, והשורה ששונתה נוספת כפריט חדש
  const owner = new Map(); // מזהה → השורה שמייצגת את הפריט הקיים
  for (const e of entries) if (e.known && !e.changed && !owner.has(e.id)) owner.set(e.id, e);
  for (const e of entries) if (e.known && !owner.has(e.id)) owner.set(e.id, e);

  // ---- שלב 2: החלת השינויים על עותק של המחירונים ----
  const work = {};
  const listOf = (id) => (work[id] ||= [...(act[id]?.items || [])]);
  const touched = new Set();
  const newSuppliers = [];
  const det = { updated: [], added: [], deleted: [], overrides: [], margins: [] };
  const ovSet = new Map(), ovClear = new Map();
  const mgSet = new Map(), mgClear = new Map(); // אחוז רווח לפריט
  const n = { updated: 0, priceChanged: 0, added: 0, deleted: 0, gone: 0, dup: 0, exists: 0 };

  for (const e of entries) {
    const { r, isPart, ch, v } = e;
    const itemKind = isPart ? 'parts' : 'devices';
    const ex = e.known && owner.get(e.id) === e ? e.known : null;
    if (!ex && ch && !e.changed) { // שורה זהה למה שיוצא, בלי פריט קיים מתאים
      if (e.known) n.dup++; else n.gone++;
      continue;
    }
    let sup = e.sup || findSup(e.supCell, isPart); // (גם ספק חדש שנוצר בשורה קודמת)
    // ספק מהסוג השני – רק לפריט קיים שנשאר אצל אותו ספק (למשל אם סוג הספק שונה בהגדרות)
    if (sup && (sup.type === 'parts') !== isPart && (!ex || ch.supplier)) { e.bad(`"${sup.name}" מוגדר כספק ${sup.type === 'parts' ? 'חלקים' : 'מכשירים'}`); continue; }
    if (!sup) {
      sup = { id: `s${now.toString(36)}${newSuppliers.length}`, name: e.supCell, type: itemKind, phone: '' };
      suppliers.push(sup); supById.set(sup.id, sup); newSuppliers.push(e.supCell);
    }

    let item;
    if (ex) {
      // עדכון פריט קיים – רק שדות ששונו בקובץ ושעדיין שונים ממה שיש באפליקציה (ייבוא חוזר של אותו קובץ לא משנה שוב)
      const cur = ex.it;
      const eff = {
        model: ch.model && v.model !== str(cur.model || cur.name),
        partType: ch.partType && v.partType !== cur.partType,
        storage: ch.storage && (v.storage || null) !== (cur.storage || null),
        variant: ch.variant && v.variant !== str(cur.variant),
        price: ch.price && Math.abs(v.price - cur.price) >= 0.005,
        category: ch.category && (v.category || null) !== (cur.categoryOverride || null),
        supplier: ch.supplier && sup.id !== ex.s.id,
      };
      item = cur;
      if (eff.model || eff.partType || eff.storage || eff.variant) {
        const f = {
          name: eff.model ? v.model : cur.model || cur.name,
          partType: eff.partType ? v.partType : cur.partType,
          storage: eff.storage ? v.storage : cur.storage,
          variant: eff.variant ? v.variant : cur.variant || '',
          price: eff.price ? v.price : cur.price,
          categoryOverride: eff.category ? v.category || undefined : cur.categoryOverride,
        };
        const { ok, ...rec } = manualItem(f, itemKind, cur, now);
        item = rec;
        if (!eff.price) Object.assign(item, { updatedAt: cur.updatedAt, changedAt: cur.changedAt, prevPrice: cur.prevPrice ?? null });
      } else if (eff.price || eff.category) {
        item = { ...cur, manual: true };
        if (eff.price) Object.assign(item, { price: v.price, prevPrice: cur.price, changedAt: now, updatedAt: now });
        if (eff.category) { if (v.category) item.categoryOverride = v.category; else delete item.categoryOverride; }
      }
      const from = listOf(ex.s.id);
      const i = from.indexOf(cur);
      if (eff.supplier) {
        if (i >= 0) from.splice(i, 1);
        const to = listOf(sup.id);
        item = { ...item, key: uniqueKey(to, item.key) };
        to.push(item);
        touched.add(ex.s.id); touched.add(sup.id);
      } else if (item !== cur) {
        item = { ...item, key: uniqueKey(from, item.key, i) };
        if (i >= 0) from[i] = item; else from.push(item);
        touched.add(ex.s.id);
      }
      if (item !== cur) {
        n.updated++; if (eff.price) n.priceChanged++;
        const what = [eff.price && 'מחיר', eff.model && 'שם', eff.partType && 'סוג חלק', eff.storage && 'נפח', eff.variant && (isPart ? 'איכות' : 'וריאנט'), eff.category && 'קטגוריה', eff.supplier && `ספק (${sup.name})`].filter(Boolean);
        det.updated.push({ sheet: e.sheetName, row: r.row, name: itemLabel(item), before: cur.price, after: item.price, what });
      }
    } else {
      // פריט חדש: שורה בלי מזהה, שורה מועתקת ששונתה, או פריט שכבר לא קיים באפליקציה ושונה בקובץ
      const { ok, ...rec } = manualItem({ name: v.model, partType: v.partType, storage: v.storage, variant: v.variant, price: v.price, categoryOverride: v.category || undefined }, itemKind, null, now);
      if (!ok) { e.bad('לא ניתן ליצור פריט מהשורה'); continue; }
      const to = listOf(sup.id);
      // אותו פריט בדיוק כבר קיים אצל הספק (למשל ייבוא חוזר של אותו קובץ) – לא מכפילים, והוא גם לא נמחק
      const same = to.find((x) => x.key.replace(/#\d+$/, '') === rec.key && Math.abs(x.price - rec.price) < 0.005 && (x.categoryOverride || null) === (rec.categoryOverride || null));
      if (same) {
        seenAll.add(idOf(sup.id, same.key));
        n.exists++;
        item = same;
      } else {
        item = { ...rec, key: uniqueKey(to, rec.key) };
        to.push(item);
        touched.add(sup.id);
        n.added++;
        det.added.push({ sheet: e.sheetName, row: r.row, name: itemLabel(item), price: item.price, supplier: sup.name });
      }
    }

    // מחיר ידני ללקוח – לכל הקבוצה (אותו דגם ואיכות / נפח ווריאנט אצל כל הספקים)
    if (ch ? ch.customer : v.customer != null) {
      const gk = isPart ? repairGroupKey(item.mkey, item.partType, item.variant) : deviceGroupKey(item);
      if (v.customer != null) {
        const val = Math.round(v.customer);
        const prev = ovSet.get(gk);
        if (!prev) ovSet.set(gk, { value: val, row: r.row, sheet: e.sheetName, item });
        else if (prev.value !== val) conflicts.push(`${itemLabel(item)}: שני מחירים שונים ללקוח (שורות ${prev.row} ו-${r.row} ב"${e.sheetName}") – נקבע ${prev.value}`);
      } else if (!ovClear.has(gk)) ovClear.set(gk, { item });
    }
    // אחוז רווח לפריט (מכשירים) – גם הוא לכל הקבוצה
    if (!isPart && (ch ? ch.margin : v.margin != null)) {
      const gk = deviceGroupKey(item);
      if (v.margin != null) {
        const prev = mgSet.get(gk);
        if (!prev) mgSet.set(gk, { value: v.margin, row: r.row, item });
        else if (prev.value !== v.margin) conflicts.push(`${itemLabel(item)}: שני אחוזי רווח שונים (שורות ${prev.row} ו-${r.row} ב"${e.sheetName}") – נקבע ${prev.value}%`);
      } else if (!mgClear.has(gk)) mgClear.set(gk, { item });
    }
  }
  if (n.gone) notes.push(`${n.gone} שורות דולגו – הפריטים שלהן כבר לא קיימים באפליקציה (נמחקו או הוחלפו מאז הייצוא) ולא שונו בקובץ`);
  if (n.dup) notes.push(`${n.dup} שורות כפולות (זהות לשורה אחרת בקובץ) דולגו`);
  if (n.exists) notes.push(`${n.exists} שורות חדשות כבר קיימות במחירון בדיוק כך (אותו ספק, פריט ומחיר) – לא נוספו פעמיים`);

  // ---- מחיקות: פריטים שהיו בקובץ (לפי רשימת הייצוא) ונמחקו ממנו ----
  if (kindsRead.length && !exportedIds) notes.push('הקובץ לא נוצר בייצוא מהאפליקציה – כל פריט שלא מופיע בו יימחק');
  for (const s of cfg.suppliers || []) {
    for (const it of act[s.id]?.items || []) {
      if (!kindsRead.includes(it.kind === 'part' ? 'repairs' : 'devices')) continue;
      const iid = idOf(s.id, it.key);
      if (seenAll.has(iid)) continue;
      if (exportedIds && !exportedIds.has(iid)) continue; // נוסף לאפליקציה אחרי הייצוא – לא נוגעים
      const arr = listOf(s.id);
      const i = arr.indexOf(it);
      if (i < 0) continue;
      arr.splice(i, 1);
      touched.add(s.id);
      n.deleted++;
      det.deleted.push({ sheet: it.kind === 'part' ? SHEET_REPAIRS : SHEET_DEVICES, name: itemLabel(it), price: it.price, supplier: s.name });
    }
  }

  // ---- מחירים ידניים ללקוח ----
  const po = { ...(cfg.priceOverrides || {}) };
  let setCount = 0, clearCount = 0;
  for (const [gk, o] of ovSet) {
    const old = groupOverrideKeys(po, o.item);
    if (old.length === 1 && old[0] === gk && Number(po[gk]) === o.value) continue;
    old.forEach((k) => delete po[k]);
    po[gk] = o.value;
    setCount++;
    det.overrides.push({ name: itemLabel(o.item), value: o.value });
  }
  for (const [gk, o] of ovClear) {
    if (ovSet.has(gk)) continue;
    const old = groupOverrideKeys(po, o.item);
    if (!old.length) continue;
    old.forEach((k) => delete po[k]);
    clearCount++;
    det.overrides.push({ name: itemLabel(o.item), value: null });
  }

  // ---- אחוזי רווח לפריטים ----
  const mo = { ...(cfg.marginOverrides || {}) };
  let mSet = 0, mClear = 0;
  for (const [gk, o] of mgSet) {
    if (numOrNull(mo[gk]) === o.value) continue;
    mo[gk] = o.value;
    mSet++;
    det.margins.push({ name: itemLabel(o.item), value: o.value });
  }
  for (const [gk, o] of mgClear) {
    if (mgSet.has(gk) || mo[gk] == null) continue;
    delete mo[gk];
    mClear++;
    det.margins.push({ name: itemLabel(o.item), value: null });
  }

  const outLists = {};
  for (const id of touched) outLists[id] = { items: work[id], supplierName: supById.get(id)?.name || id, updatedAt: act[id]?.updatedAt || now };
  const cfgChanged = newSuppliers.length > 0 || setCount > 0 || clearCount > 0 || mSet > 0 || mClear > 0;
  return {
    lists: outLists,
    config: cfgChanged ? { ...cfg, suppliers, priceOverrides: po, marginOverrides: mo } : null,
    summary: {
      updated: n.updated, priceChanged: n.priceChanged, added: n.added, deleted: n.deleted,
      overridesSet: setCount, overridesCleared: clearCount, marginsSet: mSet, marginsCleared: mClear, newSuppliers, invalid, notes, conflicts,
      exportedAt: book.manifest?.exportedAt || null,
    },
    details: det,
    hasChanges: touched.size > 0 || cfgChanged,
  };
}
