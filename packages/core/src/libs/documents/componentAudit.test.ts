import { describe, expect, it } from 'vitest';
import { declaredVocabulary, proseSheets, proseSheetsNote, vocabularyInCss } from './componentAudit';

const VOCAB = `.vocion-component-vocabulary { --components: journey gantt win2 ovcards drow bdt twocol faq; }`;
const FURNITURE = `.sheet{width:8.5in} .body{padding:0} .foot{position:absolute} .lede{color:teal} .strip{display:flex} .pill{border-radius:16px}`;

const doc = (style: string, sheets: string[]) =>
  `<!doctype html><html><head><style>${style}</style></head><body>${sheets.join('')}</body></html>`;

const sheet = (n: number, label: string, body: string) =>
  `<article class="sheet"><div class="strip"><span class="l">${label}</span></div><div class="body">${body}</div><div class="foot"><div class="pnum">${n} / 7</div></div></article>`;

describe('vocabularyInCss', () => {
  it('reads the declared list, however it is laid out', () => {
    const css = `.vocion-component-vocabulary {\n  --components:\n    journey gantt\n    win2, ovcards;\n}`;

    expect([...vocabularyInCss(css)].sort()).toEqual(['gantt', 'journey', 'ovcards', 'win2']);
  });

  it('accepts a leading dot on a name, because a framework author will write one', () => {
    expect([...vocabularyInCss('.vocion-component-vocabulary{--components:.win2 .gantt}')].sort()).toEqual(['gantt', 'win2']);
  });

  it('never reads the list out of a comment or another rule', () => {
    const css = `/* .vocion-component-vocabulary { --components: ghost } */ .other { --components: also-ghost } .vocion-component-vocabulary { --components: real }`;

    expect([...vocabularyInCss(css)]).toEqual(['real']);
  });

  it('is empty when nothing declares one', () => {
    expect(vocabularyInCss('.sheet{width:8.5in}').size).toBe(0);
    expect(declaredVocabulary('<div class="sheet"></div>').size).toBe(0);
  });

  it('survives an at-rule wrapped around other rules', () => {
    const css = `@media print { .sheet { margin: 0 } } .vocion-component-vocabulary{--components:drow}`;

    expect([...vocabularyInCss(css)]).toEqual(['drow']);
  });
});

describe('proseSheets', () => {
  it('names every sheet that carries nothing from the vocabulary', () => {
    const html = doc(`${VOCAB} ${FURNITURE}`, [
      sheet(1, 'Cover', '<div class="journey"><div class="jstep">x</div></div>'),
      sheet(2, 'The gap today', '<p>Long paragraph.</p><p>Another one.</p>'),
      sheet(3, 'Product 1', '<div class="win2"><div class="wh">app</div></div>'),
    ]);

    expect(proseSheets(html)).toEqual([{ n: 2, label: 'The gap today' }]);
  });

  it('does not count page furniture or an inline ornament as a component', () => {
    // `.sheet`, `.body`, `.foot`, `.strip`, `.lede` and `.pill` all have rules
    // in the framework and are on every page; none of them is in the
    // vocabulary, and a sheet wearing only those is still a wall of text.
    const html = doc(`${VOCAB} ${FURNITURE}`, [
      sheet(1, 'Why now', '<p class="lede">A paragraph.</p><span class="pill done">Ready</span>'),
    ]);

    expect(proseSheets(html)).toEqual([{ n: 1, label: 'Why now' }]);
  });

  it('reports nothing when the framework declares no vocabulary — no finding beats a wrong one', () => {
    const html = doc(FURNITURE, [sheet(1, 'Cover', '<p>All prose.</p>')]);

    expect(proseSheets(html)).toEqual([]);
  });

  it('is quiet on a document where every sheet carries something', () => {
    const html = doc(`${VOCAB} ${FURNITURE}`, [
      sheet(1, 'Cover', '<div class="bdt"><div class="bdt-row">x</div></div>'),
      sheet(2, 'FAQ', '<div class="faq">q</div>'),
    ]);

    expect(proseSheets(html)).toEqual([]);
  });

  it('falls back to the heading when a sheet has no strip label, and to the number when it has neither', () => {
    const html = doc(`${VOCAB} ${FURNITURE}`, [
      '<article class="sheet"><div class="body"><h2>Investment</h2><p>prose</p></div></article>',
      '<article class="sheet"><div class="body"><p>prose</p></div></article>',
    ]);

    expect(proseSheets(html)).toEqual([{ n: 1, label: 'Investment' }, { n: 2, label: '' }]);
  });

  it('reproduces the seven-sheet document three of whose sheets were prose', () => {
    // The shape that started this (a real proposal, anonymised to the fixture
    // cast): cover, gap, three products, plan, investment — with the gap, the
    // plan's preamble and the investment sheet carrying nothing but paragraphs.
    const html = doc(`${VOCAB} ${FURNITURE}`, [
      sheet(1, 'Northwind · Cover', '<div class="journey">strip</div>'),
      sheet(2, 'Where the work goes today', '<p>Two paragraphs about the spreadsheet.</p><p>And the cost of it.</p>'),
      sheet(3, 'Product 1 · Structure Record', '<div class="win2">ui</div>'),
      sheet(4, 'Product 2 · Walkaround', '<div class="win2">ui</div>'),
      sheet(5, 'Product 3 · Quality Read', '<div class="win2">ui</div>'),
      sheet(6, 'The plan', '<p>Four months, described in prose.</p>'),
      sheet(7, 'Investment', '<p>The number, in a sentence.</p>'),
    ]);
    const found = proseSheets(html);

    expect(found).toEqual([
      { n: 2, label: 'Where the work goes today' },
      { n: 6, label: 'The plan' },
      { n: 7, label: 'Investment' },
    ]);
    expect(proseSheetsNote(found, 7)).toBe(
      '3 of 7 sheets carry no component from the framework\'s vocabulary: 2 (Where the work goes today), 6 (The plan), 7 (Investment). Each is a wall of text unless its own prose says in one line why it needs no visual.',
    );
  });
});

describe('proseSheetsNote', () => {
  it('says nothing when there is nothing to say', () => {
    expect(proseSheetsNote([], 12)).toBeNull();
  });

  it('reads as one sheet, singular', () => {
    expect(proseSheetsNote([{ n: 4, label: 'Measurement' }], 12)).toContain('1 of 12 sheet carries no component');
  });
});
