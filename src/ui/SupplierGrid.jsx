import React, { useMemo, useState } from 'react';
import { SHEETS, CATALOG_ID, sheetOf, rowLabel } from '../lib/devices.js';
import { partColumns } from '../lib/repairs.js';
import { RMODELS_ID, rmodelsOf, sortRows, addRows, baseKey } from '../lib/rmodels.js';
import { partCells, setPartCell } from '../lib/partcells.js';
import { searchTokens, fmtStorage } from '../lib/normalize.js';
import { fmt, Icon } from './util.jsx';
import { useBack } from './useBack.js';

// הטבלה של ספק – כמו הקובץ שלו: ספק חלקים – דגם בשורה וחלק בעמודה; ספק מכשירים – שורה לכל מכשיר ומחיר.
// מקלידים מחיר בתא ועוזבים אותו – נשמר מיד. תא ריק = אין מחיר אצל הספק הזה
export default function SupplierGrid({ cfg, lists, supplier, store, toast, onConfigSaved }) {
  const parts = supplier.type === 'parts';
  const rm = rmodelsOf(lists);
  const devRows = lists?.[CATALOG_ID]?.items || [];
  const sheets = SHEETS.filter((s) => s.id !== 'other' || (parts ? rm : devRows).some((r) => sheetOf(r.brand) === 'other'));
  const [sheet, setSheet] = useState('apple');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null); // דגם בעריכה (שם / דגם יצרן) או דגם חדש
  const [confirmDel, setConfirmDel] = useState(false);
  useBack(!!edit, () => setEdit(null));
  const items = lists?.[supplier.id]?.items || [];

  const match = (text) => {
    const t = searchTokens(q);
    if (!t.length) return true;
    const hay = searchTokens(text);
    return t.every((x, j) => hay.includes(x) || (j === t.length - 1 && hay.some((h) => h.startsWith(x))));
  };

  const save = async (nextItems, extra = {}, msg = '') => {
    setBusy(true);
    try {
      await store.saveImport({
        lists: { ...(nextItems ? { [supplier.id]: { items: nextItems, supplierName: supplier.name, updatedAt: lists?.[supplier.id]?.updatedAt || Date.now() } } : {}), ...(extra.lists || {}) },
        config: extra.config || null,
      });
      if (extra.config) onConfigSaved?.(extra.config);
      if (msg) toast(msg);
      return true;
    } catch (e) { toast('השמירה נכשלה: ' + (e?.message || e)); return false; }
    finally { setBusy(false); }
  };
  const readPrice = (v) => {
    const s = String(v ?? '').replace(/[₪,\s]/g, '');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : NaN;
  };

  // ---------- ספק חלקים ----------
  if (parts) {
    const cols = partColumns(sheet, cfg);
    const rows = sortRows(rm.filter((r) => sheetOf(r.brand) === sheet)).filter((r) => match(`${r.model} ${r.code || ''}`));
    const cells = partCells(items, supplier.id, rm, cfg);
    const onCell = async (row, ci, raw, was) => {
      const price = readPrice(raw);
      if (Number.isNaN(price)) { toast('מחיר לא תקין'); return; }
      if ((price ?? null) === (was ?? null)) return;
      const r = setPartCell(items, supplier.id, row, ci, price, cfg);
      if (r.changed) await save(r.items, {}, price == null ? `נמחק: ${row.model} · ${cols[ci].label}` : `נשמר: ${row.model} · ${cols[ci].label} ${fmt(price)}`);
    };
    const saveModel = async () => {
      const name = edit.model.trim();
      if (!name) { toast('חסר שם דגם'); return; }
      const clash = rm.find((r) => r.id !== edit.id && sheetOf(r.brand) === sheetOf(edit.brand) && r.model.trim().toLowerCase() === name.toLowerCase());
      if (clash) { toast(`כבר יש דגם בשם ${clash.model}`); return; }
      const next = edit.id
        ? rm.map((r) => (r.id === edit.id ? { ...r, model: name, code: edit.code.trim() } : r))
        : addRows(rm, [{ brand: edit.brand, model: name, code: edit.code.trim(), year: edit.year ? Number(edit.year) : null, series: '' }]);
      if (await save(null, { lists: { [RMODELS_ID]: { items: next, supplierName: 'דגמים לתיקון' } } }, edit.id ? 'הדגם עודכן (אצל כל הספקים)' : 'הדגם נוסף לכל ספקי החלקים')) setEdit(null);
    };
    const deleteModel = async () => {
      if (!confirmDel) { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 4000); return; }
      setConfirmDel(false);
      const row = rm.find((r) => r.id === edit.id);
      const next = rm.filter((r) => r.id !== edit.id);
      // המחירים של הדגם אצל כל ספקי החלקים נמחקים איתו
      const lists2 = { [RMODELS_ID]: { items: next, supplierName: 'דגמים לתיקון' } };
      for (const s of (cfg.suppliers || []).filter((x) => x.type === 'parts')) {
        const its = lists?.[s.id]?.items || [];
        if (its.some((x) => x.mkey === row.key)) lists2[s.id] = { items: its.filter((x) => x.mkey !== row.key), supplierName: s.name, updatedAt: lists?.[s.id]?.updatedAt || Date.now() };
      }
      const removed = [...new Set([...(cfg.repairModelsRemoved || []), baseKey(row)])];
      if (await save(null, { lists: lists2, config: { ...cfg, repairModelsRemoved: removed } }, `${row.model} נמחק מרשימת התיקונים`)) setEdit(null);
    };

    if (edit) {
      return (
        <div className="card" style={{ padding: 14, marginTop: 8 }}>
          <div className="t1" style={{ fontWeight: 700, marginBottom: 4 }}>{edit.id ? 'עריכת דגם' : 'דגם חדש'} · {SHEETS.find((s) => s.id === sheetOf(edit.brand))?.label}</div>
          <div className="muted">הדגם משותף לכל ספקי החלקים – שינוי כאן מופיע אצל כולם.</div>
          {!edit.id && sheet === 'other' && <label className="field"><span>חברה</span><input className="input" value={edit.brand || ''} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} /></label>}
          <label className="field"><span>שם הדגם</span><input className="input" dir="auto" value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} /></label>
          <label className="field"><span>דגם יצרן {sheetOf(edit.brand) === 'samsung' ? '(למשל A125)' : '(לא חובה)'}</span><input className="input" dir="ltr" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></label>
          {!edit.id && <label className="field"><span>שנת השקה (למיון, לא חובה)</span><input className="input num" inputMode="numeric" value={edit.year || ''} onChange={(e) => setEdit({ ...edit, year: e.target.value.replace(/\D/g, '') })} /></label>}
          <div className="actions">
            <button className="btn primary" disabled={busy} onClick={saveModel}>שמור</button>
            {edit.id && <button className={'btn danger' + (confirmDel ? ' confirm' : '')} disabled={busy} onClick={deleteModel}>{Icon.trash}<span>{confirmDel ? 'לחץ שוב – גם המחירים שלו יימחקו' : 'מחק דגם'}</span></button>}
            <button className="btn" onClick={() => setEdit(null)}>ביטול</button>
          </div>
        </div>
      );
    }

    return (
      <>
        <SheetPills sheets={sheets} sheet={sheet} setSheet={setSheet} />
        <div className="actions" style={{ marginTop: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="חיפוש דגם / דגם יצרן…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn primary" onClick={() => setEdit({ id: null, brand: { apple: 'Apple', samsung: 'Samsung', xiaomi: 'Xiaomi' }[sheet] || '', model: '', code: '', year: '' })}>{Icon.plus}<span>דגם</span></button>
        </div>
        {!rm.length && <div className="card empty">רשימת הדגמים לתיקון עוד לא נוצרה.</div>}
        <div className="grid-wrap" aria-busy={busy}>
          <table className="sgrid">
            <thead><tr><th className="stick">דגם</th>{cols.map((c, i) => <th key={i}>{c.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th className="stick"><button className="sgrid-model" onClick={() => setEdit({ ...r, code: r.code || '' })}>{r.model}{r.code ? <span>{r.code}</span> : null}</button></th>
                  {cols.map((c, ci) => {
                    const cur = cells.get(r, ci)[0]?.price ?? null;
                    return (
                      <td key={ci}>
                        <input key={`${r.key}|${ci}|${cur ?? ''}`} className="sgrid-in num" inputMode="decimal" defaultValue={cur ?? ''} aria-label={`${r.model} ${c.label}`}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          onBlur={(e) => onCell(r, ci, e.target.value, cur)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ margin: '8px 4px' }}>{rows.length} דגמים · מקלידים מחיר ועוזבים את התא – נשמר מיד. לחיצה על שם הדגם – עריכה.</div>
      </>
    );
  }

  // ---------- ספק מכשירים ----------
  const mine = new Map(items.filter((x) => x.row).map((x) => [x.row, x]));
  const rows = devRows.filter((r) => sheetOf(r.brand) === sheet && match(`${r.brand} ${r.model} ${r.series || ''}`));
  const onPrice = async (row, raw) => {
    const price = readPrice(raw);
    if (Number.isNaN(price)) { toast('מחיר לא תקין'); return; }
    const old = mine.get(row.id) || null;
    if ((price ?? null) === (old?.price ?? null)) return;
    const now = Date.now();
    const next = items.filter((x) => x.row !== row.id);
    if (price != null) next.push({ key: row.id, row: row.id, kind: 'device', price, raw: old?.raw || 'ידני', manual: true, updatedAt: now, changedAt: now, prevPrice: old?.price ?? null });
    await save(next, {}, price == null ? `נמחק: ${rowLabel(row)}` : `נשמר: ${rowLabel(row)} ${fmt(price)}`);
  };
  return (
    <>
      <SheetPills sheets={sheets} sheet={sheet} setSheet={setSheet} />
      <div className="actions" style={{ marginTop: 8 }}>
        <input className="input" style={{ flex: 1 }} placeholder="חיפוש דגם…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card list">
        {!rows.length && <div className="empty">אין מכשירים</div>}
        {rows.map((r) => {
          const cur = mine.get(r.id)?.price ?? null;
          return (
            <div key={r.id} className="dm-row">
              <div className="main"><div className="t1" style={{ fontSize: 15 }}>{r.model}</div>
                <div className="t2">{[r.storage ? fmtStorage(r.storage) : '', r.version].filter(Boolean).join(' · ') || '—'}</div></div>
              <input key={`${r.id}|${cur ?? ''}`} className="input sm num" inputMode="decimal" placeholder="₪" defaultValue={cur ?? ''} aria-label={`${rowLabel(r)} מחיר`}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={(e) => onPrice(r, e.target.value)} />
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ margin: '8px 4px' }}>{rows.length} שורות · המחיר נשמר כשעוזבים את התא. הוספה ועריכה של מכשירים – ב"רשימת מכשירים".</div>
    </>
  );
}

function SheetPills({ sheets, sheet, setSheet }) {
  return (
    <div className="pills" style={{ paddingTop: 8 }}>
      {sheets.map((s) => <button key={s.id} className={'pill' + (sheet === s.id ? ' on' : '')} onClick={() => setSheet(s.id)}>{s.label}</button>)}
    </div>
  );
}
