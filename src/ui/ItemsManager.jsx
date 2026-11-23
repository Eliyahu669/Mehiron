import React, { useEffect, useMemo, useRef, useState } from 'react';
import { manualItem } from '../lib/parser.js';
import { allRepairs, repairLabel, optionName } from '../lib/repairs.js';
import DevicesManager from './DevicesManager.jsx';
import SupplierGrid from './SupplierGrid.jsx';
import { searchTokens } from '../lib/normalize.js';
import { fmt, Icon, daysLabel } from './util.jsx';
import { freshness, partQuality } from '../lib/pricing.js';
import { useBack } from './useBack.js';
import { CATALOG_ID, rowLabel } from '../lib/devices.js';
import { uniqueKey, bulkPrice, applyBulkPrice } from '../lib/items.js';
import { buildWorkbook, exportFileName, readWorkbook, planImport, hardenExcelJS } from '../lib/excel.js';

// ExcelJS כבד (כמגה) – נטען רק כשמייצאים או מייבאים
const loadExcel = async () => { const m = await import('exceljs'); return hardenExcelJS(m.default?.Workbook ? m.default : m); };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ניהול ידני של פריטי המחירון – מנהל בלבד
const DEVICES = '__devices'; // "רשימת מכשירים" בין הספקים

export default function ItemsManager({ cfg, lists, catalog, store, toast, focus, onConfigSaved }) {
  // "רשימת מכשירים", ואחריה כל ספק – לכל ספק טבלה כמו הקובץ שלו (ובספק חלקים גם רשימת הפריטים)
  const suppliers = [...(cfg.suppliers || []).filter((s) => s.type === 'parts'), ...(cfg.suppliers || []).filter((s) => s.type !== 'parts')];
  const [supplierId, setSupplierId] = useState(focus?.row ? DEVICES : focus?.supplierId || suppliers.find((s) => s.type === 'parts')?.id || DEVICES);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const kind = supplier?.type === 'parts' ? 'parts' : 'devices';
  const [view, setView] = useState(focus?.key ? 'list' : 'grid'); // ספק: טבלה / רשימת פריטים
  const items = lists?.[supplierId]?.items || [];
  // פריט של ספק מכשירים שמקושר לשורה ברשימת המכשירים – השם שלו מגיע מהשורה
  const devRows = useMemo(() => new Map((lists?.[CATALOG_ID]?.items || []).map((r) => [r.id, r])), [lists]);
  const linked = (it) => (it?.row ? devRows.get(it.row) : null);
  const titleOf = (it) => { const r = linked(it); return r ? rowLabel(r) : it.name; };
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(() => {
    if (!focus?.key) return null;
    const it = (lists?.[focus.supplierId]?.items || []).find((x) => x.key === focus.key);
    const r = it?.row && (lists?.[CATALOG_ID]?.items || []).find((x) => x.id === it.row);
    return it ? { ...toForm(it), ...(r ? { row: it.row, name: rowLabel(r) } : {}), key: it.key } : null;
  });
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(null); // null = לא במצב בחירה, אחרת Set של מפתחות
  const [confirmDel, setConfirmDel] = useState(false);
  const [bulk, setBulk] = useState(null); // { mode, value } – חלון שינוי מחיר
  useBack(!!edit, () => setEdit(null));
  useBack(sel !== null, () => { setSel(null); setBulk(null); });
  useBack(!!bulk, () => setBulk(null));
  useEffect(() => { if (!confirmDel) return undefined; const t = setTimeout(() => setConfirmDel(false), 4000); return () => clearTimeout(t); }, [confirmDel]);

  // ---- ייצוא / ייבוא אקסל ----
  const [xl, setXl] = useState(null); // { book, fileName, at } – קובץ שנבחר לייבוא, לפני אישור
  const [xlBusy, setXlBusy] = useState(''); // '' | 'export' | 'read' | 'save'
  const [xlConfirm, setXlConfirm] = useState(false);
  const [saving, setSaving] = useState(null); // התוכנית שנשמרת כרגע (קפואה, כדי שהמסך לא יתעדכן באמצע)
  const fileRef = useRef(null);
  useBack(!!xl, () => setXl(null));
  useEffect(() => { if (!xlConfirm) return undefined; const t = setTimeout(() => setXlConfirm(false), 4000); return () => clearTimeout(t); }, [xlConfirm]);
  // התצוגה המקדימה מחושבת תמיד מול המצב העדכני של המחירונים
  const livePlan = useMemo(() => {
    if (!xl) return null;
    try { return planImport(xl.book, lists, cfg, xl.at); } catch (e) { return { error: e?.message || String(e) }; }
  }, [xl, lists, cfg]);
  const plan = saving || livePlan;

  const onExport = async () => {
    setXlBusy('export');
    try {
      const ExcelJS = await loadExcel();
      const now = Date.now();
      const { wb, counts } = buildWorkbook(ExcelJS, lists, cfg, supplierId, now);
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: XLSX_TYPE }));
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFileName(supplier, now);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast(`הקובץ של ${supplier.name} ירד · ${counts.rows} שורות · ${counts.prices} מחירים`);
    } catch (e) { toast('הייצוא נכשל: ' + (e?.message || e)); }
    finally { setXlBusy(''); }
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setXlBusy('read');
    try {
      const ExcelJS = await loadExcel();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      setXl({ book: readWorkbook(wb, cfg, supplierId), fileName: file.name, at: Date.now() });
      setXlConfirm(false); setEdit(null); setSel(null); setBulk(null);
    } catch { toast('לא ניתן לקרוא את הקובץ – צריך קובץ אקסל בפורמט ‎.xlsx'); }
    finally { setXlBusy(''); }
  };

  const onConfirmImport = async () => {
    if (!plan?.hasChanges) { setXl(null); return; }
    const s = plan.summary;
    if ((s.deleted > 0 || s.cleared > 0) && !xlConfirm) { setXlConfirm(true); return; }
    setXlConfirm(false);
    setXlBusy('save');
    setSaving(plan);
    try {
      await store.saveImport({ lists: plan.lists, config: plan.config });
      if (plan.config) onConfigSaved?.(plan.config);
      const ov = s.overridesSet + s.overridesCleared, mg = s.marginsSet + s.marginsCleared;
      toast(['הייבוא נשמר', s.updated && `עודכנו ${s.updated}`, s.added && `נוספו ${s.added}`, s.deleted && `נמחקו ${s.deleted}`, s.cleared && `מחירים נמחקו ל-${s.cleared}`, ov && `מחירים ללקוח ${ov}`, mg && `אחוזי רווח ${mg}`].filter(Boolean).join(' · '));
      setXl(null);
    } catch (err) { toast('השמירה נכשלה: ' + (err?.message || err)); }
    finally { setXlBusy(''); setSaving(null); }
  };

  const shown = useMemo(() => {
    const t = searchTokens(q);
    if (!t.length) return items;
    return items.filter((it) => {
      const hay = searchTokens(`${it.brand || linked(it)?.brand || ''} ${titleOf(it)} ${it.variant || ''}`);
      return t.every((x, j) => hay.includes(x) || (j === t.length - 1 && hay.some((h) => h.startsWith(x))) || (it.variant || '').includes(x));
    });
  }, [items, q, devRows]);

  const saveList = async (next, label) => {
    setBusy(true);
    try {
      await store.savePriceList(supplierId, next, { supplierName: supplier?.name || supplierId, updatedAt: lists?.[supplierId]?.updatedAt || Date.now() });
      toast(label);
      return true;
    } catch (e) { toast('השמירה נכשלה: ' + (e?.message || e)); return false; }
    finally { setBusy(false); }
  };

  const onSave = async () => {
    const index = edit.key != null ? items.findIndex((x) => x.key === edit.key) : -1;
    const prev = index >= 0 ? items[index] : null;
    if (linked(prev)) { // שורה מרשימת המכשירים: משתנה רק המחיר (כמו בטבלה)
      const price = Number(edit.price);
      if (!(price > 0)) { toast('חסר מחיר'); return; }
      const now = Date.now(), changed = price !== prev.price;
      const next = [...items];
      next[index] = { ...prev, price, manual: true, updatedAt: now, changedAt: changed ? now : prev.changedAt, prevPrice: changed ? prev.price : prev.prevPrice ?? null };
      if (await saveList(next, 'הפריט עודכן')) setEdit(null);
      return;
    }
    const it = manualItem(edit, kind, prev);
    if (!it.ok) { toast('חסר שם או מחיר'); return; }
    const { ok, ...rec } = it;
    rec.key = uniqueKey(items, rec.key, index);
    const next = [...items];
    if (index >= 0) next[index] = rec; else next.push(rec);
    if (await saveList(next, index >= 0 ? 'הפריט עודכן' : 'הפריט נוסף')) setEdit(null);
  };

  const onDelete = async () => {
    const next = items.filter((x) => x.key !== edit.key);
    if (await saveList(next, 'הפריט נמחק')) setEdit(null);
  };

  // ---- בחירה מרובה ----
  const toggle = (key) => setSel((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allShownSelected = sel && shown.length > 0 && shown.every((it) => sel.has(it.key));
  const selectAll = () => setSel((s) => {
    const n = new Set(s);
    if (allShownSelected) shown.forEach((it) => n.delete(it.key)); else shown.forEach((it) => n.add(it.key));
    return n;
  });
  const bulkDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setConfirmDel(false);
    const count = sel.size;
    const next = items.filter((x) => !sel.has(x.key));
    if (await saveList(next, `נמחקו ${count} פריטים`)) setSel(null);
  };
  const bulkApply = async () => {
    const { items: next, changed, skipped } = applyBulkPrice(items, sel, bulk.mode, bulk.value);
    if (!changed) { toast(skipped ? 'המחיר החדש לא תקין (חייב להיות גדול מ-0)' : 'אין שינוי במחיר'); return; }
    if (await saveList(next, `עודכן מחיר ל-${changed} פריטים${skipped ? ` · ${skipped} דולגו (מחיר לא תקין)` : ''}`)) { setBulk(null); setSel(null); }
  };
  const sample = sel && bulk && bulk.value !== '' ? items.find((x) => sel.has(x.key)) : null;
  const sampleNew = sample ? bulkPrice(sample.price, bulk.mode, bulk.value) : null;

  if (xl && plan) {
    if (plan.error) {
      return (
        <div className="card xl-card">
          <div className="t1" style={{ fontWeight: 700 }}>לא ניתן לייבא את הקובץ</div>
          <div className="xl-note warn">{xl.fileName}: {plan.error}</div>
          <div className="actions"><button className="btn primary" onClick={() => setXl(null)}>סגור</button></div>
        </div>
      );
    }
    return <XlPreview plan={plan} fileName={xl.fileName} busy={xlBusy === 'save'} confirm={xlConfirm} onConfirm={onConfirmImport} onCancel={() => setXl(null)} />;
  }

  return (
    <>
      <div className="pills" style={{ paddingTop: 8 }}>
        <button className={'pill' + (supplierId === DEVICES ? ' on' : '')} onClick={() => { setSupplierId(DEVICES); setEdit(null); setSel(null); setBulk(null); }}>רשימת מכשירים</button>
        {suppliers.map((s) => <button key={s.id} className={'pill' + (s.id === supplierId ? ' on' : '')} onClick={() => { setSupplierId(s.id); setEdit(null); setSel(null); setBulk(null); }}>{s.name}</button>)}
      </div>
      {supplier && !edit && !sel && (
        <div className="xl-bar">
          <button className="btn" disabled={!!xlBusy} onClick={onExport}>{Icon.download}<span>{xlBusy === 'export' ? 'מכין קובץ…' : 'ייצוא הקובץ של הספק'}</span></button>
          <button className="btn" disabled={!!xlBusy} onClick={() => fileRef.current?.click()}>{Icon.upload}<span>{xlBusy === 'read' ? 'קורא קובץ…' : 'ייבוא קובץ'}</span></button>
          <input ref={fileRef} type="file" accept={`.xlsx,${XLSX_TYPE}`} hidden onChange={onPickFile} />
        </div>
      )}
      {supplier && !edit && !sel && (
        <div className="seg" style={{ marginTop: 8 }}>
          <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>טבלה</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>רשימת פריטים</button>
        </div>
      )}

      {supplierId === DEVICES ? (
        <DevicesManager cfg={cfg} lists={lists} catalog={catalog} store={store} toast={toast} focusRow={focus?.row} onConfigSaved={onConfigSaved} />
      ) : supplier && view === 'grid' && !edit ? (
        <SupplierGrid key={supplierId} cfg={cfg} lists={lists} supplier={supplier} store={store} toast={toast} onConfigSaved={onConfigSaved} />
      ) : edit ? (
        <div className="card" style={{ padding: 14, marginTop: 8 }}>
          <div className="t1" style={{ fontWeight: 700, marginBottom: 4 }}>{edit.key != null ? 'עריכת פריט' : 'פריט חדש'} · {supplier?.name}</div>
          {edit.row ? (
            <div className="field"><span>מכשיר מהרשימה</span><div className="t1" style={{ margin: '0 4px' }}>{edit.name}</div>
              <div className="muted">שינוי השם, הנפח והגרסה – ב"רשימת מכשירים".</div></div>
          ) : (
          <label className="field"><span>שם הדגם / הפריט</span>
            <input className="input" dir="auto" value={edit.name} placeholder={kind === 'parts' ? 'Galaxy A54' : 'iPhone 15 Pro'} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          )}
          {edit.row ? null : kind === 'parts' ? (
            <label className="field"><span>סוג חלק</span>
              <select className="input" value={edit.partType} onChange={(e) => setEdit({ ...edit, partType: e.target.value })}>
                {allRepairs(cfg).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select></label>
          ) : (
            <label className="field"><span>נפח (GB, לא חובה)</span>
              <input className="input" inputMode="numeric" value={edit.storage ?? ''} onChange={(e) => setEdit({ ...edit, storage: e.target.value.replace(/\D/g, '') })} /></label>
          )}
          {!edit.row && <label className="field"><span>{kind === 'parts' ? 'איכות' : 'וריאנט / הערה (צבע, DCS, רשמי…)'}</span>
            <input className="input" dir="auto" value={edit.variant} onChange={(e) => setEdit({ ...edit, variant: e.target.value })} /></label>}
          {kind === 'parts' && <div className="muted">יוצג ללקוח כ: <b>{optionName(partQuality({ partType: edit.partType, variant: edit.variant, supplierId }, cfg))}</b></div>}
          <label className="field"><span>מחיר ספק (₪)</span>
            <input className="input num" inputMode="numeric" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/[^\d.]/g, '') })} /></label>
          {edit.raw && edit.raw !== 'ידני' && <div className="muted">מקור: {edit.raw}</div>}
          <div className="actions">
            <button className="btn primary" disabled={busy} onClick={onSave}>שמור</button>
            {edit.key != null && <button className="btn danger" disabled={busy} onClick={onDelete}>{Icon.trash}<span>מחק</span></button>}
            <button className="btn" onClick={() => setEdit(null)}>ביטול</button>
          </div>
        </div>
      ) : (
        <>
          <div className="actions" style={{ marginTop: 8 }}>
            <input className="input" style={{ flex: 1 }} placeholder="חיפוש פריט…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className={'btn' + (sel ? ' primary' : '')} onClick={() => { setSel(sel ? null : new Set()); setBulk(null); setConfirmDel(false); }}>{sel ? 'סיום' : 'בחירה'}</button>
            {!sel && <button className="btn primary" onClick={() => setEdit({ name: '', variant: '', price: '', storage: '', partType: 'screen' })}>{Icon.plus}<span>פריט</span></button>}
          </div>

          {sel && (
            <div className="card selbar">
              <div className="selbar-row">
                <b className="num">נבחרו {sel.size}</b>
                <button className="btn" onClick={selectAll} disabled={!shown.length}>{allShownSelected ? 'בטל בחירת המוצגים' : `בחר הכל (${shown.length})`}</button>
                {sel.size > 0 && <button className="btn" onClick={() => setSel(new Set())}>נקה</button>}
              </div>
              <div className="selbar-row">
                <button className="btn" disabled={!sel.size || busy} onClick={() => setBulk(bulk ? null : { mode: 'set', value: '' })}>שנה מחיר</button>
                <button className={'btn danger' + (confirmDel ? ' confirm' : '')} disabled={!sel.size || busy} onClick={bulkDelete}>
                  {Icon.trash}<span>{confirmDel ? `לחץ שוב למחיקת ${sel.size}` : 'מחק'}</span>
                </button>
              </div>
              {bulk && (
                <div className="bulk">
                  <div className="seg">
                    <button className={bulk.mode === 'set' ? 'on' : ''} onClick={() => setBulk({ ...bulk, mode: 'set' })}>מחיר חדש</button>
                    <button className={bulk.mode === 'add' ? 'on' : ''} onClick={() => setBulk({ ...bulk, mode: 'add' })}>‎+/- ₪</button>
                    <button className={bulk.mode === 'pct' ? 'on' : ''} onClick={() => setBulk({ ...bulk, mode: 'pct' })}>‎+/- %</button>
                  </div>
                  <div className="actions" style={{ alignItems: 'center' }}>
                    <input className="input num" style={{ flex: 1 }} inputMode={bulk.mode === 'set' ? 'numeric' : 'text'} dir="ltr"
                      placeholder={bulk.mode === 'set' ? '250' : bulk.mode === 'add' ? '20 או ‎-20' : '10 או ‎-5'}
                      value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value.replace(/[^\d.-]/g, '') })} />
                    <button className="btn primary" disabled={busy || bulk.value === '' || bulk.value === '-' || !sel.size} onClick={bulkApply}>החל על {sel.size}</button>
                  </div>
                  {sample && <div className="muted">לדוגמה: {sample.name} <span className="num">{fmt(sample.price)} → {sampleNew == null ? 'לא תקין' : fmt(sampleNew)}</span></div>}
                </div>
              )}
            </div>
          )}

          <div className="muted" style={{ margin: '8px 4px' }}>{items.length} פריטים{shown.length !== items.length ? ` · מוצגים ${shown.length}` : ''}</div>
          <div className="card list">
            {shown.length === 0 && <div className="empty">אין פריטים</div>}
            {shown.slice(0, 300).map((it) => {
              const on = sel?.has(it.key);
              return (
                <button key={it.key} className={'row' + (on ? ' selected' : '')} onClick={() => (sel ? toggle(it.key) : setEdit({ ...toForm(it), ...(linked(it) ? { row: it.row, name: titleOf(it) } : {}), key: it.key }))}>
                  {sel ? <span className={'check' + (on ? ' on' : '')} aria-checked={!!on} role="checkbox">{on ? '✓' : ''}</span> : <span className={'dot ' + freshness(it.updatedAt, cfg).level} />}
                  <div className="main">
                    <div className="t1" style={{ fontSize: 15 }}>{titleOf(it)}{kind === 'parts' ? ` · ${repairLabel(it.partType, cfg)}` : ''}</div>
                    <div className="t2">{[kind === 'parts' ? optionName(partQuality({ ...it, supplierId }, cfg)) : it.variant, it.manual ? 'ידני' : '', daysLabel(freshness(it.updatedAt, cfg).days)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="num" style={{ fontWeight: 700 }}>{fmt(it.price)}</span>
                </button>
              );
            })}
          </div>
          {shown.length > 300 && <div className="muted" style={{ margin: 8 }}>מוצגים 300 ראשונים{sel ? ' ("בחר הכל" בוחר את כל ' + shown.length + ')' : ''}. חפש כדי לצמצם.</div>}
        </>
      )}
    </>
  );
}

// תצוגה מקדימה של ייבוא: מה ישתנה, ואישור (לחיצה שנייה כשיש מחיקות)
function XlPreview({ plan, fileName, busy, confirm, onConfirm, onCancel }) {
  const s = plan.summary, d = plan.details;
  const when = s.exportedAt ? new Date(s.exportedAt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const where = (x) => [x.supplier, x.row ? `שורה ${x.row}` : ''].filter(Boolean).join(' · ');
  const many = (n, one, other) => (n === 1 ? one : other.replace('#', n));
  return (
    <div className="card xl-card">
      <div className="t1" style={{ fontWeight: 700 }}>ייבוא מאקסל{s.supplier ? ` · ${s.supplier}` : ''} – לפני שמירה</div>
      <div className="muted">{fileName}{when ? ` · יוצא ב-${when}` : ''}</div>
      <div className="xl-sum">{plan.hasChanges ? 'אלה השינויים שיישמרו:' : 'לא נמצאו שינויים בקובץ.'}</div>
      <Sec title={many(s.updated, 'עודכנה שורה אחת', 'עודכנו # שורות')} hint={s.priceChanged ? `${s.priceChanged} מחירים` : ''} rows={d.updated}
        render={(x) => <><div className="main">{x.name}<div className="sub">{[x.what.length ? `שונה: ${x.what.join(', ')}` : '', where(x)].filter(Boolean).join(' · ')}</div></div>
          {x.after != null && <span className="num">{x.before !== x.after ? `${fmt(x.before)} → ${fmt(x.after)}` : fmt(x.after)}</span>}</>} />
      <Sec title={many(s.added, s.kind === 'parts' ? 'נוסף דגם אחד (לכל ספקי החלקים)' : 'נוסף מכשיר אחד לרשימה', s.kind === 'parts' ? 'נוספו # דגמים (לכל ספקי החלקים)' : 'נוספו # מכשירים לרשימה')} rows={d.added}
        render={(x) => <><div className="main">{x.name}<div className="sub">{where(x)}</div></div>{x.price != null && <span className="num">{fmt(x.price)}</span>}</>} />
      <Sec cls="red" title={s.cleared ? many(s.cleared, 'יימחקו המחירים של שורה אחת', 'יימחקו המחירים של # שורות') : many(s.deleted, 'יימחק פריט אחד', 'יימחקו # פריטים')} hint="השורות נמחקו מהקובץ (הדגם עצמו נשאר ברשימה)" rows={d.deleted}
        render={(x) => <><div className="main">{x.name}<div className="sub">{x.supplier}</div></div>{x.price != null && <span className="num">{fmt(x.price)}</span>}</>} />
      <Sec title={`מחיר ידני ללקוח: ${s.overridesSet + s.overridesCleared}`} rows={d.overrides}
        render={(x) => <><div className="main">{x.name}</div><span className="num">{x.value == null ? 'אוטומטי' : fmt(x.value)}</span></>} />
      <Sec title={`אחוז רווח לפריט: ${s.marginsSet + s.marginsCleared}`} rows={d.margins}
        render={(x) => <><div className="main">{x.name}</div><span className="num">{x.value == null ? 'לפי הקטגוריה' : `${x.value}%`}</span></>} />
      {s.newSuppliers.length > 0 && <div className="xl-note">ספקים חדשים שייווצרו: {s.newSuppliers.join(', ')}</div>}
      <Sec cls="orange" title={many(s.invalid.length, 'שורה אחת לא תקינה – לא תיובא', '# שורות לא תקינות – לא יובאו')} hint="הפריטים שלהן נשארים כמו שהם" rows={s.invalid}
        render={(x) => <div className="main">{x.row > 1 ? `שורה ${x.row}` : 'כותרת'} ב"{x.sheet}": {x.reason}{x.name ? <div className="sub">{x.name}</div> : null}</div>} />
      {s.conflicts.map((c, i) => <div key={'c' + i} className="xl-note warn">{c}</div>)}
      {s.notes.map((c, i) => <div key={'n' + i} className="xl-note">{c}</div>)}
      <div className="actions">
        {plan.hasChanges ? (
          <>
            <button className={'btn ' + (confirm ? 'danger confirm' : 'primary')} disabled={busy} onClick={onConfirm}>
              {busy ? 'שומר…' : confirm ? `לחץ שוב – כולל מחיקה ב-${s.deleted + (s.cleared || 0)} שורות` : 'אשר ושמור'}</button>
            <button className="btn" disabled={busy} onClick={onCancel}>ביטול</button>
          </>
        ) : <button className="btn primary" onClick={onCancel}>סגור</button>}
      </div>
    </div>
  );
}

function Sec({ title, hint, rows, render, cls = '' }) {
  if (!rows.length) return null;
  return (
    <details className={'xl-sec ' + cls}>
      <summary>{title}{hint ? <span className="muted" style={{ fontWeight: 400 }}>{hint}</span> : null}</summary>
      <div className="xl-list">
        {rows.slice(0, 500).map((x, i) => <div key={i} className="xl-row">{render(x)}</div>)}
        {rows.length > 500 && <div className="muted">ועוד {rows.length - 500}…</div>}
      </div>
    </details>
  );
}

function toForm(it) {
  return { name: it.model || it.name, storage: it.storage || '', variant: it.variant || '', price: String(it.price ?? ''), partType: it.partType || 'screen', categoryOverride: it.categoryOverride, raw: it.raw };
}
