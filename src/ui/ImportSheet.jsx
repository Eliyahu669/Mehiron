import React, { useEffect, useMemo, useState } from 'react';
import { parseMessage, mergeItems, makeItem } from '../lib/parser.js';
import { REPAIRS } from '../lib/defaults.js';
import { fmt, Icon } from './util.jsx';
import { useBack } from './useBack.js';

export default function ImportSheet({ cfg, lists, initialText = '', onClose, onSaveList, onSaveConfig, toast }) {
  const suppliers = cfg.suppliers || [];
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const supplier = suppliers.find((s) => s.id === supplierId);
  const [partType, setPartType] = useState('screen');
  const [mode, setMode] = useState('replace');
  const [text, setText] = useState(initialText);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newSup, setNewSup] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const opts = { kind: supplier?.type === 'parts' ? 'parts' : 'devices', partType };
  useBack(!!items, () => setItems(null)); // אחורה מהתצוגה המקדימה חוזר לטקסט

  const run = (t = text) => {
    const res = parseMessage(t, opts);
    setItems(res.map((it, i) => ({ ...it, _id: i })));
    setConfirmRemove(false);
  };
  // החלפת ספק / סוג חלק אחרי פענוח – מפענחים מחדש עם ההגדרה החדשה
  useEffect(() => { if (items && text.trim()) run(); }, [opts.kind, partType]);

  const onPdf = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      globalThis.pdfjsWorker = worker; // הרצה בלי worker נפרד – עובד גם בלי שרת
      const { pdfToLines } = await import('../lib/pdfText.js');
      const data = new Uint8Array(await file.arrayBuffer());
      const lines = await pdfToLines(pdfjs, data);
      if (!lines.trim()) toast('ב-PDF הזה אין טקסט (כנראה צילום). צריך להעתיק את הטקסט מההודעה.');
      setText(lines);
      run(lines);
    } catch (e) {
      toast('לא הצלחתי לקרוא את ה-PDF');
    } finally { setBusy(false); }
  };

  const old = lists?.[supplierId]?.items || [];
  const stats = useMemo(() => {
    if (!items) return null;
    const good = items.filter((i) => i.ok);
    const oldMap = new Map(old.map((i) => [i.key, i]));
    const newKeys = new Set(good.map((i) => i.key));
    return {
      ok: good.length, bad: items.length - good.length,
      added: good.filter((i) => !oldMap.has(i.key)).length,
      changed: good.filter((i) => oldMap.has(i.key) && oldMap.get(i.key).price !== i.price).length,
      removed: mode === 'replace' ? old.filter((i) => !newKeys.has(i.key)).length : 0,
      oldMap,
    };
  }, [items, old, mode]);

  const updateRow = (id, patch) => setItems((arr) => arr.map((it) => {
    if (it._id !== id) return it;
    if (patch.name != null) {
      const n = makeItem(patch.name, it.variant, it.price, null, it.raw, opts);
      return { ...n, _id: id };
    }
    const price = Number(patch.price);
    return { ...it, price, ok: Boolean(it.model && price > 0) };
  }));

  const save = async () => {
    if (stats.removed > 0 && !confirmRemove) { setConfirmRemove(true); return; }
    setBusy(true);
    try {
      const merged = mergeItems(old, items.filter((i) => i.ok).map(({ _id, ...r }) => r), { replace: mode === 'replace' });
      await onSaveList(supplierId, merged, { supplierName: supplier?.name || supplierId });
      toast(`המחירון של ${supplier?.name} עודכן · ${merged.length} שורות`);
      onClose();
    } catch (e) {
      toast('השמירה נכשלה: ' + (e?.message || e));
    } finally { setBusy(false); }
  };

  const addSupplier = async () => {
    if (!newSup?.name) return;
    const id = 's' + Date.now().toString(36);
    await onSaveConfig({ ...cfg, suppliers: [...suppliers, { id, name: newSup.name, type: newSup.type || 'parts', phone: newSup.phone || '' }] });
    setSupplierId(id); setNewSup(null); toast('הספק נוסף');
  };

  return (
    <>
      <div className="sheet-bg" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="עדכון מחירון">
        <div className="sheet-inner">
          <div className="sheet-head"><button className="back" onClick={onClose}>‹ ביטול</button><h2>עדכון מחירון מספק</h2></div>

          <div className="card" style={{ padding: 14 }}>
            <label className="field"><span>ספק</span>
              <select className="input" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setConfirmRemove(false); }}>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.type === 'parts' ? 'חלקים' : 'מכשירים'}</option>)}
              </select>
            </label>
            {!newSup ? <button className="btn" onClick={() => setNewSup({ type: 'parts' })}>{Icon.plus}<span>ספק חדש</span></button> : (
              <div style={{ display: 'grid', gap: 8 }}>
                <input className="input" placeholder="שם הספק" value={newSup.name || ''} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} />
                <select className="input" value={newSup.type} onChange={(e) => setNewSup({ ...newSup, type: e.target.value })}>
                  <option value="parts">ספק חלקים</option><option value="devices">ספק מכשירים</option>
                </select>
                <input className="input" placeholder="טלפון וואטסאפ (לא חובה)" inputMode="tel" value={newSup.phone || ''} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })} />
                <div className="actions"><button className="btn primary" onClick={addSupplier}>הוסף</button><button className="btn" onClick={() => setNewSup(null)}>ביטול</button></div>
              </div>
            )}
            {supplier?.type === 'parts' && (
              <label className="field"><span>סוג חלק (כשלא כתוב בשורה עצמה)</span>
                <select className="input" value={partType} onChange={(e) => setPartType(e.target.value)}>
                  {REPAIRS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
            )}
            <div className="seg">
              <button className={mode === 'replace' ? 'on' : ''} onClick={() => { setMode('replace'); setConfirmRemove(false); }}>מחירון מלא (מחליף)</button>
              <button className={mode === 'merge' ? 'on' : ''} onClick={() => { setMode('merge'); setConfirmRemove(false); }}>עדכון חלקי (מוסיף)</button>
            </div>
          </div>

          <div className="section-title">הודעת הספק</div>
          <textarea className="input" placeholder="מדביקים כאן את ההודעה מהוואטסאפ…" value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
          <div className="actions">
            <button className="btn primary" disabled={!text.trim() || busy} onClick={() => run()}>פענח</button>
            <label className="btn" style={{ position: 'relative' }}>{Icon.upload}<span>{busy ? 'קורא…' : 'קובץ PDF'}</span>
              <input type="file" accept="application/pdf" style={{ position: 'absolute', inset: 0, opacity: 0 }} onChange={(e) => { onPdf(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>

          {items && stats && (
            <>
              <div className="stat">
                <span className="tag green">זוהו {stats.ok}</span>
                {stats.bad > 0 && <span className="tag red">לא זוהו {stats.bad}</span>}
                <span className="tag gray">חדשים {stats.added}</span>
                <span className="tag orange">מחיר השתנה {stats.changed}</span>
                {stats.removed > 0 && <span className="tag red">יוסרו {stats.removed}</span>}
              </div>
              <div className="card list">
                {[...items].sort((a, b) => Number(a.ok) - Number(b.ok)).map((it) => {
                  const o = stats.oldMap.get(it.key);
                  return (
                    <div key={it._id} className={'preview-row' + (it.ok ? '' : ' bad')}>
                      <span>{it.ok ? '✓' : '✗'}</span>
                      <div className="nm">
                        <input className="input" style={{ padding: '4px 8px', fontSize: 14 }} defaultValue={it.name || it.raw}
                          onBlur={(e) => e.target.value !== (it.name || it.raw) && updateRow(it._id, { name: e.target.value })} />
                        <div className="v">{[opts.kind === 'parts' ? REPAIRS.find((r) => r.id === it.partType)?.label : '', it.variant].filter(Boolean).join(' · ')}{o && o.price !== it.price ? ` · היה ${fmt(o.price)}` : ''}{!it.ok ? ` · "${it.raw}"` : ''}</div>
                      </div>
                      <input className="input sm num" inputMode="numeric" defaultValue={it.price}
                        onBlur={(e) => Number(e.target.value) !== it.price && updateRow(it._id, { price: e.target.value })} />
                      <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setItems((a) => a.filter((x) => x._id !== it._id))}>{Icon.trash}</button>
                    </div>
                  );
                })}
              </div>
              <div className="actions" style={{ position: 'sticky', bottom: 12 }}>
                <button className={'btn ' + (confirmRemove ? 'danger confirm' : 'primary')} style={{ flex: 1, height: 48, justifyContent: 'center' }} disabled={busy || !stats.ok} onClick={save}>
                  {confirmRemove ? `${stats.removed} פריטים ישנים יימחקו מהמחירון · לחץ שוב לאישור` : `שמור ועדכן את כל הסניפים (${stats.ok})`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
