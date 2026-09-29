import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { markdownSections } from '../headingAnchor';
import { MarkdownCardView } from './markdown';

/**
 * A markdown artifact on its own page gives each heading the id a link to it
 * names (`libs/cards/headingAnchor.ts`), so a release's named test opens the
 * stored run at that test's section. In a chat card it draws no ids.
 */
const MD = '# Named tests, run 77\n\n## Passed: The CSV has one row per viewer.\n\n```\n## not a heading\n```\n\n## Passed: The CSV has one row per viewer.\n';

describe('markdown card headings', () => {
  it('carries the same anchors the release links to, on the artifact page', async () => {
    const screen = await render(<MarkdownCardView data={{ md: MD }} surface="artifact" />);
    const ids = [...screen.container.querySelectorAll('h1, h2')].map(h => h.id);

    expect(ids).toEqual(markdownSections(MD).map(s => s.anchor));
    expect(ids).toEqual(['named-tests-run-77', 'passed-the-csv-has-one-row-per-viewer', 'passed-the-csv-has-one-row-per-viewer-1']);
  });

  it('draws no ids in a chat card', async () => {
    const screen = await render(<MarkdownCardView data={{ md: MD }} surface="chat" />);

    expect(screen.container.querySelector('[id]')).toBeNull();
  });
});
