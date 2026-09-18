import { describe, expect, it } from 'vitest';
import { artifactTitle, firstHeading, firstSentence, isWeakTitle, stripStamp } from './title';

describe('stripStamp', () => {
  it('takes the date and time the model appended off the end', () => {
    expect(stripStamp('Right now — Sep 17, 4:50 PM UTC')).toBe('Right now');
    expect(stripStamp('Today — Sep 17, 2026')).toBe('Today');
    expect(stripStamp('Pipeline review (Wed Sep 16)')).toBe('Pipeline review');
    expect(stripStamp('Pipeline review — 4:50 PM')).toBe('Pipeline review');
  });

  it('leaves a title that carries no stamp alone', () => {
    expect(stripStamp('Q3 pipeline: three deals at risk')).toBe('Q3 pipeline: three deals at risk');
  });
});

describe('isWeakTitle', () => {
  it('calls a time word, a generic label or nothing weak', () => {
    for (const t of ['', 'Right now', 'Today', 'Update', 'Response', 'Sample Document', 'Untitled', 'Doc', 'An']) {
      expect(isWeakTitle(t)).toBe(true);
    }
  });

  it('accepts anything that says something', () => {
    for (const t of ['Northwind renewal risk', 'Why the Kestrel call moved', 'Q3 plan']) {
      expect(isWeakTitle(t)).toBe(false);
    }
  });
});

describe('artifactTitle — the title an artifact is filed under', () => {
  const md = '# Where the pipeline stands this afternoon\n\nThree deals moved since the morning brief.\n\n- Northwind: contract out\n';

  it('keeps a real title, minus the stamp', () => {
    expect(artifactTitle('Pipeline review — Sep 17, 2026', { md })).toBe('Pipeline review');
  });

  it('replaces a timestamp title with the first heading', () => {
    // The actual rows: "Right now — Sep 17, 4:50 PM UTC" and "Today — Sep 17, 2026".
    expect(artifactTitle('Right now — Sep 17, 4:50 PM UTC', { md })).toBe('Where the pipeline stands this afternoon');
    expect(artifactTitle('Today — Sep 17, 2026', { md })).toBe('Where the pipeline stands this afternoon');
  });

  it('falls to the first sentence when there is no heading', () => {
    expect(artifactTitle('Update', { md: 'Three deals moved since the morning brief. Two are at risk.' })).toBe('Three deals moved since the morning brief.');
  });

  it('skips a heading that is itself a stamp', () => {
    expect(firstHeading('# Sep 17, 2026\n\nBody here with words.')).toBeNull();
    expect(artifactTitle('Now', { md: '# Sep 17, 2026\n\nThe forecast slipped by a week.' })).toBe('The forecast slipped by a week.');
  });

  it('uses the caption for a table and the fallback for nothing at all', () => {
    expect(artifactTitle('Table', { caption: 'Open deals by stage, as of this morning' })).toBe('Open deals by stage, as of this morning');
    expect(artifactTitle('Sample Document', {}, 'Requested document')).toBe('Requested document');
  });

  it('caps a runaway heading', () => {
    const long = `# ${'word '.repeat(40)}`;

    expect(artifactTitle('Now', { md: long }).length).toBeLessThanOrEqual(90);
  });

  it('first sentence ignores list markers and needs at least two words', () => {
    expect(firstSentence('- bullet\n\nHello.')).toBeNull();
    expect(firstSentence('> quote\n\nThe deal closed early.')).toBe('The deal closed early.');
  });
});
