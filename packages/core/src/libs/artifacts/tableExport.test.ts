import { describe, expect, it } from 'vitest';
import { exportFilename, extractTables, parseNumericCell, sheetNames, tableFromSpec, tablesFromHtml, toCsv, toXlsx } from './tableExport';
import { hasExportableTables, tableExportHref } from './tableExportAvailability';

/** A finance document the way the document engine writes one: sheets, headings, tables. */
const NORTHWIND_REPORT = `<!doctype html><html><body>
<section class="sheet"><h1>Northwind Traders - Monthly Performance Report</h1>
<h2>Scorecard (Profit and Loss, accrual)</h2>
<table>
<tr><th>USD</th><th>Mar</th><th>Feb</th><th>Chg $</th><th>Chg %</th></tr>
<tr><td>Revenue</td><td>212,400.50</td><td>198,000.00</td><td>14,400.50</td><td>7.3%</td></tr>
<tr><td>Net income</td><td>−12,250.75</td><td>8,100.00</td><td>-20,350.75</td><td>-251.2%</td></tr>
<tr><td>Gross margin %</td><td>41.0%</td><td>44.5%</td><td>-3.5 pts</td><td></td></tr>
</table>
<h2>What moved</h2>
<table>
<caption>Driver bridge</caption>
<tr><th>Driver</th><th>Effect</th></tr>
<tr><td>1. Contractor cost up</td><td>($9,200)</td></tr>
<tr><td colspan="2">Notes: see the ledger</td></tr>
</table>
</section></body></html>`;

describe('parseNumericCell', () => {
  it('reads a whole-cell number with its display format', () => {
    expect(parseNumericCell('212,400.50')).toEqual({ v: 212400.5, z: '#,##0.00' });
    expect(parseNumericCell('212,400.50', true)).toEqual({ v: 212400.5, z: '"$"#,##0.00' });
    expect(parseNumericCell('-$47.10')).toEqual({ v: -47.1, z: '"$"#,##0.00' });
    expect(parseNumericCell('$-47.10')).toEqual({ v: -47.1, z: '"$"#,##0.00' });
    expect(parseNumericCell('−12,250.75')).toEqual({ v: -12250.75, z: '#,##0.00' });
    expect(parseNumericCell('($9,200)')).toEqual({ v: -9200, z: '"$"#,##0' });
    expect(parseNumericCell('7.3%')).toEqual({ v: 0.073, z: '0.0%' });
    expect(parseNumericCell('-251.2%')!.v).toBeCloseTo(-2.512);
    expect(parseNumericCell('2026')).toEqual({ v: 2026 });
  });

  it('leaves anything that is not only a number as text', () => {
    for (const text of ['-3.5 pts', '1. Contractor cost up', 'Mar 31, 2026', '', 'n/a', '12 months', '1,23', '$', '%']) {
      expect(parseNumericCell(text)).toBeNull();
    }
  });
});

describe('tablesFromHtml', () => {
  it('finds every table, named by the heading above it or its caption', () => {
    const tables = tablesFromHtml(NORTHWIND_REPORT);

    expect(tables.map(t => t.name)).toEqual(['Scorecard (Profit and Loss, accrual)', 'Driver bridge']);
  });

  it('keeps the header as words and types the body cells', () => {
    const [scorecard] = tablesFromHtml(NORTHWIND_REPORT);

    expect(scorecard!.rows[0]!.map(c => c.v)).toEqual(['USD', 'Mar', 'Feb', 'Chg $', 'Chg %']);
    // The USD corner says the money columns are dollars.
    expect(scorecard!.rows[1]![1]).toEqual({ v: 212400.5, z: '"$"#,##0.00' });
    expect(scorecard!.rows[2]![1]).toEqual({ v: -12250.75, z: '"$"#,##0.00' });
    expect(scorecard!.rows[3]![3]).toEqual({ v: '-3.5 pts' });
  });

  it('pads a spanned cell so the columns stay aligned', () => {
    const [, bridge] = tablesFromHtml(NORTHWIND_REPORT);

    expect(bridge!.rows[2]!.map(c => c.v)).toEqual(['Notes: see the ledger', '']);
  });

  it('falls back to a numbered name when nothing names a table', () => {
    expect(tablesFromHtml('<table><tr><td>a</td></tr></table>', 'Kestrel memo').map(t => t.name)).toEqual(['Kestrel memo 1']);
  });
});

describe('tableFromSpec', () => {
  it('types a table artifact by its columns (percent is 0–100 on the card)', () => {
    const table = tableFromSpec({
      title: 'Contoso pipeline',
      columns: [{ key: 'name', label: 'Deal' }, { key: 'value', type: 'currency' }, { key: 'win', label: 'Win %', type: 'percent' }, { key: 'open', type: 'text' }],
      rows: [{ name: 'Bellwater Hall', value: 42000, win: 35, open: true }, { name: 'Acme', value: null, win: 'n/a', open: false }],
    }, 'fallback');

    expect(table.name).toBe('Contoso pipeline');
    expect(table.rows[0]!.map(c => c.v)).toEqual(['Deal', 'value', 'Win %', 'open']);
    expect(table.rows[1]).toEqual([{ v: 'Bellwater Hall' }, { v: 42000, z: '"$"#,##0.00' }, { v: 0.35, z: '0.0%' }, { v: 'Yes' }]);
    expect(table.rows[2]).toEqual([{ v: 'Acme' }, { v: '' }, { v: 'n/a' }, { v: 'No' }]);
  });
});

describe('extractTables / hasExportableTables', () => {
  it('reads a document and a table artifact, and nothing else', () => {
    expect(extractTables({ kind: 'document', title: 'Report', spec: { html: NORTHWIND_REPORT } })).toHaveLength(2);
    expect(extractTables({ kind: 'table', title: 'T', spec: { columns: [{ key: 'a' }], rows: [{ a: 1 }] } })).toHaveLength(1);
    expect(extractTables({ kind: 'markdown', title: 'M', spec: { md: '| a |\n| - |\n| 1 |' } })).toEqual([]);
  });

  it('says whether there is anything to export without parsing the HTML', () => {
    expect(hasExportableTables({ kind: 'document', spec: { html: NORTHWIND_REPORT } })).toBe(true);
    expect(hasExportableTables({ kind: 'document', spec: { html: '<p>No tables here</p>' } })).toBe(false);
    expect(hasExportableTables({ kind: 'table', spec: { rows: [] } })).toBe(false);
    expect(hasExportableTables({ kind: 'chart', spec: {} })).toBe(false);
    expect(tableExportHref(42, 'xlsx')).toBe('/api/artifacts/42/tables?format=xlsx');
  });
});

describe('sheetNames', () => {
  it('follows Excel\'s rules: 31 characters, no []:*?/\\, unique', () => {
    const names = sheetNames(['Cash and balance sheet (Balance Sheet, Mar 31 vs Feb 28)', 'A/B: [test]?', 'Same', 'same']);

    expect(names[0]!.length).toBeLessThanOrEqual(31);
    expect(names[1]).toBe('A B test');
    expect(names[2]).toBe('Same');
    expect(names[3]).toBe('same (2)');
  });
});

describe('toXlsx / toCsv', () => {
  it('writes a workbook whose cells read back as numbers with formats', async () => {
    const XLSX = await import('xlsx');
    const tables = tablesFromHtml(NORTHWIND_REPORT);
    const book = XLSX.read(await toXlsx(tables), { type: 'buffer', cellNF: true });

    expect(book.SheetNames).toEqual(['Scorecard (Profit and Loss, acc', 'Driver bridge']);

    const sheet = book.Sheets[book.SheetNames[0]!]!;

    expect(sheet.B2).toMatchObject({ t: 'n', v: 212400.5, z: '"$"#,##0.00' });
    expect(sheet.E2).toMatchObject({ t: 'n', v: 0.073, z: '0.0%' });
    expect(sheet.D4).toMatchObject({ t: 's', v: '-3.5 pts' });
  });

  it('writes CSV with quoting and percents as the document said them', () => {
    const [scorecard] = tablesFromHtml(NORTHWIND_REPORT);
    const lines = toCsv(scorecard!).trim().split('\r\n');

    expect(lines[0]).toBe('USD,Mar,Feb,Chg $,Chg %');
    expect(lines[1]).toBe('Revenue,212400.5,198000,14400.5,7.3%');
    expect(toCsv({ name: 'q', rows: [[{ v: 'a, "b"' }]] })).toBe('"a, ""b"""\r\n');
  });

  it('names the download after the artifact', () => {
    expect(exportFilename('Report: March / Q1', 'xlsx')).toBe('Report March Q1.xlsx');
  });
});
