// התאמת הודעות הספקים האמיתיות לרשימת המכשירים (קבצים פרטיים – לא בריפו)
import fs from 'fs';
import { parseMessage } from '../../src/lib/parser.js';
import { defaultCatalog, matchSupplierItems, applySupplierImport, rowLabel } from '../../src/lib/devices.js';
import { mergeConfig } from '../../src/lib/store.js';
const dir = new URL('../fixtures/', import.meta.url);
const cfg = mergeConfig(null);
const v = process.argv.includes('-v');
let rows = defaultCatalog();
for (const f of ['rp.txt', 'asi_main.txt']) {
  const items = parseMessage(fs.readFileSync(new URL(f, dir), 'utf8'), { kind: 'devices' });
  const m = matchSupplierItems(items, rows, new Map(), cfg);
  const res = applySupplierImport({ rows, oldItems: [], match: m, replace: true });
  console.log(`\n=== ${f}: ${items.filter((i) => i.ok).length} פריטים · מותאמים ${m.hits.length} · גרסאות חדשות ${m.created.length} · קיבלו גרסה ${m.claimed.length} · לא ברשימה ${m.review.length}`);
  if (v) for (const h of m.hits) console.log('  ✓', String(h.price).padStart(5), rowLabel(h.row), '||', h.raw);
  const byStatus = {};
  for (const r of m.review) (byStatus[r.status] ||= []).push(r);
  for (const [st, arr] of Object.entries(byStatus)) {
    console.log(`  -- ${st}: ${arr.length}`);
    for (const r of arr.slice(0, v ? 999 : 40)) console.log(`     ${String(r.item.price).padStart(5)} | ${r.item.name} | ver=${r.ver} | ${r.item.mkey} || ${r.item.raw}`);
  }
  if (res.catalog) rows = res.catalog;
}
