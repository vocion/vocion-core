/**
 * Learning a GitHub target from a fictional site's posts and keeping it as a
 * suggestion on the project, never as its target. The repository is a fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const room = { id: 10, meta: { publishTargets: [{ id: 'site', kind: 'github', label: 'Website', config: { repo: 'example-org/northwind-site', baseBranch: 'main', path: 'src/content/blog/{slug}.mdx' } }], authors: [{ name: 'Dana Reyes', slug: 'dana-r' }] } as Record<string, unknown> };
const updates: Array<Record<string, unknown>> = [];
vi.mock('@/services/DataRoomService', () => ({
  getDataRoom: vi.fn(async (_org: string, id: number) => (id === 10 ? room : null)),
  updateDataRoom: vi.fn(async (_org: string, _id: number, patch: Record<string, unknown>) => {
    updates.push(patch);
  }),
}));

const { suggestPublishTarget } = await import('./learnTemplate');

const post = (title: string, date: string) => `---\ntitle: "${title}"\npubDate: "${date}"\nauthor: dana-r\ndraft: false\n---\n\nBody.`;
const reader = {
  readTree: vi.fn(async () => ({ ref: 'main', entries: [{ path: 'src/content/blog/a.mdx', type: 'blob' }, { path: 'src/content/blog/b.mdx', type: 'blob' }] })),
  readFile: vi.fn(async (_repo: string, path: string) => ({ path, text: path.endsWith('a.mdx') ? post('Heat pump basics', 'July 8, 2026') : post('Drain care', 'August 1, 2026'), truncated: false })),
};

describe('a target learned from the site, for a person to apply', () => {
  beforeEach(() => {
    updates.length = 0;
  });

  it('proposes the template on the project and never writes its targets', async () => {
    const out = await suggestPublishTarget('org-northwind', 10, { by: 'agent:seo-strategist' }, reader as never);

    expect(out.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]!)).toEqual(['publishTargetSuggestion']);

    const suggestion = updates[0]!.publishTargetSuggestion as { target: { config: { frontmatter: Record<string, unknown> } }; replaces: string };

    expect(suggestion.replaces).toBe('site');
    expect(suggestion.target.config.frontmatter).toEqual({ title: '{title}', pubDate: '{date:MMMM D, YYYY}', author: 'dana-r', draft: false });
  });

  it('says why when there is nothing to learn from', async () => {
    reader.readTree.mockResolvedValueOnce({ ref: 'main', entries: [] });

    const out = await suggestPublishTarget('org-northwind', 10, { by: null }, reader as never);

    expect(out).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });
});
