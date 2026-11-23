// ייצוא וייבוא של מחירון של ספק אחד לקובץ אקסל (xlsx) – קובץ נפרד לכל ספק:
//  • ספק חלקים: "חלקי חילוף Apple / Samsung / Xiaomi" (ו"אחרים" אם יש) – שורה לכל דגם מרשימת התיקונים,
//    עמודה לכל חלק (העמודות קבועות מראש, לכל חברה), ובתא – המחיר אצל הספק הזה
//  • ספק מכשירים: "Apple / Samsung / Xiaomi" (ו"אחרים" אם יש) – רשימת המכשירים בפורמט של קובץ המכשירים, עם עמודת המחיר של הספק
//
// בכל שורה נשמרת עמודה מוסתרת עם הערכים שיוצאו ("_מקור"), ובקובץ יש גיליון מוסתר עם הספק ורשימת השורות שיוצאו.
// כך הייבוא משנה רק את מה שבאמת שונה בקובץ – גם אם בינתיים המחירון עודכן מוואטסאפ – ולא נוגע בספק אחר.
import { activeLists } from './catalog.js';
import { identify, normText } from './normalize.js';
import { partColumns } from './repairs.js';
import { partCells, setPartCell } from './partcells.js';
import { RMODELS_ID, rmodelsOf, modelOfRow, sortRows, addRows, normCode } from './rmodels.js';
import {
  CATALOG_ID, SEGMENTS, SHEETS, sheetOf, segmentLabel, segmentFromLabel, priceIndex, rowQuote, rowKey, rowLabel,
  devKey, verKey, newRowId, parseStorage, defaultCatalog,
} from './devices.js';

export { parseStorage };
const SHEET_META = '_ייצוא';
export const partsSheetName = (sheetId) => `חלקי חילוף ${SHEETS.find((s) => s.id === sheetId)?.label || sheetId}`;
const deviceSheetName = (sheetId) => SHEETS.find((s) => s.id === sheetId)?.label || sheetId;
const BRAND_OF_SHEET = { apple: 'Apple', samsung: 'Samsung', xiaomi: 'Xiaomi' };
export const kindOf = (sup) => (sup?.type === 'parts' ? 'parts' : 'devices');

/** עמודות גיליון מכשירים (ספק אחד) – כמו בקובץ המכשירים, עם עמודת "מחיר" של הספק */
export function deviceCols() {
  return [
    { key: 'brand', header: 'יצרן', width: 12 },
    { key: 'segment', header: 'רמות גימור/סגמנטציה', width: 20 },
    { key: 'series', header: 'סדרה', width: 14 },
    { key: 'model', header: 'שם הדגם', width: 24 },
    { key: 'storage', header: 'נפחי אחסון זמינים', width: 12 },
    { key: 'version', header: 'גרסה', width: 14 },
    { key: 'year', header: 'שנת השקה', width: 10 },
    { key: 'price', header: 'מחיר', width: 12, num: true },
    { key: 'notes', header: 'הערות', width: 24 },
    { key: 'id', header: 'מזהה', width: 10, hidden: true },
    { key: 'orig', header: '_מקור', width: 10, hidden: true },
  ];
}

/** עמודות גיליון "חלקי חילוף" של חברה: דגם, דגם יצרן (סמסונג), ועמודה לכל חלק */
export function partsCols(sheetId, cfg) {
  return [
    { key: 'model', header: 'דגם', width: 18 },
    ...(sheetId === 'samsung' ? [{ key: 'code', header: 'דגם יצרן', width: 12 }] : []),
    ...partColumns(sheetId, cfg).map((c, i) => ({ key: `c${i}`, header: c.label, width: Math.max(9, Math.min(18, c.label.length + 2)), num: true, part: c })),
    { key: 'id', header: 'מזהה', width: 10, hidden: true },
    { key: 'orig', header: '_מקור', width: 10, hidden: true },
  ];
}

// הסברים שמופיעים באקסל כשבוחרים תא בעמודה (הודעת קלט של אימות נתונים)
const PROMPTS = {
  storage: 'למשל 128GB או 1TB. ריק = בלי נפח.',
  version: 'רשמי / מקביל / Active / New / סלולר … ריק = בלי גרסה.',
  price: 'המחיר אצל הספק. ריק = אין מחיר.',
  code: 'דגם יצרן (למשל A125). לפיו מזוהות השורות במחירון של הספק.',
};

const numOrNull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const rowsOf = (lists) => lists?.[CATALOG_ID]?.items || defaultCatalog();
const PRICE_FMT = '[$₪-40D]\\ #,##0'; // ₪ כמו בקובץ הדוגמה
const listFormula = (values) => {
  const safe = values.filter((v) => v && !/[,"]/.test(v));
  const f = `"${safe.join(',')}"`;
  return safe.length && f.length <= 255 ? [f] : null;
};


// ---------- ייצוא ----------

/** הגיליונות של הקובץ של ספק (נתונים בלבד) */
export function exportSupplier(lists, cfg, supplierId) {
  const sup = (cfg.suppliers || []).find((s) => s.id === supplierId);
  if (!sup) throw new Error('ספק לא נמצא');
  const items = lists?.[supplierId]?.items || [];
  if (kindOf(sup) === 'parts') {
    const rm = rmodelsOf(lists);
    const { get, orphan, nocol } = partCells(items, supplierId, rm, cfg);
    const sheets = [];
    for (const sh of SHEETS) {
      const rows = sortRows(rm.filter((r) => sheetOf(r.brand) === sh.id));
      if (sh.id === 'other' && !rows.length) continue;
      const cols = partsCols(sh.id, cfg);
      const out = rows.map((r) => {
        const row = { model: r.model, code: r.code || '', id: r.id };
        const p = {};
        cols.forEach((c) => {
          if (!c.part) return;
          const l = get(r, Number(c.key.slice(1)));
          if (l.length) { row[c.key] = l[0].price; p[c.header] = l[0].price; }
        });
        row.orig = JSON.stringify({ m: r.model, cd: r.code || '', p });
        return row;
      });
      sheets.push({ id: sh.id, name: partsSheetName(sh.id), cols, rows: out });
    }
    return { kind: 'parts', supplier: sup, sheets, orphan, nocol };
  }
  const catalog = rowsOf(lists);
  const mine = new Map(items.filter((x) => x.row).map((x) => [x.row, x.price]));
  const sheets = [];
  for (const sh of SHEETS) {
    const rows = catalog.filter((r) => sheetOf(r.brand) === sh.id);
    if (sh.id === 'other' && !rows.length) continue;
    const out = rows.map((r) => { // בסדר של רשימת המכשירים (כמו בקובץ המקורי)
      const row = {
        brand: r.brand || '', segment: segmentLabel(r.segment), series: r.series || '', model: r.model,
        storage: r.storage ? (r.storage >= 1024 ? `${r.storage / 1024}TB` : `${r.storage}GB`) : '', version: r.version || '',
        year: numOrNull(r.year), price: mine.get(r.id) ?? null, notes: r.notes || '', id: r.id,
      };
      row.orig = JSON.stringify({ b: row.brand, g: r.segment, se: row.series, m: row.model, st: r.storage ?? null, v: row.version, y: row.year, n: row.notes, p: row.price });
      return row;
    });
    sheets.push({ id: sh.id, name: deviceSheetName(sh.id), cols: deviceCols(), rows: out });
  }
  return { kind: 'devices', supplier: sup, sheets, orphan: 0, nocol: 0 };
}

/** בונה את הקובץ של ספק. ExcelJS מועבר מבחוץ (נטען רק כשצריך) */
export function buildWorkbook(ExcelJS, lists, cfg, supplierId, now = Date.now()) {
  const data = exportSupplier(lists, cfg, supplierId);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'מחירון';
  wb.created = new Date(now);
  let prices = 0, rowsN = 0;
  for (const sh of data.sheets) {
    const ws = wb.addWorksheet(sh.name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1, xSplit: 1 }] });
    ws.columns = sh.cols.map((c) => ({ header: c.header, key: c.key, width: c.width, hidden: !!c.hidden }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    for (const r of sh.rows) { ws.addRow(r); rowsN++; prices += sh.cols.filter((c) => (c.num || c.part) && r[c.key] != null).length; }
    sh.cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.num) { col.numFmt = PRICE_FMT; col.alignment = { horizontal: 'center' }; }
    });
    const last = sh.rows.length + 300; // מקום גם לשורות חדשות
    const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
    const range = (i) => `${letter(i)}2:${letter(i)}${last}`;
    sh.cols.forEach((c, i) => {
      if (c.num) ws.dataValidations.add(range(i), { type: 'decimal', operator: 'greaterThan', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: c.header, error: 'מספר גדול מ-0', showInputMessage: true, promptTitle: c.header, prompt: PROMPTS.price });
      else if (c.key === 'segment') ws.dataValidations.add(range(i), { type: 'list', allowBlank: false, showErrorMessage: true, errorTitle: 'רמת גימור', error: 'בחר מהרשימה', formulae: listFormula(SEGMENTS.map((x) => x.label)) });
      else if (c.key === 'year') ws.dataValidations.add(range(i), { type: 'whole', operator: 'between', formulae: [2000, 2100], allowBlank: true, showErrorMessage: true, errorTitle: 'שנת השקה', error: 'שנה, למשל 2026' });
      else if (PROMPTS[c.key]) ws.dataValidations.add(range(i), { type: 'any', showInputMessage: true, promptTitle: c.header, prompt: PROMPTS[c.key] });
    });
  }
  const meta = wb.addWorksheet(SHEET_META);
  meta.state = 'veryHidden';
  meta.addRow(['exportedAt', now]);
  meta.addRow(['supplier', data.supplier.id, data.kind, data.supplier.name]);
  for (const sh of data.sheets) for (const r of sh.rows) meta.addRow([r.id]);
  return { wb, counts: { rows: rowsN, prices, orphan: data.orphan, nocol: data.nocol }, kind: data.kind };
}

export function exportFileName(sup, now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  const safe = String(sup?.name || sup?.id || '').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return `${kindOf(sup) === 'parts' ? 'מחירון תיקונים' : 'מחירון מכשירים'} - ${safe} - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
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
  const extra = [], heads = [];
  ws.getRow(1).eachCell((cell, n) => {
    const h = str(cellValue(cell.value));
    heads.push(h);
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
    if (cols.some((c) => c.key !== 'orig' && c.key !== 'id' && str(r[c.key]) !== '')) rows.push(r);
  });
  return { rows, name: ws.name, cols: colOf, extraPriceCols: extra, heads };
}

/** קורא קובץ של ספק. supplierId – הספק שנבחר באפליקציה (הקובץ חייב להיות שלו) */
export function readWorkbook(wb, cfg, supplierId) {
  const sup = (cfg.suppliers || []).find((s) => s.id === supplierId) || null;
  const metaWs = wb.worksheets.find((ws) => ws.name === SHEET_META);
  let manifest = null;
  if (metaWs) {
    const ids = new Set();
    let exportedAt = null, owner = null;
    metaWs.eachRow((row, n) => {
      const v = str(cellValue(row.getCell(1).value));
      if (n === 1 && v === 'exportedAt') exportedAt = Number(cellValue(row.getCell(2).value)) || null;
      else if (v === 'supplier') owner = { id: str(cellValue(row.getCell(2).value)), kind: str(cellValue(row.getCell(3).value)), name: str(cellValue(row.getCell(4).value)) };
      else if (v) ids.add(v);
    });
    manifest = { ids, exportedAt, owner };
  }
  const kind = kindOf(sup);
  const sheets = [];
  let wrongKind = null;
  for (const ws of wb.worksheets) {
    if (ws.name === SHEET_META) continue;
    const heads = [];
    ws.getRow(1).eachCell((cell) => heads.push(str(cellValue(cell.value))));
    if (kind === 'parts') {
      if (heads.includes('שם הדגם')) { wrongKind = 'devices'; continue; }
      if (!heads.includes('דגם')) continue;
      const sid = sheetFromName(ws.name);
      if (!sid) continue;
      sheets.push({ ...readSheet(ws, partsCols(sid, cfg), ['model'], !!manifest), sheet: sid });
    } else {
      if (heads.includes('דגם') && !heads.includes('שם הדגם')) { wrongKind = 'parts'; continue; }
      if (!heads.includes('שם הדגם')) continue;
      sheets.push({ ...readSheet(ws, deviceCols(), ['model', 'segment'], !!manifest), sheet: sheetFromName(ws.name) });
    }
  }
  return { kind, supplierId, sheets, manifest, wrongKind };
}
// "חלקי חילוף Samsung" / "Samsung" → samsung
function sheetFromName(name) {
  const n = String(name || '').replace(/^חלקי חילוף\s*/, '').trim().toLowerCase();
  if (n === 'iphone') return 'apple';
  return SHEETS.find((s) => s.label.toLowerCase() === n || s.id === n)?.id || null;
}

// ---------- תכנון הייבוא (בלי לשמור) ----------

/**
 * משווה את הקובץ של הספק למצב הנוכחי ומחזיר מה ישתנה. לא שומר כלום.
 * מחזיר { lists: {id: {items, supplierName, updatedAt}}, config (או null), summary, details, hasChanges } או { error }
 */
export function planImport(book, lists, cfg, now = Date.now()) {
  const sup = (cfg.suppliers || []).find((s) => s.id === book.supplierId);
  if (!sup) return { error: 'בחר ספק' };
  const owner = book.manifest?.owner;
  if (owner && owner.id && owner.id !== sup.id) return { error: `הקובץ הזה הוא של "${owner.name || owner.id}", לא של "${sup.name}". בחר את הספק הנכון ונסה שוב.` };
  if (!book.sheets.length && book.wrongKind) return { error: book.wrongKind === 'devices' ? `זה קובץ של מחירון מכשירים, ו"${sup.name}" הוא ספק חלקים` : `זה קובץ של חלקי חילוף, ו"${sup.name}" הוא ספק מכשירים` };
  const ctx = {
    lists, cfg, now, sup, act: activeLists(lists, cfg),
    work: {}, touched: new Set(),
    invalid: [], notes: [], conflicts: [],
    det: { updated: [], added: [], deleted: [], overrides: [], margins: [] },
    n: { updated: 0, priceChanged: 0, added: 0, deleted: 0, cleared: 0, gone: 0, dup: 0, exists: 0 },
    exportedIds: book.manifest?.ids || null,
    inFile: new Set(book.sheets.flatMap((s) => s.rows || []).map((r) => str(r.id)).filter(Boolean)),
  };
  if (!owner) ctx.notes.push(`הקובץ לא נוצר בייצוא מהאפליקציה – המחירים בו ייכנסו ל"${sup.name}"`);
  if (book.kind === 'parts') planParts(book.sheets, ctx); else planDevices(book.sheets, ctx);
  const { n, notes } = ctx;
  if (n.gone) notes.push(`${n.gone} שורות דולגו – הן כבר לא קיימות באפליקציה (נמחקו מאז הייצוא) ולא שונו בקובץ`);
  if (n.dup) notes.push(`${n.dup} שורות כפולות (זהות לשורה אחרת בקובץ) דולגו`);
  if (n.exists) notes.push(`${n.exists} שורות חדשות כבר קיימות בדיוק כך – לא נוספו פעמיים`);
  const outLists = {};
  for (const id of ctx.touched) {
    outLists[id] = id === CATALOG_ID ? { items: ctx.work[id], supplierName: 'רשימת מכשירים' }
      : id === RMODELS_ID ? { items: ctx.work[id], supplierName: 'דגמים לתיקון' }
        : { items: ctx.work[id], supplierName: sup.name, updatedAt: ctx.act[id]?.updatedAt || now };
  }
  return {
    lists: outLists,
    config: null,
    summary: {
      updated: n.updated, priceChanged: n.priceChanged, added: n.added, deleted: n.deleted, cleared: n.cleared,
      overridesSet: 0, overridesCleared: 0, marginsSet: 0, marginsCleared: 0,
      newSuppliers: [], invalid: ctx.invalid, notes, conflicts: ctx.conflicts,
      exportedAt: book.manifest?.exportedAt || null, supplier: sup.name, kind: book.kind,
    },
    details: ctx.det,
    hasChanges: ctx.touched.size > 0,
  };
}

// ----- קובץ חלקי חילוף של ספק -----
function planParts(sheets, ctx) {
  const { lists, cfg, now, sup, det, n, invalid, notes } = ctx;
  if (!sheets.length) { notes.push('לא נמצאו בקובץ גיליונות "חלקי חילוף"'); return; }
  const good = sheets.filter((s) => !s.error);
  for (const s of sheets) if (s.error) invalid.push({ sheet: s.name || 'חלקי חילוף', row: 1, reason: s.error });
  if (!good.length) return;
  const rm0 = rmodelsOf(lists);
  let rm = [...rm0];
  let rmChanged = false;
  const byId = new Map(rm.map((r) => [r.id, r]));
  const seen = new Set();

  // עמודה בקובץ שלא קיימת בהגדרות – לא נקראת
  for (const s of good) {
    const known = new Set(partsCols(s.sheet, cfg).map((c) => c.header));
    const heads = s.heads || [];
    for (const h of heads) if (h && !known.has(h)) notes.push(`העמודה "${h}" בגיליון "${s.name}" לא מוגדרת בהגדרות (סוגי תיקון ואיכויות ← עמודות) – לא נקראה`);
  }

  let items = [...(ctx.act[sup.id]?.items || [])];
  let itemsChanged = false;
  const setCell = (row, ci, price) => {
    const r = setPartCell(items, sup.id, row, ci, price, cfg, now, 'אקסל');
    if (r.changed) { items = r.items; itemsChanged = true; }
    return r.changed;
  };
  const priceOf = (row, ci) => partCells(items.filter((x) => x.mkey === row.key), sup.id, [row], cfg).get(row, ci)[0]?.price ?? null;

  for (const sh of good) {
    const cols = partsCols(sh.sheet, cfg);
    const pcols = cols.filter((c) => c.part && sh.cols[c.key]);
    for (const r of sh.rows) {
      const bad = (reason) => invalid.push({ sheet: sh.name, row: r.row, reason, name: str(r.model) });
      const id = str(r.id);
      const dupId = id && seen.has(id);
      if (id) seen.add(id);
      let orig = null;
      try { const o = r.orig ? JSON.parse(String(r.orig)) : null; if (o && typeof o === 'object' && 'm' in o && 'p' in o) orig = o; } catch { orig = null; }
      const name = str(r.model);
      if (!name) { bad('חסר שם דגם'); continue; }
      const code = sh.cols.code ? str(r.code) : null;
      const vals = {};
      let badPrice = null;
      for (const c of pcols) {
        const v = parseNum(r[c.key]);
        if (Number.isNaN(v) || (v != null && v <= 0)) { badPrice = `"${c.header}": "${str(r[c.key])}" הוא לא מחיר`; break; }
        vals[c.key] = v;
      }
      if (badPrice) { bad(badPrice); continue; }
      let row = id && !dupId ? byId.get(id) || null : null;
      if (id && !row && !dupId && orig) {
        const same = pcols.every((c) => (orig.p?.[c.header] ?? null) === (vals[c.key] ?? null)) && str(orig.m) === name;
        if (same) { n.gone++; continue; }
      }
      const what = [];
      if (!row) {
        // שורה חדשה (או שורה בלי מזהה לדגם שכבר ברשימה – לפי השם / דגם היצרן)
        const brand = BRAND_OF_SHEET[sh.sheet] || identify(name).brand || null;
        row = rm.find((x) => sheetOf(x.brand) === sh.sheet && (normText(x.model) === normText(name) || (code && normCode(x.code) && normCode(x.code) === normCode(code)))) || null;
        if (row) seen.add(row.id);
        else {
          if (!pcols.some((c) => vals[c.key] != null) && !code) { bad('שורה חדשה בלי מחיר'); continue; }
          rm = addRows(rm, [{ brand, model: name, code: code || '', year: null, series: '' }]);
          row = rm[rm.length - 1];
          byId.set(row.id, row);
          seen.add(row.id);
          rmChanged = true;
          let cnt = 0;
          for (const c of pcols) if (vals[c.key] != null && setCell(row, Number(c.key.slice(1)), vals[c.key])) cnt++;
          n.added++;
          det.added.push({ sheet: sh.name, row: r.row, name: row.model, price: cnt ? Math.min(...pcols.map((c) => vals[c.key]).filter((x) => x != null)) : null, supplier: cnt ? `${cnt} מחירים` : '' });
          continue;
        }
      }
      // שם / דגם יצרן: משנים את הדגם ברשימה (אצל כל הספקים)
      const base = orig || { m: row.model, cd: row.code || '', p: null };
      if (str(base.m) !== name && name !== row.model) {
        const clash = rm.find((x) => x.id !== row.id && sheetOf(x.brand) === sh.sheet && normText(x.model) === normText(name));
        if (clash) { bad(`כבר יש ברשימה דגם בשם "${name}"`); continue; }
        rm = rm.map((x) => (x.id === row.id ? { ...x, model: name } : x)); row = rm.find((x) => x.id === row.id); rmChanged = true; what.push('שם');
      }
      if (code != null && str(base.cd) !== code && code !== (row.code || '') && (orig || code)) { // בלי "_מקור" – תא ריק לא מוחק דגם יצרן
        rm = rm.map((x) => (x.id === row.id ? { ...x, code } : x)); row = rm.find((x) => x.id === row.id); rmChanged = true; what.push('דגם יצרן');
      }
      let changedPrices = 0;
      for (const c of pcols) {
        const ci = Number(c.key.slice(1));
        const was = base.p ? base.p[c.header] ?? null : priceOf(row, ci);
        const nv = vals[c.key] ?? null;
        if ((was ?? null) === nv) continue;
        if (setCell(row, ci, nv)) changedPrices++;
      }
      if (changedPrices) { what.push(changedPrices === 1 ? 'מחיר' : `${changedPrices} מחירים`); n.priceChanged += changedPrices; }
      if (what.length) { n.updated++; det.updated.push({ sheet: sh.name, row: r.row, name: row.model, what }); }
    }
  }

  // שורה שנמחקה מהקובץ: המחירים של הספק הזה לדגם נמחקים (הדגם עצמו נשאר ברשימה – אצל ספקים אחרים)
  const present = new Set(good.map((s) => s.sheet));
  if (ctx.exportedIds) {
    for (const row of rm0) {
      if (seen.has(row.id) || ctx.inFile.has(row.id) || !present.has(sheetOf(row.brand)) || !ctx.exportedIds.has(row.id)) continue;
      const mine = items.filter((it) => it.kind === 'part' && it.mkey === row.key);
      if (!mine.length) continue;
      items = items.filter((it) => !(it.kind === 'part' && it.mkey === row.key));
      itemsChanged = true;
      n.cleared++;
      det.deleted.push({ sheet: partsSheetName(sheetOf(row.brand)), name: row.model, price: Math.min(...mine.map((x) => x.price)), supplier: `${mine.length} מחירים של ${sup.name}` });
    }
  }
  if (itemsChanged) { ctx.work[sup.id] = items; ctx.touched.add(sup.id); }
  if (rmChanged) { ctx.work[RMODELS_ID] = rm; ctx.touched.add(RMODELS_ID); }
}

// ----- קובץ מחירון מכשירים של ספק -----
function planDevices(sheets, ctx) {
  const { lists, cfg, now, det, n, invalid, notes, sup } = ctx;
  if (!sheets.length) { notes.push('לא נמצאו בקובץ גיליונות מכשירים'); return; }
  const good = sheets.filter((s) => !s.error);
  for (const s of sheets) if (s.error) invalid.push({ sheet: s.name || 'מכשירים', row: 1, reason: s.error });
  if (!good.length) return;

  const rows = rowsOf(lists);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sups = [sup];
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
      const known = id ? byId.get(id) || null : null;
      let orig = null;
      try { const o = r.orig ? JSON.parse(String(r.orig)) : null; if (o && typeof o === 'object' && 'm' in o && 'g' in o) orig = o; } catch { orig = null; }
      const model = str(r.model);
      if (!model) { bad('חסר שם דגם'); continue; }
      const segment = segmentFromLabel(r.segment);
      if (!segment) { bad(str(r.segment) ? `רמת גימור לא מוכרת: "${str(r.segment)}"` : 'חסרה רמת גימור / סגמנט'); continue; }
      const storage = parseStorage(r.storage);
      if (Number.isNaN(storage)) { bad(`נפח לא תקין: "${str(r.storage)}"`); continue; }
      const yearN = parseNum(r.year);
      if (Number.isNaN(yearN)) { bad(`שנת השקה לא תקינה: "${str(r.year)}"`); continue; }
      const p = {};
      if (sh.cols.price) { // אין עמודת מחיר בקובץ – לא נוגעים במחירים
        const pv = parseNum(r.price);
        if (Number.isNaN(pv) || (pv != null && pv <= 0)) { bad(`מחיר לא תקין: "${str(r.price)}"`); continue; }
        p[sup.id] = pv;
      }
      const v = { brand: str(r.brand), segment, series: str(r.series), model, storage, version: str(r.version), year: yearN, notes: str(r.notes), p };

      const base = orig
        ? { b: str(orig.b), g: orig.g, se: str(orig.se), m: str(orig.m), st: orig.st ?? null, v: str(orig.v), y: orig.y ?? null, n: str(orig.n), p: { [sup.id]: orig.p ?? null } }
        : known ? baseOf(known, prices, sup.id) : null;
      const ch = base && {
        brand: base.b !== v.brand, segment: base.g !== v.segment, series: base.se !== v.series, model: base.m !== v.model,
        storage: (base.st ?? null) !== (v.storage ?? null), version: base.v !== v.version, year: (base.y ?? null) !== (v.year ?? null), notes: base.n !== v.notes,
        prices: Object.keys(p).filter((sid) => (base.p[sid] ?? null) !== (p[sid] ?? null)),
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
        what.push('מחיר');
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
        if (diffPrices.length) { n.updated++; n.priceChanged += diffPrices.length; det.updated.push({ sheet: e.sheet, row: r.row, name: label(same), what: ['מחיר'] }); }
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
  }

  // שורה שנמחקה מהקובץ: המחיר של הספק הזה נמחק (המכשיר עצמו נשאר ברשימה – אצל ספקים אחרים; מוחקים מכשיר ב"רשימת מכשירים")
  const present = new Set(good.map((s) => s.sheet).filter(Boolean));
  if (ctx.exportedIds) {
    for (const r0 of rows) {
      if (seen.has(r0.id) || ctx.inFile.has(r0.id) || !present.has(sheetOf(r0.brand)) || !ctx.exportedIds.has(r0.id)) continue;
      const was = curPrice(r0.id, sup.id);
      if (was == null) continue;
      setPrice(r0.id, sup.id, null);
      n.cleared++;
      det.deleted.push({ sheet: deviceSheetName(sheetOf(r0.brand)), name: rowLabel(r0), price: was, supplier: sup.name });
    }
  }
  if (catalogChanged) ctx.touched.add(CATALOG_ID); else delete ctx.work[CATALOG_ID];
  for (const [sid, items] of Object.entries(supItems)) if (ctx.touched.has(sid)) ctx.work[sid] = items;
}

// הערכים הנוכחיים של שורה (כשאין בקובץ את העמודה המוסתרת)
function baseOf(r, prices, sid) {
  return {
    b: str(r.brand), g: r.segment, se: str(r.series), m: str(r.model), st: r.storage ?? null, v: str(r.version), y: numOrNull(r.year), n: str(r.notes),
    p: { [sid]: (prices.get(r.id) || []).find((x) => x.supplierId === sid)?.price ?? null },
  };
}
