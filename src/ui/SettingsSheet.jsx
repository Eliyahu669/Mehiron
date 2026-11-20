import React, { useEffect, useState } from 'react';
import { REPAIRS, LABOR_GROUPS, CATEGORY_LABELS } from '../lib/defaults.js';
import { fmt, Icon } from './util.jsx';
import ItemsManager from './ItemsManager.jsx';
import { useBack } from './useBack.js';

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

export default function SettingsSheet({ cfg, catalog, lists, store, focus, initialTab, requests = [], onClose, onSaveConfig, toast }) {
  const [d, setD] = useState(() => JSON.parse(JSON.stringify(cfg)));
  const [tab, setTab] = useState(initialTab || (focus ? 'items' : 'labor'));
  const [busy, setBusy] = useState(false);
  const set = (fn) => setD((x) => { const y = JSON.parse(JSON.stringify(x)); fn(y); return y; });

  const save = async () => {
    setBusy(true);
    try { await onSaveConfig(d); toast('ההגדרות נשמרו ועודכנו בכל הסניפים'); onClose(); }
    catch (e) { toast('השמירה נכשלה: ' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  const tabs = [['items', 'פריטים'], ['labor', 'עלות עבודה'], ['rules', 'חריגים'], ['margins', 'רווח מכשירים'], ['addons', 'תוספות'], ['suppliers', 'ספקים'], ['general', 'כללי'], ['users', requests.length ? `עובדים (${requests.length})` : 'עובדים']];

  return (
    <>
      <div className="sheet-bg" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="הגדרות">
        <div className="sheet-inner">
          <div className="sheet-head"><button className="back" onClick={onClose}>‹ ביטול</button><h2>הגדרות</h2>
            {tab !== 'items' && tab !== 'users' && <button className="pill-btn" disabled={busy} onClick={save}>שמור</button>}</div>
          <div className="pills" style={{ paddingTop: 4 }}>
            {tabs.map(([k, l]) => <button key={k} className={'pill' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
          </div>

          {tab === 'labor' && (
            <>
              <div className="muted" style={{ margin: '8px 4px' }}>עלות עבודה ללא חלק, לפי עמודות המחירון ({d.laborUpdated}). שדה ריק = לא מוגדר.</div>
              <div className="card scroll-x" style={{ padding: 8 }}>
                <table className="grid-table">
                  <thead><tr><th>סדרה</th>{REPAIRS.map((r) => <th key={r.id}>{r.label}</th>)}</tr></thead>
                  <tbody>
                    {LABOR_GROUPS.map((g) => (
                      <tr key={g.id}><td>{g.label}</td>
                        {REPAIRS.map((r) => (
                          <td key={r.id}><input className="input sm num" inputMode="numeric" value={d.labor[g.id]?.[r.id] ?? ''}
                            onChange={(e) => set((y) => { y.labor[g.id] = y.labor[g.id] || {}; y.labor[g.id][r.id] = numOrNull(e.target.value); })} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'rules' && <Rules d={d} set={set} catalog={catalog} />}

          {tab === 'margins' && (
            <div className="card" style={{ padding: 14 }}>
              <div className="muted">אחוז רווח על מחיר הספק למכשירים למכירה. ריק = לא מוצג מחיר ללקוח.</div>
              {Object.keys(CATEGORY_LABELS).map((k) => (
                <label key={k} className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1, margin: 0, fontSize: 15, color: 'var(--text)' }}>{CATEGORY_LABELS[k]}</span>
                  <input className="input sm num" inputMode="decimal" value={d.margins[k] ?? ''} onChange={(e) => set((y) => { y.margins[k] = numOrNull(e.target.value); })} /> %
                </label>
              ))}
              <div className="muted">דגל: כל האייפונים, Galaxy S, Galaxy Z, Note, אייפד, Galaxy Tab S ו-AirTag. ביניים: שאר הטלפונים והטאבלטים. אפשר לשנות קטגוריה לסדרה או לדגם בלשונית "חריגים".</div>
            </div>
          )}

          {tab === 'addons' && (
            <div className="card list">
              {d.addons.map((a, i) => (
                <div key={a.id} className="row">
                  <div className="main"><div className="t1" style={{ fontSize: 15 }}>{a.label}</div>
                    <div className="t2">{a.repairs ? REPAIRS.filter((r) => a.repairs.includes(r.id)).map((r) => r.label).join(', ') : 'כל התיקונים'}{a.manager ? ' · באישור מנהל סניף' : ''}</div></div>
                  <input className="input sm num" inputMode="numeric" value={a.amount ?? ''} onChange={(e) => set((y) => { y.addons[i].amount = numOrNull(e.target.value); })} />
                </div>
              ))}
            </div>
          )}

          {tab === 'suppliers' && (
            <>
              <div className="card list">
                {d.suppliers.map((s, i) => (
                  <div key={s.id} className="row" style={{ flexWrap: 'wrap' }}>
                    <input className="input" style={{ flex: '1 1 160px' }} value={s.name} onChange={(e) => set((y) => { y.suppliers[i].name = e.target.value; })} />
                    <select className="input" style={{ width: 120 }} value={s.type} onChange={(e) => set((y) => { y.suppliers[i].type = e.target.value; })}>
                      <option value="parts">חלקים</option><option value="devices">מכשירים</option>
                    </select>
                    <input className="input" style={{ flex: '1 1 140px' }} inputMode="tel" placeholder="וואטסאפ 05X…" value={s.phone || ''} onChange={(e) => set((y) => { y.suppliers[i].phone = e.target.value; })} />
                    <button className="icon-btn" onClick={() => set((y) => { y.suppliers.splice(i, 1); })}>{Icon.trash}</button>
                  </div>
                ))}
              </div>
              <div className="actions"><button className="btn" onClick={() => set((y) => { y.suppliers.push({ id: 's' + Date.now().toString(36), name: 'ספק חדש', type: 'parts', phone: '' }); })}>{Icon.plus}<span>הוסף ספק</span></button></div>
              <div className="muted" style={{ margin: 6 }}>מספר הטלפון משמש לכפתור "בדוק מלאי", שפותח צ'אט וואטסאפ עם הודעה מוכנה.</div>
            </>
          )}

          {tab === 'general' && (
            <div className="card" style={{ padding: 14 }}>
              <label className="field"><span>עיגול מחיר ללקוח</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input sm num" inputMode="numeric" value={d.rounding.step} onChange={(e) => set((y) => { y.rounding.step = Number(e.target.value) || 1; })} />
                  <select className="input" value={d.rounding.mode} onChange={(e) => set((y) => { y.rounding.mode = e.target.value; })}>
                    <option value="ceil">כלפי מעלה</option><option value="round">לקרוב ביותר</option><option value="floor">כלפי מטה</option>
                  </select>
                </div>
              </label>
              <label className="field"><span>מספר וואטסאפ לבקשות פירוט מעובדים</span>
                <input className="input" inputMode="tel" dir="ltr" value={d.adminPhone || ''} onChange={(e) => set((y) => { y.adminPhone = e.target.value; })} /></label>
              <label className="field"><span>ירוק – מחיר עדכני עד (ימים)</span>
                <input className="input sm num" inputMode="numeric" value={d.freshness.green} onChange={(e) => set((y) => { y.freshness.green = Number(e.target.value) || 0; })} /></label>
              <label className="field"><span>כתום – עד (ימים). מעבר לזה אדום: דורש וידוא</span>
                <input className="input sm num" inputMode="numeric" value={d.freshness.orange} onChange={(e) => set((y) => { y.freshness.orange = Number(e.target.value) || 0; })} /></label>
              {Object.keys(d.priceOverrides || {}).length > 0 && (
                <>
                  <div className="section-title">מחירים ידניים ({Object.keys(d.priceOverrides).length})</div>
                  {Object.entries(d.priceOverrides).map(([k, v]) => (
                    <div key={k} className="sup-row" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                      <span style={{ fontSize: 13 }}>{k.split('|').filter(Boolean).slice(1).join(' · ')}</span>
                      <span><span className="num">{fmt(v)}</span> <button className="btn danger" style={{ height: 28 }} onClick={() => set((y) => { delete y.priceOverrides[k]; })}>הסר</button></span>
                    </div>
                  ))}
                </>
              )}
              {store.mode === 'local' && <button className="btn danger" style={{ marginTop: 12 }} onClick={() => { store.resetLocal(); onClose(); }}>איפוס נתוני התצוגה המקדימה</button>}
            </div>
          )}

          {tab === 'users' && <Users store={store} toast={toast} requests={requests} onClose={onClose} />}
          {tab === 'items' && <ItemsManager cfg={cfg} lists={lists} store={store} toast={toast} focus={focus} />}
        </div>
      </div>
    </>
  );
}

function Rules({ d, set, catalog }) {
  const [draft, setDraft] = useState(null);
  useBack(!!draft, () => setDraft(null));
  const names = [...new Set(catalog.models.filter((m) => m.devKind === 'phone').map((m) => m.model))].sort();
  return (
    <>
      <div className="muted" style={{ margin: '8px 4px' }}>
        חריג גובר על הטבלה: עלות עבודה אחרת, שיוך לעמודה, או קטגוריית רווח אחרת. <b>סדרה</b> = כל הדגמים שמתחילים בשם (למשל "iPhone 15" חל על 15, 15 Plus, 15 Pro…). <b>דגם</b> = רק הדגם המדויק. דגם קודם לסדרה.
      </div>
      <div className="card list">
        {d.laborRules.length === 0 && <div className="empty">אין חריגים</div>}
        {d.laborRules.map((r, i) => (
          <div key={r.id} className="row">
            <div className="main">
              <div className="t1" style={{ fontSize: 15 }}>{r.scope === 'model' ? 'דגם' : 'סדרה'}: {r.match}</div>
              <div className="t2">
                {r.group ? `משויך ל: ${LABOR_GROUPS.find((g) => g.id === r.group)?.label}` : ''}
                {Object.entries(r.labor || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => ` ${REPAIRS.find((x) => x.id === k)?.label} ${fmt(v)}`).join(' ·')}
                {r.category ? ` · רווח: ${CATEGORY_LABELS[r.category]}` : ''}
                {r.note ? ` · ${r.note}` : ''}
              </div>
            </div>
            <button className="btn" onClick={() => setDraft({ ...JSON.parse(JSON.stringify(r)), _i: i })}>עריכה</button>
          </div>
        ))}
      </div>
      {!draft && <div className="actions"><button className="btn primary" onClick={() => setDraft({ id: 'r' + Date.now().toString(36), scope: 'series', match: '', labor: {} })}>{Icon.plus}<span>חריג חדש</span></button></div>}
      {draft && (
        <div className="card" style={{ padding: 14, marginTop: 12 }}>
          <div className="seg">
            <button className={draft.scope === 'series' ? 'on' : ''} onClick={() => setDraft({ ...draft, scope: 'series' })}>סדרה</button>
            <button className={draft.scope === 'model' ? 'on' : ''} onClick={() => setDraft({ ...draft, scope: 'model' })}>דגם ספציפי</button>
          </div>
          <label className="field"><span>שם (כמו שמופיע באפליקציה)</span>
            <input className="input" list="model-names" dir="ltr" placeholder="iPhone 15 / Galaxy A54 / Galaxy Note" value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value })} />
            <datalist id="model-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label className="field"><span>שייך לעמודה בטבלה (לא חובה)</span>
            <select className="input" value={draft.group || ''} onChange={(e) => setDraft({ ...draft, group: e.target.value || undefined })}>
              <option value="">— ללא —</option>
              {LABOR_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </label>
          <label className="field"><span>קטגוריית רווח למכשירים למכירה (לא חובה)</span>
            <select className="input" value={draft.category || ''} onChange={(e) => setDraft({ ...draft, category: e.target.value || undefined })}>
              <option value="">— אוטומטי —</option>
              {Object.entries(CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <div className="muted">עלות עבודה ספציפית (ריק = לפי הטבלה):</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, marginTop: 8 }}>
            {REPAIRS.map((r) => (
              <label key={r.id} style={{ fontSize: 13, color: 'var(--text2)' }}>{r.label}
                <input className="input num" inputMode="numeric" value={draft.labor?.[r.id] ?? ''} onChange={(e) => setDraft({ ...draft, labor: { ...draft.labor, [r.id]: numOrNull(e.target.value) } })} />
              </label>
            ))}
          </div>
          <div className="actions">
            <button className="btn primary" disabled={!draft.match.trim()} onClick={() => {
              const { _i, ...r } = draft;
              set((y) => { if (_i != null) y.laborRules[_i] = r; else y.laborRules.push(r); });
              setDraft(null);
            }}>אישור</button>
            {draft._i != null && <button className="btn danger" onClick={() => { set((y) => { y.laborRules.splice(draft._i, 1); }); setDraft(null); }}>מחק</button>}
            <button className="btn" onClick={() => setDraft(null)}>ביטול</button>
          </div>
        </div>
      )}
    </>
  );
}

function Users({ store, toast, requests, onClose }) {
  const [list, setList] = useState(null);
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const load = () => store.listAllowed().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [requests.length]);
  const toggle = async (u) => {
    await store.setShowCost(u.email, !u.showCost);
    toast(!u.showCost ? `פירוט פנימי הופעל ל-${u.label || u.email}` : `פירוט פנימי כובה ל-${u.label || u.email}`);
    load();
  };
  return (
    <>
      {requests.length > 0 && (
        <>
          <div className="section-title">בקשות פירוט פתוחות</div>
          <div className="card list">
            {requests.map((r) => (
              <div key={r.id} className="row" style={{ flexWrap: 'wrap' }}>
                <div className="main"><div className="t1" style={{ fontSize: 15 }}>{r.what}</div>
                  <div className="t2" dir="auto">{r.email} · {new Date(r.at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</div></div>
                <div className="row-actions">
                  <button className="btn primary" onClick={async () => { await store.resolveRequest(r.id, true, r.email); toast('אושר: הפירוט הפנימי הופעל לעובד'); load(); }}>אשר</button>
                  <button className="btn" onClick={() => store.resolveRequest(r.id, false, r.email)}>דחה</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="section-title">עובדים מורשים</div>
      <div className="muted" style={{ margin: '0 4px 8px' }}>חשבונות גוגל של הטלפונים בסניפים. כברירת מחדל עובד רואה רק מחיר סופי. "פירוט פנימי" חושף לו גם עלות, ספק ורווח, ואפשר לכבות את זה בכל רגע.</div>
      <div className="card list">
        {list == null && <div className="empty">טוען…</div>}
        {list?.length === 0 && <div className="empty">עדיין אין עובדים</div>}
        {list?.map((u) => (
          <div key={u.email} className="row" style={{ flexWrap: 'wrap' }}>
            <div className="main"><div className="t1" style={{ fontSize: 15 }}>{u.label || u.email}</div>{u.label && <div className="t2" dir="ltr" style={{ textAlign: 'right' }}>{u.email}</div>}</div>
            <label className="switch-row">
              <span className="muted">פירוט פנימי</span>
              <button className={'switch' + (u.showCost ? ' on' : '')} role="switch" aria-checked={!!u.showCost} onClick={() => toggle(u)}><span /></button>
            </label>
            <div className="row-actions" style={{ width: '100%', justifyContent: 'flex-end' }}>
              {store.mode === 'local' && <button className="btn" onClick={() => { store.previewAs(u.email); onClose(); }}>צפה כמו העובד</button>}
              <button className="btn danger" onClick={async () => { await store.removeAllowed(u.email); load(); }}>הסר</button>
            </div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 12, marginTop: 12, display: 'grid', gap: 8 }}>
        <input className="input" dir="ltr" type="email" placeholder="branch@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" placeholder="שם (למשל: סניף כפר סבא)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn primary" disabled={!/.+@.+\..+/.test(email)} onClick={async () => { await store.addAllowed(email, label); setEmail(''); setLabel(''); toast('העובד נוסף'); load(); }}>{Icon.plus}<span>הוסף עובד</span></button>
      </div>
    </>
  );
}
