/**
 * The Tools page's body, rendered from a catalog: families in order, a REST
 * source's reads then its writes, the existing readiness chips on the paid
 * built-ins, and the two empty states a family can be in — a source with no
 * credential (says so, links to Connectors) and a source no agent holds.
 */
import type { OrgToolCatalog } from '@/libs/tools/orgCatalog';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

// The app's Link needs the router; a plain anchor carries the same href.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<'a'> & { href: string }) => <a href={href} {...rest}>{children}</a>,
}));

const { ToolCatalogView } = await import('./ToolCatalogView');

const WEB_SEARCH = { capability: 'web_search', provider: 'tavily', ready: true, missingEnv: [], keySource: 'workspace' as const };
const IMAGE = { capability: 'generate_image', provider: 'openai', ready: false, missingEnv: ['OPENAI_API_KEY'], keySource: 'none' as const };

const CATALOG: OrgToolCatalog = {
  agents: [{ slug: 'delivery-lead', name: 'Delivery Lead' }, { slug: 'analyst', name: 'Analyst' }],
  statuses: [WEB_SEARCH, IMAGE],
  families: [
    {
      id: 'builtin',
      kind: 'builtin',
      label: 'Built-in',
      description: 'Capabilities every agent can use out of the box.',
      sources: [],
      readiness: null,
      actions: [],
      tools: [
        { name: 'web_search', title: 'Web search', description: 'Live web search.', familyId: 'builtin', agents: ['delivery-lead', 'analyst'], inputSchema: {}, status: WEB_SEARCH },
        { name: 'generate_image', title: 'Generate image', description: 'Create an image.', familyId: 'builtin', agents: ['delivery-lead', 'analyst'], inputSchema: {}, status: IMAGE },
      ],
    },
    {
      id: 'records',
      kind: 'records',
      label: 'Records',
      description: 'One typed filing tool per object type that opts in.',
      sources: [],
      readiness: null,
      actions: [],
      tools: [{ name: 'file_request', title: 'File request', description: 'File one request record.', familyId: 'records', agents: ['delivery-lead'], inputSchema: {} }],
    },
    {
      id: 'hubspot',
      kind: 'hubspot',
      label: 'HubSpot',
      description: 'Live CRM reads.',
      sources: [{ id: 3, slug: 'hubspot', name: 'hubspot' }],
      readiness: { ready: false, keyStateUnknown: false },
      actions: [],
      tools: [{ name: 'hubspot_get_contact', title: 'Hubspot get contact', description: 'One contact, live.', familyId: 'hubspot', agents: ['delivery-lead'], inputSchema: {} }],
    },
    {
      id: 'rest:acme-delivery',
      kind: 'rest',
      label: 'Acme Delivery API',
      description: 'Live reads of Acme Delivery API.',
      sources: [{ id: 1, slug: 'acme-delivery', name: 'Acme Delivery API' }],
      readiness: { ready: true, keyStateUnknown: false },
      tools: [
        { name: 'delivery_list_projects', title: 'List projects', description: 'List projects visible to the account.', familyId: 'rest:acme-delivery', agents: ['delivery-lead', 'analyst'], inputSchema: {}, rest: { sourceSlug: 'acme-delivery', sourceName: 'Acme Delivery API', method: 'GET', path: '/api/projects', query: {}, input: { type: 'object' } } },
        { name: 'delivery_list_actions', title: 'List actions', description: 'The writes an agent may propose.', familyId: 'rest:acme-delivery', agents: ['delivery-lead', 'analyst'], inputSchema: {} },
      ],
      actions: [{ name: 'update_milestone', description: 'Change a milestone.', method: 'PUT', path: '/api/milestones/{documentId}', input: { type: 'object' }, reversible: false, sourceSlug: 'acme-delivery' }],
    },
    {
      id: 'rest:contoso-cms',
      kind: 'rest',
      label: 'Contoso CMS',
      description: 'Live reads of Contoso CMS.',
      sources: [{ id: 2, slug: 'contoso-cms', name: 'Contoso CMS' }],
      readiness: { ready: false, keyStateUnknown: false },
      tools: [{ name: 'contoso_cms_list_pages', title: 'List pages', description: 'GET /pages', familyId: 'rest:contoso-cms', agents: [], inputSchema: {}, rest: { sourceSlug: 'contoso-cms', sourceName: 'Contoso CMS', method: 'GET', path: '/pages', query: {}, input: { type: 'object' } } }],
      actions: [],
    },
    {
      id: 'workspace',
      kind: 'workspace',
      label: 'Workspace',
      description: 'What every agent has on the workspace itself.',
      sources: [],
      readiness: null,
      actions: [],
      tools: [{ name: 'search_knowledge', title: 'Search knowledge', description: 'Search the sources.', familyId: 'workspace', agents: ['delivery-lead', 'analyst'], inputSchema: {} }],
    },
  ],
};

describe('ToolCatalogView', () => {
  it('groups the tools by family, built-ins first, then each connected source, the workspace\'s own folded last', async () => {
    await render(<ToolCatalogView catalog={CATALOG} />);

    const sections = document.querySelectorAll('[data-testid^="tool-family-"]');

    expect([...sections].map(s => s.getAttribute('data-testid'))).toEqual([
      'tool-family-builtin',
      'tool-family-records',
      'tool-family-hubspot',
      'tool-family-rest:acme-delivery',
      'tool-family-rest:contoso-cms',
      'tool-family-workspace',
    ]);
    await expect.element(page.getByTestId('tool-card-delivery_list_projects')).toBeVisible();
    await expect.element(page.getByTestId('tool-card-file_request')).toBeVisible();
    // Folded: the workspace's own tools are there for whoever opens them.
    expect(document.querySelector('[data-testid="tool-family-workspace"]')?.hasAttribute('open')).toBe(false);
    expect(document.querySelector('[data-testid="tool-family-workspace"]')?.textContent).toContain('search_knowledge');
  });

  it('shows a REST source\'s reads as cards with their endpoint, and its writes in a second block', async () => {
    await render(<ToolCatalogView catalog={CATALOG} />);

    const card = page.getByTestId('tool-card-delivery_list_projects');

    await expect.element(card).toBeVisible();
    expect(card.element().textContent).toContain('GET /api/projects');
    expect(card.element().textContent).toContain('2 agents');

    const writes = document.querySelector('[data-testid="tool-family-rest:acme-delivery"] [data-testid="rest-actions"]');

    expect(writes?.textContent).toContain('update_milestone');
    expect(writes?.textContent).toContain('PUT /api/milestones/{documentId}');
    expect(writes?.textContent).toContain('Irreversible');
  });

  it('keeps the readiness chips on the paid built-ins', async () => {
    await render(<ToolCatalogView catalog={CATALOG} />);

    expect(page.getByTestId('tool-card-web_search').element().textContent).toContain('Ready');
    expect(page.getByTestId('tool-card-generate_image').element().textContent).toContain('Needs key');
    expect(page.getByTestId('tool-card-generate_image').element().textContent).toContain('OPENAI_API_KEY');
  });

  it('says when a source has no credential and links to the Connectors page, and when no agent holds a source', async () => {
    await render(<ToolCatalogView catalog={CATALOG} />);

    const hubspot = document.querySelector('[data-testid="tool-family-hubspot"]')!;
    const needs = hubspot.querySelector('[data-testid="family-needs-credential"]')!;

    expect(needs.textContent).toContain('HubSpot is set up as a source but has no credential connected');
    expect(needs.querySelector('a')?.getAttribute('href')).toContain('/dashboard/connectors');

    const cms = document.querySelector('[data-testid="tool-family-rest:contoso-cms"]')!;

    expect(cms.querySelector('[data-testid="family-unheld"]')?.textContent).toContain('No agent holds contoso-cms yet');
    expect(cms.querySelector('[data-testid="family-needs-credential"]')).not.toBeNull();
    // A source with a credential and holders says neither.
    expect(document.querySelector('[data-testid="tool-family-rest:acme-delivery"] [data-testid^="family-"]')).toBeNull();
  });

  it('counts what agents can reach, what is ready and what needs a key', async () => {
    await render(<ToolCatalogView catalog={CATALOG} />);

    const text = document.body.textContent ?? '';

    expect(text).toContain('Tools agents can reach');
    // 2 + 1 + 1 + 2 + 1 + 1 tools; web_search and Acme ready; the image key, HubSpot and Contoso wanting.
    expect(text).toMatch(/8\s*Tools agents can reach/);
    expect(text).toMatch(/2\s*Ready/);
    expect(text).toMatch(/3\s*Need a key/);
  });
});
