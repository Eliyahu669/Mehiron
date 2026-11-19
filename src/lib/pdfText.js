// הפיכת PDF (מחירון טבלאי) לשורות טקסט מופרדות בטאבים, לפי מיקום על הדף
export async function pdfToLines(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      const str = (it.str || '').trim();
      if (!str) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, cells: [] }; rows.push(row); }
      row.cells.push({ x, str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) out.push(r.cells.sort((a, b) => a.x - b.x).map((c) => c.str).join('\t'));
  }
  return out.join('\n');
}
