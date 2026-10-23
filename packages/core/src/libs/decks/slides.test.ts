import { describe, expect, it } from 'vitest';
import { assetRefs, checkSlide, findPlaceholders, iconNamesIn, normaliseSlideHtml, sectionId, slideText, withNotes } from './slides';

const slide = (body: string, id = 'cover') => `<section id="${id}" style="background:#0b1f2a;color:#fff;display:flex;flex-direction:column;padding:120px">${body}</section>`;

describe('checkSlide', () => {
  it('accepts a slide in the contract, counting its elements', () => {
    const c = checkSlide('cover', slide('<h1>Northwind runs on one record</h1><p>Kestrel Capital, Q3</p><x-icon name="Lock"/><aside>From the 2026-09-12 call.</aside>'));

    expect(c.errors).toEqual([]);
    expect(c.unknownElements).toEqual([]);
    expect(c.elementCount).toBe(4);
    expect(c.notesLength).toBeGreaterThan(0);
  });

  it('refuses anything that is not exactly one section with the key as its id', () => {
    expect(checkSlide('cover', '<div>no section</div>').errors[0]).toMatch(/exactly one <section id="cover">/);
    expect(checkSlide('cover', `${slide('<h1>a</h1>')}${slide('<h1>b</h1>')}`).errors[0]).toMatch(/exactly one/);
    expect(checkSlide('cover', slide('<h1>a</h1>', 'other')).errors[0]).toMatch(/id is "other"; it must be id="cover"/);
    expect(checkSlide('cover', `stray ${slide('<h1>a</h1>')}`).errors[0]).toMatch(/text outside its <section>/);
  });

  it('refuses scripts, styles, frames and event handlers', () => {
    expect(checkSlide('cover', slide('<script>alert(1)</script>')).errors.join(' ')).toMatch(/<script> is not allowed/);
    expect(checkSlide('cover', slide('<style>h1{}</style>')).errors.join(' ')).toMatch(/<style> is not allowed/);
    expect(checkSlide('cover', slide('<p onclick="x()">hi</p>')).errors.join(' ')).toMatch(/onclick/);
    expect(checkSlide('cover', slide('<a href="javascript:void 0">x</a>')).errors.join(' ')).toMatch(/javascript:/);
  });

  it('names unknown elements, icons, shapes and connectors without refusing the slide', () => {
    const c = checkSlide('cover', slide('<video></video><x-icon name="Unicorn"></x-icon><x-shape kind="hexagon"></x-shape><x-connector x1="10"></x-connector><svg><path d="M0 0"/><blink/></svg>'));

    expect(c.errors).toEqual([]);
    expect(c.unknownElements).toEqual(expect.arrayContaining(['element:video', 'icon:Unicorn', 'shape:hexagon', 'connector:missing y1 x2 y2', 'element:blink']));
  });

  it('keeps notes to one trailing aside of at most 4,000 characters', () => {
    expect(checkSlide('cover', slide('<aside>a</aside><p>after</p>')).errors.join(' ')).toMatch(/last child/);
    expect(checkSlide('cover', slide('<aside>a</aside><aside>b</aside>')).errors.join(' ')).toMatch(/2 <aside>/);
    expect(checkSlide('cover', slide(`<h1>x</h1><aside>${'n'.repeat(4001)}</aside>`)).errors.join(' ')).toMatch(/4001 characters/);
  });

  it('counts the elements, so the audit can hold a slide over 200', () => {
    expect(checkSlide('cover', slide('<span>.</span>'.repeat(201))).elementCount).toBe(201);
  });
});

describe('slideText', () => {
  it('separates what the audience reads from what the presenter says', () => {
    const t = slideText(slide('<h1>One record</h1><p>Every order, one place.</p><aside>Larkfield Systems said this on the 12 Sept call.</aside>'));

    expect(t.text).toBe('One record Every order, one place.');
    expect(t.notes).toBe('Larkfield Systems said this on the 12 Sept call.');
    expect(t.label).toBe('One record');
  });
});

describe('findPlaceholders', () => {
  it('finds the open blanks a draft carries, and nothing else', () => {
    expect(findPlaceholders('Saves [$__k] a year by [date]; owner [__]; [TBD] and [CLIENT NAME] and [ ]')).toEqual(expect.arrayContaining(['[$__k]', '[date]', '[__]', '[TBD]', '[CLIENT NAME]', '[ ]']));
    expect(findPlaceholders('Phase [1] of the plan, see [a] footnote')).toEqual([]);
  });
});

describe('assetRefs', () => {
  it('sorts image references into assets, data URIs and outside URLs', () => {
    const refs = assetRefs(slide('<img src="asset:logo"><div style="background:url(\'asset:hero\')"></div><img src="data:image/png;base64,AAA"><img src="https://cdn.example/x.png">'));

    expect(refs.ids.sort()).toEqual(['hero', 'logo']);
    expect(refs.dataUris).toBe(1);
    expect(refs.other).toEqual(['https://cdn.example/x.png']);
  });
});

describe('helpers', () => {
  it('opens self-closed Vocion elements so a parser does not swallow the slide', () => {
    expect(normaliseSlideHtml('<x-icon name="Lock"/><p>x</p>')).toBe('<x-icon name="Lock"></x-icon><p>x</p>');
    expect(iconNamesIn(slide('<x-icon name="Lock"/><x-icon name=\'Star\'></x-icon>'))).toEqual(['Lock', 'Star']);
  });

  it('replaces notes as plain text, and removes them when empty', () => {
    const withN = withNotes(slide('<h1>a</h1><aside>old</aside>'), 'new <b>notes</b> & more');

    expect(withN).toContain('<aside>new &lt;b&gt;notes&lt;/b&gt; &amp; more</aside>');
    expect(withN).not.toContain('old');
    expect(withNotes(withN, '  ')).not.toContain('<aside');
    expect(sectionId(withN)).toBe('cover');
  });
});
