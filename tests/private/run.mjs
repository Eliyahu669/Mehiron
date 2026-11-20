import fs from 'fs';
import { parseMessage } from '../../src/lib/parser.js';

const dir = new URL('../fixtures/', import.meta.url);
const show = process.argv.includes('-v');
for (const f of ['asi_main.txt', 'asi_update.txt', 'rp.txt']) {
  const items = parseMessage(fs.readFileSync(new URL(f, dir), 'utf8'), { kind: 'devices' });
  const bad = items.filter((i) => !i.ok);
  console.log(`\n=== ${f}: ${items.length} פריטים, ${bad.length} לא זוהו`);
  for (const it of items) if (show || !it.ok) console.log(`${it.ok ? ' ' : '✗'} ${String(it.price).padStart(5)} | ${it.name} | ${it.variant} | fam=${it.family} tier=${it.tier} cat=${it.category} || ${it.raw}`);
}
