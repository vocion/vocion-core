/**
 * A tool's own page for everything the static catalog used to 404: what it
 * does, which family, who holds it — and for a REST read the endpoint, the
 * query template and its arguments as a field table.
 */
import type { CatalogTool, ToolFamily } from '@/libs/tools/orgCatalog';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

// The app's Link needs the router; a plain anchor carries the same href.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<'a'> & { href: string }) => <a href={href} {...rest}>{children}</a>,
}));

const { HoldingAgents, ToolDetailView } = await import('./ToolDetailView');

const AGENTS = [{ slug: 'delivery-lead', name: 'Delivery Lead' }, { slug: 'analyst', name: 'Analyst' }];

const LIST_PROJECTS: CatalogTool = {
  name: 'delivery_list_projects',
  title: 'List projects',
  description: 'List projects visible to the account.',
  familyId: 'rest:acme-delivery',
  agents: ['delivery-lead', 'analyst'],
  inputSchema: {},
  rest: {
    sourceSlug: 'acme-delivery',
    sourceName: 'Acme Delivery API',
    method: 'GET',
    path: '/api/projects',
    query: { 'filters[status][$eq]': '{status}', 'pagination[pageSize]': '100' },
    pick: 'data',
    input: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'archived'], description: 'Project status' }, search: { type: 'string' } }, required: [] },
  },
};

const LIST_ACTIONS: CatalogTool = {
  name: 'delivery_list_actions',
  title: 'List actions',
  description: 'The writes an agent may propose.',
  familyId: 'rest:acme-delivery',
  agents: [],
  inputSchema: { type: 'object', properties: {} },
};

const FAMILY: ToolFamily = {
  id: 'rest:acme-delivery',
  kind: 'rest',
  label: 'Acme Delivery API',
  description: 'Live reads of Acme Delivery API, called at the moment of the question.',
  sources: [{ id: 1, slug: 'acme-delivery', name: 'Acme Delivery API' }],
  readiness: { ready: true, keyStateUnknown: false },
  tools: [LIST_PROJECTS, LIST_ACTIONS],
  actions: [{ name: 'update_milestone', description: 'Change a milestone.', method: 'PUT', path: '/api/milestones/{documentId}', input: { type: 'object' }, reversible: false, sourceSlug: 'acme-delivery' }],
};

describe('ToolDetailView', () => {
  it('shows a REST read with its family, its holders, the endpoint and query template, and the arguments as fields', async () => {
    await render(<ToolDetailView tool={LIST_PROJECTS} family={FAMILY} agents={AGENTS} />);

    await expect.element(page.getByTestId('rest-endpoint')).toBeVisible();
    expect(document.querySelector('h1')?.textContent).toContain('List projects');
    expect(document.body.textContent).toContain('Acme Delivery API');
    expect(document.body.textContent).toContain('delivery_list_projects');

    const endpoint = document.querySelector('[data-testid="rest-endpoint"]')!;

    expect(endpoint.textContent).toContain('GET');
    expect(endpoint.textContent).toContain('/api/projects');
    expect(endpoint.textContent).toContain('filters[status][$eq] = {status}');
    expect(endpoint.textContent).toContain('pagination[pageSize] = 100');
    expect(endpoint.textContent).toContain('data');

    const fields = document.querySelector('[data-testid="tool-input-fields"]')!;

    expect(fields.textContent).toContain('status');
    expect(fields.textContent).toContain('"active" | "archived"');
    expect(fields.textContent).toContain('Project status');
    expect(fields.textContent).toContain('search');

    const holders = document.querySelector('[data-testid="holding-agents"]')!;

    expect(holders.textContent).toContain('Delivery Lead');
    expect(holders.textContent).toContain('Analyst');
    expect(holders.querySelector('a')?.getAttribute('href')).toContain('/dashboard/agents/delivery-lead');
  });

  it('lists the source\'s writes on its list_actions tool, and says when nobody holds it', async () => {
    await render(<ToolDetailView tool={LIST_ACTIONS} family={FAMILY} agents={AGENTS} />);

    const actions = document.querySelector('[data-testid="rest-action-catalog"]')!;

    expect(actions.textContent).toContain('update_milestone');
    expect(actions.textContent).toContain('PUT /api/milestones/{documentId}');
    expect(actions.textContent).toContain('Irreversible');
    expect(document.querySelector('[data-testid="holding-agents"]')?.textContent).toContain('No agent holds delivery_list_actions yet');
    expect(document.body.textContent).toContain('This tool takes no parameters.');
  });

  it('says when the source has no credential and links to the Connectors page', async () => {
    await render(<ToolDetailView tool={LIST_PROJECTS} family={{ ...FAMILY, readiness: { ready: false, keyStateUnknown: false } }} agents={AGENTS} />);

    const notice = document.querySelector('[data-testid="needs-credential"]')!;

    expect(notice.textContent).toContain('has no credential connected');
    expect(notice.querySelector('a')?.getAttribute('href')).toContain('/dashboard/connectors');
    expect(document.body.textContent).toContain('Needs key');
  });
});

describe('HoldingAgents', () => {
  it('names the agents by their display names, or explains why none holds a gated tool', async () => {
    const { unmount } = await render(<HoldingAgents tool={{ ...LIST_ACTIONS, name: 'record_verdict', agents: ['analyst'], rest: undefined }} agents={AGENTS} />);

    expect(document.querySelector('[data-testid="holding-agents"]')?.textContent).toContain('Analyst');

    unmount();
    await render(<HoldingAgents tool={{ ...LIST_ACTIONS, name: 'record_verdict', agents: [] }} agents={AGENTS} />);

    expect(document.querySelector('[data-testid="holding-agents"]')?.textContent).toContain('gated by a source or a grant');
  });
});
