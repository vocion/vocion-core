import { describe, expect, it } from 'vitest';
import { componentLabel, proposalVisualSvg, visualShape } from './proposalVisual';

/**
 * The drawing is the platform's claim about a record, so what it is allowed
 * to say is argued with here rather than looked at in a browser.
 */

describe('which shape an outcome is drawn as', () => {
  it('draws a surface a person looks at as a screen', () => {
    expect(visualShape({ surface: 'ui' })).toBe('screen');
    expect(visualShape({ surface: 'flow' })).toBe('screen');
  });

  it('draws the machine underneath as a mechanism', () => {
    expect(visualShape({ surface: 'data' })).toBe('mechanism');
    expect(visualShape({ surface: 'infra' })).toBe('mechanism');
    expect(visualShape({ surface: 'none' })).toBe('mechanism');
  });

  it('refuses to guess at a surface nobody classified', () => {
    // The honest drawing of "nobody has said what this changes" is an empty
    // frame. Inferring it from the title is how the drawing becomes wrong.
    expect(visualShape({})).toBe('unknown');
    expect(visualShape({ surface: '' })).toBe('unknown');
    expect(visualShape({ surface: 'Something Else' })).toBe('unknown');
  });

  it('reads the surface however it was cased', () => {
    expect(visualShape({ surface: ' UI ' })).toBe('screen');
  });
});

describe('the component label', () => {
  it('keeps the subject and drops the sentence after it', () => {
    expect(componentLabel('packages/core: the page layer resolves ids')).toBe('core');
    expect(componentLabel('apps/api — the new route')).toBe('api');
  });

  it('is short enough to fit in a box', () => {
    expect(componentLabel('services/reconciliation-worker').length).toBeLessThanOrEqual(8);
  });

  it('has nothing to say about an empty line', () => {
    expect(componentLabel('   ')).toBe('');
  });
});

describe('the drawing', () => {
  it('is deterministic, which is what lets the store content-address it', () => {
    const a = proposalVisualSvg({ surface: 'ui', acceptanceCount: 3 });
    const b = proposalVisualSvg({ surface: 'ui', acceptanceCount: 3 });

    expect(a.svg).toBe(b.svg);
  });

  it('says something different when the record says something different', () => {
    const one = proposalVisualSvg({ surface: 'ui', acceptanceCount: 1 }).svg;
    const four = proposalVisualSvg({ surface: 'ui', acceptanceCount: 4 }).svg;

    expect(one).not.toBe(four);
  });

  it('draws the components the plan recorded, and no more than three', () => {
    const { svg } = proposalVisualSvg({
      surface: 'infra',
      components: ['packages/core: x', 'apps/api: y', 'worker: z', 'docs: w'],
      interfaceCount: 1,
    });

    expect(svg).toContain('>core<');
    expect(svg).toContain('>api<');
    expect(svg).not.toContain('>docs<');
  });

  it('draws a machine change with no plan as one unnamed box', () => {
    const { svg, shape } = proposalVisualSvg({ surface: 'infra' });

    expect(shape).toBe('mechanism');
    expect(svg).not.toContain('<text');
  });

  it('cannot be made to draw markup, because the label is record text', () => {
    // Two defences, and the first one wins: the label keeps only word
    // characters, so the markup never reaches the escaper. The escaper stays
    // anyway — the day someone draws a field that has not been narrowed, it
    // is the one that holds.
    const { svg } = proposalVisualSvg({ surface: 'data', components: ['<script>x</script>', 'b"&<'] });

    expect(svg).not.toContain('<script');
    expect(svg).toContain('>script<');
    expect(svg).toContain('>b<');
  });

  it('carries a sentence for a reader who cannot see it', () => {
    expect(proposalVisualSvg({ surface: 'ui' }).svg).toContain('<title>');
    expect(proposalVisualSvg({}).svg).toContain('Nothing recorded yet');
  });

  it('is one well-formed document at a fixed size, whatever it drew', () => {
    for (const input of [{ surface: 'ui', acceptanceCount: 9 }, { surface: 'flow' }, { surface: 'none' }, {}]) {
      const { svg } = proposalVisualSvg(input);

      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).toContain('viewBox="0 0 128 80"');
    }
  });
});
