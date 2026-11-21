// ייצוא וייבוא של כל המחירונים לקובץ אקסל (xlsx):
//  • "מחירון תיקונים" – פריטי ספקי החלקים
//  • Apple / Samsung / Xiaomi / אחרים – רשימת המכשירים, בפורמט של קובץ המכשירים (שורה לכל דגם + נפח + גרסה,
//    עמודת מחיר לכל ספק מכשירים, מחיר ללקוח ואחוז רווח)
//
// בכל שורה נשמרת עמודה מוסתרת עם הערכים שיוצאו ("_מקור"), ובקובץ יש גיליון מוסתר עם רשימת השורות שיוצאו.
// כך הייבוא משנה רק את מה שבאמת שונה בקובץ – גם אם בינתיים המחירונים עודכנו מוואטסאפ – ומוחק רק שורות
// שהיו בקובץ ונמחקו ממנו (ולא שורות שנוספו לאפליקציה אחרי הייצוא).
import { REPAIRS } from './defaults.js';
import { buildCatalog, activeLists } from './catalog.js';
import { repairQuote, qualityKey, repairGroupKey } from './pricing.js';
import { manualItem, detectPartType } from './parser.js';
import { fmtStorage } from './normalize.js';
import { uniqueKey } from './items.js';
import {
  CATALOG_ID, SEGMENTS, SHEETS, sheetOf, segmentLabel, segmentFromLabel, priceIndex, rowQuote, rowKey, rowLabel,
  devKey, verKey, newRowId, parseStorage, defaultCatalog,
} from './devices.js';

export { parseStorage };
export const SHEET_REPAIRS = 'מחירון תיקונים';
const SHEET_META = '_ייצוא';

const REPAIR_COLS = [
  { key: 'supplier', header: 'ספק', width: 22 },
  { key: 'model', header: 'דגם', width: 26 },
  { key: 'partType', header: 'סוג חלק', width: 13 },
  { key: 'variant', header: 'איכות', width: 26 },
  { key: 'price', header: 'מחיר ספק', width: 11, num: true },
  { key: 'customer', header: 'מחיר ללקוח', width: 12, num: true },
  { key: 'updated', header: 'עודכן', width: 12, date: true },
  { key: 'id', header: 'מזהה', width: 18 },
  { key: 'orig', header: '_מקור', width: 10, hidden: true },
];

/** עמודות גיליון מכשירים – כמו בקובץ המכשירים, ועמודת מחיר לכל ספק מכשירים */
export function deviceCols(cfg) {
  return [
    { key: 'brand', header: 'יצרן', width: 12 },
    { key: 'segment', header: 'רמות גימור/סגמנטציה', width: 20 },
    { key: 'series', header: 'סדרה', width: 14 },
    { key: 'model', header: 'שם הדגם', width: 24 },
    { key: 'storage', header: 'נפחי אחסון זמינים', width: 12 },
    { key: 'version', header: 'גרסה', width: 14 },
    { key: 'year', header: 'שנת השקה', width: 10 },
    ...devSuppliers(cfg).map((s) => ({ key: `p:${s.id}`, header: `מחיר ספק ${s.name}`, width: 14, num: true, sup: s.id })),
    { key: 'customer', header: 'מחיר ללקוח', width: 12, num: true },
    { key: 'margin', header: 'אחוז רווח', width: 10 },
    { key: 'notes', header: 'הערות', width: 24 },
    { key: 'id', header: 'מזהה', width: 10 },
    { key: 'orig', header: '_מקור', width: 10, hidden: true },
  ];
}
const devSuppliers = (cfg) => (cfg.suppliers || []).filter((s) => s.type !== 'parts');

// הסברים שמופיעים באקסל כשבוחרים תא בעמודה (הודעת קלט של אימות נתונים – בלי "הערות", שתוכנות אחרות שומרות בצורה שלא תמיד נקראת)
const PROMPTS = {
  supplier: 'בחירה מהרשימה. שם ספק שלא קיים ייצור ספק חדש.',
  customer: 'ריק = מחיר אוטומטי. מספר = מחיר ידני ללקוח (בתיקונים – לאותו דגם ואיכות אצל כל הספקים). מחיקת המספר מחזירה לאוטומטי.',
  storage: 'למשל 128GB או 1TB. ריק = בלי נפח.',
  margin: 'ריק = לפי רמת הגימור. מספר = אחוז רווח לשורה הזו. מחיקת המספר מחזירה לרמת הגימור.',
  id: 'לא לשנות. בשורה חדשה – להשאיר ריק. מחיקת שורה מוחקת אותה מהאפליקציה.',
  version: 'רשמי / מקביל / Active / New / סלולר … ריק = בלי גרסה.',
  price: 'מחיר הספק. ריק = אין מחיר מהספק הזה.',
};

export const idOf = (supplierId, key) => `${supplierId}~${key}`;
const numOrNull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const partLabel = (id) => REPAIRS.find((r) => r.id === id)?.label || id || '';
const itemLabel = (it) => [it.name || it.model, partLabel(it.partType), it.variant].filter(Boolean).join(' · ');
// תאריך מקומי (בלי שעה), כדי שאקסל לא יזיז אותו ביום בגלל אזור הזמן
const excelDate = (ts) => { if (!ts) return null; const d = new Date(ts); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
const rowsOf = (lists) => lists?.[CATALOG_ID]?.items || defaultCatalog();

/** מחיר ללקוח לחלק – כמו באפליקציה (החלק הזול לאותה איכות + עבודה) */
function partPricer(catalog, cfg) {
  const models = new Map(catalog.models.map((m) => [m.mkey, m]));
  const rq = new Map();
  return (it) => {
    const k = `${it.mkey}|${it.partType}`;
    if (!rq.has(k)) rq.set(k, repairQuote(models.get(it.mkey) || it, it.partType, catalog.partIndex.get(k) || [], cfg));
    return rq.get(k).options.find((o) => qualityKey(o.quality) === qualityKey(it.variant))?.final ?? null;
  };
}

/** שורות הייצוא (נתונים בלבד) */
export function exportRows(lists, cfg) {
  const act = activeLists(lists, cfg);
  const priceOf = partPricer(buildCatalog(act), cfg);
  const repairs = [];
  for (const s of cfg.suppliers || []) {
    if (s.type !== 'parts') continue;
    for (const it of act[s.id]?.items || []) {
      if (it.kind !== 'part') continue;
      const customer = priceOf(it);
      const model = it.model || it.name || '';
      const row = { supplier: s.name, model, partType: partLabel(it.partType), variant: it.variant || '', price: it.price, customer, updated: excelDate(it.updatedAt), id: idOf(s.id, it.key) };
      row.orig = JSON.stringify({ s: s.id, n: s.name, m: model, t: it.partType || null, q: row.variant, p: it.price, c: customer });
      repairs.push(row);
    }
  }
  const prices = priceIndex(act, cfg);
  const devices = Object.fromEntries(SHEETS.map((s) => [s.id, []]));
  for (const r of rowsOf(lists)) {
    const q = rowQuote(r, prices.get(r.id), cfg);
    const margin = numOrNull(cfg.marginOverrides?.[rowKey(r)]);
    const row = {
      brand: r.brand, segment: segmentLabel(r.segment), series: r.series || '', model: r.model, storage: fmtStorage(r.storage) || null,
      version: r.version || '', year: numOrNull(r.year), customer: q.final, margin, notes: r.notes || '', id: r.id,
    };
    const p = {};
    for (const x of prices.get(r.id) || []) { row[`p:${x.supplierId}`] = x.price; p[x.supplierId] = x.price; }
    row.orig = JSON.stringify({ b: r.brand, g: r.segment, se: row.series, m: r.model, st: r.storage ?? null, v: row.version, y: row.year, n: row.notes, p, c: q.final, r: margin });
    devices[sheetOf(r.brand)].push(row);
  }
  return { repairs, devices };
}

const listFormula = (values) => {
  const safe = values.filter((v) => v && !/[,"]/.test(v));
  const f = `"${safe.join(',')}"`;
  return safe.length && f.length <= 255 ? [f] : null;
};

/** בונה את חוברת האקסל. ExcelJS מועבר מבחוץ (נטען רק כשצריך) */
export function buildWorkbook(ExcelJS, lists, cfg, now = Date.now()) {
  const data = exportRows(lists, cfg);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'מחירון';
  wb.created = new Date(now);
  const add = (name, cols, rows, validations) => {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, hidden: !!c.hidden }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFF4' } }; });
    for (const r of rows) ws.addRow(r);
    cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.num) col.numFmt = '#,##0';
      if (c.date) col.numFmt = 'dd/mm/yyyy';
      if (c.key === 'id' || c.key === 'updated') col.font = { color: { argb: 'FF8E8E93' } };
    });
    const last = rows.length + 500; // מקום גם לשורות חדשות
    const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
    const range = (key) => { const i = cols.findIndex((c) => c.key === key); return i < 0 ? null : `${letter(i)}2:${letter(i)}${last}`; };
    const prompt = (key, title) => (PROMPTS[key] ? { showInputMessage: true, promptTitle: title, prompt: PROMPTS[key] } : {});
    const positive = (title) => ({ type: 'decimal', operator: 'greaterThan', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: title, error: 'מספר גדול מ-0' });
    validations({ add: (key, v) => { const r = range(key); if (r) ws.dataValidations.add(r, v); }, prompt, positive });
  };
  add(SHEET_REPAIRS, REPAIR_COLS, data.repairs, ({ add: v, prompt, positive }) => {
    const sup = listFormula((cfg.suppliers || []).filter((s) => s.type === 'parts').map((s) => s.name));
    v('supplier', { ...(sup ? { type: 'list', formulae: sup } : { type: 'any' }), allowBlank: true, showErrorMessage: false, ...prompt('supplier', 'ספק') });
    v('price', positive('מחיר ספק'));
    v('customer', { ...positive('מחיר ללקוח'), ...prompt('customer', 'מחיר ללקוח') });
    v('id', { type: 'any', ...prompt('id', 'מזהה') });
    v('partType', { type: 'list', allowBlank: true, showErrorMessage: true, errorTitle: 'סוג חלק', error: 'בחר מהרשימה', formulae: listFormula(REPAIRS.map((r) => r.label)) });
  });
  const dcols = deviceCols(cfg);
  for (const sh of SHEETS) {
    add(sh.label, dcols, data.devices[sh.id], ({ add: v, prompt, positive }) => {
      v('segment', { type: 'list', allowBlank: false, showErrorMessage: true, errorTitle: 'רמת גימור', error: 'בחר מהרשימה', formulae: listFormula(SEGMENTS.map((s) => s.label)) });
      v('storage', { type: 'any', ...prompt('storage', 'נפח') });
      v('version', { type: 'any', ...prompt('version', 'גרסה') });
      v('year', { type: 'whole', operator: 'between', formulae: [2000, 2100], allowBlank: true, showErrorMessage: true, errorTitle: 'שנת השקה', error: 'שנה, למשל 2026' });
      for (const c of dcols.filter((x) => x.sup)) v(c.key, { ...positive(c.header), ...prompt('price', c.header) });
      v('customer', { ...positive('מחיר ללקוח'), ...prompt('customer', 'מחיר ללקוח') });
      v('margin', { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: 'אחוז רווח', error: 'מספר (0 ומעלה)', ...prompt('margin', 'אחוז רווח') });
      v('id', { type: 'any', ...prompt('id', 'מזהה') });
    });
  }
  const meta = wb.addWorksheet(SHEET_META);
  meta.state = 'veryHidden';
  meta.addRow(['exportedAt', now]);
  for (const r of data.repairs) meta.addRow([r.id]);
  for (const sh of SHEETS) for (const r of data.devices[sh.id]) meta.addRow([r.id]);
  const devCount = SHEETS.reduce((n, sh) => n + data.devices[sh.id].length, 0);
  return { wb, counts: { repairs: data.repairs.length, devices: devCount } };
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

const isPercentFmt = (f) => typeof f === 'string' && f.replace(/"[^"]*"/g, '').includes('%');

/** קורא גיליון לפי כותרות. גיליון בלי העמודות החובה → { error } */
function readSheet(ws, cols, required, needId) {
  const colOf = {};
  const extra = [];
  ws.getRow(1).eachCell((cell, n) => {
    const h = str(cellValue(cell.value));
    const c = cols.find((x) => x.header === h);
    if (c && !colOf[c.key]) colOf[c.key] = n;
    else if (!c && /^מחיר ספק /.test(h)) extra.push(h);
  });
  const missing = required.filter((k) => !colOf[k]).map((k) => `"${cols.find((c) => c.key === k).header}"`);
  if (missing.length) return { error: `בגיליון "${ws.name}" לא נמצאו בשורה הראשונה העמודות ${missing.join(', ')}` };
  if (needId && !colOf.id) return { error: `בגיליון "${ws.name}" חסרה העמודה "מזהה" – בלעדיה אי אפשר לדעת איזו שורה שייכת לאיזה פריט` };
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const r = { row: n };
    for (const c of cols) if (colOf[c.key]) r[c.key] = cellValue(row.getCell(colOf[c.key]).value);
    if (typeof r.margin === 'number' && isPercentFmt(row.getCell(colOf.margin).numFmt)) r.margin = Math.round(r.margin * 1e6) / 1e4; // "8%" באקסל = 0.08
    if (cols.some((c) => c.key !== 'orig' && c.key !== 'updated' && str(r[c.key]) !== '')) rows.push(r);
  });
  return { rows, name: ws.name, cols: colOf, extraPriceCols: extra };
}

/** קורא חוברת אקסל. גיליון שלא נמצא = null (לא נוגעים בפריטים שלו) */
export function readWorkbook(wb, cfg) {
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
  const repWs = visible.find((ws) => /תיקונ|מחירות/.test(ws.name));
  const dcols = deviceCols(cfg);
  const devices = [];
  for (const ws of visible) {
    if (ws === repWs) continue;
    const heads = [];
    ws.getRow(1).eachCell((cell) => heads.push(str(cellValue(cell.value))));
    if (!heads.includes('שם הדגם')) continue; // לא גיליון מכשירים
    devices.push(readSheet(ws, dcols, ['model', 'segment'], !!manifest));
  }
  return {
    repairs: repWs ? readSheet(repWs, REPAIR_COLS, ['model', 'price'], !!manifest) : null,
    devices,
    manifest,
  };
}

// ---------- תכנון הייבוא (בלי לשמור) ----------

const normName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const partFromCell = (v) => {
  const s = str(v);
  if (!s) return null;
  return REPAIRS.find((x) => x.label === s || x.id === s)?.id || detectPartType(s);
};

// כל המפתחות של "מחיר ידני ללקוח" שחלים על אותה קבוצת תיקון (כולל מפתחות בפורמט ישן)
function repairOverrideKeys(po, item) {
  const out = [];
  const pre = `${item.mkey}|${item.partType}|`;
  const qk = qualityKey(item.variant);
  for (const k of Object.keys(po)) if (k.startsWith(pre) && qualityKey(k.slice(pre.length)) === qk) out.push(k);
  return out;
}

/**
 * משווה את הקובץ למצב הנוכחי ומחזיר מה ישתנה. לא שומר כלום.
 * מחזיר { lists: {id: {items, supplierName, updatedAt}}, config (או null), summary, details, hasChanges }
 */
export function planImport(book, lists, cfg, now = Date.now()) {
  const ctx = {
    lists, cfg, now, act: activeLists(lists, cfg),
    suppliers: (cfg.suppliers || []).map((s) => ({ ...s })),
    work: {}, touched: new Set(), newSuppliers: [],
    invalid: [], notes: [], conflicts: [],
    det: { updated: [], added: [], deleted: [], overrides: [], margins: [] },
    n: { updated: 0, priceChanged: 0, added: 0, deleted: 0, gone: 0, dup: 0, exists: 0 },
    po: { ...(cfg.priceOverrides || {}) }, mo: { ...(cfg.marginOverrides || {}) },
    ov: { set: 0, cleared: 0 }, mg: { set: 0, cleared: 0 },
    exportedIds: book.manifest?.ids || null,
    // כל המזהים שבקובץ, מכל הגיליונות – שורה שהועברה לגיליון אחר לא נמחקת
    inFile: new Set([...(book.repairs?.rows || []), ...(book.devices || []).flatMap((s) => s.rows || [])].map((r) => str(r.id)).filter(Boolean)),
  };
  ctx.listOf = (id) => (ctx.work[id] ||= [...(ctx.act[id]?.items || [])]);
  planRepairs(book.repairs, ctx);
  planDevices(book.devices || [], ctx);
  const { n, notes } = ctx;
  if (n.gone) notes.push(`${n.gone} שורות דולגו – הן כבר לא קיימות באפליקציה (נמחקו או הוחלפו מאז הייצוא) ולא שונו בקובץ`);
  if (n.dup) notes.push(`${n.dup} שורות כפולות (זהות לשורה אחרת בקובץ) דולגו`);
  if (n.exists) notes.push(`${n.exists} שורות חדשות כבר קיימות בדיוק כך – לא נוספו פעמיים`);

  const supById = new Map(ctx.suppliers.map((s) => [s.id, s]));
  const outLists = {};
  for (const id of ctx.touched) {
    outLists[id] = id === CATALOG_ID
      ? { items: ctx.work[id], supplierName: 'רשימת מכשירים' }
      : { items: ctx.work[id], supplierName: supById.get(id)?.name || id, updatedAt: ctx.act[id]?.updatedAt || now };
  }
  const cfgChanged = ctx.newSuppliers.length > 0 || ctx.ov.set + ctx.ov.cleared + ctx.mg.set + ctx.mg.cleared > 0;
  return {
    lists: outLists,
    config: cfgChanged ? { ...cfg, suppliers: ctx.suppliers, priceOverrides: ctx.po, marginOverrides: ctx.mo } : null,
    summary: {
      updated: n.updated, priceChanged: n.priceChanged, added: n.added, deleted: n.deleted,
      overridesSet: ctx.ov.set, overridesCleared: ctx.ov.cleared, marginsSet: ctx.mg.set, marginsCleared: ctx.mg.cleared,
      newSuppliers: ctx.newSuppliers, invalid: ctx.invalid, notes, conflicts: ctx.conflicts,
      exportedAt: book.manifest?.exportedAt || null,
    },
    details: ctx.det,
    hasChanges: ctx.touched.size > 0 || cfgChanged,
  };
}

// ----- מחירון תיקונים -----
function planRepairs(sheet, ctx) {
  const { act, cfg, now, suppliers, det, n, invalid, notes, conflicts } = ctx;
  const sheetName = SHEET_REPAIRS;
  if (!sheet) { notes.push(`הגיליון "${sheetName}" לא נמצא בקובץ – פריטי התיקונים לא שונו`); return; }
  if (sheet.error) { invalid.push({ sheet: sheetName, row: 1, reason: sheet.error }); return; }
  const supById = new Map(suppliers.map((s) => [s.id, s]));
  const findSup = (name) => {
    const all = suppliers.filter((s) => normName(s.name) === normName(name));
    return all.find((s) => s.type === 'parts') || all[0] || null;
  };
  const priceOf = partPricer(buildCatalog(act), cfg);
  const existing = new Map(); // מזהה → { s, it }
  for (const s of suppliers) for (const it of act[s.id]?.items || []) if (it.kind === 'part') existing.set(idOf(s.id, it.key), { s, it });
  const seen = new Set();
  const entries = [];

  for (const r of sheet.rows) {
    const bad = (reason) => invalid.push({ sheet: sheetName, row: r.row, reason, name: str(r.model) });
    const id = str(r.id);
    if (id) seen.add(id);
    const known = id ? existing.get(id) || null : null;
    let orig = null;
    try { const o = r.orig ? JSON.parse(String(r.orig)) : null; if (o && typeof o === 'object' && o.s) orig = o; } catch { orig = null; }
    const supCell = str(r.supplier);
    if (!supCell) { bad('חסר ספק'); continue; }
    const model = str(r.model);
    if (!model) { bad('חסר דגם'); continue; }
    const price = parseNum(r.price);
    if (price == null || Number.isNaN(price) || price <= 0) { bad(`מחיר ספק חסר או לא תקין${str(r.price) ? `: "${str(r.price)}"` : ''}`); continue; }
    const variant = str(r.variant);
    const partType = partFromCell(r.partType);
    if (!partType) { bad(str(r.partType) ? `סוג חלק לא מוכר: "${str(r.partType)}"` : 'חסר סוג חלק'); continue; }
    const customer = parseNum(r.customer);
    if (Number.isNaN(customer) || (customer != null && customer <= 0)) { bad(`מחיר ללקוח לא תקין: "${str(r.customer)}"`); continue; }

    // הערכים שיוצאו (מהעמודה המוסתרת; אם חסרה – הערכים הנוכחיים של הפריט)
    const base = orig
      ? { s: orig.s, n: orig.n ?? supById.get(orig.s)?.name ?? '', m: str(orig.m), t: orig.t || null, q: str(orig.q), p: Number(orig.p), c: orig.c ?? null }
      : known ? { s: known.s.id, n: known.s.name, m: str(known.it.model || known.it.name), t: known.it.partType || null, q: str(known.it.variant), p: known.it.price, c: priceOf(known.it) } : null;
    // ספק: אם השם לא שונה בקובץ – אותו ספק (גם אם בינתיים שמו שונה באפליקציה)
    const sameName = !!base && normName(supCell) === normName(base.n);
    const sup = sameName && supById.has(base.s) ? supById.get(base.s) : findSup(supCell);
    const ch = base && {
      supplier: !sameName && (!sup || sup.id !== base.s),
      model: base.m !== model,
      partType: base.t !== partType,
      variant: base.q !== variant,
      price: !(Math.abs(base.p - price) < 0.005),
      customer: base.c == null ? customer != null : customer == null || Math.round(customer) !== Math.round(base.c),
    };
    entries.push({ r, id, known, sup, supCell, ch, changed: !!ch && Object.values(ch).some(Boolean), v: { model, price, variant, partType, customer }, bad });
  }

  // שורה שהועתקה (אותו מזהה פעמיים): הפריט הקיים נשאר לשורה שלא שונתה, והשורה ששונתה נוספת כפריט חדש
  const owner = new Map();
  for (const e of entries) if (e.known && !e.changed && !owner.has(e.id)) owner.set(e.id, e);
  for (const e of entries) if (e.known && !owner.has(e.id)) owner.set(e.id, e);
  const ovSet = new Map(), ovClear = new Map();

  for (const e of entries) {
    const { r, ch, v } = e;
    const ex = e.known && owner.get(e.id) === e ? e.known : null;
    if (!ex && ch && !e.changed) { if (e.known) n.dup++; else n.gone++; continue; }
    let sup = e.sup || findSup(e.supCell);
    if (sup && sup.type !== 'parts' && (!ex || ch.supplier)) { e.bad(`"${sup.name}" מוגדר כספק מכשירים`); continue; }
    if (!sup) {
      sup = { id: `s${now.toString(36)}${ctx.newSuppliers.length}`, name: e.supCell, type: 'parts', phone: '' };
      suppliers.push(sup); supById.set(sup.id, sup); ctx.newSuppliers.push(e.supCell);
    }
    let item;
    if (ex) {
      // עדכון פריט קיים – רק שדות ששונו בקובץ ושעדיין שונים ממה שיש באפליקציה
      const cur = ex.it;
      const eff = {
        model: ch.model && v.model !== str(cur.model || cur.name),
        partType: ch.partType && v.partType !== cur.partType,
        variant: ch.variant && v.variant !== str(cur.variant),
        price: ch.price && Math.abs(v.price - cur.price) >= 0.005,
        supplier: ch.supplier && sup.id !== ex.s.id,
      };
      item = cur;
      if (eff.model || eff.partType || eff.variant) {
        const f = { name: eff.model ? v.model : cur.model || cur.name, partType: eff.partType ? v.partType : cur.partType, variant: eff.variant ? v.variant : cur.variant || '', price: eff.price ? v.price : cur.price };
        const { ok, ...rec } = manualItem(f, 'parts', cur, now);
        item = rec;
        if (!eff.price) Object.assign(item, { updatedAt: cur.updatedAt, changedAt: cur.changedAt, prevPrice: cur.prevPrice ?? null });
      } else if (eff.price) {
        item = { ...cur, manual: true, price: v.price, prevPrice: cur.price, changedAt: now, updatedAt: now };
      }
      const from = ctx.listOf(ex.s.id);
      const i = from.indexOf(cur);
      if (eff.supplier) {
        if (i >= 0) from.splice(i, 1);
        const to = ctx.listOf(sup.id);
        item = { ...item, key: uniqueKey(to, item.key) };
        to.push(item);
        ctx.touched.add(ex.s.id); ctx.touched.add(sup.id);
      } else if (item !== cur) {
        item = { ...item, key: uniqueKey(from, item.key, i) };
        if (i >= 0) from[i] = item; else from.push(item);
        ctx.touched.add(ex.s.id);
      }
      if (item !== cur) {
        n.updated++; if (eff.price) n.priceChanged++;
        const what = [eff.price && 'מחיר', eff.model && 'שם', eff.partType && 'סוג חלק', eff.variant && 'איכות', eff.supplier && `ספק (${sup.name})`].filter(Boolean);
        det.updated.push({ sheet: sheetName, row: r.row, name: itemLabel(item), before: cur.price, after: item.price, what });
      }
    } else {
      // פריט חדש: שורה בלי מזהה, שורה מועתקת ששונתה, או פריט שכבר לא קיים באפליקציה ושונה בקובץ
      const { ok, ...rec } = manualItem({ name: v.model, partType: v.partType, variant: v.variant, price: v.price }, 'parts', null, now);
      if (!ok) { e.bad('לא ניתן ליצור פריט מהשורה'); continue; }
      const to = ctx.listOf(sup.id);
      const same = to.find((x) => x.key.replace(/#\d+$/, '') === rec.key && Math.abs(x.price - rec.price) < 0.005);
      if (same) { seen.add(idOf(sup.id, same.key)); n.exists++; item = same; }
      else {
        item = { ...rec, key: uniqueKey(to, rec.key) };
        to.push(item);
        ctx.touched.add(sup.id);
        n.added++;
        det.added.push({ sheet: sheetName, row: r.row, name: itemLabel(item), price: item.price, supplier: sup.name });
      }
    }
    // מחיר ידני ללקוח – לכל הקבוצה (אותו דגם ואיכות אצל כל הספקים)
    if (ch ? ch.customer : v.customer != null) {
      const gk = repairGroupKey(item.mkey, item.partType, item.variant);
      if (v.customer != null) {
        const val = Math.round(v.customer);
        const prev = ovSet.get(gk);
        if (!prev) ovSet.set(gk, { value: val, row: r.row, item });
        else if (prev.value !== val) conflicts.push(`${itemLabel(item)}: שני מחירים שונים ללקוח (שורות ${prev.row} ו-${r.row} ב"${sheetName}") – נקבע ${prev.value}`);
      } else if (!ovClear.has(gk)) ovClear.set(gk, { item });
    }
  }

  // מחיקות: פריטים שהיו בקובץ (לפי רשימת הייצוא) ונמחקו ממנו
  if (!ctx.exportedIds) notes.push(`הקובץ לא נוצר בייצוא מהאפליקציה – כל פריט תיקון שלא מופיע בו יימחק`);
  for (const s of cfg.suppliers || []) {
    for (const it of act[s.id]?.items || []) {
      if (it.kind !== 'part') continue;
      const iid = idOf(s.id, it.key);
      if (seen.has(iid) || ctx.inFile.has(iid) || (ctx.exportedIds && !ctx.exportedIds.has(iid))) continue;
      const arr = ctx.listOf(s.id);
      const i = arr.indexOf(it);
      if (i < 0) continue;
      arr.splice(i, 1);
      ctx.touched.add(s.id);
      n.deleted++;
      det.deleted.push({ sheet: sheetName, name: itemLabel(it), price: it.price, supplier: s.name });
    }
  }

  const { po } = ctx;
  for (const [gk, o] of ovSet) {
    const old = repairOverrideKeys(po, o.item);
    if (old.length === 1 && old[0] === gk && Number(po[gk]) === o.value) continue;
    old.forEach((k) => delete po[k]);
    po[gk] = o.value;
    ctx.ov.set++;
    det.overrides.push({ name: itemLabel(o.item), value: o.value });
  }
  for (const [gk, o] of ovClear) {
    if (ovSet.has(gk)) continue;
    const old = repairOverrideKeys(po, o.item);
    if (!old.length) continue;
    old.forEach((k) => delete po[k]);
    ctx.ov.cleared++;
    det.overrides.push({ name: itemLabel(o.item), value: null });
  }
}

// ----- רשימת המכשירים (גיליונות החברות) -----
function planDevices(sheets, ctx) {
  const { lists, cfg, now, det, n, invalid, notes, conflicts } = ctx;
  if (!sheets.length) { notes.push('לא נמצאו בקובץ גיליונות מכשירים – רשימת המכשירים לא שונתה'); return; }
  const good = sheets.filter((s) => !s.error);
  for (const s of sheets) if (s.error) invalid.push({ sheet: s.name || 'מכשירים', row: 1, reason: s.error });
  if (!good.length) return;
  for (const s of good) for (const h of s.extraPriceCols) notes.push(`העמודה "${h}" בגיליון "${s.name}" לא שייכת לאף ספק מכשירים באפליקציה – לא נקראה`);

  const rows = rowsOf(lists);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sups = devSuppliers(cfg);
  const prices = priceIndex(ctx.act, cfg);
  const curPrice = (rowId, sid) => (prices.get(rowId) || []).find((x) => x.supplierId === sid)?.price ?? null;
  const keyOf = (r) => `${devKey(r.brand, r.model)}|${r.storage ?? ''}|${verKey(r.version)}`;
  const seen = new Set();
  const entries = [];

  for (const sh of good) {
    for (const r of sh.rows) {
      const bad = (reason) => invalid.push({ sheet: sh.name, row: r.row, reason, name: str(r.model) });
      const id = str(r.id);
      if (id) seen.add(id);
      if (id.includes('~')) { bad(`זו שורה של תיקון – מקומה בגיליון "${SHEET_REPAIRS}"`); continue; }
      const known = id ? byId.get(id) || null : null;
      let orig = null;
      try { const o = r.orig ? JSON.parse(String(r.orig)) : null; if (o && typeof o === 'object' && 'm' in o) orig = o; } catch { orig = null; }
      const model = str(r.model);
      if (!model) { bad('חסר שם דגם'); continue; }
      const segment = segmentFromLabel(r.segment);
      if (!segment) { bad(str(r.segment) ? `רמת גימור לא מוכרת: "${str(r.segment)}"` : 'חסרה רמת גימור / סגמנט'); continue; }
      const storage = parseStorage(r.storage);
      if (Number.isNaN(storage)) { bad(`נפח לא תקין: "${str(r.storage)}"`); continue; }
      const yearN = parseNum(r.year);
      if (Number.isNaN(yearN)) { bad(`שנת השקה לא תקינה: "${str(r.year)}"`); continue; }
      const p = {};
      let badPrice = null;
      for (const s of sups) {
        if (!sh.cols[`p:${s.id}`]) continue; // אין עמודה לספק הזה בקובץ – לא נוגעים במחירים שלו
        const v = parseNum(r[`p:${s.id}`]);
        if (Number.isNaN(v) || (v != null && v <= 0)) { badPrice = s.name; break; }
        p[s.id] = v;
      }
      if (badPrice) { bad(`מחיר ספק ${badPrice} לא תקין`); continue; }
      const customer = parseNum(r.customer);
      if (Number.isNaN(customer) || (customer != null && customer <= 0)) { bad(`מחיר ללקוח לא תקין: "${str(r.customer)}"`); continue; }
      const margin = parseNum(r.margin);
      if (Number.isNaN(margin) || (margin != null && margin < 0)) { bad(`אחוז רווח לא תקין: "${str(r.margin)}"`); continue; }
      const v = { brand: str(r.brand), segment, series: str(r.series), model, storage, version: str(r.version), year: yearN, notes: str(r.notes), p, customer, margin };

      const base = orig
        ? { b: str(orig.b), g: orig.g, se: str(orig.se), m: str(orig.m), st: orig.st ?? null, v: str(orig.v), y: orig.y ?? null, n: str(orig.n), p: orig.p || {}, c: orig.c ?? null, r: orig.r ?? null }
        : known ? baseOf(known, prices, cfg) : null;
      const ch = base && {
        brand: base.b !== v.brand, segment: base.g !== v.segment, series: base.se !== v.series, model: base.m !== v.model,
        storage: (base.st ?? null) !== (v.storage ?? null), version: base.v !== v.version, year: (base.y ?? null) !== (v.year ?? null), notes: base.n !== v.notes,
        prices: Object.keys(p).filter((sid) => (base.p[sid] ?? null) !== (p[sid] ?? null)),
        customer: base.c == null ? customer != null : customer == null || Math.round(customer) !== Math.round(base.c),
        margin: base.r == null ? margin != null : margin == null || Math.abs(margin - base.r) > 1e-9,
      };
      const changed = !!ch && Object.entries(ch).some(([k, x]) => (k === 'prices' ? x.length > 0 : x));
      entries.push({ r, sheet: sh.name, id, known, ch, changed, v, bad });
    }
  }

  const owner = new Map();
  for (const e of entries) if (e.known && !e.changed && !owner.has(e.id)) owner.set(e.id, e);
  for (const e of entries) if (e.known && !owner.has(e.id)) owner.set(e.id, e);

  const work = ctx.work[CATALOG_ID] = [...rows];
  const supItems = {}; // ספק → מחירון (עותק) רק אם השתנה
  const supList = (sid) => (supItems[sid] ||= [...(ctx.act[sid]?.items || [])]);
  const setPrice = (rowId, sid, price) => {
    const arr = supList(sid);
    const i = arr.findIndex((x) => x.row === rowId);
    const old = i >= 0 ? arr[i] : null;
    if ((old?.price ?? null) === price) return;
    if (price == null) arr.splice(i, 1);
    else {
      const rec = { key: rowId, row: rowId, kind: 'device', price, raw: 'אקסל', manual: true, updatedAt: now, changedAt: now, prevPrice: old?.price ?? null };
      if (i >= 0) arr[i] = rec; else arr.push(rec);
    }
    ctx.touched.add(sid);
  };
  let catalogChanged = false;
  const ovSet = new Map(), ovClear = new Set(), mgSet = new Map(), mgClear = new Set();
  const keys = new Map(work.map((r) => [keyOf(r), r]));

  for (const e of entries) {
    const { r, ch, v } = e;
    const ex = e.known && owner.get(e.id) === e ? e.known : null;
    if (!ex && ch && !e.changed) { if (e.known) n.dup++; else n.gone++; continue; }
    let row;
    const label = (x) => `${rowLabel(x)}`;
    if (ex) {
      const cur = work.find((x) => x.id === ex.id) || ex;
      const fields = ['brand', 'segment', 'series', 'model', 'storage', 'version', 'year', 'notes'];
      const next = { ...cur };
      const what = [];
      const names = { brand: 'יצרן', segment: 'רמת גימור', series: 'סדרה', model: 'שם', storage: 'נפח', version: 'גרסה', year: 'שנה', notes: 'הערות' };
      for (const f of fields) {
        if (!ch[f]) continue;
        const nv = v[f];
        if (String(cur[f] ?? '') === String(nv ?? '')) continue; // כבר כך באפליקציה (למשל ייבוא חוזר)
        next[f] = nv;
        what.push(names[f]);
      }
      if (what.length) {
        const k = keyOf(next);
        const clash = keys.get(k);
        if (clash && clash.id !== cur.id) { e.bad(`כבר קיימת שורה כזו: ${label(clash)}`); continue; }
        keys.delete(keyOf(cur)); keys.set(k, next);
        work[work.indexOf(cur)] = next;
        catalogChanged = true;
      }
      row = what.length ? next : cur;
      for (const sid of ch.prices) {
        const nv = v.p[sid] ?? null;
        if (curPrice(row.id, sid) === nv) continue;
        setPrice(row.id, sid, nv);
        what.push(`מחיר ${sups.find((s) => s.id === sid)?.name || sid}`);
        n.priceChanged++;
      }
      if (what.length) {
        n.updated++;
        det.updated.push({ sheet: e.sheet, row: r.row, name: label(row), what, before: null, after: null });
      }
    } else {
      // שורה חדשה (או שורה שכבר קיימת ברשימה באותו דגם + נפח + גרסה – אז היא מעדכנת אותה)
      const want = { id: newRowId(n.added), brand: v.brand, segment: v.segment, series: v.series, model: v.model, storage: v.storage, version: v.version, year: v.year, notes: v.notes };
      const same = keys.get(keyOf(want));
      if (same) {
        row = same;
        seen.add(same.id);
        const diffPrices = Object.keys(v.p).filter((sid) => v.p[sid] != null && curPrice(same.id, sid) !== v.p[sid]);
        for (const sid of diffPrices) setPrice(same.id, sid, v.p[sid]);
        if (diffPrices.length) { n.updated++; n.priceChanged += diffPrices.length; det.updated.push({ sheet: e.sheet, row: r.row, name: label(same), what: diffPrices.map((sid) => `מחיר ${sups.find((s) => s.id === sid)?.name || sid}`) }); }
        else n.exists++;
      } else {
        row = want;
        work.push(row); keys.set(keyOf(row), row); catalogChanged = true;
        for (const sid of Object.keys(v.p)) if (v.p[sid] != null) setPrice(row.id, sid, v.p[sid]);
        n.added++;
        const ps = Object.values(v.p).filter((x) => x != null);
        det.added.push({ sheet: e.sheet, row: r.row, name: label(row), price: ps.length ? Math.min(...ps) : null, supplier: segmentLabel(row.segment) });
      }
    }
    const rk = rowKey(row);
    if (ch ? ch.customer : v.customer != null) {
      if (v.customer != null) {
        const val = Math.round(v.customer);
        const prev = ovSet.get(rk);
        if (!prev) ovSet.set(rk, { value: val, row: r.row, label: label(row) });
        else if (prev.value !== val) conflicts.push(`${label(row)}: שני מחירים שונים ללקוח (שורות ${prev.row} ו-${r.row}) – נקבע ${prev.value}`);
      } else ovClear.add(rk);
    }
    if (ch ? ch.margin : v.margin != null) {
      if (v.margin != null) { if (!mgSet.has(rk)) mgSet.set(rk, { value: v.margin, label: label(row) }); } else mgClear.add(rk);
    }
  }

  // מחיקות: שורות שהיו בקובץ (לפי רשימת הייצוא) ונמחקו ממנו – רק מגיליונות שנמצאים בקובץ
  const present = new Set(good.map((s) => SHEETS.find((x) => x.label === s.name)?.id).filter(Boolean));
  for (const sh of SHEETS) if (!present.has(sh.id)) notes.push(`הגיליון "${sh.label}" לא נמצא בקובץ – המכשירים שלו לא נמחקו`);
  if (!ctx.exportedIds) notes.push('הקובץ לא נוצר בייצוא מהאפליקציה – כל מכשיר ברשימה שלא מופיע בגיליון של החברה שלו יימחק');
  for (const r0 of rows) {
    if (seen.has(r0.id) || ctx.inFile.has(r0.id) || !present.has(sheetOf(r0.brand)) || (ctx.exportedIds && !ctx.exportedIds.has(r0.id))) continue;
    const i = work.findIndex((x) => x.id === r0.id);
    if (i < 0) continue;
    const r = work[i];
    work.splice(i, 1);
    catalogChanged = true;
    for (const s of sups) if (curPrice(r.id, s.id) != null) setPrice(r.id, s.id, null);
    n.deleted++;
    det.deleted.push({ sheet: SHEETS.find((s) => s.id === sheetOf(r.brand))?.label, name: rowLabel(r), price: (prices.get(r.id) || [])[0]?.price ?? null, supplier: segmentLabel(r.segment) });
  }
  if (catalogChanged) ctx.touched.add(CATALOG_ID); else delete ctx.work[CATALOG_ID];
  for (const [sid, items] of Object.entries(supItems)) if (ctx.touched.has(sid)) ctx.work[sid] = items;

  const { po, mo } = ctx;
  for (const [k, o] of ovSet) { if (Number(po[k]) === o.value) continue; po[k] = o.value; ctx.ov.set++; det.overrides.push({ name: o.label, value: o.value }); }
  for (const k of ovClear) { if (ovSet.has(k) || po[k] == null) continue; delete po[k]; ctx.ov.cleared++; det.overrides.push({ name: rowLabel(work.find((x) => rowKey(x) === k) || { model: k }), value: null }); }
  for (const [k, o] of mgSet) { if (numOrNull(mo[k]) === o.value) continue; mo[k] = o.value; ctx.mg.set++; det.margins.push({ name: o.label, value: o.value }); }
  for (const k of mgClear) { if (mgSet.has(k) || mo[k] == null) continue; delete mo[k]; ctx.mg.cleared++; det.margins.push({ name: rowLabel(work.find((x) => rowKey(x) === k) || { model: k }), value: null }); }
}

// הערכים הנוכחיים של שורה (כשאין בקובץ את העמודה המוסתרת)
function baseOf(r, prices, cfg) {
  const p = {};
  for (const x of prices.get(r.id) || []) p[x.supplierId] = x.price;
  return {
    b: str(r.brand), g: r.segment, se: str(r.series), m: str(r.model), st: r.storage ?? null, v: str(r.version), y: numOrNull(r.year), n: str(r.notes),
    p, c: rowQuote(r, prices.get(r.id), cfg).final, r: numOrNull(cfg.marginOverrides?.[rowKey(r)]),
  };
}
