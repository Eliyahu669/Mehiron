import React, { useEffect, useMemo, useState } from 'react';
import {
  CATALOG_ID, SEGMENTS, SHEETS, sheetOf, segmentLabel, buildDeviceModels, sortDeviceModels, rowQuote, rowLabel, devKey, verKey, parseStorage, newRowId,
} from '../lib/devices.js';
import { catalogRows } from '../lib/publish.js';
import { fmtStorage, searchTokens } from '../lib/normalize.js';
import { fmt, Icon } from './util.jsx';
import { useBack } from './useBack.js';

// רשימת המכשירים (מנהל בלבד): דגם + נפח + גרסה לכל שורה, בגיליונות לפי חברה, ומחיר לכל ספק מכשירים
export default function DevicesManager({ cfg, lists, catalog, store, toast, focusRow, onConfigSaved }) {
  const rows = useMemo(() => catalogRows(lists), [lists]);
  const prices = catalog?.prices || new Map();
  const devSuppliers = (cfg.suppliers || []).filter((s) => s.type !== 'parts');
  const focused = focusRow ? rows.find((r) => r.id === focusRow) : null;
  const [sheet, setSheet] = useState(focused ? sheetOf(focused.brand) : 'apple');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(() => (focused ? toForm(focused, prices) : null));
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  useBack(!!edit, () => setEdit(null));
  useBack(sel !== null, () => setSel(null));
  useEffect(() => { if (!confirmDel) return undefined; const t = setTimeout(() => setConfirmDel(false), 4000); return () => clearTimeout(t); }, [confirmDel]);

  const counts = useMemo(() => Object.fromEntries(SHEETS.map((s) => [s.id, rows.filter((r) => sheetOf(r.brand) === s.id).length])), [rows]);
  const shownRows = useMemo(() => {
    const qt = searchTokens(q);
    return rows.filter((r) => sheetOf(r.brand) === sheet).filter((r) => {
      if (!qt.length) return true;
      const t = searchTokens(`${r.model} ${r.series || ''} ${fmtStorage(r.storage)} ${r.version || ''} ${segmentLabel(r.segment)}`);
      return qt.every((x) => t.some((y) => y.startsWith(x)));
    });
  }, [rows, sheet, q]);
  const groups = useMemo(() => sortDeviceModels(buildDeviceModels(shownRows)), [shownRows]);

  // שמירה: הרשימה + המחירונים של הספקים שהשתנו – באצווה אחת
  const save = async (nextRows, supplierItems, msg) => {
    setBusy(true);
    try {
      const out = { [CATALOG_ID]: { items: nextRows, supplierName: 'רשימת מכשירים' } };
      for (const [sid, items] of Object.entries(supplierItems || {})) {
        const s = devSuppliers.find((x) => x.id === sid);
        out[sid] = { items, supplierName: s?.name || sid, updatedAt: lists?.[sid]?.updatedAt || Date.now() };
      }
      await store.saveImport({ lists: out });
      toast(msg);
      return true;
    } catch (e) {
      toast('השמירה נכשלה: ' + (e?.message || e));
      return false;
    } finally { setBusy(false); }
  };
  const withoutRows = (ids) => {
    const out = {};
    for (const s of devSuppliers) {
      const items = lists?.[s.id]?.items || [];
      if (items.some((x) => ids.has(x.row))) out[s.id] = items.filter((x) => !ids.has(x.row));
    }
    return out;
  };

  const onSave = async () => {
    const f = edit;
    const storage = parseStorage(f.storage);
    if (!String(f.model).trim()) { toast('חסר שם דגם'); return; }
    if (Number.isNaN(storage)) { toast('נפח לא תקין (למשל 128GB או 1TB)'); return; }
    const newPrices = {};
    for (const s of devSuppliers) {
      const v = String(f.prices[s.id] ?? '').replace(/[₪,\s]/g, '');
      if (v !== '' && !(Number(v) > 0)) { toast(`מחיר לא תקין אצל ${s.name}`); return; }
      newPrices[s.id] = v === '' ? null : Number(v);
    }
    const row = { id: f.id || newRowId(), brand: f.brand.trim(), segment: f.segment, series: f.series.trim(), model: f.model.trim(), storage, version: f.version.trim(), year: f.year === '' ? null : Number(f.year) || null, notes: f.notes.trim() };
    const dupe = rows.find((r) => r.id !== row.id && devKey(r.brand, r.model) === devKey(row.brand, row.model) && (r.storage ?? null) === storage && verKey(r.version) === verKey(row.version));
    if (dupe) { toast(`כבר יש ברשימה: ${rowLabel(dupe)}`); return; }
    const nextRows = f.id ? rows.map((r) => (r.id === f.id ? row : r)) : [...rows, row];
    const now = Date.now();
    const supplierItems = {};
    for (const s of devSuppliers) {
      const items = lists?.[s.id]?.items || [];
      const old = items.find((x) => x.row === row.id);
      const p = newPrices[s.id];
      if ((old?.price ?? null) === p) continue;
      const rest = items.filter((x) => x.row !== row.id);
      supplierItems[s.id] = p == null ? rest : [...rest, { key: row.id, row: row.id, kind: 'device', price: p, raw: 'ידני', manual: true, updatedAt: now, changedAt: now, prevPrice: old?.price ?? null }];
    }
    if (await save(nextRows, supplierItems, f.id ? 'השורה עודכנה' : 'המכשיר נוסף לרשימה')) { setEdit(null); setSheet(sheetOf(row.brand)); }
  };
  const onDelete = async () => {
    const ids = new Set([edit.id]);
    if (await save(rows.filter((r) => !ids.has(r.id)), withoutRows(ids), 'השורה נמחקה')) setEdit(null);
  };

  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSel = sel && shownRows.length > 0 && shownRows.every((r) => sel.has(r.id));
  const bulkDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setConfirmDel(false);
    if (await save(rows.filter((r) => !sel.has(r.id)), withoutRows(sel), `נמחקו ${sel.size} שורות`)) setSel(null);
  };
  const bulkSegment = async (seg) => {
    if (!seg) return;
    if (await save(rows.map((r) => (sel.has(r.id) ? { ...r, segment: seg } : r)), null, `הסגמנט עודכן ל-${sel.size} שורות`)) setSel(null);
  };
  const unignore = async (key) => {
    const next = { ...cfg, ignoredDevices: (cfg.ignoredDevices || []).filter((x) => x.key !== key) };
    try { await store.saveImport({ lists: {}, config: next }); onConfigSaved?.(next); toast('יופיע שוב ב"לא ברשימה" בהודעה הבאה'); }
    catch (e) { toast('השמירה נכשלה: ' + (e?.message || e)); }
  };

  if (edit) {
    return (
      <div className="card" style={{ padding: 14, marginTop: 8 }}>
        <div className="t1" style={{ fontWeight: 700, marginBottom: 4 }}>{edit.id ? 'עריכת שורה' : 'מכשיר חדש'}</div>
        <div className="dev-form">
          <label className="field"><span>יצרן</span><input className="input" list="dm-brands" dir="ltr" value={edit.brand} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} /></label>
          <label className="field"><span>רמות גימור / סגמנטציה</span>
            <select className="input" value={edit.segment} onChange={(e) => setEdit({ ...edit, segment: e.target.value })}>{SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="field"><span>סדרה</span><input className="input" dir="ltr" value={edit.series} onChange={(e) => setEdit({ ...edit, series: e.target.value })} /></label>
          <label className="field"><span>שם הדגם</span><input className="input" dir="ltr" value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} /></label>
          <label className="field"><span>נפח</span><input className="input" dir="ltr" placeholder="128GB" value={edit.storage} onChange={(e) => setEdit({ ...edit, storage: e.target.value })} /></label>
          <label className="field"><span>גרסה</span><input className="input" placeholder="רשמי / מקביל / Active…" value={edit.version} onChange={(e) => setEdit({ ...edit, version: e.target.value })} /></label>
          <label className="field"><span>שנת השקה</span><input className="input num" inputMode="numeric" value={edit.year} onChange={(e) => setEdit({ ...edit, year: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="field"><span>הערות</span><input className="input" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
          {devSuppliers.map((s) => (
            <label key={s.id} className="field"><span>מחיר ספק {s.name} (ריק = אין)</span>
              <input className="input num" inputMode="numeric" value={edit.prices[s.id] ?? ''} onChange={(e) => setEdit({ ...edit, prices: { ...edit.prices, [s.id]: e.target.value } })} /></label>
          ))}
        </div>
        <datalist id="dm-brands"><option value="Apple" /><option value="Samsung" /><option value="Xiaomi" /></datalist>
        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={onSave}>שמור</button>
          {edit.id && <button className="btn danger" disabled={busy} onClick={onDelete}>{Icon.trash}<span>מחק</span></button>}
          <button className="btn" onClick={() => setEdit(null)}>ביטול</button>
        </div>
      </div>
    );
  }

  const ignored = cfg.ignoredDevices || [];
  return (
    <>
      <div className="pills" style={{ paddingTop: 4 }}>
        {SHEETS.map((s) => <button key={s.id} className={'pill' + (s.id === sheet ? ' on' : '')} onClick={() => { setSheet(s.id); setSel(null); }}>{s.label} <span className="num muted">{counts[s.id]}</span></button>)}
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <input className="input" style={{ flex: 1 }} placeholder="חיפוש דגם…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={'btn' + (sel ? ' primary' : '')} onClick={() => { setSel(sel ? null : new Set()); setConfirmDel(false); }}>{sel ? 'סיום' : 'בחירה'}</button>
        {!sel && <button className="btn primary" onClick={() => setEdit(toForm({ brand: SHEETS.find((s) => s.id === sheet)?.brand || '', segment: 'mid' }, prices))}>{Icon.plus}<span>מכשיר</span></button>}
      </div>
      {sel && (
        <div className="card selbar">
          <div className="selbar-row">
            <b className="num">נבחרו {sel.size}</b>
            <button className="btn" disabled={!shownRows.length} onClick={() => setSel(() => (allSel ? new Set() : new Set(shownRows.map((r) => r.id))))}>{allSel ? 'בטל בחירה' : `בחר הכל (${shownRows.length})`}</button>
          </div>
          <div className="selbar-row">
            <select className="input sm" style={{ width: 'auto' }} value="" disabled={!sel.size || busy} onChange={(e) => bulkSegment(e.target.value)}>
              <option value="">שנה סגמנט…</option>
              {SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button className={'btn danger' + (confirmDel ? ' confirm' : '')} disabled={!sel.size || busy} onClick={bulkDelete}>
              {Icon.trash}<span>{confirmDel ? `לחץ שוב למחיקת ${sel.size}` : 'מחק'}</span>
            </button>
          </div>
        </div>
      )}
      {groups.length === 0 && <div className="empty">אין מכשירים{q ? ' שמתאימים לחיפוש' : ' בגיליון הזה'}</div>}
      {groups.map((g) => (
        <div key={g.key} className="card list dm-group">
          <div className="dm-head"><b>{g.model}</b><span className="muted">{[segmentLabel(g.segment), g.year].filter(Boolean).join(' · ')}</span></div>
          {g.rows.map((r) => {
            const qt = rowQuote(r, prices.get(r.id), cfg);
            const byS = new Map((prices.get(r.id) || []).map((p) => [p.supplierId, p.price]));
            return (
              <button key={r.id} className={'row dm-row' + (sel?.has(r.id) ? ' selected' : '')} onClick={() => (sel ? toggle(r.id) : setEdit(toForm(r, prices)))}>
                {sel && <span className={'check' + (sel.has(r.id) ? ' on' : '')}>{sel.has(r.id) ? '✓' : ''}</span>}
                <div className="main">
                  <div className="t1" style={{ fontSize: 15 }}>{[fmtStorage(r.storage) || 'בלי נפח', r.version].filter(Boolean).join(' · ')}</div>
                  <div className="t2">{devSuppliers.map((s) => `${s.name} ${byS.has(s.id) ? fmt(byS.get(s.id)) : '—'}`).join(' · ')}{r.segment !== g.segment ? ` · ${segmentLabel(r.segment)}` : ''}</div>
                </div>
                {qt.final != null && <span className="price num" style={{ fontSize: 16 }}>{fmt(qt.final)}</span>}
              </button>
            );
          })}
        </div>
      ))}
      {ignored.length > 0 && (
        <>
          <button className="disc" onClick={() => setShowIgnored((v) => !v)}>{showIgnored ? 'הסתר' : 'הצג'} פריטים שמדלגים עליהם תמיד ({ignored.length})</button>
          {showIgnored && (
            <div className="card list">
              {ignored.map((x) => (
                <div key={x.key} className="row"><div className="main"><div className="t1" style={{ fontSize: 14 }}>{x.label}</div></div>
                  <button className="btn" onClick={() => unignore(x.key)}>בטל דילוג</button></div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function toForm(r, prices) {
  const byS = Object.fromEntries((r.id ? prices.get(r.id) || [] : []).map((p) => [p.supplierId, String(p.price)]));
  return {
    id: r.id || null, brand: r.brand || '', segment: r.segment || 'mid', series: r.series || '', model: r.model || '',
    storage: r.storage ? fmtStorage(r.storage) : '', version: r.version || '', year: r.year == null ? '' : String(r.year), notes: r.notes || '', prices: byS,
  };
}
