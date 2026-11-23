// המחירים של ספק חלקים כטבלה: שורה לכל דגם מרשימת התיקונים, עמודה לכל חלק (העמודות של החברה בהגדרות).
// משמש גם את קובץ "חלקי חילוף" וגם את טבלת הספק באפליקציה
import { partQuality } from './pricing.js';
import { partColumns, columnOf, columnTarget, manualPart, effectivePartType } from './repairs.js';
import { modelOfRow } from './rmodels.js';
import { sheetOf } from './devices.js';

const cellKey = (rowKey, ci) => `${rowKey}\u0001${ci}`;

/** באיזו עמודה נמצא פריט (או -1) */
export function partColumnIndex(it, row, supplierId, cfg) {
  const repair = effectivePartType(it, cfg);
  const q = partQuality({ ...it, partType: repair, supplierId }, cfg);
  return columnOf(partColumns(sheetOf(row.brand), cfg), repair, q.qid, q.frame);
}

/** המחירים בתאים: Map(דגם+עמודה → הפריטים, הזול קודם). orphan – מחירים לדגם שלא ברשימה, nocol – בלי עמודה מתאימה */
export function partCells(items, supplierId, rmRows, cfg) {
  const rowByKey = new Map(rmRows.map((r) => [r.key, r]));
  const cells = new Map();
  let orphan = 0, nocol = 0;
  for (const it of items || []) {
    if (it.kind !== 'part') continue;
    const r = rowByKey.get(it.mkey);
    if (!r) { orphan++; continue; }
    const ci = partColumnIndex(it, r, supplierId, cfg);
    if (ci < 0) { nocol++; continue; }
    const k = cellKey(r.key, ci);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(it);
  }
  for (const l of cells.values()) l.sort((a, b) => a.price - b.price);
  return { cells, orphan, nocol, get: (row, ci) => cells.get(cellKey(row.key, ci)) || [] };
}

/**
 * כותב מחיר בתא (price = null מוחק): מעדכן את הפריט הזול שבתא, או יוצר פריט חדש באיכות של העמודה.
 * מחזיר { items, changed } – items עותק חדש (או אותו מערך אם לא השתנה)
 */
export function setPartCell(items, supplierId, row, ci, price, cfg, now = Date.now(), raw = 'ידני') {
  const cur = (items || []).filter((it) => it.kind === 'part' && it.mkey === row.key && partColumnIndex(it, row, supplierId, cfg) === ci)
    .sort((a, b) => a.price - b.price);
  if (price == null) {
    if (!cur.length) return { items, changed: false };
    const drop = new Set(cur);
    return { items: items.filter((x) => !drop.has(x)), changed: true };
  }
  if (cur.length && Math.abs(cur[0].price - price) < 0.005) return { items, changed: false };
  const col = partColumns(sheetOf(row.brand), cfg)[ci];
  const t = columnTarget(col);
  const it = manualPart({ model: modelOfRow(row), repair: t.repair, qid: t.qid, frame: t.frame, price, cfg, now, prev: cur[0] || null, variant: cur[0]?.variant ?? null });
  it.raw = raw;
  if (cur.length) return { items: items.map((x) => (x === cur[0] ? { ...it, key: cur[0].key } : x)), changed: true };
  const taken = new Set(items.map((x) => x.key));
  let k = it.key, c = 1;
  while (taken.has(k)) k = `${it.key}#${++c}`;
  return { items: [...items, { ...it, key: k }], changed: true };
}
