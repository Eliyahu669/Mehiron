// פעולות על רשימת פריטים של ספק (עריכה ידנית ובחירה מרובה)

/** מפתח ייחודי בתוך המחירון של הספק (שני פריטים זהים מקבלים #2, #3…) */
export function uniqueKey(items, key, skipIndex = -1) {
  const taken = new Set(items.filter((_, i) => i !== skipIndex).map((x) => x.key));
  if (!taken.has(key)) return key;
  const base = key.replace(/#\d+$/, '');
  let n = 2;
  while (taken.has(`${base}#${n}`)) n++;
  return `${base}#${n}`;
}

/** שינוי מחיר גורף: set = מחיר חדש, add = תוספת/הפחתה בשקלים, pct = אחוזים. מחזיר null אם התוצאה לא תקינה */
export function bulkPrice(price, mode, value) {
  const v = Number(value);
  if (value === '' || value == null || !Number.isFinite(v)) return null;
  const p = mode === 'set' ? v : mode === 'add' ? price + v : price * (1 + v / 100);
  const r = Math.round(p);
  return r > 0 ? r : null;
}

/** מחיל שינוי מחיר על הפריטים שנבחרו. מחזיר { items, changed, skipped } */
export function applyBulkPrice(items, keys, mode, value, now = Date.now()) {
  let changed = 0, skipped = 0;
  const next = items.map((x) => {
    if (!keys.has(x.key)) return x;
    const p = bulkPrice(x.price, mode, value);
    if (p == null) { skipped++; return x; }
    if (p === x.price) return x;
    changed++;
    return { ...x, price: p, prevPrice: x.price, changedAt: now, updatedAt: now };
  });
  return { items: next, changed, skipped };
}
