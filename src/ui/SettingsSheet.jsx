import React, { useEffect, useRef, useState } from 'react';
import { REPAIRS, LABOR_GROUPS } from '../lib/defaults.js';
import { allRepairs, repairLabel, qualitiesFor, qualityLabel, FRAME, DEFAULT_QUALITIES } from '../lib/repairs.js';
import { SEGMENTS, rowLabel } from '../lib/devices.js';
import { fmt, Icon } from './util.jsx';
import ItemsManager from './ItemsManager.jsx';
import { useBack } from './useBack.js';

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

export default function SettingsSheet({ cfg, catalog, lists, store, focus, initialTab, requests = [], onClose, onSaveConfig, toast }) {
  const [d, setD] = useState(() => JSON.parse(JSON.stringify(cfg)));
  const [tab, setTab] = useState(initialTab || (focus ? 'items' : 'labor'));
  const [status, setStatus] = useState(''); // '' | 'pending' | 'saving' | 'saved' | 'error'
  const dirty = useRef(false);
  const latest = useRef(d);
  latest.current = d;
  const set = (fn) => { dirty.current = true; setStatus('pending'); setD((x) => { const y = JSON.parse(JSON.stringify(x)); fn(y); return y; }); };

  // שמירה אוטומטית (כמו בהגדרות של אייפון): שנייה אחרי השינוי האחרון, ומיד כשיוצאים
  const flush = async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setStatus('saving');
    try { await onSaveConfig(latest.current); setStatus('saved'); }
    catch (e) { dirty.current = true; setStatus('error'); toast('השמירה נכשלה: ' + (e?.message || e)); }
  };
  useEffect(() => {
    if (!dirty.current) return undefined;
    const t = setTimeout(flush, 900);
    return () => clearTimeout(t);
  }, [d]);
  useEffect(() => () => { if (dirty.current) { dirty.current = false; onSaveConfig(latest.current).catch(() => toast('שמירת ההגדרות נכשלה')); } }, []);

  const tabs = [['items', 'פריטים'], ['labor', 'עלות עבודה'], ['rules', 'חריגים'], ['repairs', 'סוגי תיקון ואיכויות'], ['margins', 'רווח מכשירים'], ['addons', 'תוספות'], ['suppliers', 'ספקים'], ['general', 'כללי'], ['users', requests.length ? `עובדים (${requests.length})` : 'עובדים']];
  const reps = allRepairs(d);

  return (
    <>
      <div className="sheet-bg" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="הגדרות">
        <div className="sheet-inner">
          <div className="sheet-head"><button className="back" onClick={onClose}>‹ סגור</button><h2>הגדרות</h2>
            <span className={'save-state ' + status}>{status === 'saving' || status === 'pending' ? 'שומר…' : status === 'saved' ? 'נשמר ✓' : status === 'error' ? 'השמירה נכשלה' : ''}</span></div>
          <div className="pills" style={{ paddingTop: 4 }}>
            {tabs.map(([k, l]) => <button key={k} className={'pill' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
          </div>

          {tab === 'labor' && (
            <>
              <div className="muted" style={{ margin: '8px 4px' }}>עלות עבודה ללא חלק, לפי עמודות המחירון ({d.laborUpdated}). שדה ריק = לא מוגדר.</div>
              <div className="card scroll-x" style={{ padding: 8 }}>
                <table className="grid-table">
                  <thead><tr><th>סדרה</th>{reps.map((r) => <th key={r.id}>{r.label}</th>)}</tr></thead>
                  <tbody>
                    {LABOR_GROUPS.map((g) => (
                      <tr key={g.id}><td>{g.label}</td>
                        {reps.map((r) => (
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
          {tab === 'repairs' && <RepairTypes d={d} set={set} />}

          {tab === 'margins' && (
            <div className="card" style={{ padding: 14 }}>
              <div className="muted">רווח על מחיר הספק לפי רמת הגימור / הסגמנט של המכשיר ברשימה: אחוז, ואפשר גם מינימום ומקסימום ברווח בשקלים (כולל מע"מ). שדה ריק = בלי הגבלה. בלי אחוז ועם מינימום = סכום קבוע. בלי אחוז ובלי סכום – לא מוצג מחיר ללקוח.</div>
              {SEGMENTS.map(({ id: k, label }) => (
                <div key={k} className="margin-row">
                  <div className="lbl">{label}</div>
                  <div className="margin-inputs">
                    <label>אחוז <input className="input sm num" inputMode="decimal" value={d.margins[k] ?? ''} onChange={(e) => set((y) => { y.margins[k] = numOrNull(e.target.value); })} /> %</label>
                    <label>מינימום <input className="input sm num" inputMode="numeric" value={d.marginMin?.[k] ?? ''} onChange={(e) => set((y) => { y.marginMin = { ...(y.marginMin || {}), [k]: numOrNull(e.target.value) }; })} /> ₪</label>
                    <label>מקסימום <input className="input sm num" inputMode="numeric" value={d.marginMax?.[k] ?? ''} onChange={(e) => set((y) => { y.marginMax = { ...(y.marginMax || {}), [k]: numOrNull(e.target.value) }; })} /> ₪</label>
                  </div>
                </div>
              ))}
              <div className="muted">הסגמנט של כל מכשיר נקבע ברשימת המכשירים (הגדרות ← פריטים, או העמודה "רמות גימור/סגמנטציה" באקסל). אחוז רווח לפריט מסוים קובעים במסך הדגם (פירוט פנימי) או בעמודה "אחוז רווח" באקסל, והוא מחליף את הכלל של הסגמנט.</div>
              {Object.keys(d.marginOverrides || {}).length > 0 && (
                <>
                  <div className="section-title">אחוזי רווח לפריטים ({Object.keys(d.marginOverrides).length})</div>
                  {Object.entries(d.marginOverrides).map(([k, v]) => (
                    <div key={k} className="sup-row" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                      <span style={{ fontSize: 13 }}>{keyLabel(k, catalog, d)}</span>
                      <span><span className="num">{v}%</span> <button className="btn danger" style={{ height: 28 }} onClick={() => set((y) => { delete y.marginOverrides[k]; })}>הסר</button></span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === 'addons' && (
            <div className="card list">
              {d.addons.map((a, i) => (
                <div key={a.id} className="row">
                  <div className="main"><div className="t1" style={{ fontSize: 15 }}>{a.label}</div>
                    <div className="t2">{a.repairs ? reps.filter((r) => a.repairs.includes(r.id)).map((r) => r.label).join(', ') : 'כל התיקונים'}{a.manager ? ' · באישור מנהל סניף' : ''}</div></div>
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
                    {s.type === 'parts' && (
                      <label className="field" style={{ width: '100%', margin: 0 }}><span>שורות בלי שם איכות אצל הספק הזה הן</span>
                        <select className="input" value={s.defaultQuality || ''} onChange={(e) => set((y) => { y.suppliers[i].defaultQuality = e.target.value; })}>
                          <option value="">לא ידוע ("סטנדרטי")</option>
                          {qualitiesFor('screen', d).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                        </select></label>
                    )}
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
              <label className="field"><span>מע"מ (%) – לחישוב "רווח אחרי מע"מ" בפירוט הפנימי</span>
                <input className="input sm num" inputMode="decimal" value={d.vat ?? ''} onChange={(e) => set((y) => { y.vat = numOrNull(e.target.value); })} /></label>
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
                      <span style={{ fontSize: 13 }}>{keyLabel(k, catalog, d)}</span>
                      <span><span className="num">{fmt(v)}</span> <button className="btn danger" style={{ height: 28 }} onClick={() => set((y) => { delete y.priceOverrides[k]; })}>הסר</button></span>
                    </div>
                  ))}
                </>
              )}
              {store.mode === 'local' && <button className="btn danger" style={{ marginTop: 12 }} onClick={() => { store.resetLocal(); onClose(); }}>איפוס נתוני התצוגה המקדימה</button>}
            </div>
          )}

          {tab === 'users' && <Users store={store} toast={toast} requests={requests} onClose={onClose} />}
          {tab === 'items' && <ItemsManager cfg={d} lists={lists} catalog={catalog} store={store} toast={toast} focus={focus}
            onConfigSaved={(c) => { dirty.current = false; setD(JSON.parse(JSON.stringify(c))); setStatus('saved'); }} />}
        </div>
      </div>
    </>
  );
}

// שם קריא למפתח של מחיר ידני / אחוז רווח: שורה ברשימת המכשירים או תיקון (דגם · תיקון · איכות)
function keyLabel(k, catalog, cfg) {
  if (k.startsWith('row:')) { const row = catalog?.rows?.find((r) => `row:${r.id}` === k); return row ? rowLabel(row) : 'מכשיר שנמחק מהרשימה'; }
  const p = k.split('|');
  const name = catalog?.models?.find((m) => m.mkey === `${p[0]}|${p[1]}`)?.model || p[1];
  let q = p.slice(3).join(' ');
  if (p[3]?.startsWith('q:')) { // מפתח חדש: איכות + מסגרת
    const qid = p[3].slice(2);
    q = [qid.startsWith('?') ? qid.slice(1) || 'סטנדרטי' : qualityLabel(p[2], qid, cfg) || qid, FRAME[p[4]] || ''].filter(Boolean).join(' · ');
  }
  return [name, repairLabel(p[2], cfg), q].filter(Boolean).join(' · ');
}

// סוגי תיקון (6 קבועים + שהוספת), רמות האיכות של כל סוג והמילים של הספקים שמתורגמות אליהן
const splitWords = (s) => String(s || '').split(/[,،\n]+/).map((w) => w.trim()).filter(Boolean);
function RepairTypes({ d, set }) {
  const reps = allRepairs(d);
  const [rid, setRid] = useState('screen');
  const qs = qualitiesFor(rid, d);
  const own = Array.isArray(d.qualities?.[rid]) && d.qualities[rid].length > 0;
  const editQ = (fn) => set((y) => { y.qualities = y.qualities || {}; const list = (y.qualities[rid]?.length ? y.qualities[rid] : qualitiesFor(rid, y)).map((x) => ({ ...x, words: [...(x.words || [])] })); fn(list); y.qualities[rid] = list; });
  return (
    <>
      <div className="section-title">סוגי תיקון</div>
      <div className="muted" style={{ margin: '0 4px 8px' }}>6 הסוגים הראשונים קבועים. סוג שתוסיף יופיע בחיפוש, בעמוד הדגם ובטבלת עלות העבודה (את העלות לכל סדרה קובעים בלשונית "עלות עבודה"). המילים הן מה שהספקים כותבים – שורה עם אחת מהן תשויך לסוג הזה.</div>
      <div className="card list">
        {REPAIRS.map((r) => <div key={r.id} className="row"><div className="main"><div className="t1" style={{ fontSize: 15 }}>{r.label}</div></div><span className="muted">קבוע</span></div>)}
        {(d.customRepairs || []).map((r, i) => (
          <div key={r.id} className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <input className="input" style={{ flex: '1 1 120px' }} placeholder="שם התיקון" value={r.label} onChange={(e) => set((y) => { y.customRepairs[i].label = e.target.value; })} />
            <input className="input" style={{ flex: '2 1 180px' }} placeholder="מילים של ספקים, מופרדות בפסיק" defaultValue={(r.words || []).join(', ')}
              onBlur={(e) => set((y) => { y.customRepairs[i].words = splitWords(e.target.value); })} />
            <button className="icon-btn" aria-label="מחק סוג תיקון" onClick={() => set((y) => { y.customRepairs.splice(i, 1); })}>{Icon.trash}</button>
            <label className="field" style={{ width: '100%', margin: 0 }}><span>כשאין עלות עבודה לסוג הזה, חלק עם מחיר יחושב עם העבודה של</span>
              <select className="input" value={r.laborFrom || ''} onChange={(e) => set((y) => { y.customRepairs[i].laborFrom = e.target.value || null; })}>
                <option value="">— בלי (אין מחיר סופי עד שתקבע עלות)</option>
                {REPAIRS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select></label>
          </div>
        ))}
      </div>
      <div className="actions"><button className="btn" onClick={() => set((y) => { y.customRepairs = [...(y.customRepairs || []), { id: 'c' + Date.now().toString(36), label: '', words: [] }]; })}>{Icon.plus}<span>סוג תיקון חדש</span></button></div>

      <div className="section-title">רמות איכות</div>
      <div className="muted" style={{ margin: '0 4px 8px' }}>השם הוא מה שהלקוח רואה. המילים הן איך שהספקים כותבים את האיכות (בכל שפה ובכל כתיב). הסדר קובע מה קודם כשכתובות כמה: "מקורי סאני" → מקורי סרוויס, "תחליפי OLED" → OLED.</div>
      <select className="input" value={rid} onChange={(e) => setRid(e.target.value)}>
        {reps.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <div className="card list" style={{ marginTop: 8 }}>
        {qs.map((x, i) => (
          <div key={x.id + i} className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <input className="input" style={{ flex: '1 1 110px' }} value={x.label} onChange={(e) => editQ((l) => { l[i].label = e.target.value; })} />
            <input className="input" style={{ flex: '2 1 180px' }} dir="auto" defaultValue={(x.words || []).join(', ')} key={(x.words || []).join(',')}
              onBlur={(e) => editQ((l) => { l[i].words = splitWords(e.target.value); })} />
            <span style={{ display: 'flex', gap: 4 }}>
              <button className="icon-btn" aria-label="למעלה" disabled={i === 0} onClick={() => editQ((l) => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; })}>↑</button>
              <button className="icon-btn" aria-label="למטה" disabled={i === qs.length - 1} onClick={() => editQ((l) => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; })}>↓</button>
              <button className="icon-btn" aria-label="מחק איכות" onClick={() => editQ((l) => { l.splice(i, 1); })}>{Icon.trash}</button>
            </span>
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="btn" onClick={() => editQ((l) => { l.push({ id: 'q' + Date.now().toString(36), label: 'איכות חדשה', words: [] }); })}>{Icon.plus}<span>איכות</span></button>
        {own && <button className="btn" onClick={() => set((y) => { delete y.qualities[rid]; })}>{DEFAULT_QUALITIES[rid] ? 'חזרה לרשימה ההתחלתית' : 'חזרה לברירת המחדל'}</button>}
      </div>

      {(d.qualityNoise || []).length > 0 && (
        <>
          <div className="section-title">מילים שאינן איכות</div>
          <div className="card list">
            {d.qualityNoise.map((w, i) => (
              <div key={w} className="row"><div className="main"><div className="t1" style={{ fontSize: 15 }}>{w}</div></div>
                <button className="btn" onClick={() => set((y) => { y.qualityNoise.splice(i, 1); })}>הסר</button></div>
            ))}
          </div>
        </>
      )}
      {(d.ignoredParts || []).length > 0 && (
        <>
          <div className="section-title">שורות חלקים בדילוג קבוע</div>
          <div className="card list">
            {d.ignoredParts.map((x, i) => (
              <div key={x.key} className="row"><div className="main"><div className="t1" style={{ fontSize: 15 }} dir="auto">{x.label}</div></div>
                <button className="btn" onClick={() => set((y) => { y.ignoredParts.splice(i, 1); })}>בטל דילוג</button></div>
            ))}
          </div>
        </>
      )}
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
        חריג גובר על טבלת עלות העבודה: עלות עבודה אחרת או שיוך לעמודה. <b>סדרה</b> = כל הדגמים שמתחילים בשם (למשל "iPhone 15" חל על 15, 15 Plus, 15 Pro…). <b>דגם</b> = רק הדגם המדויק. דגם קודם לסדרה.
      </div>
      <div className="card list">
        {d.laborRules.length === 0 && <div className="empty">אין חריגים</div>}
        {d.laborRules.map((r, i) => (
          <div key={r.id} className="row">
            <div className="main">
              <div className="t1" style={{ fontSize: 15 }}>{r.scope === 'model' ? 'דגם' : 'סדרה'}: {r.match}</div>
              <div className="t2">
                {r.group ? `משויך ל: ${LABOR_GROUPS.find((g) => g.id === r.group)?.label}` : ''}
                {Object.entries(r.labor || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => ` ${repairLabel(k, d)} ${fmt(v)}`).join(' ·')}
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
          <div className="muted">עלות עבודה ספציפית (ריק = לפי הטבלה):</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, marginTop: 8 }}>
            {allRepairs(d).map((r) => (
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
