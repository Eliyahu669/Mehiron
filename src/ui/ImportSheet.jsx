import React, { useEffect, useMemo, useState } from 'react';
import { parseMessage, mergeItems, makeItem } from '../lib/parser.js';
import { allRepairs, repairLabel, qualitiesFor, optionName } from '../lib/repairs.js';
import { partQuality } from '../lib/pricing.js';
import { normText } from '../lib/normalize.js';
import { catalogRows } from '../lib/publish.js';
import {
  CATALOG_ID, SEGMENTS, matchSupplierItems, applySupplierImport, reviewDefaults, rowLabel, parseStorage,
} from '../lib/devices.js';
import { fmtStorage } from '../lib/normalize.js';
import { fmt, Icon } from './util.jsx';
import { useBack } from './useBack.js';

export default function ImportSheet({ cfg, lists, catalog, kind = null, initialText = '', onClose, onSaveConfig, onSaveImport, toast }) {
  const suppliers = cfg.suppliers || [];
  // נפתח ממחירון התיקונים → ספק חלקים; ממחירון המכשירים → ספק מכשירים
  const [supplierId, setSupplierId] = useState((kind && suppliers.find((s) => (s.type || 'devices') === kind)?.id) || suppliers[0]?.id || '');
  const supplier = suppliers.find((s) => s.id === supplierId);
  const isDev = supplier && supplier.type !== 'parts';
  const [partType, setPartType] = useState('screen');
  // ספק חלקים שולח בדרך כלל תשובה על כמה דגמים – עדכון חלקי. ספק מכשירים שולח מחירון מלא
  const modeFor = (s) => (s && s.type === 'parts' ? 'merge' : 'replace');
  const [mode, setMode] = useState(() => modeFor(supplier));
  const [text, setText] = useState(initialText);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newSup, setNewSup] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const opts = { kind: isDev ? 'devices' : 'parts', partType, cfg };
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
              <select className="input" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setMode(modeFor(suppliers.find((x) => x.id === e.target.value))); setConfirmRemove(false); }}>
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
                  {allRepairs(cfg).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
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

          {items && !isDev && (
            <PartsPreview key={supplierId} items={items} setItems={setItems} opts={opts} cfg={cfg} catalog={catalog} onSaveImport={onSaveImport} old={lists?.[supplierId]?.items || []} mode={mode} supplier={supplier}
              busy={busy} setBusy={setBusy} confirmRemove={confirmRemove} setConfirmRemove={setConfirmRemove} toast={toast} onClose={onClose} />
          )}
          {items && isDev && (
            <DevicePreview key={supplierId} items={items} lists={lists} catalog={catalog} cfg={cfg} supplier={supplier} mode={mode}
              busy={busy} setBusy={setBusy} confirmRemove={confirmRemove} setConfirmRemove={setConfirmRemove} onSaveImport={onSaveImport} toast={toast} onClose={onClose} />
          )}
        </div>
      </div>
    </>
  );
}

// ---------- ספק חלקים: כל שורה מקבלת דגם, סוג תיקון ואיכות מאוחדת. דגם שלא זוהה / מילה שאולי היא איכות – לבחירה ----------
export const partIgnoreKey = (it) => `p:${normText(it.model || it.name || it.raw || '')}`;

function PartsPreview({ items, setItems, opts, cfg, catalog, onSaveImport, old, mode, supplier, busy, setBusy, confirmRemove, setConfirmRemove, toast, onClose }) {
  const ignored = useMemo(() => new Set((cfg.ignoredParts || []).map((x) => x.key)), [cfg.ignoredParts]);
  const [terms, setTerms] = useState({}); // מילה לא מוכרת → 'keep' | 'noise' | 'q:<id>' | 'new'
  const [newNames, setNewNames] = useState({});
  const [defQ, setDefQ] = useState(supplier?.defaultQuality || '');
  const [skipAlways, setSkipAlways] = useState(() => new Set());

  // ההגדרות אחרי הבחירות במסך הזה – כדי שהתצוגה תתעדכן מיד
  const nextCfg = useMemo(() => {
    const qualities = { ...(cfg.qualities || {}) };
    const noise = [...(cfg.qualityNoise || [])];
    for (const [k, v] of Object.entries(terms)) {
      const [repair, word] = k.split('\u0001');
      if (v === 'noise') { if (!noise.includes(word)) noise.push(word); continue; }
      const list = (qualities[repair] || qualitiesFor(repair, cfg)).map((x) => ({ ...x, words: [...(x.words || [])] }));
      if (v.startsWith('q:')) { const q = list.find((x) => x.id === v.slice(2)); if (q && !q.words.includes(word)) q.words.push(word); }
      else if (v === 'new') { const name = (newNames[k] || word).trim(); list.push({ id: 'q' + Math.abs([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36), label: name, words: [word] }); }
      else continue;
      qualities[repair] = list;
    }
    const suppliers = (cfg.suppliers || []).map((x) => (x.id === supplier?.id ? { ...x, defaultQuality: defQ || '' } : x));
    return { ...cfg, qualities, qualityNoise: noise, suppliers };
  }, [cfg, terms, newNames, defQ, supplier]);

  const view = useMemo(() => {
    const oldMap = new Map(old.map((i) => [i.key, i]));
    const rows = items.map((it) => {
      const skipped = it.unknownModel && (ignored.has(partIgnoreKey(it)) || skipAlways.has(it._id));
      const q = it.ok ? partQuality({ ...it, supplierId: supplier?.id }, nextCfg) : null;
      return { it, q, skipped, o: oldMap.get(it.key) };
    });
    const good = rows.filter((r) => r.it.ok);
    const newKeys = new Set(good.map((r) => r.it.key));
    // מילים שאולי הן איכות (לפי ההגדרות הנוכחיות – לפני הבחירות כאן)
    const unknown = new Map();
    for (const r of good) {
      const q0 = partQuality({ ...r.it, supplierId: supplier?.id }, cfg);
      if (q0.qid || !q0.note) continue;
      const k = `${r.it.partType}\u0001${q0.note}`;
      if (!unknown.has(k)) unknown.set(k, { k, repair: r.it.partType, word: q0.note, n: 0, sample: r.it });
      unknown.get(k).n++;
    }
    return {
      rows, ok: good.length, unknown: [...unknown.values()],
      badModel: rows.filter((r) => r.it.unknownModel && !r.skipped), skipped: rows.filter((r) => r.skipped).length,
      bad: rows.filter((r) => !r.it.ok && !r.it.unknownModel).length,
      noQuality: good.filter((r) => { const q0 = partQuality({ ...r.it, supplierId: supplier?.id }, { ...cfg, suppliers: [] }); return !q0.qid && !q0.note; }).length,
      added: good.filter((r) => !r.o).length,
      changed: good.filter((r) => r.o && r.o.price !== r.it.price).length,
      removed: mode === 'replace' ? old.filter((i) => !newKeys.has(i.key)).length : 0,
    };
  }, [items, old, mode, supplier, ignored, skipAlways, nextCfg, cfg]);

  const updateRow = (id, patch) => setItems((arr) => arr.map((it) => {
    if (it._id !== id) return it;
    if (patch.name != null) {
      const n = makeItem(patch.name, it.variant, it.price, null, it.raw, opts);
      return { ...n, _id: id };
    }
    const price = Number(patch.price);
    return { ...it, price, ok: Boolean(it.model && price > 0 && !it.unknownModel) };
  }));

  const modelNames = useMemo(() => [...new Set((catalog?.models || []).map((m) => m.model))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), [catalog]);

  const save = async () => {
    if (view.removed > 0 && !confirmRemove) { setConfirmRemove(true); return; }
    setBusy(true);
    try {
      const merged = mergeItems(old, items.filter((i) => i.ok).map(({ _id, ...r }) => r), { replace: mode === 'replace' });
      const newIgnored = view.rows.filter((r) => r.it.unknownModel && skipAlways.has(r.it._id))
        .map((r) => ({ key: partIgnoreKey(r.it), label: r.it.raw || r.it.name }));
      const cfgChanged = Object.keys(terms).some((k) => terms[k] !== 'keep') || (defQ || '') !== (supplier?.defaultQuality || '') || newIgnored.length;
      await onSaveImport({
        lists: { [supplier.id]: { items: merged, supplierName: supplier?.name || supplier.id } },
        config: cfgChanged ? { ...nextCfg, ignoredParts: [...(cfg.ignoredParts || []), ...newIgnored.filter((x) => !ignored.has(x.key))] } : null,
      });
      toast(`המחירון של ${supplier?.name} עודכן · ${view.ok} שורות${mode === 'merge' ? ' עודכנו/נוספו' : ''}`);
      onClose();
    } catch (e) {
      toast('השמירה נכשלה: ' + (e?.message || e));
    } finally { setBusy(false); }
  };

  const qOptions = (repair) => qualitiesFor(repair, cfg);
  return (
    <>
      <div className="stat">
        <span className="tag green">זוהו {view.ok}</span>
        <span className="tag gray">חדשים {view.added}</span>
        <span className="tag orange">מחיר השתנה {view.changed}</span>
        {view.badModel.length > 0 && <span className="tag red">דגם לא זוהה {view.badModel.length}</span>}
        {view.unknown.length > 0 && <span className="tag orange">מילים לא מוכרות {view.unknown.length}</span>}
        {view.skipped > 0 && <span className="tag gray">דילוג קבוע {view.skipped}</span>}
        {view.bad > 0 && <span className="tag red">בלי מחיר {view.bad}</span>}
        {view.removed > 0 && <span className="tag red">יוסרו {view.removed}</span>}
      </div>

      {view.badModel.length > 0 && (
        <>
          <div className="section-title">דגם לא זוהה – בחר דגם, או דלג</div>
          <datalist id="part-models">{modelNames.map((n) => <option key={n} value={n} />)}</datalist>
          <div className="card list">
            {view.badModel.map(({ it }) => (
              <div key={it._id} className="preview-row bad">
                <span>?</span>
                <div className="nm">
                  <input className="input" list="part-models" style={{ padding: '4px 8px', fontSize: 14 }} placeholder="בחר דגם…" defaultValue=""
                    onBlur={(e) => e.target.value.trim() && updateRow(it._id, { name: e.target.value })} />
                  <div className="v">"{it.raw}" · {fmt(it.price)}</div>
                </div>
                <button className="btn" style={{ height: 30, padding: '0 8px' }} onClick={() => setSkipAlways((x) => new Set([...x, it._id]))}>דלג תמיד</button>
                <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="דלג" onClick={() => setItems((a) => a.filter((x) => x._id !== it._id))}>{Icon.trash}</button>
              </div>
            ))}
          </div>
        </>
      )}

      {view.unknown.length > 0 && (
        <>
          <div className="section-title">מילים שאולי הן איכות</div>
          <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
            {view.unknown.map((u) => (
              <div key={u.k} className="rv-q">
                <div><b>"{u.word}"</b> · {repairLabel(u.repair, cfg)} · {u.n} שורות <span className="muted">(למשל {u.sample.name})</span></div>
                <select className="input" value={terms[u.k] || 'keep'} onChange={(e) => setTerms({ ...terms, [u.k]: e.target.value })}>
                  <option value="keep">להשאיר כמו שהספק כתב</option>
                  {qOptions(u.repair).map((x) => <option key={x.id} value={`q:${x.id}`}>זו האיכות: {x.label}</option>)}
                  <option value="new">איכות חדשה…</option>
                  <option value="noise">זו לא איכות (לא לשאול שוב)</option>
                </select>
                {terms[u.k] === 'new' && <input className="input" placeholder="שם האיכות ללקוח" value={newNames[u.k] ?? u.word} onChange={(e) => setNewNames({ ...newNames, [u.k]: e.target.value })} />}
              </div>
            ))}
          </div>
        </>
      )}

      {view.noQuality > 0 && (
        <label className="field" style={{ margin: '10px 4px' }}><span>{view.noQuality === 1 ? 'שורה אחת' : `${view.noQuality} שורות`} בלי שם איכות. אצל {supplier?.name} אלה:</span>
          <select className="input" value={defQ} onChange={(e) => setDefQ(e.target.value)}>
            <option value="">לא ידוע ("סטנדרטי")</option>
            {qualitiesFor('screen', cfg).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select></label>
      )}

      <div className="card list">
        {view.rows.filter((r) => !r.it.unknownModel).sort((a, b) => Number(a.it.ok) - Number(b.it.ok)).map(({ it, q, o }) => (
          <div key={it._id} className={'preview-row' + (it.ok ? '' : ' bad')}>
            <span>{it.ok ? '✓' : '✗'}</span>
            <div className="nm">
              <input className="input" style={{ padding: '4px 8px', fontSize: 14 }} defaultValue={it.name || it.raw}
                onBlur={(e) => e.target.value !== (it.name || it.raw) && updateRow(it._id, { name: e.target.value })} />
              <div className="v">{[repairLabel(it.partType, cfg), q ? optionName(q) : it.variant].filter(Boolean).join(' · ')}{o && o.price !== it.price ? ` · היה ${fmt(o.price)}` : ''}{!it.ok ? ` · "${it.raw}"` : ''}</div>
            </div>
            <input className="input sm num" inputMode="numeric" defaultValue={it.price}
              onBlur={(e) => Number(e.target.value) !== it.price && updateRow(it._id, { price: e.target.value })} />
            <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setItems((a) => a.filter((x) => x._id !== it._id))}>{Icon.trash}</button>
          </div>
        ))}
      </div>
      <div className="actions" style={{ position: 'sticky', bottom: 12 }}>
        <button className={'btn ' + (confirmRemove ? 'danger confirm' : 'primary')} style={{ flex: 1, height: 48, justifyContent: 'center' }} disabled={busy || !view.ok} onClick={save}>
          {confirmRemove ? `${view.removed} פריטים ישנים יימחקו מהמחירון · לחץ שוב לאישור` : `שמור ועדכן את כל הסניפים (${view.ok})`}
        </button>
      </div>
    </>
  );
}

// ---------- ספק מכשירים: עדכון מחירים ברשימת המכשירים + "לא ברשימה" ----------
const STATUS = {
  'new-model': () => 'דגם שלא ברשימה',
  'new-storage': (r) => `לדגם ${r.models[0].model} אין ברשימה נפח ${fmtStorage(r.storage)}`,
  'need-storage': (r) => `לא כתוב נפח – לדגם ${r.models[0].model} יש: ${r.storages.map((x) => fmtStorage(x) || 'בלי נפח').join(', ')}`,
};

function DevicePreview({ items, lists, catalog, cfg, supplier, mode, busy, setBusy, confirmRemove, setConfirmRemove, onSaveImport, toast, onClose }) {
  const rows = useMemo(() => catalogRows(lists), [lists]);
  const good = useMemo(() => items.filter((i) => i.ok), [items]);
  const bad = items.length - good.length;
  const match = useMemo(() => matchSupplierItems(good, rows, catalog?.prices || new Map(), cfg), [good, rows, catalog, cfg]);
  const [choice, setChoice] = useState({}); // מספר שורה ב"לא ברשימה" → { action, fields }
  useEffect(() => { setChoice(Object.fromEntries(match.review.map((r, i) => [i, { action: 'skip', fields: reviewDefaults(r) }]))); }, [match]);
  const oldItems = lists?.[supplier.id]?.items || [];

  const adds = match.review.map((r, i) => ({ r, c: choice[i] })).filter((x) => x.c?.action === 'add');
  const badAdd = adds.find((x) => !String(x.c.fields.model || '').trim() || Number.isNaN(parseStorage(x.c.fields.storage)));
  const result = useMemo(() => {
    if (badAdd) return null;
    return applySupplierImport({
      rows, oldItems, match, replace: mode === 'replace',
      adds: adds.map(({ r, c }) => ({ fields: { ...c.fields, storage: parseStorage(c.fields.storage) }, price: r.item.price, raw: r.item.raw })),
    });
  }, [rows, oldItems, match, mode, choice]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevPrice = useMemo(() => new Map(oldItems.filter((x) => x.row).map((x) => [x.row, x.price])), [oldItems]);
  const changed = match.hits.filter((h) => prevPrice.has(h.row.id) && prevPrice.get(h.row.id) !== h.price).length;
  const ignores = match.review.filter((_, i) => choice[i]?.action === 'ignore');
  const removed = result?.removed.length || 0;
  const setC = (i, patch) => setChoice((c) => ({ ...c, [i]: { ...c[i], ...patch } }));
  const setF = (i, patch) => setChoice((c) => ({ ...c, [i]: { ...c[i], fields: { ...c[i].fields, ...patch } } }));
  const versions = [...match.created, ...match.claimed.map((c) => ({ ...rows.find((r) => r.id === c.id), version: c.version }))];

  const save = async () => {
    if (!result) return;
    if (removed > 0 && !confirmRemove) { setConfirmRemove(true); return; }
    setBusy(true);
    try {
      const out = { [supplier.id]: { items: result.items, supplierName: supplier.name } };
      if (result.catalog) out[CATALOG_ID] = { items: result.catalog, supplierName: 'רשימת מכשירים' };
      const known = new Set((cfg.ignoredDevices || []).map((x) => x.key));
      const newIgnores = ignores.filter((r) => !known.has(r.ignoreKey)).map((r) => ({ key: r.ignoreKey, label: [r.item.name, r.ver].filter(Boolean).join(' · ') }));
      await onSaveImport({ lists: out, config: newIgnores.length ? { ...cfg, ignoredDevices: [...(cfg.ignoredDevices || []), ...newIgnores] } : null });
      toast([`המחירון של ${supplier.name} עודכן`, `${result.items.length} מכשירים עם מחיר`, result.newRows.length && `נוספו לרשימה ${result.newRows.length}`].filter(Boolean).join(' · '));
      onClose();
    } catch (e) {
      toast('השמירה נכשלה: ' + (e?.message || e));
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="stat">
        <span className="tag green">ברשימה {match.hits.length}</span>
        {changed > 0 && <span className="tag orange">מחיר השתנה {changed}</span>}
        {versions.length > 0 && <span className="tag gray">גרסאות חדשות {versions.length}</span>}
        {match.review.length > 0 && <span className="tag red">לא ברשימה {match.review.length}</span>}
        {match.skippedIgnored > 0 && <span className="tag gray">דילוג קבוע {match.skippedIgnored}</span>}
        {bad > 0 && <span className="tag red">לא זוהו {bad}</span>}
        {removed > 0 && <span className="tag red">יוסרו {removed}</span>}
      </div>

      {match.review.length > 0 && (
        <>
          <div className="section-title">לא ברשימה – להוסיף או לדלג?</div>
          <div className="card list">
            {match.review.map((r, i) => {
              const c = choice[i];
              if (!c) return null;
              return (
                <div key={i} className="rv">
                  <div className="rv-head"><b>{[r.item.name, r.ver].filter(Boolean).join(' · ')}</b><span className="num">{fmt(r.item.price)}</span></div>
                  <div className="muted" style={{ fontSize: 13 }}>{STATUS[r.status](r)} · "{r.item.raw}"</div>
                  <div className="seg rv-seg">
                    {[['skip', 'דלג'], ['add', 'הוסף'], ['ignore', 'דלג תמיד']].map(([a, l]) => (
                      <button key={a} className={c.action === a ? 'on' : ''} onClick={() => setC(i, { action: a })}>{l}</button>
                    ))}
                  </div>
                  {c.action === 'add' && <AddForm r={r} f={c.fields} set={(p) => setF(i, p)} />}
                </div>
              );
            })}
          </div>
        </>
      )}

      {versions.length > 0 && (
        <>
          <div className="section-title">גרסאות חדשות שנוספות לרשימה</div>
          <div className="card list">
            {versions.map((v) => <div key={v.id} className="preview-row"><span>+</span><div className="nm">{rowLabel(v)}</div></div>)}
          </div>
        </>
      )}

      {match.hits.length > 0 && (
        <>
          <div className="section-title">מחירים שמתעדכנים</div>
          <div className="card list">
            {match.hits.map((h) => {
              const o = prevPrice.get(h.row.id);
              return (
                <div key={h.row.id} className="preview-row">
                  <span>✓</span>
                  <div className="nm">{rowLabel(h.row)}<div className="v">{h.raw}</div></div>
                  <span className="num" style={{ whiteSpace: 'nowrap' }}>{o != null && o !== h.price ? `${fmt(o)} → ` : ''}{fmt(h.price)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {bad > 0 && (
        <div className="muted" style={{ margin: '10px 6px' }}>שורות שלא זוהו: {items.filter((i) => !i.ok).map((i) => `"${i.raw}"`).join(' · ')}</div>
      )}

      <div className="actions" style={{ position: 'sticky', bottom: 12 }}>
        <button className={'btn ' + (confirmRemove ? 'danger confirm' : 'primary')} style={{ flex: 1, height: 48, justifyContent: 'center' }}
          disabled={busy || !result || (!match.hits.length && !adds.length && !ignores.length)} onClick={save}>
          {badAdd ? 'יש להשלים שם דגם ונפח תקין במכשירים שמוסיפים'
            : confirmRemove ? `${removed} מחירים ישנים של ${supplier.name} יימחקו · לחץ שוב לאישור`
              : `שמור ועדכן את כל הסניפים (${match.hits.length + adds.length})`}
        </button>
      </div>
    </>
  );
}

function AddForm({ r, f, set }) {
  const storages = r.status === 'need-storage' ? r.storages : [];
  return (
    <div className="rv-form">
      <label>חברה<input className="input sm" list="dev-brands" value={f.brand} onChange={(e) => set({ brand: e.target.value })} /></label>
      <label>שם הדגם<input className="input sm" value={f.model} onChange={(e) => set({ model: e.target.value })} /></label>
      <label>סגמנט<select className="input sm" value={f.segment} onChange={(e) => set({ segment: e.target.value })}>
        {SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select></label>
      <label>סדרה<input className="input sm" value={f.series} onChange={(e) => set({ series: e.target.value })} /></label>
      <label>נפח{storages.length
        ? <select className="input sm" value={f.storage ?? ''} onChange={(e) => set({ storage: e.target.value })}>{storages.map((x) => <option key={x ?? 'none'} value={x ?? ''}>{fmtStorage(x) || 'בלי נפח'}</option>)}</select>
        : <input className="input sm" placeholder="128GB" value={f.storage === null || f.storage === undefined ? '' : (typeof f.storage === 'number' ? fmtStorage(f.storage) : f.storage)} onChange={(e) => set({ storage: e.target.value })} />}
      </label>
      <label>גרסה<input className="input sm" placeholder="רשמי / מקביל…" value={f.version} onChange={(e) => set({ version: e.target.value })} /></label>
      <label>שנת השקה<input className="input sm" inputMode="numeric" value={f.year ?? ''} onChange={(e) => set({ year: e.target.value })} /></label>
      <datalist id="dev-brands"><option value="Apple" /><option value="Samsung" /><option value="Xiaomi" /></datalist>
    </div>
  );
}
