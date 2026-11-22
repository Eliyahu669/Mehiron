// ייצוא וייבוא של כל המחירונים לקובץ אקסל (xlsx):
//  • תיקונים Apple / Samsung / Xiaomi / אחרים – שורה לכל דגם + סוג תיקון + איכות (+ מסגרת), עמודת מחיר לכל ספק חלקים
//  • Apple / Samsung / Xiaomi / אחרים – רשימת המכשירים, בפורמט של קובץ המכשירים (שורה לכל דגם + נפח + גרסה,
//    עמודת מחיר לכל ספק מכשירים, מחיר ללקוח ואחוז רווח)
//
// בכל שורה נשמרת עמודה מוסתרת עם הערכים שיוצאו ("_מקור"), ובקובץ יש גיליון מוסתר עם רשימת השורות שיוצאו.
// כך הייבוא משנה רק את מה שבאמת שונה בקובץ – גם אם בינתיים המחירונים עודכנו מוואטסאפ – ומוחק רק שורות
// שהיו בקובץ ונמחקו ממנו (ולא שורות שנוספו לאפליקציה אחרי הייצוא).
import { buildCatalog, activeLists } from './catalog.js';
import { repairQuote, partQuality, repairGroupKey } from './pricing.js';
import { fmtStorage, identify, modelKey } from './normalize.js';
import {
  allRepairs, repairLabel, qualitiesFor, resolveQuality, groupId, optionKey, optionName, FRAME, manualPart, STANDARD,
} from './repairs.js';
import {
  CATALOG_ID, SEGMENTS, SHEETS, sheetOf, segmentLabel, segmentFromLabel, priceIndex, rowQuote, rowKey, rowLabel,
  devKey, verKey, newRowId, parseStorage, defaultCatalog,
} from './devices.js';

export { parseStorage };
export const SHEET_REPAIRS = 'מחירון תיקונים'; // השם של גיליון התיקונים בפורמט הישן (לפני הגיליונות לפי חברה)
export const repairSheetName = (sheetId) => `תיקונים ${SHEETS.find((s) => s.id === sheetId)?.label || sheetId}`;
const REPAIR_SHEETS = SHEETS.map((s) => ({ id: s.id, name: repairSheetName(s.id) }));
const SHEET_META = '_ייצוא';

/** עמודות גיליון תיקונים – שורה לכל דגם + סוג תיקון + איכות, ועמודת מחיר לכל ספק חלקים */
export function repairCols(cfg) {
  return [
    { key: 'brand', header: 'יצרן', width: 12 },
    { key: 'model', header: 'דגם', width: 24 },
    { key: 'year', header: 'שנת השקה', width: 10 },
    { key: 'repair', header: 'סוג תיקון', width: 13 },
    { key: 'quality', header: 'איכות', width: 18 },
    { key: 'frame', header: 'מסגרת', width: 12 },
    ...partSuppliers(cfg).map((s) => ({ key: `p:${s.id}`, header: `מחיר ספק ${s.name}`, width: 14, num: true, sup: s.id })),
    { key: 'labor', header: 'עבודה', width: 9, num: true },
    { key: 'customer', header: 'מחיר ללקוח', width: 12, num: true },
    { key: 'id', header: 'מזהה', width: 18 },
    { key: 'orig', header: '_מקור', width: 10, hidden: true },
  ];
}
const partSuppliers = (cfg) => (cfg.suppliers || []).filter((s) => s.type === 'parts');

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
  customer: 'ריק = מחיר אוטומטי. מספר = מחיר ידני ללקוח. מחיקת המספר מחזירה לאוטומטי.',
  quality: 'שם האיכות כמו בהגדרות (סוגי תיקון ואיכויות). ריק = סטנדרטי.',
  frame: 'כולל מסגרת / ללא מסגרת. ריק = לא צוין.',
  labor: 'לעיון בלבד. עלות העבודה נקבעת בהגדרות.',
  storage: 'למשל 128GB או 1TB. ריק = בלי נפח.',
  margin: 'ריק = לפי רמת הגימור. מספר = אחוז רווח לשורה הזו. מחיקת המספר מחזירה לרמת הגימור.',
  id: 'לא לשנות. בשורה חדשה – להשאיר ריק. מחיקת שורה מוחקת אותה מהאפליקציה.',
  version: 'רשמי / מקביל / Active / New / סלולר … ריק = בלי גרסה.',
  price: 'מחיר הספק. ריק = אין מחיר מהספק הזה.',
};

const numOrNull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
// תאריך מקומי (בלי שעה), כדי שאקסל לא יזיז אותו ביום בגלל אזור הזמן
const excelDate = (ts) => { if (!ts) return null; const d = new Date(ts); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
const rowsOf = (lists) => lists?.[CATALOG_ID]?.items || defaultCatalog();

// מזהה שורת תיקון: דגם + סוג תיקון + איכות ומסגרת (ה-~ מבדיל משורות מכשירים)
export const repairRowId = (mkey, repair, gid) => `r~${mkey}|${repair}|${gid}`;
const qualityText = (r) => (r.qid ? r.label : r.note || '');
const groupLabel = (model, repair, r, cfg) => [model, repairLabel(repair, cfg), optionName(r)].join(' · ');

/** קבוצות התיקון שיש להן מחיר מספק: לכל אחת – הדגם, האיכות, והפריטים של כל ספק */
function repairGroups(act, cfg, rows) {
  const cat = buildCatalog(act, rows, cfg);
  const models = new Map(cat.models.map((m) => [m.mkey, m]));
  const out = new Map();
  for (const [k, parts] of cat.partIndex) {
    const repair = k.slice(k.lastIndexOf('|') + 1);
    for (const p of parts) {
      const m = models.get(p.mkey);
      if (!m) continue;
      const r = partQuality(p, cfg);
      const id = repairRowId(m.mkey, repair, groupId(r));
      if (!out.has(id)) out.set(id, { id, model: m, repair, r, gid: groupId(r), bySup: new Map(), parts: [] });
      const g = out.get(id);
      if (!g.bySup.has(p.supplierId)) g.bySup.set(p.supplierId, []);
      g.bySup.get(p.supplierId).push(p);
      g.parts.push(p);
    }
  }
  for (const g of out.values()) for (const list of g.bySup.values()) list.sort((a, b) => a.price - b.price);
  return { groups: out, cat, models };
}

/** שורות הייצוא (נתונים בלבד) */
export function exportRows(lists, cfg) {
  const act = activeLists(lists, cfg);
  const { groups, cat } = repairGroups(act, cfg, rowsOf(lists));
  const order = new Map(allRepairs(cfg).map((r, i) => [r.id, i]));
  const quotes = new Map();
  const quoteOf = (g) => {
    const k = `${g.model.mkey}|${g.repair}`;
    if (!quotes.has(k)) quotes.set(k, repairQuote(g.model, g.repair, cat.partIndex.get(k) || [], cfg));
    return quotes.get(k);
  };
  const repairs = Object.fromEntries(SHEETS.map((s) => [s.id, []]));
  const list = [...groups.values()].sort((a, b) => (b.model.year ?? 0) - (a.model.year ?? 0)
    || String(a.model.model).localeCompare(String(b.model.model), 'en', { numeric: true })
    || (order.get(a.repair) ?? 99) - (order.get(b.repair) ?? 99)
    || (a.r.qid ? qualitiesFor(a.repair, cfg).findIndex((x) => x.id === a.r.qid) : 99) - (b.r.qid ? qualitiesFor(b.repair, cfg).findIndex((x) => x.id === b.r.qid) : 99));
  for (const g of list) {
    const q = quoteOf(g);
    const o = q.options.find((x) => x.gid === g.gid);
    const row = {
      brand: g.model.brand || '', model: g.model.model, year: numOrNull(g.model.year), repair: repairLabel(g.repair, cfg),
      quality: qualityText(g.r), frame: g.r.frame ? FRAME[g.r.frame] : '', labor: q.labor?.amount ?? null, customer: o?.final ?? null, id: g.id,
    };
    const p = {}, k = {};
    for (const [sid, items] of g.bySup) { row[`p:${sid}`] = items[0].price; p[sid] = items[0].price; k[sid] = items[0].key; }
    row.orig = JSON.stringify({ b: row.brand, m: row.model, rp: g.repair, q: row.quality, fr: g.r.frame || '', p, k, c: row.customer });
    repairs[g.model.sheet || sheetOf(g.model.brand)].push(row);
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
  const rcols = repairCols(cfg);
  const qLabels = [...new Set(allRepairs(cfg).flatMap((r) => qualitiesFor(r.id, cfg).map((x) => x.label)))];
  for (const sh of REPAIR_SHEETS) {
    add(sh.name, rcols, data.repairs[sh.id], ({ add: v, prompt, positive }) => {
      v('repair', { type: 'list', allowBlank: false, showErrorMessage: true, errorTitle: 'סוג תיקון', error: 'בחר מהרשימה', formulae: listFormula(allRepairs(cfg).map((r) => r.label)) });
      v('quality', { ...(listFormula(qLabels) ? { type: 'list', formulae: listFormula(qLabels) } : { type: 'any' }), allowBlank: true, showErrorMessage: false, ...prompt('quality', 'איכות') });
      v('frame', { type: 'list', allowBlank: true, showErrorMessage: true, errorTitle: 'מסגרת', error: 'בחר מהרשימה', formulae: listFormula(Object.values(FRAME)), ...prompt('frame', 'מסגרת') });
      for (const c of rcols.filter((x) => x.sup)) v(c.key, { ...positive(c.header), ...prompt('price', c.header) });
      v('labor', { type: 'any', ...prompt('labor', 'עבודה') });
      v('customer', { ...positive('מחיר ללקוח'), ...prompt('customer', 'מחיר ללקוח') });
      v('id', { type: 'any', ...prompt('id', 'מזהה') });
    });
  }
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
  for (const sh of SHEETS) for (const r of data.repairs[sh.id]) meta.addRow([r.id]);
  for (const sh of SHEETS) for (const r of data.devices[sh.id]) meta.addRow([r.id]);
  const count = (o) => SHEETS.reduce((n, sh) => n + o[sh.id].length, 0);
  return { wb, counts: { repairs: count(data.repairs), devices: count(data.devices) } };
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
  const dcols = deviceCols(cfg), rcols = repairCols(cfg);
  const devices = [], repairs = [];
  let oldRepairs = false;
  for (const ws of visible) {
    const heads = [];
    ws.getRow(1).eachCell((cell) => heads.push(str(cellValue(cell.value))));
    if (heads.includes('סוג תיקון')) repairs.push(readSheet(ws, rcols, ['model', 'repair'], !!manifest));
    else if (heads.includes('שם הדגם')) devices.push(readSheet(ws, dcols, ['model', 'segment'], !!manifest));
    else if (heads.includes('סוג חלק') && heads.includes('ספק')) oldRepairs = true; // גיליון תיקונים בפורמט הקודם
  }
  return { repairs, devices, manifest, oldRepairs };
}

// ---------- תכנון הייבוא (בלי לשמור) ----------

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
    inFile: new Set([...(book.repairs || []), ...(book.devices || [])].flatMap((s) => s.rows || []).map((r) => str(r.id)).filter(Boolean)),
  };
  ctx.listOf = (id) => (ctx.work[id] ||= [...(ctx.act[id]?.items || [])]);
  planRepairs(book.repairs || [], ctx, book.oldRepairs);
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

// ----- מחירון תיקונים (גיליון לכל חברה) -----
const frameFromCell = (v) => {
  const s = str(v);
  if (!s) return '';
  if (/ללא|בלי|without|no/i.test(s)) return 'without';
  if (/כולל|עם|with|מסגרת|frame/i.test(s)) return 'with';
  return null;
};
const repairFromCell = (v, cfg) => {
  const s = str(v);
  if (!s) return null;
  const all = allRepairs(cfg);
  return all.find((x) => x.label === s || x.id === s)?.id || null;
};
/** איכות מהתא: שם מהרשימה (או מילה של ספק שמתורגמת אליו), אחרת טקסט חופשי */
const qualityFromCell = (v, repair, cfg) => {
  const s = str(v);
  if (!s || s === STANDARD) return { qid: '', note: '' };
  const x = qualitiesFor(repair, cfg).find((q) => q.label === s);
  if (x) return { qid: x.id, note: '' };
  const r = resolveQuality(repair, s, cfg);
  return r.qid && !r.note ? { qid: r.qid, note: '' } : { qid: '', note: s };
};

function planRepairs(sheets, ctx, oldFormat) {
  const { act, cfg, now, det, n, invalid, notes, conflicts, lists } = ctx;
  if (oldFormat) notes.push(`הגיליון "${SHEET_REPAIRS}" בפורמט הקודם לא יובא. כדי לערוך תיקונים באקסל – ייצא קובץ חדש`);
  if (!sheets.length) { if (!oldFormat) notes.push('לא נמצאו בקובץ גיליונות תיקונים – מחירון התיקונים לא שונה'); return; }
  const good = sheets.filter((s) => !s.error);
  for (const s of sheets) if (s.error) invalid.push({ sheet: s.name || 'תיקונים', row: 1, reason: s.error });
  if (!good.length) return;
  for (const s of good) for (const h of s.extraPriceCols) notes.push(`העמודה "${h}" בגיליון "${s.name}" לא שייכת לאף ספק חלקים באפליקציה – לא נקראה`);

  const sups = partSuppliers(cfg);
  const { groups, models } = repairGroups(act, cfg, rowsOf(lists));
  const seen = new Set();
  const entries = [];
  // דגם מהתא: דגם שקיים במחירון, או שם שמזוהה (יצרן / סדרה)
  const modelFrom = (brand, name) => {
    const id = identify(name, brand || null);
    const mkey = modelKey(id);
    const m = models.get(mkey);
    if (m) return m;
    if (!id.family && !id.brand) return null;
    return { mkey, brand: id.brand || brand || null, model: id.model, family: id.family, tier: id.tier, devKind: id.kind === 'other' ? 'phone' : id.kind };
  };

  for (const sh of good) {
    for (const r of sh.rows) {
      const bad = (reason) => invalid.push({ sheet: sh.name, row: r.row, reason, name: str(r.model) });
      const id = str(r.id);
      if (id && !id.startsWith('r~')) { bad('זו שורה של מכשיר – מקומה בגיליון של החברה ברשימת המכשירים'); continue; }
      const dupId = id && seen.has(id);
      if (id) seen.add(id);
      let orig = null;
      try { const o = r.orig ? JSON.parse(String(r.orig)) : null; if (o && typeof o === 'object' && 'rp' in o) orig = o; } catch { orig = null; }
      const name = str(r.model);
      if (!name) { bad('חסר דגם'); continue; }
      const repair = repairFromCell(r.repair, cfg);
      if (!repair) { bad(str(r.repair) ? `סוג תיקון לא מוכר: "${str(r.repair)}"` : 'חסר סוג תיקון'); continue; }
      const frame = frameFromCell(r.frame);
      if (frame == null) { bad(`מסגרת לא מוכרת: "${str(r.frame)}" (כולל מסגרת / ללא מסגרת / ריק)`); continue; }
      const p = {};
      let badPrice = null;
      for (const s of sups) {
        if (!sh.cols[`p:${s.id}`]) continue; // אין עמודה לספק הזה בקובץ (למשל שמו שונה אחרי הייצוא) – לא נוגעים במחירים שלו
        const v = parseNum(r[`p:${s.id}`]);
        if (Number.isNaN(v) || (v != null && v <= 0)) { badPrice = `מחיר ספק ${s.name} לא תקין: "${str(r[`p:${s.id}`])}"`; break; }
        p[s.id] = v;
      }
      if (badPrice) { bad(badPrice); continue; }
      const customer = parseNum(r.customer);
      if (Number.isNaN(customer) || (customer != null && customer <= 0)) { bad(`מחיר ללקוח לא תקין: "${str(r.customer)}"`); continue; }
      const known = id && !dupId ? groups.get(id) || null : null;
      const q = qualityFromCell(r.quality, repair, cfg);
      entries.push({ r, sh, id, known, orig, name, brand: str(r.brand), repair, q, frame, p, customer, bad });
    }
  }

  const ovSet = new Map(), ovClear = new Map();
  const listOf = (sid) => { ctx.touched.add(sid); return ctx.listOf(sid); };
  const removeItem = (sid, it) => { const arr = listOf(sid); const i = arr.findIndex((x) => x.key === it.key); if (i >= 0) arr.splice(i, 1); };
  const putItem = (sid, it, replaceKey = null) => {
    const arr = listOf(sid);
    if (replaceKey) { const i = arr.findIndex((x) => x.key === replaceKey); if (i >= 0) arr.splice(i, 1); }
    const taken = new Set(arr.map((x) => x.key));
    let k = it.key, c = 1;
    while (taken.has(k)) k = `${it.key}#${++c}`;
    arr.push({ ...it, key: k });
  };
  const curPrice = (g, sid) => g?.bySup.get(sid)?.[0]?.price ?? null;

  for (const e of entries) {
    const { r, known: g, orig } = e;
    const model = modelFrom(e.brand, e.name);
    if (!model) { e.bad(`דגם לא מזוהה: "${e.name}"`); continue; }
    const r2 = { qid: e.q.qid, label: '', frame: e.frame || null, note: e.q.qid ? '' : e.q.note };
    const target = { model, repair: e.repair, qid: e.q.qid, frame: e.frame || null, note: r2.note, gid: groupId(r2) };
    const targetId = repairRowId(model.mkey, e.repair, target.gid);
    const label = [model.model, repairLabel(e.repair, cfg), optionName({ ...r2, label: e.q.qid ? qualitiesFor(e.repair, cfg).find((x) => x.id === e.q.qid)?.label : '' })].join(' · ');
    const variantFor = (prevVariant) => (target.qid || !target.note ? null : prevVariant ?? target.note);

    if (g) {
      // שורה קיימת: מה השתנה בקובץ לעומת מה שיוצא (שדות שלא שונו בקובץ נשארים כמו באפליקציה)
      const base = orig || { m: g.model.model, rp: g.repair, q: qualityText(g.r), fr: g.r.frame || '', p: Object.fromEntries([...g.bySup].map(([sid, l]) => [sid, l[0].price])), c: repairQuote(g.model, g.repair, g.parts, cfg).options[0]?.final ?? null };
      const moved = str(base.m) !== e.name || base.rp !== e.repair || str(base.q) !== str(r.quality) || (base.fr || '') !== (e.frame || '');
      let changed = false, priceChanged = 0;
      if (moved && targetId !== g.id) {
        if (groups.has(targetId)) { e.bad(`כבר קיימת שורה ל-${label}`); continue; }
        for (const [sid, items] of g.bySup) {
          for (const it of items) {
            const fresh = manualPart({ model, repair: e.repair, qid: target.qid, frame: target.frame, price: it.price, cfg, now, prev: it, variant: variantFor(null) });
            putItem(sid, { ...fresh, updatedAt: it.updatedAt, changedAt: it.changedAt, prevPrice: it.prevPrice ?? null }, it.key);
          }
        }
        changed = true;
      }
      for (const s of sups) {
        if (!(s.id in e.p)) continue;
        const was = base.p?.[s.id] ?? null, now_ = e.p[s.id];
        if ((was ?? null) === (now_ ?? null) || (was != null && now_ != null && Math.abs(was - now_) < 0.005)) continue;
        const items = g.bySup.get(s.id) || [];
        if (now_ == null) { for (const it of items) removeItem(s.id, it); }
        else if (items.length) {
          const it = items[0];
          if (Math.abs(it.price - now_) < 0.005) continue;
          const tgt = moved && targetId !== g.id ? { model, repair: e.repair, qid: target.qid, frame: target.frame, variant: variantFor(null) } : { model: g.model, repair: g.repair, qid: g.r.qid, frame: g.r.frame, variant: it.variant };
          putItem(s.id, manualPart({ ...tgt, price: now_, cfg, now, prev: it }), it.key);
        } else {
          const tgt = moved && targetId !== g.id ? { model, repair: e.repair, qid: target.qid, frame: target.frame, variant: variantFor(null) } : { model: g.model, repair: g.repair, qid: g.r.qid, frame: g.r.frame, variant: g.r.qid ? null : (g.parts[0]?.variant ?? null) };
          putItem(s.id, manualPart({ ...tgt, price: now_, cfg, now }));
        }
        changed = true; priceChanged++;
      }
      if (changed) {
        n.updated++; n.priceChanged += priceChanged ? 1 : 0;
        det.updated.push({ sheet: e.sh.name, row: r.row, name: label, what: [moved && targetId !== g.id && 'דגם/תיקון/איכות', priceChanged && 'מחיר ספק'].filter(Boolean) });
      }
      const custChanged = base.c == null ? e.customer != null : e.customer == null || Math.round(e.customer) !== Math.round(base.c);
      if (custChanged) {
        const okey = optionKey(model.mkey, e.repair, target.gid);
        const old = [optionKey(g.model.mkey, g.repair, g.gid), ...new Set(g.parts.flatMap((x) => [repairGroupKey(g.model.mkey, g.repair, x.variant), `${g.model.mkey}|${g.repair}|${x.variant || 'סטנדרטי'}`]))];
        if (e.customer != null) ovSet.set(okey, { value: Math.round(e.customer), row: r.row, sheet: e.sh.name, label, old });
        else ovClear.set(okey, { label, old });
      } else if (moved && targetId !== g.id) {
        // מחיר ידני שהיה לשורה עובר איתה
        const from = optionKey(g.model.mkey, g.repair, g.gid);
        if (ctx.po[from] != null) { ctx.po[optionKey(model.mkey, e.repair, target.gid)] = ctx.po[from]; delete ctx.po[from]; ctx.ov.set++; }
      }
      continue;
    }

    // שורה חדשה (בלי מזהה, או מזהה שכבר לא קיים / שורה מועתקת)
    const existing = groups.get(targetId);
    if (existing) seen.add(targetId); // שורה שנכתבה מחדש (בלי מזהה) לקבוצה קיימת – הקבוצה לא נמחקת
    const priced = sups.filter((s) => e.p[s.id] != null);
    if (!priced.length && !existing) { if (e.id && orig) { n.gone++; continue; } e.bad('אין מחיר ספק בשורה'); continue; }
    if (e.id && orig && !existing) { // שורה שכבר לא קיימת באפליקציה: מוסיפים רק אם שונתה בקובץ
      const same = sups.every((s) => (orig.p?.[s.id] ?? null) === (e.p[s.id] ?? null)) && str(orig.m) === e.name && orig.rp === e.repair && str(orig.q) === str(r.quality);
      if (same) { n.gone++; continue; }
    }
    if (existing && e.id === targetId) { n.dup++; continue; } // אותה שורה פעמיים
    let added = 0, upd = 0;
    for (const s of priced) {
      const cur = existing?.bySup.get(s.id)?.[0] || null;
      if (cur && Math.abs(cur.price - e.p[s.id]) < 0.005) continue;
      putItem(s.id, manualPart({ model, repair: e.repair, qid: target.qid, frame: target.frame, price: e.p[s.id], cfg, now, prev: cur, variant: variantFor(cur?.variant) }), cur?.key || null);
      if (cur) upd++; else added++;
    }
    if (!added && !upd) { n.exists++; }
    else if (existing) { n.updated++; n.priceChanged++; det.updated.push({ sheet: e.sh.name, row: r.row, name: label, what: ['מחיר ספק'] }); }
    else { n.added++; det.added.push({ sheet: e.sh.name, row: r.row, name: label, price: Math.min(...priced.map((s) => e.p[s.id])), supplier: priced.map((s) => s.name).join(', ') }); }
    if (e.customer != null) ovSet.set(optionKey(model.mkey, e.repair, target.gid), { value: Math.round(e.customer), row: r.row, sheet: e.sh.name, label, old: [] });
  }

  // מחיקות: שורות שהיו בקובץ (לפי רשימת הייצוא) ונמחקו ממנו – רק מגיליונות שנמצאים בקובץ
  const present = new Set(good.map((s) => REPAIR_SHEETS.find((x) => x.name === s.name)?.id).filter(Boolean));
  for (const sh of REPAIR_SHEETS) if (!present.has(sh.id) && groups.size) notes.push(`הגיליון "${sh.name}" לא נמצא בקובץ – התיקונים שלו לא נמחקו`);
  if (!ctx.exportedIds) notes.push('הקובץ לא נוצר בייצוא מהאפליקציה – כל מחיר תיקון שלא מופיע בגיליון של החברה שלו יימחק');
  for (const g of groups.values()) {
    if (seen.has(g.id) || ctx.inFile.has(g.id) || !present.has(g.model.sheet || sheetOf(g.model.brand)) || (ctx.exportedIds && !ctx.exportedIds.has(g.id))) continue;
    for (const [sid, items] of g.bySup) for (const it of items) removeItem(sid, it);
    n.deleted++;
    det.deleted.push({ sheet: repairSheetName(g.model.sheet || sheetOf(g.model.brand)), name: groupLabel(g.model.model, g.repair, g.r, cfg), price: Math.min(...g.parts.map((x) => x.price)), supplier: [...g.bySup.keys()].map((sid) => sups.find((s) => s.id === sid)?.name || sid).join(', ') });
    const k = optionKey(g.model.mkey, g.repair, g.gid);
    if (ctx.po[k] != null) { delete ctx.po[k]; ctx.ov.cleared++; }
  }

  const { po } = ctx;
  const seenSet = new Map();
  for (const [k, o] of ovSet) {
    const prev = seenSet.get(k);
    if (prev && prev.value !== o.value) { conflicts.push(`${o.label}: שני מחירים שונים ללקוח (שורות ${prev.row} ו-${o.row}) – נקבע ${prev.value}`); continue; }
    seenSet.set(k, o);
    const legacy = o.old.filter((x) => x !== k && po[x] != null);
    if (Number(po[k]) === o.value && !legacy.length) continue;
    legacy.forEach((x) => delete po[x]);
    po[k] = o.value;
    ctx.ov.set++;
    det.overrides.push({ name: o.label, value: o.value });
  }
  for (const [k, o] of ovClear) {
    if (ovSet.has(k)) continue;
    const old = [k, ...o.old].filter((x) => po[x] != null);
    if (!old.length) continue;
    old.forEach((x) => delete po[x]);
    ctx.ov.cleared++;
    det.overrides.push({ name: o.label, value: null });
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
      if (id.includes('~')) { bad('זו שורה של תיקון – מקומה בגיליון "תיקונים" של החברה'); continue; }
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
