// מחירון לדוגמה מהקבצים הפרטיים (לא בריפו): חלקים + מחירי מכשירים לפי רשימת המכשירים. כותב את src/seed.json לתצוגה המקומית
import fs from 'fs';
import { parseMessage, mergeItems } from '../../src/lib/parser.js';
import { buildCatalog, searchModels } from '../../src/lib/catalog.js';
import { repairQuote, laborFor } from '../../src/lib/pricing.js';
import { defaultCatalog, matchSupplierItems, applySupplierImport, priceIndex, CATALOG_ID } from '../../src/lib/devices.js';
import { buildFullCatalog, getDeviceQuotes } from '../../src/lib/publish.js';
import { mergeConfig } from '../../src/lib/store.js';
const cfg = mergeConfig(null);
const rd = (f) => fs.readFileSync('tests/fixtures/' + f, 'utf8');
const t = Date.parse('2026-11-19T12:00:00+02:00');

// מחירי מכשירים: כל הודעה מותאמת לרשימה (שורות גרסה חדשות נוספות, מה שלא ברשימה מדולג – כמו "דלג")
let rows = defaultCatalog();
const lists = { parts1: { updatedAt: t, items: mergeItems([], parseMessage(rd('parts_from_pdf.txt'), { kind: 'parts', partType: 'screen' }), { now: t }) } };
for (const [sid, file, replace] of [['rp', 'rp.txt', true], ['asi', 'asi_main.txt', true], ['asi', 'asi_update.txt', false]]) {
  const items = parseMessage(rd(file), { kind: 'devices' });
  const m = matchSupplierItems(items, rows, priceIndex({ ...lists, [CATALOG_ID]: { items: rows } }, cfg), cfg);
  const res = applySupplierImport({ rows, oldItems: lists[sid]?.items || [], match: m, replace, now: t });
  if (res.catalog) rows = res.catalog;
  lists[sid] = { updatedAt: t, items: res.items };
  console.log(`${file}: ${m.hits.length} מחירים, ${m.created.length} גרסאות חדשות, ${m.review.length} לא ברשימה`);
}
lists[CATALOG_ID] = { updatedAt: t, items: rows };

const cat = buildCatalog(lists);
const full = buildFullCatalog(lists, cfg);
console.log('models', cat.models.length, 'parts', cat.parts.length, 'device models', full.devModels.length, 'priced', full.devModels.filter((m) => m.priced).length);
for (const q of ['a54 מסך', 'אייפון 15 סוללה', 'זד פולד 5 מסך', 'note 20 מסך', 'iphone 8 מסך']) {
  const r = searchModels(q, cat);
  const m = r.models[0];
  console.log(`\n"${q}" → repair=${r.repair}; ${r.models.slice(0, 5).map((x) => x.model + (x.synthetic ? '*' : '')).join(', ')}`);
  if (!m || !r.repair) continue;
  const qt = repairQuote(m, r.repair, cat.parts, cfg);
  console.log(`  labor: ${qt.labor ? qt.labor.amount + ' (' + qt.labor.source + ')' : 'לא מוגדר'}; laborOnly=${qt.laborOnly}`);
  for (const o of qt.options) console.log(`  ${o.quality}: part ${o.part.price} → ₪${o.final}`);
}
for (const q of ['iphone 16e', 'iphone 17 pro max', 's25 ultra', 'a56', 'a16', 'redmi note 14']) {
  const m = searchModels(q, { models: full.devModels }, { kindFilter: 'devices' }).models[0];
  if (!m) { console.log(`\n"${q}" → לא נמצא`); continue; }
  console.log(`\n"${q}" → ${m.model} (${m.segment})`);
  for (const d of getDeviceQuotes(m, full, cfg).filter((x) => x.final != null).slice(0, 4)) console.log(`  ${d.row.storage || ''} ${d.row.version}: cost ${d.best.price} → ₪${d.final} [${d.suppliers.map((s) => s.supplierId + ':' + s.price).join(' ')}]`);
}
console.log('\n14 Pro back:', laborFor({ model: 'iPhone 14 Pro Max', family: 'iphone', tier: 'new' }, 'back', cfg));
fs.writeFileSync('src/seed.json', JSON.stringify({ seededAt: t, lists }));
console.log('seed bytes', fs.statSync('src/seed.json').size);
