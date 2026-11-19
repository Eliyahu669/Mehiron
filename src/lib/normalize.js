// זיהוי ונרמול שמות דגמים מתוך טקסט חופשי (עברית / אנגלית / קיצורים של ספקים)

const STORAGE = new Set([16, 32, 64, 128, 256, 512, 1024]);

// החלפות עברית → מונחים אחידים. הסדר חשוב (ביטויים ארוכים קודם)
const HEB = [
  [/אי[\s-]?סים/g, ' esim '],
  [/דואל[\s-]?סים/g, ' dualsim '],
  [/די\.?סי\.?אס|דיסיאס/g, ' dcs '],
  [/(\d)\s*טרה/g, '$1tb '],
  [/איירפודס|אירפודס|אייפודס/g, ' airpods '],
  [/אייפד|איפד/g, ' ipad '],
  [/אייפון|איפון/g, ' iphone '],
  [/שעונים|שעון/g, ' watch '],
  [/גלקסי/g, ' galaxy '],
  [/סמסונג/g, ' samsung '],
  [/שיאומי|שאומי|קסיאומי/g, ' xiaomi '],
  [/רדמי/g, ' redmi '],
  [/פוקו/g, ' poco '],
  [/אפל/g, ' apple '],
  [/אס\s*אי/g, ' se '],
  [/איי\s*(\d)/g, ' a$1'],
  [/אס\s*(\d)/g, ' s$1'],
  [/זד(?=\s|$)/g, ' z '],
  [/דור\s*(\d+)/g, ' gen$1 '],
  [/פרו/g, ' pro '],
  [/מקס/g, ' max '],
  [/פלוס/g, ' plus '],
  [/מיני/g, ' mini '],
  [/אולטרה|אולטרא/g, ' ultra '],
  [/פליפ/g, ' flip '],
  [/פולד/g, ' fold '],
  [/אייר/g, ' air '],
  [/נוט(?=\s|$)/g, ' note '],
  [/מסך/g, ' מסך '],
];

const TAGS = new Set(['new', 'active', 'no', 'dcs', 'esim', 'dualsim', 'sim', 'wifi', 'cell', 'cellular',
  'gps', 'nfc', 'pr', '5g', '4g', 'g', 'gb', 'tb', 'lte', 'ds']);

const OTHER_BRANDS = {
  oneplus: 'OnePlus', pixel: 'Google Pixel', google: 'Google', nokia: 'Nokia', motorola: 'Motorola', moto: 'Motorola',
  honor: 'Honor', huawei: 'Huawei', oppo: 'Oppo', realme: 'Realme', vivo: 'Vivo', nothing: 'Nothing', tcl: 'TCL', zte: 'ZTE',
};

export function normText(s) {
  let t = ' ' + String(s || '').toLowerCase() + ' ';
  t = t.replace(/[‎‏‪-‮ְ-ׇ]/g, ''); // סימני כיוון וניקוד
  t = t.replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ');
  for (const [re, rep] of HEB) t = t.replace(re, rep);
  t = t.replace(/([a-z0-9])\+/g, '$1 plus ');
  t = t.replace(/[‼️!?,.:;"'`*()[\]{}|\\/_~＋+–—-]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function tokenize(s) {
  const out = [];
  for (const raw of normText(s).split(' ')) {
    if (!raw) continue;
    let m;
    if (/^[345]g$/.test(raw)) { out.push(raw); continue; }
    if ((m = raw.match(/^([12])(tb|t)$/))) { out.push(m[1], 'tb'); continue; }
    if ((m = raw.match(/^(\d+)(new|active|dcs|g|gb|tb)$/))) {
      out.push(m[1]);
      if (m[2] === 'tb') out.push('tb'); else if (m[2] === 'g' || m[2] === 'gb') out.push('gb'); else out.push(m[2]);
    } else if ((m = raw.match(/^(fold|flip)(\d+)$/))) {
      out.push(m[1], m[2]);
    } else if ((m = raw.match(/^(nord|note)(\d+)$/))) {
      out.push(m[1], m[2]);
    } else out.push(raw);
  }
  return out;
}

const cap = (w) => (w === 'fe' ? 'FE' : w === 'se' ? 'SE' : w.charAt(0).toUpperCase() + w.slice(1));
const isCode = (t) => /^[a-z]{1,2}\d{3,4}[a-z0-9]*$/.test(t); // קודי יצרן כמו A546, F926B, G965

function pickStorage(tokens, used) {
  let best = null;
  tokens.forEach((t, i) => {
    if (used.has(i)) return;
    if (t === 'tb' && i > 0 && /^\d+$/.test(tokens[i - 1])) { best = Number(tokens[i - 1]) * 1024; used.add(i - 1); used.add(i); return; }
    if (/^\d+$/.test(t) && STORAGE.has(Number(t))) {
      const n = Number(t);
      if (best === null || n > best) best = n;
    }
  });
  if (best !== null) tokens.forEach((t, i) => { if (t === String(best)) used.add(i); });
  return best;
}

const fmtStorage = (n) => (n == null ? '' : n >= 1024 ? `${n / 1024}TB` : `${n}GB`);

/**
 * מזהה מכשיר מתוך טקסט.
 * מחזיר: brand, family (לטבלת עבודה), tier, model (שם תצוגה ללא נפח), storage, kind, category, extra (מילים שנשארו)
 */
export function identify(text, ctxBrand = null) {
  const tk = tokenize(text);
  const used = new Set();
  const has = (w) => tk.includes(w);
  const res = { brand: null, family: null, tier: null, model: null, storage: null, kind: 'other', category: 'other' };

  // שעונים
  const isWatch = has('watch') || tk.some((t) => /^\d{2}mm?$/.test(t));
  if (isWatch) {
    res.kind = 'watch';
    res.brand = has('galaxy') || has('samsung') || tk.some((t) => /^r\d{3}/.test(t)) ? 'Samsung' : (ctxBrand === 'Samsung' ? 'Samsung' : 'Apple');
  } else if (has('airpods') || has('airpod')) { res.kind = 'audio'; res.brand = 'Apple'; tk.forEach((t, i) => { if (t.startsWith('airpod')) used.add(i); }); res.model = 'AirPods'; }
  else if (has('buds')) { res.kind = 'audio'; res.brand = 'Samsung'; }
  else if (has('airtag') || has('smartag')) { res.kind = 'accessory'; res.brand = has('airtag') ? 'Apple' : 'Samsung'; }
  else if (has('ipad')) { res.kind = 'tablet'; res.brand = 'Apple'; }
  else if (has('tab') || has('tablet') || has('teclast') || has('easytab') || has('lenovo') || tk.some((t) => t.startsWith('טאבלט'))) {
    res.kind = 'tablet'; res.brand = has('sam') || has('galaxy') || has('samsung') ? 'Samsung' : null;
  } else if (has('mibox') || (has('tv') && has('box')) || has('homepod') || (has('home') && has('pod')) || has('modem') || has('camera')) {
    res.kind = 'other';
  } else if (has('iphone') || has('ip') || has('lp')) {
    parseIphone(tk, used, res);
  } else if (has('redmi') || has('poco') || has('xiaomi') || has('mi')) {
    parseXiaomi(tk, used, res);
  } else if (tk.some((t) => OTHER_BRANDS[t])) {
    parseOther(tk, used, res, tk.find((t) => OTHER_BRANDS[t]));
  } else if (has('galaxy') || has('samsung') || tk.some((t) => /^[asmjez]\d{1,2}[a-z]*$/.test(t)) || (has('z') && (has('flip') || has('fold')))) {
    parseSamsung(tk, used, res);
  } else if (ctxBrand === 'Apple' && tk.some((t) => /^(\d{1,2}e?|x|xr|xs|se|air)$/.test(t))) {
    parseIphone(tk, used, res);
  } else if (ctxBrand === 'Samsung') {
    parseSamsung(tk, used, res);
  } else if (ctxBrand) res.brand = ctxBrand;

  if (res.kind !== 'phone' && res.kind !== 'tablet' && tk.some((t) => /^(charger|adapter|cable|case|מטען|כבל|כיסוי|מגן)$/.test(t))) {
    res.kind = 'accessory'; res.category = 'accessory';
  }
  if (res.kind === 'audio' || res.kind === 'watch') res.category = 'wearable';
  if (res.kind === 'tablet') res.category = has('ipad') || (res.brand === 'Samsung' && tk.some((t) => /^s\d/.test(t))) ? 'flagship' : 'mid';
  if (has('airtag')) res.category = 'flagship';
  if (has('smartag')) res.category = 'mid';
  res.storage = pickStorage(tk, used);
  tk.forEach((t, i) => { if (['iphone', 'ip', 'lp', 'apple', 'galaxy', 'samsung', 'xiaomi', 'watch', 'sam', 'tab'].includes(t) || isCode(t)) used.add(i); });
  const extra = tk.filter((t, i) => !used.has(i));
  res.extra = extra.join(' ');

  if (!res.model) {
    // שם כללי: הטקסט המקורי באנגלית כפי שנכתב (בלי מילים בעברית)
    const latin = String(text || '').replace(/[֐-׿"'׳״!]+/g, ' ').replace(/[^\x20-\x7e]/g, ' ')
      .replace(/\s*-\s*$/, '').replace(/\s+/g, ' ').trim();
    res.model = latin || null;
    res.storage = null;
    res.extra = extra.filter((t) => /^[֐-׿]/.test(t) || (res.kind === 'watch' && TAGS.has(t))).join(' ');
    if (res.kind === 'watch') {
      const w = tk.filter((t) => t !== 'watch' && !TAGS.has(t) && !/^[֐-׿]/.test(t) && !/^r\d{3}/.test(t));
      res.model = 'Watch ' + w.map((x) => (x === 'se' ? 'SE' : /^gen\d/.test(x) ? 'Gen ' + x.slice(3) : /^\d+m$/.test(x) ? x + 'm' : cap(x))).join(' ');
    }
    if (res.kind === 'audio' && res.brand === 'Samsung') res.model = res.model || 'Buds';
  } else if (res.kind === 'audio' && res.model === 'AirPods') {
    const rest = extra.filter((t) => ['pro', 'max', 'anc'].includes(t) || /^\d$/.test(t));
    res.model = ['AirPods', ...rest.map((w) => (w === 'anc' ? 'ANC' : cap(w)))].join(' ');
  }
  return res;
}

function parseIphone(tk, used, res) {
  res.brand = 'Apple'; res.kind = 'phone'; res.family = 'iphone'; res.category = 'flagship';
  let idx = tk.findIndex((t) => /^(x|xr|xs|se|air|\d{1,2}e?)$/.test(t) && !(/^\d+$/.test(t) && (Number(t) < 4 || Number(t) > 25)));
  if (idx < 0) {
    const ii = tk.findIndex((t) => t === 'iphone' || t === 'ip');
    const nxt = tk[ii + 1];
    if (nxt && /^[\u0590-\u05ff]/.test(nxt)) { used.add(ii + 1); res.model = 'iPhone ' + nxt; } else res.model = 'iPhone';
    return;
  }
  const m = tk[idx]; used.add(idx);
  const parts = [];
  for (let j = idx + 1; j < tk.length && ['pro', 'max', 'plus', 'mini'].includes(tk[j]); j++) { parts.push(cap(tk[j])); used.add(j); }
  const label = /^\d/.test(m) ? m : m === 'air' ? 'Air' : m.toUpperCase();
  res.model = ['iPhone', label, ...parts].join(' ');
  const n = parseInt(m, 10);
  if (m === 'air' || m === '16e' || (n >= 14 && n <= 25)) res.tier = 'new';
  else if (['x', 'xr', 'xs'].includes(m) || (n >= 11 && n <= 13)) res.tier = 'old';
  else res.tier = null; // 8 / SE וכו' – לא מוגדר בטבלה
}

function parseSamsung(tk, used, res) {
  res.brand = 'Samsung'; res.kind = 'phone';
  let letter = null, label = null;
  const zi = tk.findIndex((t) => t === 'z');
  let fi = tk.findIndex((t, k) => (t === 'flip' || t === 'fold') && /^\d{1,2}$/.test(tk[k + 1] || ''));
  if (fi < 0) fi = tk.findIndex((t) => t === 'flip' || t === 'fold');
  if (fi >= 0 && (zi >= 0 || tk.includes('galaxy') || res.brand)) {
    letter = 'z';
    const num = /^\d{1,2}$/.test(tk[fi + 1] || '') ? tk[fi + 1] : '';
    label = `Z ${cap(tk[fi])}${num ? ' ' + num : ''}`;
    if (zi >= 0) used.add(zi); used.add(fi); if (num) used.add(fi + 1);
    var after = fi + (num ? 2 : 1);
  } else {
    const ni = tk.findIndex((t, k) => t === 'note' && /^\d{1,2}$/.test(tk[k + 1] || ''));
    const mi = tk.findIndex((t) => /^[asmjez]\d{1,2}[a-z]*$/.test(t));
    if (ni >= 0 && /^\d{1,2}$/.test(tk[ni + 1] || '')) {
      letter = 'note'; label = `Note ${tk[ni + 1]}`; used.add(ni); used.add(ni + 1); after = ni + 2;
    } else if (mi >= 0) {
      const mm = tk[mi].match(/^([asmjez])(\d{1,2})([a-z]*)$/);
      letter = mm[1];
      label = mm[1].toUpperCase() + mm[2] + (mm[3] ? (mm[3] === 'fe' ? ' FE' : mm[3]) : '');
      used.add(mi); after = mi + 1;
    }
  }
  if (!letter) { res.kind = 'other'; return; }
  const parts = [];
  for (let j = after; j < tk.length; j++) {
    const t = tk[j];
    if (['ultra', 'plus', 'fe', 'lite', 'core', 'edge'].includes(t)) { parts.push(cap(t)); used.add(j); }
    else if (/^20(1[0-9])$/.test(t) && letter !== 'z') { parts.push(t); used.add(j); }
    else if (t === 'oled' || t === '5g') continue;
    else break;
  }
  res.model = ['Galaxy', label, ...parts].join(' ');
  res.family = 'galaxy-' + letter;
  res.tier = { z: 'z', s: 's', a: 'a' }[letter] || null;
  res.category = ['s', 'z', 'note'].includes(letter) ? 'flagship' : 'mid';
}

function parseXiaomi(tk, used, res) {
  res.brand = 'Xiaomi'; res.kind = 'phone'; res.category = 'mid';
  let sub = tk.includes('redmi') ? 'redmi' : tk.includes('poco') ? 'poco' : 'xiaomi';
  const si = tk.findIndex((t) => t === sub || (sub === 'xiaomi' && t === 'mi'));
  if (si >= 0) used.add(si);
  const mi = tk.indexOf('mi'); if (mi >= 0) used.add(mi);
  const parts = [];
  for (let j = si + 1; j < tk.length && parts.length < 3; j++) {
    const t = tk[j];
    if (/^\d+$/.test(t) && STORAGE.has(Number(t))) break;
    if (TAGS.has(t)) break;
    if (/^(note|pro|plus|ultra|lite|[a-z]?\d{1,2}[a-z]{0,2}|[a-z])$/.test(t) && !/^\d+g$/.test(t)) {
      parts.push(t === 'note' || t === 'pro' || t === 'plus' || t === 'ultra' || t === 'lite' ? cap(t) : t.toUpperCase());
      used.add(j);
    } else break;
  }
  const name = sub === 'redmi' ? 'Redmi' : sub === 'poco' ? 'POCO' : (tk.includes('mi') && !tk.includes('xiaomi') ? 'Mi' : 'Xiaomi');
  res.model = [name, ...parts].join(' ');
  if (sub === 'redmi') res.family = 'redmi';
  else if (sub === 'poco') res.family = /^F\d/.test(parts[0] || '') ? 'xiaomi' : null;
  else res.family = 'xiaomi';
  res.tier = res.family ? 'std' : null;
}

function parseOther(tk, used, res, b) {
  res.brand = OTHER_BRANDS[b]; res.kind = 'phone'; res.category = 'mid';
  const bi = tk.indexOf(b); used.add(bi);
  const parts = [];
  for (let j = bi + 1; j < tk.length && parts.length < 3; j++) {
    const t = tk[j];
    if ((/^\d+$/.test(t) && STORAGE.has(Number(t))) || TAGS.has(t) || /^[֐-׿]/.test(t)) break;
    parts.push(/^[a-z]+$/.test(t) ? cap(t) : t.toUpperCase()); used.add(j);
  }
  res.model = [res.brand, ...parts].join(' ');
}

export function modelKey(id) {
  return `${id.brand || ''}|${id.model || ''}`.toLowerCase();
}

export function displayName(id) {
  return [id.model, fmtStorage(id.storage)].filter(Boolean).join(' ');
}

export { fmtStorage };

// מחרוזת חיפוש לפריט – כולל כינויים בעברית
export function searchTokens(str) {
  return tokenize(str).filter((t) => !['iphone', 'ip', 'galaxy', 'samsung', 'apple', 'xiaomi', 'gb'].includes(t));
}
