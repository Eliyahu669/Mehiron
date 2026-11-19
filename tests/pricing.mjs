import fs from 'fs';
import { parseMessage, mergeItems } from '../src/lib/parser.js';
import { buildCatalog, searchModels } from '../src/lib/catalog.js';
import { repairQuote, deviceQuotes, laborFor } from '../src/lib/pricing.js';
import { DEFAULT_CONFIG as cfg } from '../src/lib/defaults.js';
const rd = (f) => fs.readFileSync('tests/fixtures/' + f, 'utf8');
const t = Date.parse('2026-11-19T12:00:00+02:00');
const asi = mergeItems(mergeItems([], parseMessage(rd('asi_main.txt'), { kind: 'devices' }), { now: t }), parseMessage(rd('asi_update.txt'), { kind: 'devices' }), { replace: false, now: t });
const lists = {
  rp: { updatedAt: t, items: mergeItems([], parseMessage(rd('rp.txt'), { kind: 'devices' }), { now: t }) },
  asi: { updatedAt: t, items: asi },
  parts1: { updatedAt: t, items: mergeItems([], parseMessage(rd('parts_from_pdf.txt'), { kind: 'parts', partType: 'screen' }), { now: t }) },
};
const cat = buildCatalog(lists);
console.log('models', cat.models.length, 'devices', cat.devices.length, 'parts', cat.parts.length);
for (const q of ['a54 מסך', '14 פרו', 'אייפון 15 סוללה', 's23 ultra', 'זד פולד 5 מסך', 'note 20 מסך', 'iphone 8 מסך', 'airpods']) {
  const r = searchModels(q, cat);
  console.log(`\n"${q}" → repair=${r.repair}; ${r.models.slice(0, 5).map((m) => m.model + (m.synthetic ? '*' : '')).join(', ')}`);
  const m = r.models[0];
  if (!m) continue;
  if (r.repair) {
    const qt = repairQuote(m, r.repair, cat.parts, cfg);
    console.log(`  labor: ${qt.labor ? qt.labor.amount + ' (' + qt.labor.source + ')' : 'לא מוגדר'}; laborOnly=${qt.laborOnly}`);
    for (const o of qt.options) console.log(`  ${o.quality}: part ${o.part.price} → ₪${o.final}`);
  } else {
    for (const d of deviceQuotes(m, cat.devices, cfg).slice(0, 4)) console.log(`  ${d.item.name} ${d.item.variant}: cost ${d.item.price} +${d.margin}% → ₪${d.final} [${d.suppliers.map(s=>s.supplierId+':'+s.price).join(' ')}]`);
  }
}
console.log('\n14 Pro back:', laborFor({ model: 'iPhone 14 Pro Max', family: 'iphone', tier: 'new' }, 'back', cfg));
console.log('14 back:', laborFor({ model: 'iPhone 14', family: 'iphone', tier: 'new' }, 'back', cfg));
fs.writeFileSync('src/seed.json', JSON.stringify({ seededAt: t, lists }));
console.log('seed bytes', fs.statSync('src/seed.json').size);
