// דחיסת רשימות גדולות לפני שמירה ב-Firestore (מגבלה של 1MB למסמך).
// מחירון של אלפי שורות נדחס פי 4–7, כך שגם ספק עם מחירון ענק נכנס במסמך אחד.
import LZ from 'lz-string';

export const MAX_FIELD = 900000; // השארת מרווח מתחת למגבלת 1,048,487 בתים לשדה

export class TooBigError extends Error {
  constructor(what, size) {
    super(`${what} גדול מדי לשמירה (${Math.round(size / 1024)}KB אחרי דחיסה). אפשר לפצל אותו לשני ספקים.`);
    this.code = 'too-big';
  }
}

export function pack(value, what = 'המחירון') {
  const z = LZ.compressToBase64(JSON.stringify(value));
  if (z.length > MAX_FIELD) throw new TooBigError(what, z.length);
  return z;
}

export function unpack(z, fallback) {
  try {
    const s = LZ.decompressFromBase64(z);
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

/** מסמך מחירון: גרסה חדשה {z} או ישנה {items} */
export function readPriceListDoc(d) {
  if (!d) return d;
  if (typeof d.z === 'string') {
    const { z, ...meta } = d;
    const items = unpack(z, null);
    return items ? { ...meta, items } : { ...meta, items: [], corrupt: true };
  }
  return { ...d, items: d.items || [] };
}

/** מסמך קטלוג לעובדים: גרסה חדשה {z} או ישנה {models} */
export function readCatalogDoc(d) {
  if (!d) return { models: [] };
  if (typeof d.z === 'string') {
    const { z, ...meta } = d;
    const models = unpack(z, null);
    return models ? { ...meta, models } : { ...meta, models: [], corrupt: true };
  }
  return { ...d, models: d.models || [] };
}
