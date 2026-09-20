import { describe, expect, it } from 'vitest';
import { classesInCss, definedClasses, undefinedClasses, usedClasses } from './classAudit';

const doc = (style: string, body: string) => `<!doctype html><html><head><style>${style}</style></head><body>${body}</body></html>`;

describe('usedClasses', () => {
  it('reads every class attribute once, in document order', () => {
    expect(usedClasses('<div class="a b"><p class="b c">x</p></div>')).toEqual(['a', 'b', 'c']);
  });

  it('accepts single quotes', () => {
    expect(usedClasses(`<div class='a  b'></div>`)).toEqual(['a', 'b']);
  });

  it('ignores class names inside <style> and <script>', () => {
    const html = '<style>.only-a-rule{color:red}</style><script>el.className = "only-in-js";</script><div class="real"></div>';

    expect(usedClasses(html)).toEqual(['real']);
  });
});

describe('classesInCss', () => {
  it('takes class names from selectors only, never from declarations or comments', () => {
    const css = `/* .commented-out was here */ .real, .also-real > .nested:hover { content: ".in-a-value"; }`;

    expect([...classesInCss(css)].sort()).toEqual(['also-real', 'nested', 'real']);
  });

  it('sees a rule that only exists inside an at-rule', () => {
    expect(classesInCss('@media print { .print-only { display: none } }').has('print-only')).toBe(true);
  });

  it('does not treat an at-rule prelude as a selector', () => {
    expect(classesInCss('@page { margin: 0 }').size).toBe(0);
  });
});

describe('undefinedClasses', () => {
  it('names every class the markup uses that no rule defines', () => {
    const html = doc('.sheet{width:8.5in} .ovc{border:1px solid}', '<article class="sheet"><div class="ovcards"><div class="ovc"><div class="ovh"><span class="oht">t</span></div></div></div></article>');

    expect(undefinedClasses(html)).toEqual(['ovcards', 'ovh', 'oht']);
  });

  it('is clean when the stylesheet defines everything', () => {
    const html = doc('.sheet{}.a{}.b{}', '<article class="sheet"><p class="a b"></p></article>');

    expect(undefinedClasses(html)).toEqual([]);
  });

  it('counts a rule in any of the document\'s style blocks, in any order', () => {
    const html = '<style>.late{}</style><style>.early{}</style><div class="early late"></div>';

    expect(undefinedClasses(html)).toEqual([]);
    expect(definedClasses(html).size).toBe(2);
  });

  it('reproduces the drift found on a live proposal: components used, rules absent', () => {
    // The fifteen that rendered as bare divs (2026-09-19). Every one of them
    // is in the skill's own `framework.css`; none was in the document.
    const drifted = ['ovcards', 'ovc', 'ovh', 'ovb', 'oht', 'dtiles', 'dtile', 'dv', 'dk', 'opts', 'opts-h', 'opt-row', 'opt-v', 'acc', 'dots'];
    const html = doc('.sheet{}.body{}.foot{}', `<article class="sheet"><div class="body">${drifted.map(c => `<div class="${c}"></div>`).join('')}</div><div class="foot"></div></article>`);

    expect(undefinedClasses(html)).toEqual(drifted);
  });
});
