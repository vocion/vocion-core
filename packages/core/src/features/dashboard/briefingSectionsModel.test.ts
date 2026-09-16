import { describe, expect, it } from 'vitest';
import { splitSections } from './briefingSectionsModel';

describe('splitSections', () => {
  it('splits on ## headings, keeps the preamble, strips leading emoji from the heading', () => {
    const md = `# Revenue Briefing\nGenerated 8am\n\n## 📊 Pipeline Snapshot\n- $3.74M open\n\n## 🚨 Close This Week\n- StreetTalk $110K\n- Alliant $37.5K`;
    const s = splitSections(md);

    expect(s.map(x => x.heading)).toEqual([null, 'Pipeline Snapshot', 'Close This Week']);
    expect(s[0]!.body).toContain('# Revenue Briefing');
    expect(s[2]!.body).toBe('- StreetTalk $110K\n- Alliant $37.5K');
  });

  it('ignores ## inside fenced code', () => {
    const s = splitSections('## A\n```\n## not a heading\n```\nafter');

    expect(s).toHaveLength(1);
    expect(s[0]!.body).toContain('## not a heading');
  });
});
