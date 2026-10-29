/**
 * The Prompts register's pure parts: one key per prompt however it is
 * written, what a save writes onto a row (never an older check over a newer
 * one), an Ahrefs Brand Radar export read by its headers, and the export read
 * back to the same prompts. Every brand here is fictional.
 */
import type { SeoPromptMeta } from './prompts';
import { describe, expect, it } from 'vitest';
import { mergePromptInputs, parseBrandRadarCsv, parseCsv, platformFrom, promptKey, promptPatch, toBrandRadarCsv } from './prompts';

const ROW: SeoPromptMeta = { projectId: 1, prompt: 'best invoicing tool for agencies', promptKey: 'best invoicing tool for agencies', platforms: ['chatgpt'], source: 'agent', status: 'tracked', visibility: 'unchecked' };

describe('a prompt\'s key', () => {
  it('is the same however the prompt is written', () => {
    expect(promptKey('  Best  invoicing tool for “agencies”? ')).toBe(promptKey('best invoicing tool for agencies'));
    expect(promptKey('Is Tally Books good?')).toBe('is tally books good');
  });
});

describe('a save onto a row', () => {
  it('adds platforms and takes a newer check, with its visibility', () => {
    const patch = promptPatch(ROW, { prompt: ROW.prompt, platforms: ['perplexity', 'chatgpt'], mentioned: true, cited: false, competitorsMentioned: ['ledgerly.example'], checkedAt: '2026-10-29T00:00:00.000Z', checkedWith: 'Ahrefs Brand Radar export' }, 'usr-mara');

    expect(patch).toMatchObject({ platforms: ['chatgpt', 'perplexity'], platformsLabel: 'ChatGPT, Perplexity', mentioned: true, cited: false, visibility: 'mentioned', checkedAt: '2026-10-29T00:00:00.000Z' });
  });

  it('never lets an older check overwrite a newer one, and takes the group and why when given', () => {
    const current = { ...ROW, mentioned: true, cited: true, visibility: 'cited' as const, checkedAt: '2026-10-29T00:00:00.000Z' };
    const patch = promptPatch(current, { prompt: ROW.prompt, group: 'category', mentioned: false, checkedAt: '2026-09-01T00:00:00.000Z', why: 'buyers start here' }, 'usr-mara', new Date('2026-10-30T00:00:00Z'));

    expect(patch.mentioned).toBeUndefined();
    expect(patch).toMatchObject({ group: 'category', groupLabel: 'Category', why: { text: 'buyers start here', at: '2026-10-30T00:00:00.000Z', by: 'usr-mara' } });
  });

  it('merges one prompt\'s rows across platforms: a mention anywhere counts', () => {
    const [one] = mergePromptInputs([
      { prompt: 'Tally Books vs Ledgerly', platforms: ['chatgpt'], mentioned: false, checkedAt: '2026-10-01T00:00:00.000Z' },
      { prompt: 'tally books vs ledgerly?', platforms: ['perplexity'], mentioned: true, competitorsMentioned: ['Ledgerly'], checkedAt: '2026-10-02T00:00:00.000Z' },
    ]);

    expect(one).toMatchObject({ prompt: 'Tally Books vs Ledgerly', platforms: ['chatgpt', 'perplexity'], mentioned: true, competitorsMentioned: ['Ledgerly'], checkedAt: '2026-10-02T00:00:00.000Z' });
  });
});

describe('an Ahrefs Brand Radar export', () => {
  const EXPORT = [
    '﻿Query,AI platform,Brand mentioned,Cited pages,Competitors mentioned,Date,Country',
    'best invoicing tool for agencies,ChatGPT,Yes,https://tally-books.example/pricing,"Ledgerly; Billstream",2026-10-20,US',
    'best invoicing tool for agencies,AI Overview,No,,Ledgerly,2026-10-21,US',
    '"how do I stop chasing ""late"" payments",Perplexity,0,,,2026-10-20,US',
    ',ChatGPT,Yes,,,2026-10-20,US',
  ].join('\r\n');

  it('is read by its headers, rows of one prompt merged, each column named and the rest left out', () => {
    const r = parseBrandRadarCsv(EXPORT, '2026-10-29T12:00:00.000Z');

    expect(r.columns).toEqual({ prompt: 'Query', platform: 'AI platform', mentioned: 'Brand mentioned', cited: 'Cited pages', competitors: 'Competitors mentioned', checked: 'Date' });
    expect(r.ignored).toEqual(['Country']);
    expect(r.skipped).toBe(1);
    expect(r.prompts).toHaveLength(2);
    expect(r.prompts[0]).toMatchObject({ prompt: 'best invoicing tool for agencies', platforms: ['chatgpt', 'google_ai_overviews'], mentioned: true, cited: true, citedUrls: ['https://tally-books.example/pricing'], competitorsMentioned: ['Ledgerly', 'Billstream'], checkedAt: '2026-10-21T00:00:00.000Z', checkedWith: 'Ahrefs Brand Radar export' });
    expect(r.prompts[1]).toMatchObject({ prompt: 'how do I stop chasing "late" payments', platforms: ['perplexity'], mentioned: false });
  });

  it('says when no column holds the prompts', () => {
    expect(parseBrandRadarCsv('Name,Value\na,b', 'x').columns.prompt).toBeUndefined();
    expect(platformFrom('Google AI Mode')).toBe('google_ai_mode');
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('round-trips: the export read back gives the same prompts', () => {
    const rows: SeoPromptMeta[] = [
      { ...ROW, prompt: 'best invoicing tool, for agencies', promptKey: 'x', group: 'category', intent: 'commercial', platforms: ['chatgpt', 'google_ai_overviews'], mentioned: true, cited: false, competitorsMentioned: ['Ledgerly', 'Billstream'], checkedAt: '2026-10-21T00:00:00.000Z' },
      { ...ROW, prompt: 'is "Tally Books" good for freelancers', promptKey: 'y', group: 'brand', platforms: ['perplexity'] },
    ];
    const csv = toBrandRadarCsv(rows);
    const back = parseBrandRadarCsv(csv, '2026-10-29T12:00:00.000Z');

    expect(csv.split('\r\n')[0]).toBe('Prompt,Group,Intent,Platforms,Mentioned,Cited,Competitors mentioned,Last checked');
    expect(back.ignored).toEqual([]);
    expect(back.prompts.map(p => ({ prompt: p.prompt, group: p.group, intent: p.intent, platforms: p.platforms, mentioned: p.mentioned, cited: p.cited, competitorsMentioned: p.competitorsMentioned, checkedAt: p.checkedAt }))).toEqual([
      { prompt: 'best invoicing tool, for agencies', group: 'category', intent: 'commercial', platforms: ['chatgpt', 'google_ai_overviews'], mentioned: true, cited: false, competitorsMentioned: ['Ledgerly', 'Billstream'], checkedAt: '2026-10-21T00:00:00.000Z' },
      { prompt: 'is "Tally Books" good for freelancers', group: 'brand', intent: undefined, platforms: ['perplexity'], mentioned: undefined, cited: undefined, competitorsMentioned: undefined, checkedAt: undefined },
    ]);
  });
});
