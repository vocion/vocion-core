import { describe, expect, it } from 'vitest';
import { blobAssetId, claudeSlidesToDeck, deckToClaudeSlides, isClaudeSlides } from './claudeSlides';
import { deckProblems } from './edit';

const HEX = 'a3f9c2d41b7e8a90';

const project = {
  'project/deck.json': JSON.stringify({
    version: 4,
    title: 'Contoso Supply — concept',
    order: ['intro', 'how'],
    sections: { opening: { description: 'Opening', start: 'intro' } },
    faces: { Inter: { family: 'Inter', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700' } },
  }),
  'project/slides/intro.html': `<section id="intro" style="padding:120px"><h1>One record</h1><img src="/_blob/${HEX}.png" style="width:400px"><aside>From the kickoff.</aside></section>`,
  'project/slides/how.html': `<section id="how" style="background:url(/_blob/${HEX})"><h2>How</h2></section>`,
  'project/slides/orphan.html': '<section id="orphan"><h2>Not ordered</h2></section>',
};

describe('claudeSlidesToDeck', () => {
  it('recognises a Claude Slides project, and not a Vocion deck', () => {
    expect(isClaudeSlides(project)).toBe(true);
    expect(isClaudeSlides({ 'deck.json': JSON.stringify({ format: 'vocion-deck/1' }) })).toBe(false);
    expect(isClaudeSlides({ 'slides/a.html': '' })).toBe(false);
  });

  it('converts the files into a valid vocion-deck/1, blobs becoming assets', () => {
    const r = claudeSlidesToDeck(project);

    expect(r.spec.title).toBe('Contoso Supply — concept');
    expect(r.spec.order).toEqual(['intro', 'how']);
    expect(r.spec.slides.intro).toContain(`src="asset:${blobAssetId(HEX)}"`);
    expect(r.spec.slides.how).toContain(`url(asset:${blobAssetId(HEX)})`);
    expect(r.blobs).toEqual([HEX]);
    expect(r.spec.sections).toEqual({ opening: { description: 'Opening', start: 'intro' } });
    expect(r.spec.faces?.Inter?.href).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?/);
    expect(r.warnings).toEqual(['slides/orphan.html is not in deck.json\'s order; it was left out.']);
    expect(deckProblems({ ...r.spec, assets: { [blobAssetId(HEX)]: { url: '/api/artifacts/org-x/org-x.png', contentType: 'image/png' } } })).toEqual([]);
  });

  it('round-trips: out to Claude Slides and back is the same deck', () => {
    const { spec } = claudeSlidesToDeck(project);
    const withAssets = { ...spec, assets: { [blobAssetId(HEX)]: { url: '/api/artifacts/org-x/org-x.png', contentType: 'image/png' } } };
    const files = deckToClaudeSlides(withAssets, id => (id === blobAssetId(HEX) ? HEX : null));

    expect(files['project/slides/intro.html']).toContain(`/_blob/${HEX}`);

    const back = claudeSlidesToDeck(files);

    expect(back.spec.order).toEqual(spec.order);
    expect(back.spec.slides).toEqual(spec.slides);
    expect(back.spec.title).toBe(spec.title);
    expect(back.spec.sections).toEqual(spec.sections);
    expect(back.spec.faces).toEqual(spec.faces);
  });
});
