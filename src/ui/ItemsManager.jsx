import React, { useMemo, useState } from 'react';
import { manualItem } from '../lib/parser.js';
import { REPAIRS, CATEGORY_LABELS } from '../lib/defaults.js';
import { searchTokens } from '../lib/normalize.js';
import { fmt, Icon, daysLabel } from './util.jsx';
import { freshness } from '../lib/pricing.js';
import { useBack } from './useBack.js';

// ניהול ידני של פריטי המחירון – מנהל בלבד
export default function ItemsManager({ cfg, lists, store, toast, focus }) {
  const suppliers = cfg.suppliers || [];
  const [supplierId, setSupplierId] = useState(focus?.supplierId || suppliers[0]?.id);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const kind = supplier?.type === 'parts' ? 'parts' : 'devices';
  const items = lists?.[supplierId]?.items || [];
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(() => {
    if (!focus?.key) return null;
    const idx = (lists?.[focus.supplierId]?.items || []).findIndex((x) => x.key === focus.key);
    return idx >= 0 ? { ...toForm(lists[focus.supplierId].items[idx]), index: idx } : null;
  });
  const [busy, setBusy] = useState(false);
  useBack(!!edit, () => setEdit(null));

  const shown = useMemo(() => {
    const t = searchTokens(q);
    const list = items.map((it, i) => ({ it, i }));
    if (!t.length) return list;
    return list.filter(({ it }) => {
      const hay = searchTokens(`${it.brand || ''} ${it.name} ${it.variant || ''}`);
      return t.every((x, j) => hay.includes(x) || (j === t.length - 1 && hay.some((h) => h.startsWith(x))) || (it.variant || '').includes(x));
    });
  }, [items, q]);

  const saveList = async (next, label) => {
    setBusy(true);
    try {
      await store.savePriceList(supplierId, next, { supplierName: supplier?.name || supplierId, updatedAt: lists?.[supplierId]?.updatedAt || Date.now() });
      toast(label);
      setEdit(null);
    } catch (e) { toast('השמירה נכשלה: ' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  const onSave = () => {
    const prev = edit.index != null ? items[edit.index] : null;
    const it = manualItem(edit, kind, prev);
    if (!it.ok) { toast('חסר שם או מחיר'); return; }
    const { ok, ...rec } = it;
    const next = [...items];
    if (edit.index != null) next[edit.index] = rec; else next.push(rec);
    saveList(next, edit.index != null ? 'הפריט עודכן' : 'הפריט נוסף');
  };

  const onDelete = () => {
    const next = items.filter((_, i) => i !== edit.index);
    saveList(next, 'הפריט נמחק');
  };

  return (
    <>
      <div className="pills" style={{ paddingTop: 8 }}>
        {suppliers.map((s) => <button key={s.id} className={'pill' + (s.id === supplierId ? ' on' : '')} onClick={() => { setSupplierId(s.id); setEdit(null); }}>{s.name}</button>)}
      </div>

      {edit ? (
        <div className="card" style={{ padding: 14, marginTop: 8 }}>
          <div className="t1" style={{ fontWeight: 700, marginBottom: 4 }}>{edit.index != null ? 'עריכת פריט' : 'פריט חדש'} · {supplier?.name}</div>
          <label className="field"><span>שם הדגם / הפריט</span>
            <input className="input" dir="auto" value={edit.name} placeholder={kind === 'parts' ? 'Galaxy A54' : 'iPhone 15 Pro'} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          {kind === 'parts' ? (
            <label className="field"><span>סוג חלק</span>
              <select className="input" value={edit.partType} onChange={(e) => setEdit({ ...edit, partType: e.target.value })}>
                {REPAIRS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select></label>
          ) : (
            <label className="field"><span>נפח (GB, לא חובה)</span>
              <input className="input" inputMode="numeric" value={edit.storage ?? ''} onChange={(e) => setEdit({ ...edit, storage: e.target.value.replace(/\D/g, '') })} /></label>
          )}
          <label className="field"><span>{kind === 'parts' ? 'איכות' : 'וריאנט / הערה (צבע, DCS, רשמי…)'}</span>
            <input className="input" dir="auto" value={edit.variant} onChange={(e) => setEdit({ ...edit, variant: e.target.value })} /></label>
          <label className="field"><span>מחיר ספק (₪)</span>
            <input className="input num" inputMode="numeric" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/[^\d.]/g, '') })} /></label>
          {kind === 'devices' && (
            <label className="field"><span>קטגוריית רווח</span>
              <select className="input" value={edit.categoryOverride || ''} onChange={(e) => setEdit({ ...edit, categoryOverride: e.target.value || undefined })}>
                <option value="">אוטומטי</option>
                {Object.entries(CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
          )}
          {edit.raw && edit.raw !== 'ידני' && <div className="muted">מקור: {edit.raw}</div>}
          <div className="actions">
            <button className="btn primary" disabled={busy} onClick={onSave}>שמור</button>
            {edit.index != null && <button className="btn danger" disabled={busy} onClick={onDelete}>{Icon.trash}<span>מחק</span></button>}
            <button className="btn" onClick={() => setEdit(null)}>ביטול</button>
          </div>
        </div>
      ) : (
        <>
          <div className="actions" style={{ marginTop: 8 }}>
            <input className="input" style={{ flex: 1 }} placeholder="חיפוש פריט…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" onClick={() => setEdit({ name: '', variant: '', price: '', storage: '', partType: 'screen' })}>{Icon.plus}<span>פריט</span></button>
          </div>
          <div className="muted" style={{ margin: '8px 4px' }}>{items.length} פריטים{shown.length !== items.length ? ` · מוצגים ${shown.length}` : ''}</div>
          <div className="card list">
            {shown.length === 0 && <div className="empty">אין פריטים</div>}
            {shown.slice(0, 200).map(({ it, i }) => (
              <button key={it.key + i} className="row" onClick={() => setEdit({ ...toForm(it), index: i })}>
                <span className={'dot ' + freshness(it.updatedAt, cfg).level} />
                <div className="main">
                  <div className="t1" style={{ fontSize: 15 }}>{it.name}{kind === 'parts' ? ` · ${REPAIRS.find((r) => r.id === it.partType)?.label || ''}` : ''}</div>
                  <div className="t2">{[it.variant, it.manual ? 'ידני' : '', daysLabel(freshness(it.updatedAt, cfg).days)].filter(Boolean).join(' · ')}</div>
                </div>
                <span className="num" style={{ fontWeight: 700 }}>{fmt(it.price)}</span>
              </button>
            ))}
          </div>
          {shown.length > 200 && <div className="muted" style={{ margin: 8 }}>מוצגים 200 ראשונים. חפש כדי לצמצם.</div>}
        </>
      )}
    </>
  );
}

function toForm(it) {
  return { name: it.model || it.name, storage: it.storage || '', variant: it.variant || '', price: String(it.price ?? ''), partType: it.partType || 'screen', categoryOverride: it.categoryOverride, raw: it.raw };
}
