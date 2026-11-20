import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildCatalog, activeLists, searchModels } from './lib/catalog.js';
import { freshness } from './lib/pricing.js';
import { liteCatalog, getRepairQuote, getDeviceQuotes } from './lib/publish.js';
import { REPAIRS } from './lib/defaults.js';
import { fmt, Fresh, Icon, daysLabel } from './ui/util.jsx';
import ModelSheet from './ui/ModelSheet.jsx';
import ImportSheet from './ui/ImportSheet.jsx';
import SettingsSheet from './ui/SettingsSheet.jsx';
import { useBack, useExitGuard } from './ui/useBack.js';

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

const DEVICE_CATS = [
  { id: 'phone', label: 'טלפונים', kinds: ['phone'] },
  { id: 'tablet', label: 'טאבלטים', kinds: ['tablet'] },
  { id: 'wear', label: 'שעונים ואוזניות', kinds: ['watch', 'audio'] },
  { id: 'acc', label: 'אביזרים', kinds: ['accessory', 'other'] },
];
const BRANDS = ['Apple', 'Samsung', 'Xiaomi'];
const EMPTY = { query: '', brand: null, pill: null };
const BIG_STORAGE = /(^|\s)(64|128|256|512|1024)\s*(gb|g|גיגה)?(?=\s|$)|(^|\s)([12])\s*(tb|טרה)(?=\s|$)/i;

export default function App({ store }) {
  const [auth, setAuth] = useState({ user: null, role: 'pending' });
  const [data, setData] = useState({ ready: false });
  const [requests, setRequests] = useState([]);
  const [pubError, setPubError] = useState(null); // פרסום המחירים לעובדים נכשל
  const [mode, setMode] = useState(() => lsGet('mehiron:mode', 'repairs')); // 'repairs' | 'devices'
  const [filters, setFilters] = useState({ repairs: EMPTY, devices: EMPTY }); // חיפוש נפרד לכל מחירון
  const [customer, setCustomer] = useState(() => lsGet('mehiron:customer', false));
  const [open, setOpen] = useState(null); // דגם פתוח
  const [panel, setPanel] = useState(null); // 'import' | 'settings' | 'users'
  const [focusItem, setFocusItem] = useState(null);
  const [shareText, setShareText] = useState('');
  const [msg, setMsg] = useState(null);
  const inputRef = useRef(null);

  const f = filters[mode];
  const setF = (patch) => setFilters((all) => ({ ...all, [mode]: { ...all[mode], ...patch } }));
  const { query, brand, pill } = f;

  useEffect(() => store.onAuth(setAuth), [store]);
  useEffect(() => store.onData(setData), [store]);
  useEffect(() => lsSet('mehiron:customer', customer), [customer]);
  useEffect(() => lsSet('mehiron:mode', mode), [mode]);
  useEffect(() => {
    // שיתוף טקסט מוואטסאפ ישירות לאפליקציה (Android)
    const p = new URLSearchParams(location.search);
    const t = p.get('text') || p.get('title');
    if (t) { setShareText(t); history.replaceState(history.state, '', location.pathname); }
  }, []);
  useEffect(() => { if (shareText && auth.role === 'admin') setPanel('import'); }, [shareText, auth.role]);

  const toastTimer = useRef(null);
  const toast = (t) => { setMsg(t); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setMsg(null), 2600); };
  const closeImport = () => { setPanel(null); setShareText(''); };
  const closeSettings = () => { setPanel(null); setFocusItem(null); };

  // אחורה: חלונות → סינונים (מהאחרון שנבחר) → חיפוש → מחירון תיקונים → יציאה בלחיצה כפולה
  useExitGuard(() => toast('לחץ שוב אחורה כדי לצאת'));
  useBack(mode === 'devices', () => setMode('repairs'));
  useBack(mode === 'repairs' && !!filters.repairs.query, () => setFilters((a) => ({ ...a, repairs: { ...a.repairs, query: '' } })));
  useBack(mode === 'devices' && !!filters.devices.query, () => setFilters((a) => ({ ...a, devices: { ...a.devices, query: '' } })));
  useBack(mode === 'repairs' && !!filters.repairs.brand, () => setFilters((a) => ({ ...a, repairs: { ...a.repairs, brand: null } })));
  useBack(mode === 'devices' && !!filters.devices.brand, () => setFilters((a) => ({ ...a, devices: { ...a.devices, brand: null } })));
  useBack(mode === 'repairs' && !!filters.repairs.pill, () => setFilters((a) => ({ ...a, repairs: { ...a.repairs, pill: null } })));
  useBack(mode === 'devices' && !!filters.devices.pill, () => setFilters((a) => ({ ...a, devices: { ...a.devices, pill: null } })));
  useBack(!!open, () => setOpen(null), true);
  useBack(panel === 'import', closeImport, true);
  useBack(panel === 'settings' || panel === 'users', closeSettings, true);

  const full = !!data.full;
  const cfg = full ? data.config : data.pcfg;
  const catalog = useMemo(() => (full ? buildCatalog(activeLists(data.lists, data.config)) : liteCatalog(data.pub)), [full, data.lists, data.config, data.pub]);
  const isAdmin = auth.role === 'admin';
  const seeCost = full; // מנהל, או עובד שקיבל הרשאת פירוט
  const showCustomer = customer || !seeCost;

  // מנהל: מפרסם לעובדים קטלוג מחירים סופיים בכל שינוי
  useEffect(() => {
    if (!isAdmin || !full || !data.ready) return;
    const t = setTimeout(() => { store.publish(data.lists, data.config).then(() => setPubError(null), (e) => setPubError(e?.message || String(e))); }, 1200);
    return () => clearTimeout(t);
  }, [isAdmin, full, data.ready, data.lists, data.config, store]);
  // מנהל: בקשות פירוט פתוחות
  useEffect(() => (isAdmin && store.onRequests ? store.onRequests(setRequests) : undefined), [isAdmin, store]);
  const onRequest = !seeCost ? (what) => { store.createRequest({ what }).catch(() => {}); toast('הבקשה נשלחה למנהל'); } : null;

  // במכשירים: נפח בחיפוש ("17 פרו 256") מסנן גרסאות ולא חלק משם הדגם
  const storageQ = useMemo(() => {
    if (mode !== 'devices') return null;
    const m = query.match(BIG_STORAGE);
    if (!m) return null;
    return m[5] ? Number(m[5]) * 1024 : Number(m[2]);
  }, [mode, query]);

  const results = useMemo(() => {
    if (!cfg) return { repair: null, models: [] };
    const active = query.trim() || brand || pill;
    if (!active) return { repair: null, models: [] };
    if (mode === 'repairs') {
      const q = [query, pill ? REPAIRS.find((r) => r.id === pill)?.label : ''].filter(Boolean).join(' ');
      const r = searchModels(q, catalog, { brand, kindFilter: 'repairs' });
      // רק דגמים שיש להם מחיר תיקון (למשל אייפון 8 / SE לא מתוקנים – לא מוצגים)
      const has = (m) => (r.repair ? [r.repair] : REPAIRS.map((x) => x.id)).some((id) => {
        const qt = getRepairQuote(m, id, catalog, cfg);
        return qt.options.some((o) => o.final != null) || qt.laborOnly != null;
      });
      return { ...r, models: r.models.filter(has) };
    }
    const q = storageQ ? query.replace(BIG_STORAGE, ' ') : query;
    const r = searchModels(q, catalog, { brand, kindFilter: 'devices' });
    let models = r.models.filter((m) => m.hasDevices && !m.synthetic);
    if (pill) models = models.filter((m) => DEVICE_CATS.find((c) => c.id === pill)?.kinds.includes(m.devKind || 'other'));
    if (storageQ) models = models.filter((m) => getDeviceQuotes(m, catalog, cfg).some((d) => d.item.storage === storageQ));
    return { repair: null, models };
  }, [mode, query, brand, pill, storageQ, catalog, cfg]);

  if (data.error && !data.ready && auth.role !== 'none') return <ErrorScreen code={data.error} store={store} />;
  if (auth.role === 'pending' || (auth.role !== 'none' && (!data.ready || !cfg))) return <Loading />;
  if (auth.role === 'none') return <Login store={store} auth={auth} />;

  const supType = mode === 'repairs' ? 'parts' : 'devices';
  const supplierStatus = (full ? cfg.suppliers || [] : []).filter((s) => (s.type || 'devices') === supType)
    .map((s) => ({ s, doc: data.lists[s.id], f: freshness(data.lists[s.id]?.updatedAt, cfg) }));
  const repairFor = results.repair;
  const idle = !query.trim() && !brand && !pill;
  const switchMode = (m) => { if (m !== mode) { setMode(m); setOpen(null); } };

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-row">
          <div className="brand">מחירון</div>
          {seeCost && <button className={'icon-btn' + (customer ? ' on' : '')} title="מצב לקוח" onClick={() => { setCustomer(!customer); toast(customer ? 'מצב פנימי: רואים עלויות ורווח' : 'מצב לקוח: רק מחיר סופי'); }}>{customer ? Icon.eyeOff : Icon.eye}</button>}
          {isAdmin && !customer && <button className="icon-btn" title="הגדרות" style={{ position: 'relative' }} onClick={() => setPanel('settings')}>{Icon.gear}{requests.length > 0 && <span className="badge num">{requests.length}</span>}</button>}
          {isAdmin && !customer && <button className="pill-btn" onClick={() => setPanel('import')}>{Icon.plus}<span>עדכן מחירון</span></button>}
        </div>
        <div className="seg mode-seg">
          <button className={mode === 'repairs' ? 'on' : ''} onClick={() => switchMode('repairs')}>מחירון תיקונים</button>
          <button className={mode === 'devices' ? 'on' : ''} onClick={() => switchMode('devices')}>מחירון מכשירים</button>
        </div>
        <div className="search">
          <span className="mag">{Icon.search}</span>
          <input ref={inputRef} value={query} onChange={(e) => setF({ query: e.target.value })}
            placeholder={mode === 'repairs' ? 'לדוגמה: אייפון 14 פרו מסך' : 'לדוגמה: אייפון 17 פרו 256'} enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} />
          {query && <button className="clear" onClick={() => { setF({ query: '' }); inputRef.current?.focus(); }}>✕</button>}
        </div>
        <div className="pills">
          {BRANDS.map((b) => <button key={b} className={'pill' + (brand === b ? ' on' : '')} onClick={() => setF({ brand: brand === b ? null : b })}>{b}</button>)}
          <span className="pill-sep" />
          {(mode === 'repairs' ? REPAIRS : DEVICE_CATS).map((r) => <button key={r.id} className={'pill' + (pill === r.id ? ' on' : '')} onClick={() => setF({ pill: pill === r.id ? null : r.id })}>{r.label}</button>)}
        </div>
      </div>

      {data.error && data.ready && (
        <div className="banner" style={{ background: 'rgba(255,59,48,.1)', color: '#D70015' }}>{ERRORS[data.error] || 'בעיה בסנכרון עם השרת. המחירים המוצגים הם האחרונים שנטענו.'}</div>
      )}
      {isAdmin && pubError && (
        <div className="banner" style={{ background: 'rgba(255,59,48,.1)', color: '#D70015' }}>המחירים לא עודכנו אצל העובדים: {pubError}</div>
      )}
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
      {store.mode === 'local' && !customer && auth.role === 'admin' && (
        <div className="banner">תצוגה מקדימה: הנתונים נשמרים רק במכשיר הזה.</div>
      )}

      {idle && (
        <>
          {full && supplierStatus.length > 0 && (
            <>
              <div className="section-title">{mode === 'repairs' ? 'ספקי חלקים' : 'ספקי מכשירים'}</div>
              <div className="card list">
                {supplierStatus.map(({ s, doc, f: fr }) => (
                  <div key={s.id} className="row">
                    <span className={'dot ' + fr.level} />
                    <div className="main"><div className="t1" style={{ fontSize: 16 }}>{s.name}</div>
                      <div className="t2">{doc ? `${doc.items?.length || 0} שורות · ${daysLabel(fr.days)}` : 'עדיין לא נטען מחירון'}</div></div>
                  </div>
                ))}
              </div>
            </>
          )}
          {!full && catalog.updatedAt > 0 && (
            <div className="muted" style={{ margin: '14px 6px 0' }}>המחירון עודכן {daysLabel(freshness(catalog.updatedAt, cfg).days).replace('עודכן ', '')}</div>
          )}
          <div className="empty" style={{ paddingTop: 28 }}>
            {mode === 'repairs'
              ? <>מקלידים דגם וסוג תיקון ומקבלים מחיר סופי ללקוח.<br />לדוגמה: <b>a54 מסך</b>, <b>15 פרו סוללה</b>, <b>זד פליפ 5</b></>
              : <>מקלידים דגם (ואפשר גם נפח) ומקבלים מחיר מכירה ללקוח.<br />לדוגמה: <b>17 פרו 256</b>, <b>s26</b>, <b>איירפודס</b></>}
          </div>
        </>
      )}

      {!idle && results.models.length === 0 && <div className="empty">לא נמצא {mode === 'repairs' ? 'דגם מתאים' : 'מכשיר מתאים'}</div>}

      {results.models.length > 0 && (
        <>
          <div className="section-title">{results.models.length > 60 ? 'תוצאות (60 ראשונות)' : 'תוצאות'}</div>
          <div className="card list">
            {results.models.slice(0, 60).map((m) => <ResultRow key={m.mkey} m={m} mode={mode} repair={repairFor} storage={storageQ} catalog={catalog} cfg={cfg} onOpen={() => setOpen(m)} />)}
          </div>
        </>
      )}

      {open && <ModelSheet model={open} mode={mode} storage={storageQ} catalog={catalog} cfg={cfg} customer={showCustomer} isAdmin={isAdmin} onRequest={onRequest} initialRepair={mode === 'repairs' ? repairFor : null}
        onClose={() => setOpen(null)} onSaveConfig={store.saveConfig} toast={toast}
        onEditItem={isAdmin ? (fi) => { setFocusItem(fi); setPanel('settings'); } : null} />}
      {panel === 'import' && <ImportSheet cfg={cfg} lists={data.lists} initialText={shareText} onClose={closeImport}
        onSaveList={store.savePriceList} onSaveConfig={store.saveConfig} toast={toast} />}
      {(panel === 'settings' || panel === 'users') && <SettingsSheet cfg={cfg} catalog={catalog} lists={data.lists} store={store} focus={focusItem} initialTab={panel === 'users' ? 'users' : null} requests={requests} onClose={closeSettings} onSaveConfig={store.saveConfig} toast={toast} />}
      {msg && <div className="toast">{msg}</div>}
      {store.mode === 'cloud' && !customer && (
        <div className="muted" style={{ textAlign: 'center', marginTop: 28 }}>
          {auth.user?.email} · {isAdmin ? 'מנהל' : seeCost ? 'צפייה + פירוט' : 'צפייה'} · <button className="disc" style={{ margin: 0 }} onClick={() => store.signOut()}>התנתק</button>
        </div>
      )}
    </div>
  );
}

function ResultRow({ m, mode, repair, storage, catalog, cfg, onOpen }) {
  let right = null, sub = '';
  if (mode === 'repairs') {
    if (repair) {
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
      const avail = REPAIRS.filter((r) => { const qt = getRepairQuote(m, r.id, catalog, cfg); return qt.options.length || qt.laborOnly != null; });
      sub = avail.length ? avail.map((r) => r.label).join(' · ') : 'אין תיקונים מוגדרים';
    }
  } else {
    let dq = getDeviceQuotes(m, catalog, cfg).filter((d) => d.final != null);
    if (storage) dq = dq.filter((d) => d.item.storage === storage);
    const min = dq.length ? Math.min(...dq.map((d) => d.final)) : null;
    if (min != null) right = <span className="price num">{fmt(min)}</span>;
    sub = dq.length > 1 ? `${dq.length} גרסאות · החל מ-${fmt(min)}` : dq.length === 1 ? [dq[0].item.storage ? dq[0].item.name.replace(m.model, '').trim() : '', dq[0].item.variant].filter(Boolean).join(' · ') : 'אין מחיר ללקוח';
  }
  return (
    <button className="row" onClick={onOpen}>
      <div className="main"><div className="t1">{m.model}</div><div className="t2">{sub}</div></div>
      {right}<span className="chev">‹</span>
    </button>
  );
}

const ERRORS = {
  'permission-denied': 'אין הרשאה לקרוא את המחירון. אם המנהל עדכן הרשאות או חוקי אבטחה עכשיו, נסה שוב בעוד דקה.',
  unavailable: 'אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.',
};

function ErrorScreen({ code, store }) {
  return (
    <div className="login card">
      <h1>מחירון</h1>
      <p className="muted" style={{ lineHeight: 1.6 }}>{ERRORS[code] || 'לא הצלחתי לטעון את המחירון.'}</p>
      <div className="actions" style={{ justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => location.reload()}>נסה שוב</button>
        {store.mode === 'cloud' && <button className="btn" onClick={() => store.signOut()}>החלף חשבון</button>}
      </div>
      <p className="muted" dir="ltr" style={{ fontSize: 11, marginTop: 14 }}>{code}</p>
    </div>
  );
}

function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 12000); return () => clearTimeout(t); }, []);
  return (
    <div className="login">
      <div className="muted">טוען…</div>
      {slow && (
        <>
          <p className="muted" style={{ marginTop: 16 }}>הטעינה לוקחת יותר זמן מהרגיל. בדוק את החיבור לאינטרנט.</p>
          <button className="btn primary" onClick={() => location.reload()}>נסה שוב</button>
        </>
      )}
    </div>
  );
}

function Login({ store, auth }) {
  const [err, setErr] = useState('');
  return (
    <div className="login card">
      <h1>מחירון</h1>
      {auth.user ? (
        <>
          <p className="muted" style={{ lineHeight: 1.6 }}>החשבון <b dir="ltr">{auth.user.email}</b> עדיין לא מורשה.<br />בקש מהמנהל להוסיף אותו בהגדרות ← עובדים.</p>
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
