/**
 * Every accepted Office, mail and table format, converted from a small
 * fictional file built in the test (`./officeFixtures.ts`) — the repo is
 * public, so no real export is checked in.
 */
import type { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { formatOf } from '@/libs/chat/attachmentFormats';
import { convertForModel, PREVIEW_ROWS, readFullText, readTables } from './convert';
import * as fx from './officeFixtures';

const format = (name: string) => {
  const f = formatOf({ name });
  if (!f) {
    throw new Error(`no format for ${name}`);
  }
  return f;
};

describe('spreadsheets become tables', () => {
  it.each([
    ['xlsx', 'xlsx'],
    ['xlsm', 'xlsm'],
    ['xls', 'biff8'],
    ['ods', 'ods'],
  ] as const)('a small .%s is inlined whole as a markdown table', async (ext, bookType) => {
    const data = await fx.workbook({ Leads: fx.leadRows(3) }, bookType);
    const out = await convertForModel(data, format(`leads.${ext}`));

    expect(out.text).toContain('## 3 rows × 5 columns');
    expect(out.text).toContain('| Name | Company | Email | Stage | Deal size |');
    expect(out.text).toContain('| Lead 002 | Contoso Supply | lead2@contososupply.example | Qualified | 3000 |');
    expect(out.sheets).toEqual([{ name: 'Leads', rows: 3, columns: ['Name', 'Company', 'Email', 'Stage', 'Deal size'] }]);
  });

  it('summarises a big sheet — columns, row count, the first rows — and points at the tool for the rest', async () => {
    const data = await fx.workbook({ Leads: fx.leadRows(1200), Owners: [['Owner', 'Region'], ['Sam Ito', 'West']] });
    const out = await convertForModel(data, format('Export-All-Leads.xlsx'));

    expect(out.text).toContain('Excel spreadsheet with 2 sheets: “Leads” (1,200 rows), “Owners” (1 row).');
    expect(out.text).toContain('## Sheet “Leads” — 1,200 rows × 5 columns');
    expect(out.text).toContain('Columns: Name, Company, Email, Stage, Deal size');
    expect(out.text).toContain(`| Lead ${String(PREVIEW_ROWS).padStart(3, '0')} |`);
    expect(out.text).not.toContain(`| Lead ${String(PREVIEW_ROWS + 1).padStart(3, '0')} |`);
    expect(out.text).toContain('(1,180 more rows not shown. Read, filter or count every row with read_attachment.)');
    // The small second sheet is whole.
    expect(out.text).toContain('| Sam Ito | West |');
    // A preview, not the sheet: far smaller than the data.
    expect(out.text.length).toBeLessThan(6000);
  });

  it('reads every row of every sheet for the tool', async () => {
    const tables = await readTables(await fx.workbook({ Leads: fx.leadRows(1200) }), format('leads.xlsx'));

    expect(tables[0]!.rows).toHaveLength(1200);
    expect(tables[0]!.rows.at(-1)![0]).toBe('Lead 1200');
  });

  it('reads CSV with quoted commas and a byte-order mark, and TSV by its tabs', async () => {
    const { Buffer: B } = await import('node:buffer');
    const csv = await readTables(B.from('﻿Name,Company\nLead 1,"Northwind, Inc"\n'), format('a.csv'));
    const tsv = await readTables(B.from('Name\tCompany\nLead 1\tKestrel Capital, LLC\n'), format('a.tsv'));

    expect(csv[0]).toMatchObject({ header: ['Name', 'Company'], rows: [['Lead 1', 'Northwind, Inc']] });
    expect(tsv[0]).toMatchObject({ header: ['Name', 'Company'], rows: [['Lead 1', 'Kestrel Capital, LLC']] });
  });

  it('names blank and repeated headers so every column can be asked for', async () => {
    const tables = await readTables(await fx.workbook({ S: [['Name', '', 'Name'], ['a', 'b', 'c']] }), format('a.xlsx'));

    expect(tables[0]!.header).toEqual(['Name', 'Column 2', 'Name (2)']);
  });
});

describe('documents become text with headings', () => {
  it('a Word document keeps its title, headings, lists and tables', async () => {
    const out = await convertForModel(await fx.docx(), format('plan.docx'));

    expect(out.text).toBe([
      '# Northwind renewal plan',
      '# Background',
      'Northwind has bought from Contoso Supply since 2021.',
      '## Risks',
      '- Budget moves to Q3',
      '- A new buyer at Kestrel Capital',
      '| Owner | Due |\n| --- | --- |\n| Bellwater Hall | 2026-11-03 |',
    ].join('\n\n'));
  });

  it('an OpenDocument text the same way', async () => {
    const out = await convertForModel(await fx.odt(), format('booking.odt'));

    expect(out.text).toBe('# Bellwater Hall booking\n\nTwo nights for Larkfield Systems.\n\n- Dinner for 40');
  });
});

describe('slides become one section per slide', () => {
  it('a PowerPoint deck in presentation order, with titles and speaker notes, without slide numbers', async () => {
    const out = await convertForModel(await fx.pptx(), format('review.pptx'));

    expect(out.slides).toBe(3);
    expect(out.text).toBe([
      '## Slide 1: Kestrel Capital — Q4 review',
      'Agenda\n\nPipeline',
      '## Slide 2: Pipeline',
      'Northwind: Qualified\n\nContoso Supply: Won',
      'Speaker notes: Mention the renewal date.',
      '## Slide 3: Next steps',
      'Send the proposal',
    ].join('\n\n'));
  });

  it('an OpenDocument presentation too', async () => {
    const out = await convertForModel(await fx.odp(), format('onboarding.odp'));

    expect(out.text).toContain('## Slide 1: Welcome\n\nLarkfield Systems onboarding');
    expect(out.text).toContain('## Slide 2: Timeline\n\nKickoff on Monday');
  });
});

describe('mail becomes its headers and body', () => {
  it('an .eml', async () => {
    const text = await readFullText(fx.eml(), format('quote.eml'));

    expect(text).toContain('Subject: Revised quote');
    expect(text).toContain('From: Dana Reyes <dana@contososupply.example>');
    expect(text).toContain('To: Sam Ito <sam@northwind.example>');
    expect(text).toContain('The revised quote is 12,400 for the first year.');
  });

  it('an Outlook .msg', async () => {
    const text = await readFullText(await fx.msg(), format('hold.msg'));

    expect(text).toContain('Subject: Bellwater Hall hold');
    expect(text).toContain('From: Alex Morgan <alex@bellwaterhall.example>');
    expect(text).toContain('We are holding the ballroom for Kestrel Capital until Friday.');
  });
});

describe('a file that is not what its name says', () => {
  it('throws, so the upload route attaches it with "no text could be extracted" instead of failing the upload', async () => {
    const { Buffer: B } = await import('node:buffer');
    const notAZip: Buffer = B.from('this is not a zip');

    await expect(convertForModel(notAZip, format('fake.docx'))).rejects.toThrow();
  });
});
