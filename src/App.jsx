import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildCatalog, searchModels } from './lib/catalog.js';
import { freshness } from './lib/pricing.js';
import { liteCatalog, getRepairQuote, getDeviceQuotes } from './lib/publish.js';
import { REPAIRS } from './lib/defaults.js';
import { fmt, Fresh, Icon, daysLabel } from './ui/util.jsx';
import ModelSheet from './ui/ModelSheet.jsx';
import ImportSheet from './ui/ImportSheet.jsx';
import SettingsSheet from './ui/SettingsSheet.jsx';

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

export default function App({ store }) {
  const [auth, setAuth] = useState({ user: null, role: 'pending' });
  const [data, setData] = useState({ ready: false });
  const [requests, setRequests] = useState([]);
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState(null);
  const [repairPill, setRepairPill] = useState(null);
  const [customer, setCustomer] = useState(() => lsGet('mehiron:customer', false));
  const [open, setOpen] = useState(null); // דגם פתוח
  const [panel, setPanel] = useState(null); // 'import' | 'settings'
  const [focusItem, setFocusItem] = useState(null);
  const [shareText, setShareText] = useState('');
  const [msg, setMsg] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => store.onAuth(setAuth), [store]);
  useEffect(() => store.onData(setData), [store]);
  useEffect(() => lsSet('mehiron:customer', customer), [customer]);
  useEffect(() => {
    // שיתוף טקסט מוואטסאפ ישירות לאפליקציה (Android)
    const p = new URLSearchParams(location.search);
    const t = p.get('text') || p.get('title');
    if (t) { setShareText(t); history.replaceState(null, '', location.pathname); }
  }, []);
  useEffect(() => { if (shareText && auth.role === 'admin') setPanel('import'); }, [shareText, auth.role]);

  const toast = (t) => { setMsg(t); clearTimeout(toast.t); toast.t = setTimeout(() => setMsg(null), 2600); };
  const full = !!data.full;
  const cfg = full ? data.config : data.pcfg;
  const catalog = useMemo(() => (full ? buildCatalog(data.lists) : liteCatalog(data.pub)), [full, data.lists, data.pub]);
  const isAdmin = auth.role === 'admin';
  const seeCost = full; // מנהל, או עובד שקיבל הרשאת פירוט
  const showCustomer = customer || !seeCost;

  // מנהל: מפרסם לעובדים קטלוג מחירים סופיים בכל שינוי
  useEffect(() => {
    if (!isAdmin || !full || !data.ready) return;
    const t = setTimeout(() => { store.publish(data.lists, data.config).catch(() => {}); }, 1200);
    return () => clearTimeout(t);
  }, [isAdmin, full, data.ready, data.lists, data.config, store]);
  // מנהל: בקשות פירוט פתוחות
  useEffect(() => (isAdmin && store.onRequests ? store.onRequests(setRequests) : undefined), [isAdmin, store]);
  const onRequest = !seeCost ? (what) => { store.createRequest({ what }).catch(() => {}); toast('הבקשה נשלחה למנהל'); } : null;

  const q = [query, repairPill ? REPAIRS.find((r) => r.id === repairPill).label : ''].filter(Boolean).join(' ');
  const results = useMemo(() => {
    if (!cfg) return { repair: null, models: [] };
    const kind = repairPill === 'devices' ? 'devices' : null;
    const qq = repairPill === 'devices' ? query : q;
    if (!qq.trim() && !brand && !repairPill) return { repair: null, models: [] };
    return searchModels(qq, catalog, { brand, kindFilter: kind });
  }, [q, query, brand, repairPill, catalog, cfg]);

  if (auth.role === 'pending' || (auth.role !== 'none' && (!data.ready || !cfg))) return <div className="login"><div className="muted">טוען…</div></div>;
  if (auth.role === 'none') return <Login store={store} auth={auth} />;

  const supplierStatus = (full ? cfg.suppliers || [] : []).map((s) => ({ s, doc: data.lists[s.id], f: freshness(data.lists[s.id]?.updatedAt, cfg) }));
  const repairFor = results.repair;

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-row">
          <div className="brand">מחירון</div>
          {seeCost && <button className={'icon-btn' + (customer ? ' on' : '')} title="מצב לקוח" onClick={() => { setCustomer(!customer); toast(customer ? 'מצב פנימי: רואים עלויות ורווח' : 'מצב לקוח: רק מחיר סופי'); }}>{customer ? Icon.eyeOff : Icon.eye}</button>}
          {isAdmin && !customer && <button className="icon-btn" title="הגדרות" style={{ position: 'relative' }} onClick={() => setPanel('settings')}>{Icon.gear}{requests.length > 0 && <span className="badge num">{requests.length}</span>}</button>}
          {isAdmin && !customer && <button className="pill-btn" onClick={() => setPanel('import')}>{Icon.plus}<span>עדכן מחירון</span></button>}
        </div>
        <div className="search">
          <span className="mag">{Icon.search}</span>
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="לדוגמה: אייפון 14 פרו מסך" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} />
          {query && <button className="clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>✕</button>}
        </div>
        <div className="pills">
          {['Apple', 'Samsung', 'Xiaomi'].map((b) => <button key={b} className={'pill' + (brand === b ? ' on' : '')} onClick={() => setBrand(brand === b ? null : b)}>{b}</button>)}
          <span className="pill-sep" />
          {REPAIRS.map((r) => <button key={r.id} className={'pill' + (repairPill === r.id ? ' on' : '')} onClick={() => setRepairPill(repairPill === r.id ? null : r.id)}>{r.label}</button>)}
          <button className={'pill' + (repairPill === 'devices' ? ' on' : '')} onClick={() => setRepairPill(repairPill === 'devices' ? null : 'devices')}>מכשירים</button>
        </div>
      </div>

      {isAdmin && requests.length > 0 && !customer && (
        <button className="banner" style={{ width: '100%', textAlign: 'right', background: 'rgba(0,122,255,.1)', color: 'var(--blue)' }} onClick={() => { setFocusItem(null); setPanel('users'); }}>
          {requests.length === 1 ? 'בקשת פירוט חדשה מעובד' : `${requests.length} בקשות פירוט חדשות מעובדים`} · לצפייה ואישור ‹
        </button>
      )}
      {store.mode === 'local' && auth.role === 'viewer' && (
        <button className="banner" style={{ width: '100%', textAlign: 'right' }} onClick={() => store.previewAs(null)}>
          תצוגה מקדימה כעובד ({auth.user.email}{auth.showCost ? ', עם פירוט' : ''}) · חזרה למנהל ‹
        </button>
      )}
      {!full && catalog.updatedAt > 0 && (
        <div className="muted" style={{ margin: '12px 6px 0' }}>המחירון עודכן {daysLabel(freshness(catalog.updatedAt, cfg).days).replace('עודכן ', '')}</div>
      )}
      {store.mode === 'local' && !customer && (
        <div className="banner">תצוגה מקדימה: הנתונים נשמרים רק במכשיר הזה. אחרי חיבור Firebase כל הסניפים יתעדכנו מהמאגר הראשי.</div>
      )}

      {full && results.models.length === 0 && !query && !brand && !repairPill && (
        <>
          <div className="section-title">מצב המחירונים</div>
          <div className="card list">
            {supplierStatus.map(({ s, doc, f }) => (
              <div key={s.id} className="row">
                <span className={'dot ' + f.level} />
                <div className="main"><div className="t1" style={{ fontSize: 16 }}>{s.name}</div>
                  <div className="t2">{doc ? `${doc.items?.length || 0} שורות · ${daysLabel(f.days)}` : 'עדיין לא נטען מחירון'}</div></div>
                <span className="muted">{s.type === 'parts' ? 'חלקים' : 'מכשירים'}</span>
              </div>
            ))}
          </div>
          <div className="empty" style={{ paddingTop: 28 }}>מקלידים דגם וסוג תיקון ומקבלים מחיר סופי ללקוח.<br />לדוגמה: <b>a54 מסך</b>, <b>15 פרו סוללה</b>, <b>זד פליפ 5</b></div>
        </>
      )}

      {(query || brand || repairPill) && results.models.length === 0 && <div className="empty">לא נמצא דגם מתאים</div>}

      {results.models.length > 0 && (
        <>
          <div className="section-title">{results.models.length > 60 ? 'תוצאות (60 ראשונות)' : 'תוצאות'}</div>
          <div className="card list">
            {results.models.slice(0, 60).map((m) => <ResultRow key={m.mkey} m={m} repair={repairFor} catalog={catalog} cfg={cfg} devicesMode={repairPill === 'devices'} onOpen={() => setOpen(m)} />)}
          </div>
        </>
      )}

      {!full && results.models.length === 0 && !query && !brand && !repairPill && (
        <div className="empty" style={{ paddingTop: 28 }}>מקלידים דגם וסוג תיקון ומקבלים מחיר סופי ללקוח.<br />לדוגמה: <b>a54 מסך</b>, <b>15 פרו סוללה</b></div>
      )}
      {open && <ModelSheet model={open} catalog={catalog} cfg={cfg} customer={showCustomer} isAdmin={isAdmin} onRequest={onRequest} initialRepair={repairPill !== 'devices' ? repairFor : null}
        onClose={() => setOpen(null)} onSaveConfig={store.saveConfig} toast={toast}
        onEditItem={isAdmin ? (f) => { setFocusItem(f); setPanel('settings'); } : null} />}
      {panel === 'import' && <ImportSheet cfg={cfg} lists={data.lists} initialText={shareText} onClose={() => { setPanel(null); setShareText(''); }}
        onSaveList={store.savePriceList} onSaveConfig={store.saveConfig} toast={toast} />}
      {(panel === 'settings' || panel === 'users') && <SettingsSheet cfg={cfg} catalog={catalog} lists={data.lists} store={store} focus={focusItem} initialTab={panel === 'users' ? 'users' : null} requests={requests} onClose={() => { setPanel(null); setFocusItem(null); }} onSaveConfig={store.saveConfig} toast={toast} />}
      {msg && <div className="toast">{msg}</div>}
      {store.mode === 'cloud' && !customer && (
        <div className="muted" style={{ textAlign: 'center', marginTop: 28 }}>
          {auth.user?.email} · {isAdmin ? 'מנהל' : seeCost ? 'צפייה + פירוט' : 'צפייה'} · <button className="disc" style={{ margin: 0 }} onClick={() => store.signOut()}>התנתק</button>
        </div>
      )}
    </div>
  );
}

function ResultRow({ m, repair, catalog, cfg, devicesMode, onOpen }) {
  let right = null, sub = '';
  if (repair && !devicesMode) {
    const qt = getRepairQuote(m, repair, catalog, cfg);
    const best = qt.options[0];
    if (best && best.final != null) {
      right = <span className="price num">{fmt(best.final)}</span>;
      sub = `${qt.label} · ${best.quality}${qt.options.length > 1 ? ` · עוד ${qt.options.length - 1} רמות` : ''}`;
    } else if (qt.laborOnly != null) {
      right = <span><span className="price num" style={{ fontSize: 17 }}>{fmt(qt.laborOnly)}</span><span className="plus-part">+ חלק</span></span>;
      sub = `${qt.label} · עבודה בלבד, אין מחיר חלק`;
    } else sub = `${qt.label} · לא מוגדר`;
  } else {
    const dq = m.hasDevices ? getDeviceQuotes(m, catalog, cfg).filter((d) => d.final != null) : [];
    const min = dq.length ? Math.min(...dq.map((d) => d.final)) : null;
    const bits = [];
    if (m.devKind === 'phone' || m.hasParts) bits.push('תיקונים');
    if (m.hasDevices) bits.push(min != null ? `מכשיר מ-${fmt(min)}` : 'מכשיר למכירה');
    sub = bits.join(' · ');
  }
  return (
    <button className="row" onClick={onOpen}>
      <div className="main"><div className="t1">{m.model}</div><div className="t2">{sub}</div></div>
      {right}<span className="chev">‹</span>
    </button>
  );
}

function Login({ store, auth }) {
  const [err, setErr] = useState('');
  return (
    <div className="login card">
      <h1>מחירון</h1>
      {auth.user ? (
        <>
          <p className="muted" style={{ lineHeight: 1.6 }}>החשבון <b dir="ltr">{auth.user.email}</b> עדיין לא מורשה.<br />בקש מהמנהל להוסיף אותו בהגדרות ← משתמשים.</p>
          <button className="btn" onClick={() => store.signOut()}>החלף חשבון</button>
        </>
      ) : (
        <>
          <p className="muted">כניסה עם חשבון גוגל</p>
          <button className="btn primary" style={{ height: 48, padding: '0 22px' }} onClick={() => store.signIn().catch((e) => setErr(e?.message || String(e)))}>התחברות עם Google</button>
          {err && <p className="warn" dir="ltr">{err}</p>}
        </>
      )}
    </div>
  );
}
