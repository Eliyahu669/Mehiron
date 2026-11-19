import React, { useMemo, useState } from 'react';
import { REPAIRS, CATEGORY_LABELS } from '../lib/defaults.js';
import { repairQuote, deviceQuotes, freshness, categoryFor } from '../lib/pricing.js';
import { fmt, Price, Fresh, waLink, copyText, daysLabel, Icon } from './util.jsx';

export default function ModelSheet({ model, catalog, cfg, customer, isAdmin, initialRepair, onClose, onSaveConfig, toast }) {
  const hasRepairs = model.devKind === 'phone' || model.hasParts;
  const [tab, setTab] = useState(initialRepair || hasRepairs ? 'repairs' : 'devices');
  const sup = useMemo(() => Object.fromEntries((cfg.suppliers || []).map((s) => [s.id, s])), [cfg.suppliers]);

  const order = initialRepair ? [initialRepair, ...REPAIRS.map((r) => r.id).filter((r) => r !== initialRepair)] : REPAIRS.map((r) => r.id);
  const quotes = order.map((r) => repairQuote(model, r, catalog.parts, cfg));
  const shown = quotes.filter((q) => q.options.length || q.labor);
  const missing = quotes.filter((q) => !q.options.length && !q.labor);

  return (
    <>
      <div className="sheet-bg" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={model.model}>
        <div className="sheet-inner">
          <div className="sheet-head">
            <button className="back" onClick={onClose}>‹ חזרה</button>
          </div>
          <h2 style={{ margin: '4px 4px 2px', fontSize: 30, letterSpacing: '-0.02em' }}>{model.model}</h2>
          <div className="muted" style={{ margin: '0 4px 8px' }}>{model.brand || ''}</div>
          {hasRepairs && model.hasDevices && (
            <div className="seg">
              <button className={tab === 'repairs' ? 'on' : ''} onClick={() => setTab('repairs')}>תיקונים</button>
              <button className={tab === 'devices' ? 'on' : ''} onClick={() => setTab('devices')}>מכשיר למכירה</button>
            </div>
          )}
          {tab === 'repairs' && (
            <>
              {shown.map((q, i) => (
                <QuoteCard key={q.repair} q={q} model={model} cfg={cfg} sup={sup} customer={customer} isAdmin={isAdmin}
                  catalogParts={catalog.parts} defaultOpen={i === 0 || !!initialRepair && q.repair === initialRepair} onSaveConfig={onSaveConfig} toast={toast} />
              ))}
              {!shown.length && <div className="card empty">אין עדיין מחיר עבודה או חלק לדגם הזה.{isAdmin && <><br />אפשר להגדיר עלות עבודה לסדרה או לדגם בהגדרות.</>}</div>}
              {!customer && missing.length > 0 && shown.length > 0 && (
                <div className="muted" style={{ margin: '4px 6px' }}>לא מוגדר לדגם הזה: {missing.map((m) => m.label).join(', ')}</div>
              )}
            </>
          )}
          {tab === 'devices' && <Devices model={model} catalog={catalog} cfg={cfg} sup={sup} customer={customer} isAdmin={isAdmin} onSaveConfig={onSaveConfig} toast={toast} />}
        </div>
      </div>
    </>
  );
}

function QuoteCard({ q: q0, model, cfg, sup, customer, isAdmin, catalogParts, defaultOpen, onSaveConfig, toast }) {
  const [open, setOpen] = useState(defaultOpen);
  const [addonIds, setAddonIds] = useState([]);
  const [showInternal, setShowInternal] = useState(false);
  const applicable = (cfg.addons || []).filter((a) => (!a.repairs || a.repairs.includes(q0.repair)) && (!a.families || a.families.includes(model.family)));
  const q = addonIds.length ? repairQuote(model, q0.repair, catalogParts, cfg, addonIds) : q0;
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
  const setOverride = async (key, val) => {
    const po = { ...(cfg.priceOverrides || {}) };
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
              <div><b>{o.quality}</b> · רווח <b className="num">{fmt(o.profit)}</b></div>
              {o.suppliers.map((p, j) => (
                <div className="sup-row" key={j}>
                  <span>{j === 0 ? '★ ' : ''}{sup[p.supplierId]?.name || p.supplierId} · {daysLabel(freshness(p.updatedAt, cfg).days)}{p.prevPrice != null ? ` · קודם ${fmt(p.prevPrice)}` : ''}</span>
                  <span className="num">{fmt(p.price)}</span>
                </div>
              ))}
              {isAdmin && (
                <div className="sup-row" style={{ marginTop: 4, alignItems: 'center' }}>
                  <span>מחיר ידני ללקוח</span>
                  <input className="input sm num" inputMode="numeric" defaultValue={o.overridden ? o.final : ''} placeholder="אוטומטי"
                    onBlur={(e) => e.target.value !== String(o.overridden ? o.final : '') && setOverride(o.overrideKey, e.target.value)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="actions">
        <a className="btn green" href={waLink('', quoteText())} target="_blank" rel="noreferrer">{Icon.wa}<span>שלח ללקוח</span></a>
        <button className="btn" onClick={async () => toast((await copyText(quoteText())) ? 'ההצעה הועתקה' : 'לא ניתן להעתיק במכשיר הזה')}>{Icon.copy}<span>העתק</span></button>
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

function Devices({ model, catalog, cfg, sup, customer, isAdmin, onSaveConfig, toast }) {
  const [showInternal, setShowInternal] = useState(false);
  const list = deviceQuotes(model, catalog.devices, cfg);
  if (!list.length) return <div className="card empty">אין מכשיר כזה במחירוני הספקים.</div>;
  const noMargin = list.some((d) => d.margin == null && !d.overridden);
  const textFor = (d) => `${d.item.name}${d.item.variant ? ' (' + d.item.variant + ')' : ''}: ${fmt(d.final)}`;
  const setOverride = async (key, val) => {
    const po = { ...(cfg.priceOverrides || {}) };
    if (val === '' || val == null) delete po[key]; else po[key] = Number(val);
    await onSaveConfig({ ...cfg, priceOverrides: po });
    toast(val === '' ? 'המחיר הידני הוסר' : 'נשמר מחיר ידני');
  };
  return (
    <div className="card quote">
      {list.map((d, i) => {
        const f = freshness(d.item.updatedAt, cfg);
        const s = sup[d.item.supplierId];
        return (
          <div key={i} className="opt" style={{ flexWrap: 'wrap' }}>
            <div className="q">{d.item.name}<span className="sub">{d.item.variant}</span>
              {!customer && showInternal && <span className="sub">עלות {fmt(d.item.price)} · {s?.name || d.item.supplierId}{d.margin != null ? ` · רווח ${d.margin}%` : ''} · {daysLabel(f.days)}{d.item.prevPrice != null ? ` · קודם ${fmt(d.item.prevPrice)}` : ''}{d.overridden ? ' · מחיר ידני' : ''}</span>}
            </div>
            <span className={'dot ' + f.level} />
            <span className="p num">{fmt(d.final)}</span>
            {!customer && showInternal && (
              <div style={{ width: '100%', display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {d.suppliers.length > 1 && <span className="muted">גם אצל: {d.suppliers.slice(1).map((x) => `${sup[x.supplierId]?.name || x.supplierId} ${fmt(x.price)}`).join(' · ')}</span>}
                <a className="btn" style={{ height: 32 }} href={waLink(s?.phone || '', `היי, יש במלאי ${d.item.name} ${d.item.variant || ''}?`)} target="_blank" rel="noreferrer">{Icon.box}<span>בדוק מלאי</span></a>
                <a className="btn" style={{ height: 32 }} href={waLink('', textFor(d))} target="_blank" rel="noreferrer">{Icon.wa}<span>שלח</span></a>
                {isAdmin && <input className="input sm num" inputMode="numeric" defaultValue={d.overridden ? d.final : ''} placeholder="ידני"
                  onBlur={(e) => e.target.value !== String(d.overridden ? d.final : '') && setOverride(d.overrideKey, e.target.value)} />}
              </div>
            )}
          </div>
        );
      })}
      {noMargin && !customer && <div className="warn">לא הוגדר אחוז רווח לקטגוריה "{CATEGORY_LABELS[categoryFor(list[0].item, cfg)]}". אפשר להגדיר בהגדרות.</div>}
      {!customer && <button className="disc" onClick={() => setShowInternal((v) => !v)}>{showInternal ? 'הסתר פירוט פנימי' : 'הצג פירוט פנימי'}</button>}
    </div>
  );
}
