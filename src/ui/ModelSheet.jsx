import React, { useMemo, useState } from 'react';
import { freshness, afterVat, partQuality } from '../lib/pricing.js';
import { REPAIRS } from '../lib/defaults.js';
import { allRepairs, qualitiesFor, FRAME, parseReply, manualPart } from '../lib/repairs.js';
import { extractPrice, splitMulti } from '../lib/parser.js';
import { getRepairQuote, getDeviceQuotes } from '../lib/publish.js';
import { segmentLabel } from '../lib/devices.js';
import { fmtStorage } from '../lib/normalize.js';
import { fmt, Price, Fresh, waLink, copyText, daysLabel, Icon } from './util.jsx';

// mode = 'repairs' | 'devices' – כל מחירון מוצג בנפרד לגמרי
export default function ModelSheet({ model, mode, storage, catalog, cfg, customer, isAdmin, initialRepair, onClose, onSaveConfig, toast, onEditItem, onRequest, lists, onSaveImport }) {
  const tab = mode === 'devices' ? 'devices' : 'repairs';
  const sup = useMemo(() => Object.fromEntries((cfg.suppliers || []).map((s) => [s.id, s])), [cfg.suppliers]);

  const ids = allRepairs(cfg).map((r) => r.id);
  const order = initialRepair ? [initialRepair, ...ids.filter((r) => r !== initialRepair)] : ids;
  const quotes = order.map((r) => getRepairQuote(model, r, catalog, cfg));
  const shown = quotes.filter((q) => q.options.length || q.labor);
  // סוג שנוסף בהגדרות מופיע בדגם רק כשיש לו עלות עבודה או חלק (כך "מסך חיצוני" לא מופיע באייפון)
  const missing = quotes.filter((q) => !q.options.length && !q.labor && REPAIRS.some((r) => r.id === q.repair));
  // מנהל: אפשר להזין מחיר חלק גם לתיקון שעוד אין לו כלום (בוחרים מהרשימה למטה)
  const canEdit = isAdmin && !customer && !!onSaveImport && !!lists;
  const [adding, setAdding] = useState(null);

  return (
    <>
      <div className="sheet-bg" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={model.model}>
        <div className="sheet-inner">
          <div className="sheet-head">
            <button className="back" onClick={onClose}>‹ חזרה</button>
          </div>
          <h2 style={{ margin: '4px 4px 2px', fontSize: 30, letterSpacing: '-0.02em' }}>{model.model}</h2>
          <div className="muted" style={{ margin: '0 4px 8px' }}>{(tab === 'devices' ? [model.brand, segmentLabel(model.segment), model.year] : [model.brand, 'תיקונים']).filter(Boolean).join(' · ')}</div>
          {tab === 'repairs' && (
            <>
              {shown.map((q, i) => (
                <QuoteCard key={q.repair} q={q} model={model} cfg={cfg} sup={sup} customer={customer} isAdmin={isAdmin} canEdit={canEdit} lists={lists} onSaveImport={onSaveImport}
                  catalog={catalog} onRequest={onRequest} defaultOpen={i === 0 || !!initialRepair && q.repair === initialRepair} onSaveConfig={onSaveConfig} toast={toast} onEditItem={onEditItem} />
              ))}
              {!shown.length && <div className="card empty">אין עדיין מחיר עבודה או חלק לדגם הזה.{isAdmin && <><br />אפשר להגדיר עלות עבודה לסדרה או לדגם בהגדרות.</>}</div>}
              {!customer && missing.length > 0 && (
                <div className="muted" style={{ margin: '4px 6px' }}>לא מוגדר לדגם הזה: {missing.map((m) => (canEdit
                  ? <button key={m.repair} className="disc" style={{ margin: '0 0 0 8px' }} onClick={() => setAdding(m.repair)}>{m.label} +</button>
                  : <span key={m.repair}>{m.label} </span>))}</div>
              )}
              {adding && <PriceEditor model={model} repair={adding} cfg={cfg} lists={lists} catalog={catalog} onSaveImport={onSaveImport} toast={toast} onDone={() => setAdding(null)} />}
            </>
          )}
          {tab === 'devices' && <Devices model={model} storage={storage} catalog={catalog} cfg={cfg} sup={sup} customer={customer} isAdmin={isAdmin} onSaveConfig={onSaveConfig} toast={toast} onEditItem={onEditItem} onRequest={onRequest} />}
        </div>
      </div>
    </>
  );
}

function QuoteCard({ q: q0, model, cfg, sup, customer, isAdmin, canEdit, lists, onSaveImport, catalog, defaultOpen, onSaveConfig, toast, onEditItem, onRequest }) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [addonIds, setAddonIds] = useState([]);
  const [showInternal, setShowInternal] = useState(false);
  const applicable = (cfg.addons || []).filter((a) => (!a.repairs || a.repairs.includes(q0.repair)) && (!a.families || a.families.includes(model.family)));
  const q = addonIds.length ? getRepairQuote(model, q0.repair, catalog, cfg, addonIds) : q0;
  const best = q.options[0];
  const headline = best ? best.final : null;

  const quoteText = () => {
    const lines = [`הצעת מחיר – ${model.model}`, `${q.label}:`];
    if (q.options.length) q.options.forEach((o) => o.final != null && lines.push(`• ${o.quality}: ${fmt(o.final)}`));
    else if (q.laborOnly != null) lines.push(`• עבודה: ${fmt(q.laborOnly)} (בתוספת מחיר החלק)`);
    if (q.addons.length) lines.push(`כולל: ${q.addons.map((a) => a.label).join(', ')}`);
    return lines.join('\n');
  };

  if (!open) {
    return (
      <button className="card row" style={{ marginBottom: 10, borderRadius: 16 }} onClick={() => setOpen(true)}>
        <div className="main"><div className="t1">{q.label}</div>
          <div className="t2">{q.options.length ? `${q.options.length} רמות איכות` : 'עבודה בלבד – אין מחיר חלק'}</div></div>
        {headline != null ? <Price className="price" v={headline} /> : <span><Price className="price" v={q.laborOnly} /><span className="plus-part">+ חלק</span></span>}<span className="chev">‹</span>
      </button>
    );
  }

  const toggleAddon = (id) => setAddonIds((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const setOverride = async (key, val, legacy = []) => {
    const po = { ...(cfg.priceOverrides || {}) };
    for (const k of legacy) if (k !== key) delete po[k];
    if (val === '' || val == null) delete po[key]; else po[key] = Number(val);
    await onSaveConfig({ ...cfg, priceOverrides: po });
    toast(val === '' ? 'המחיר הידני הוסר' : 'נשמר מחיר ידני');
  };

  return (
    <div className="card quote">
      <div className="quote-head">
        <span className="lbl">{q.label}</span>
        {best && <Fresh f={freshness(best.part.updatedAt, cfg)} short />}
      </div>
      {q.options.length === 0 && (
        <>
          <div className="big"><span className="num">{fmt(q.laborOnly)}</span><span className="plus-part">+ מחיר החלק</span></div>
          {!customer && <div className="warn">עבודה בלבד. אין מחיר חלק במחירון, יש לברר מול הספק.</div>}
        </>
      )}
      {q.options.map((o, i) => (
        <div key={o.quality} className={'opt' + (i === 0 ? ' best' : '')}>
          <div className="q">{o.quality}
            {!customer && showInternal && <span className="sub">חלק {fmt(o.part.price)} · {sup[o.part.supplierId]?.name || o.part.supplierId}{o.overridden ? ' · מחיר ידני' : ''}</span>}
          </div>
          <span className={'dot ' + freshness(o.part.updatedAt, cfg).level} />
          <span className="p num">{o.final == null ? '—' : fmt(o.final)}</span>
        </div>
      ))}
      {q.options.length > 0 && !q.labor && <div className="warn">לא מוגדרת עלות עבודה לדגם הזה, ולכן אין מחיר סופי.</div>}

      {applicable.length > 0 && (
        <div className="chips">
          {applicable.map((a) => (
            <button key={a.id} className={'chip' + (addonIds.includes(a.id) ? ' on' : '')} onClick={() => toggleAddon(a.id)}>
              {addonIds.includes(a.id) ? '✓ ' : '+ '}{a.label} {!customer && <span className="num">({fmt(a.amount)})</span>}{a.manager ? ' *' : ''}
            </button>
          ))}
        </div>
      )}
      {applicable.some((a) => a.manager) && <div className="muted" style={{ marginTop: 6 }}>* באישור מנהל סניף בלבד</div>}

      {!customer && showInternal && (
        <div className="internal">
          <div>עבודה: <b className="num">{q.labor ? fmt(q.labor.amount) : 'לא מוגדר'}</b> {q.labor && <>· {q.labor.source}</>}</div>
          {q.addons.length > 0 && <div>תוספות: <b className="num">{fmt(q.addons.reduce((s, a) => s + a.amount, 0))}</b></div>}
          {q.options.map((o) => (
            <div key={o.quality} style={{ marginTop: 6 }}>
              <div><b>{o.quality}</b> · רווח <b className="num">{fmt(o.profit)}</b>{o.profit != null && <> · אחרי מע"מ <span className="num">{fmt(afterVat(o.profit, cfg))}</span></>}</div>
              {o.suppliers.map((p, j) => (
                <div className="sup-row" key={j}>
                  <span>{j === 0 ? '★ ' : ''}{sup[p.supplierId]?.name || p.supplierId} · {daysLabel(freshness(p.updatedAt, cfg).days)}{p.prevPrice != null ? ` · קודם ${fmt(p.prevPrice)}` : ''}</span>
                  <span><span className="num">{fmt(p.price)}</span>{onEditItem && <button className="disc" style={{ margin: '0 6px 0 0' }} onClick={() => onEditItem({ supplierId: p.supplierId, key: p.key })}>ערוך</button>}</span>
                </div>
              ))}
              {isAdmin && (
                <div className="sup-row" style={{ marginTop: 4, alignItems: 'center' }}>
                  <span>מחיר ידני ללקוח</span>
                  <input className="input sm num" inputMode="numeric" defaultValue={o.overridden ? o.final : ''} placeholder="אוטומטי"
                    onBlur={(e) => e.target.value !== String(o.overridden ? o.final : '') && setOverride(o.overrideKey, e.target.value, o.legacyKeys)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && <PriceEditor model={model} repair={q.repair} cfg={cfg} lists={lists} catalog={catalog} onSaveImport={onSaveImport} toast={toast} onDone={() => setEditing(false)} />}
      <div className="actions">
        {canEdit && !editing && <button className="btn primary" onClick={() => setEditing(true)}>{Icon.plus}<span>עדכן מחיר</span></button>}
        <a className="btn green" href={waLink('', quoteText())} target="_blank" rel="noreferrer">{Icon.wa}<span>שלח ללקוח</span></a>
        <button className="btn" onClick={async () => toast((await copyText(quoteText())) ? 'ההצעה הועתקה' : 'לא ניתן להעתיק במכשיר הזה')}>{Icon.copy}<span>העתק</span></button>
        {onRequest && <RequestBtn cfg={cfg} what={`${model.model} – ${q.label}`} onRequest={onRequest} />}
        {!customer && !best && (
          <a className="btn" href={waLink('', `היי, כמה עולה ויש במלאי ${q.label} ל-${model.model}?`)} target="_blank" rel="noreferrer">{Icon.box}<span>בקש מחיר מספק</span></a>
        )}
        {!customer && best && (() => {
          const s = sup[best.part.supplierId];
          const txt = `היי, יש במלאי ${q.label} ${best.quality} ל-${model.model}?`;
          return s?.phone
            ? <a className="btn" href={waLink(s.phone, txt)} target="_blank" rel="noreferrer">{Icon.box}<span>בדוק מלאי</span></a>
            : <a className="btn" href={waLink('', txt)} target="_blank" rel="noreferrer">{Icon.box}<span>בדוק מלאי</span></a>;
        })()}
      </div>
      {!customer && <button className="disc" onClick={() => setShowInternal((v) => !v)}>{showInternal ? 'הסתר פירוט פנימי' : 'הצג פירוט פנימי'}</button>}
    </div>
  );
}

function Devices({ model, storage, catalog, cfg, sup, customer, isAdmin, onSaveConfig, toast, onEditItem, onRequest }) {
  const [showInternal, setShowInternal] = useState(false);
  const all = getDeviceQuotes(model, catalog, cfg);
  const atStorage = storage && all.some((d) => d.row.storage === storage) ? all.filter((d) => d.row.storage === storage) : all;
  const list = atStorage.filter((d) => d.final != null || d.best);
  const noPrice = atStorage.filter((d) => d.final == null && !d.best);
  if (!list.length) return <div className="card empty">אין עדיין מחיר מספק לדגם הזה.</div>;
  const noMargin = list.filter((d) => d.final == null);
  const label = (d) => [fmtStorage(d.row.storage), d.row.version].filter(Boolean).join(' · ') || model.model;
  const textFor = (d) => `${model.model} ${label(d)}: ${fmt(d.final)}`;
  const saveKey = async (field, key, val, msg) => {
    const obj = { ...(cfg[field] || {}) };
    if (val === '' || val == null) delete obj[key]; else obj[key] = Number(val);
    await onSaveConfig({ ...cfg, [field]: obj });
    toast(msg);
  };
  const setOverride = (key, val) => saveKey('priceOverrides', key, val, val === '' ? 'המחיר הידני הוסר' : 'נשמר מחיר ידני');
  // אחוז רווח לשורה (נפח + גרסה, אצל כל הספקים). ריק = לפי הסגמנט
  const setMargin = (key, val) => {
    const v = String(val).replace('%', '').trim();
    if (v !== '' && !(Number(v) >= 0)) { toast('אחוז רווח לא תקין'); return; }
    saveKey('marginOverrides', key, v, v === '' ? 'אחוז הרווח לפריט הוסר – לפי הסגמנט' : `נשמר: ${Number(v)}% רווח לפריט`);
  };
  const howText = (d) => (d.overridden ? 'מחיר ידני' : [
    d.rule?.pct != null ? `${d.rule.pct}%${d.rule.source === 'item' ? ' לפריט' : ''}` : null,
    { min: 'מינימום', max: 'מקסימום', fixed: 'סכום קבוע' }[d.limit],
  ].filter(Boolean).join(', '));
  const profitText = (d) => (d.profit == null ? '' : ` · רווח ${fmt(d.profit)}${howText(d) ? ` (${howText(d)})` : ''} · אחרי מע"מ ${fmt(afterVat(d.profit, cfg))}`);
  return (
    <div className="card quote">
      {list.map((d) => {
        const f = freshness(d.best?.updatedAt, cfg);
        const s = d.best ? sup[d.best.supplierId] : null;
        return (
          <div key={d.row.id || label(d)} className="opt" style={{ flexWrap: 'wrap' }}>
            <div className="q">{label(d)}
              {!customer && showInternal && d.best && <span className="sub">עלות {fmt(d.best.price)} · {s?.name || d.best.supplierId}{profitText(d)} · {daysLabel(f.days)}{d.best.prevPrice != null ? ` · קודם ${fmt(d.best.prevPrice)}` : ''}</span>}
            </div>
            <span className={'dot ' + f.level} />
            <span className="p num">{d.final == null ? '—' : fmt(d.final)}</span>
            {!customer && showInternal && (
              <div style={{ width: '100%', display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {d.suppliers.length > 1 && <span className="muted">גם אצל: {d.suppliers.slice(1).map((x) => `${sup[x.supplierId]?.name || x.supplierId} ${fmt(x.price)}`).join(' · ')}</span>}
                {d.best && <a className="btn" style={{ height: 32 }} href={waLink(s?.phone || '', `היי, יש במלאי ${model.model} ${label(d)}?`)} target="_blank" rel="noreferrer">{Icon.box}<span>בדוק מלאי</span></a>}
                {d.final != null && <a className="btn" style={{ height: 32 }} href={waLink('', textFor(d))} target="_blank" rel="noreferrer">{Icon.wa}<span>שלח</span></a>}
                {onEditItem && d.row.id && <button className="btn" style={{ height: 32 }} onClick={() => onEditItem({ row: d.row.id })}>ערוך</button>}
              </div>
            )}
            {!customer && showInternal && isAdmin && d.row.id && (
              <div className="dev-admin">
                <label>מחיר ידני <input className="input sm num" inputMode="numeric" defaultValue={d.overridden ? d.final : ''} placeholder="אוטומטי"
                  onBlur={(e) => e.target.value !== String(d.overridden ? d.final : '') && setOverride(d.key, e.target.value)} /></label>
                <label>רווח לפריט <input className="input sm num" inputMode="decimal" defaultValue={d.rule?.source === 'item' ? d.rule.pct : ''}
                  placeholder={cfg.margins?.[d.row.segment] ?? ''}
                  onBlur={(e) => e.target.value !== String(d.rule?.source === 'item' ? d.rule.pct : '') && setMargin(d.key, e.target.value)} /> %</label>
              </div>
            )}
          </div>
        );
      })}
      {noMargin.length > 0 && !customer && <div className="warn">לא הוגדר רווח לסגמנט "{segmentLabel(noMargin[0].row.segment) || 'ללא סגמנט'}". אפשר להגדיר בהגדרות ← רווח מכשירים.</div>}
      {!customer && showInternal && noPrice.length > 0 && <div className="muted" style={{ marginTop: 8 }}>אין מחיר מספק: {noPrice.map(label).join(', ')}</div>}
      {!customer && <button className="disc" onClick={() => setShowInternal((v) => !v)}>{showInternal ? 'הסתר פירוט פנימי' : 'הצג פירוט פנימי'}</button>}
      {onRequest && <div className="actions"><RequestBtn cfg={cfg} what={`${model.model} – מכשיר למכירה`} onRequest={onRequest} /></div>}
    </div>
  );
}

// עובד בלי הרשאה: בקשת פירוט – נרשמת במערכת ונשלחת למנהל בוואטסאפ
function RequestBtn({ cfg, what, onRequest }) {
  const text = `בקשה לפירוט פנימי (עלות חלק): ${what}`;
  return (
    <a className="btn" href={waLink(cfg.adminPhone || '', text)} target="_blank" rel="noreferrer" onClick={() => onRequest(what)}>
      {Icon.eye}<span>בקש פירוט</span>
    </a>
  );
}

// מנהל: הזנת מחירי חלק לדגם ולסוג תיקון – בוחרים ספק, ולכל איכות (ומסגרת) מחיר.
// אפשר גם להדביק את התשובה של הספק כמו שהיא ("אינסל 150, אולד 250, מקורי סרוויס 1170")
function PriceEditor({ model, repair, cfg, lists, catalog, onSaveImport, toast, onDone }) {
  const partSups = (cfg.suppliers || []).filter((s) => s.type === 'parts');
  const qualities = qualitiesFor(repair, cfg);
  const label = allRepairs(cfg).find((r) => r.id === repair)?.label || repair;
  const [sid, setSid] = useState(partSups[0]?.id || '__new');
  const [newSup, setNewSup] = useState({ name: '', phone: '' });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = (id) => (lists?.[id]?.items || []).filter((it) => it.kind === 'part' && it.mkey === model.mkey
    && (catalog.parts || []).some((p) => p.supplierId === id && p.key === it.key && p.partType === repair));
  const rowsOf = (id) => mine(id).map((it) => {
    const r = partQuality({ ...it, supplierId: id, partType: repair }, cfg);
    return { key: it.key, qid: r.qid || (r.note ? '?' : ''), frame: r.frame || '', price: String(it.price), note: r.note, prev: it };
  });
  const [rows, setRows] = useState(() => rowsOf(sid));
  const pick = (id) => { setSid(id); setRows(id === '__new' ? [] : rowsOf(id)); };
  const blank = () => ({ key: null, qid: qualities[0]?.id || '', frame: '', price: '', note: '', prev: null });
  const shown = rows.length ? rows : [blank()];
  const set = (i, patch) => setRows(shown.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const fromReply = () => {
    const found = parseReply(reply, repair, cfg, { extractPrice, splitMulti });
    if (!found.length) { toast('לא נמצאו מחירים בטקסט'); return; }
    const next = rows.filter((r) => r.price !== '' || r.key);
    for (const f of found) {
      const qid = f.qid || (f.note ? '?' : '');
      const at = next.findIndex((r) => r.qid === qid && (r.frame || '') === (f.frame || '') && (qid !== '?' || r.note === f.note));
      const row = { qid, frame: f.frame || '', price: String(f.price), note: f.note };
      if (at >= 0) next[at] = { ...next[at], ...row }; else next.push({ key: null, prev: null, ...row });
    }
    setRows(next);
    setReply('');
    const unknown = found.filter((f) => !f.qid).length;
    toast(`נמצאו ${found.length} מחירים${unknown ? ` · ${unknown} בלי איכות מוכרת – בחר איכות` : ''}`);
  };

  const save = async () => {
    const isNew = sid === '__new';
    if (isNew && !newSup.name.trim()) { toast('חסר שם ספק'); return; }
    const filled = shown.filter((r) => String(r.price).trim() !== '');
    if (filled.some((r) => !(Number(r.price) > 0))) { toast('מחיר לא תקין'); return; }
    if (filled.some((r) => r.qid === '?' && !r.prev)) { toast('בחר איכות לכל שורה'); return; }
    const seen = new Set();
    for (const r of filled) { const k = `${r.qid}|${r.frame}|${r.qid === '?' ? r.note : ''}`; if (seen.has(k)) { toast('אותה איכות מופיעה פעמיים'); return; } seen.add(k); }
    const id = isNew ? 's' + Date.now().toString(36) : sid;
    const supplier = isNew ? { id, name: newSup.name.trim(), type: 'parts', phone: newSup.phone.trim() } : partSups.find((s) => s.id === sid);
    const now = Date.now();
    const old = isNew ? [] : (lists?.[id]?.items || []);
    const replaced = new Set(isNew ? [] : mine(id).map((it) => it.key)); // כל מה שהיה לספק לתיקון הזה בדגם – מוחלף במה שבטופס
    const made = filled.map((r) => manualPart({
      model, repair, qid: r.qid === '?' ? '' : r.qid, frame: r.frame || null, price: Number(r.price), cfg, now,
      variant: r.qid === '?' ? r.prev?.variant ?? r.note : null, prev: r.prev,
    }));
    const keep = old.filter((it) => !replaced.has(it.key));
    const keys = new Set(keep.map((it) => it.key));
    for (const it of made) { let k = it.key, n = 1; while (keys.has(k)) k = `${it.key}#${++n}`; it.key = k; keys.add(k); }
    setBusy(true);
    try {
      await onSaveImport({
        lists: { [id]: { items: [...keep, ...made], supplierName: supplier.name, updatedAt: lists?.[id]?.updatedAt || now } },
        config: isNew ? { ...cfg, suppliers: [...(cfg.suppliers || []), supplier] } : null,
      });
      toast(`נשמר: ${label} ל-${model.model} אצל ${supplier.name}`);
      onDone();
    } catch (e) { toast('השמירה נכשלה: ' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="pe">
      <div className="t1" style={{ fontWeight: 700 }}>עדכון מחיר חלק · {label}</div>
      <label className="field"><span>ספק</span>
        <select className="input" value={sid} onChange={(e) => pick(e.target.value)}>
          {partSups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="__new">+ ספק חדש</option>
        </select></label>
      {sid === '__new' && (
        <div className="pe-new">
          <input className="input" placeholder="שם הספק" value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} />
          <input className="input" placeholder="וואטסאפ (לא חובה)" inputMode="tel" value={newSup.phone} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })} />
        </div>
      )}
      <label className="field"><span>תשובת הספק (לא חובה)</span>
        <textarea className="input" dir="auto" rows={2} placeholder="אינסל 150, אולד 250, מקורי סרוויס 1170" value={reply} onChange={(e) => setReply(e.target.value)} /></label>
      {reply.trim() && <button className="btn" onClick={fromReply}>מלא מהתשובה</button>}
      <div className="pe-rows">
        {shown.map((r, i) => (
          <div key={i} className="pe-row">
            <select className="input" aria-label="איכות" value={r.qid} onChange={(e) => set(i, { qid: e.target.value })}>
              {r.qid === '?' && <option value="?">{r.note || 'לא מוכר'} (כמו אצל הספק)</option>}
              {qualities.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              <option value="">סטנדרטי</option>
            </select>
            <select className="input" aria-label="מסגרת" value={r.frame} onChange={(e) => set(i, { frame: e.target.value })}>
              <option value="">מסגרת: לא צוין</option>
              <option value="with">{FRAME.with}</option>
              <option value="without">{FRAME.without}</option>
            </select>
            <input className="input num" aria-label="מחיר" inputMode="numeric" placeholder="₪" value={r.price} onChange={(e) => set(i, { price: e.target.value.replace(/[^\d.]/g, '') })} />
            <button className="icon-btn" aria-label="הסר" onClick={() => setRows(shown.filter((_, j) => j !== i))}>{Icon.trash}</button>
          </div>
        ))}
      </div>
      <button className="disc" style={{ margin: '4px 0' }} onClick={() => setRows([...shown, blank()])}>+ עוד איכות</button>
      <div className="actions">
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'שומר…' : 'שמור'}</button>
        <button className="btn" onClick={onDone}>ביטול</button>
      </div>
    </div>
  );
}
