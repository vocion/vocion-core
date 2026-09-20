import { describe, expect, it } from 'vitest';
import { undefinedClasses } from './classAudit';
import { FRAMEWORK_ATTR, injectFramework, stripFramework } from './framework';

const page = '<!doctype html><html><head><title>T</title><style>:root{--ink:#000}</style></head><body><article class="sheet"><div class="ovc"></div></article></body></html>';

describe('injectFramework', () => {
  it('puts the framework ahead of the author\'s style, so their tokens still win', () => {
    const out = injectFramework(page, '.ovc{border:1px}', 'proposal-document');

    expect(out.indexOf(FRAMEWORK_ATTR)).toBeLessThan(out.indexOf(':root{--ink:#000}'));
    expect(out).toContain('<article class="sheet">');
  });

  it('turns a document full of drifting classes into one with none', () => {
    expect(undefinedClasses(page)).toEqual(['sheet', 'ovc']);
    expect(undefinedClasses(injectFramework(page, '.sheet{}.ovc{}', 'x'))).toEqual([]);
  });

  it('falls back to the end of <head>, then to the top, when there is no style block', () => {
    const noStyle = '<html><head><title>T</title></head><body><article class="sheet"></article></body></html>';

    expect(injectFramework(noStyle, '.a{}', 'x')).toMatch(/<title>T<\/title><style [^>]*>\n\.a\{\}\n<\/style>\n<\/head>/);
    expect(injectFramework('<article class="sheet"></article>', '.a{}', 'x')).toMatch(/^<style /);
  });

  it('replaces the block it already wrote instead of stacking a second one', () => {
    const once = injectFramework(page, '.v1{}', 'proposal-document');
    const twice = injectFramework(once, '.v2{}', 'proposal-document');

    expect(twice.match(new RegExp(FRAMEWORK_ATTR, 'g'))).toHaveLength(1);
    expect(twice).toContain('.v2{}');
    expect(twice).not.toContain('.v1{}');
  });

  it('records the skill the CSS came from, so a workspace override is visible in the file', () => {
    expect(injectFramework(page, '.a{}', 'client-documents')).toContain(`${FRAMEWORK_ATTR}="client-documents"`);
  });

  it('injects nothing for an empty stylesheet', () => {
    expect(injectFramework(page, '   ', 'x')).toBe(page);
  });
});

describe('stripFramework', () => {
  it('gives back exactly what the author wrote', () => {
    expect(stripFramework(injectFramework(page, '.a{}', 'x'))).toBe(page);
  });

  it('leaves a document that never had one alone, however many times it runs', () => {
    expect(stripFramework(stripFramework(page))).toBe(page);
  });

  it('never touches a style block the author wrote', () => {
    const out = stripFramework(injectFramework(page, '.a{}', 'x'));

    expect(out).toContain('<style>:root{--ink:#000}</style>');
  });
});
