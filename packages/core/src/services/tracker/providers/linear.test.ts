/**
 * Linear as the tracker family's second provider: an issue reads back in the
 * family's shape, a status change is one of the team's workflow states, a
 * new issue lands on the team its key names with labels by name and the
 * family's priority names mapped, and what Linear lacks (fix versions) is
 * refused by name rather than ignored. GraphQL answers are recorded; the
 * team is invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/services/connectors/sourceCredentials', () => ({ credentialsForSource: vi.fn(async () => ({ token: 'lin_api_northwind' })) }));

const { linearPriority, linearTrackerProvider } = await import('./linear');

const SOURCE = { id: 4, slug: 'linear', kind: 'linear', config: { projectKeys: ['eng'] }, apiTokenId: null };

const FULL = {
  id: 'uuid-7',
  identifier: 'ENG-7',
  title: 'Totals are off',
  description: 'Seen on the October report.',
  url: 'https://linear.app/acme/issue/ENG-7',
  priorityLabel: 'Medium',
  state: { id: 'st-todo', name: 'Todo', type: 'unstarted' },
  team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
  labels: { nodes: [{ id: 'l-bug', name: 'Bug' }] },
  creator: { name: 'Dana Reyes' },
  comments: { nodes: [{ id: 'c1', body: 'Repro attached', user: { name: 'Dana Reyes' } }] },
  attachments: { nodes: [{ id: 'a1', title: 'shot.png', url: 'https://uploads.linear.app/x/shot.png' }] },
  relations: { nodes: [{ type: 'blocks', relatedIssue: { identifier: 'ENG-9', title: 'Release' } }] },
  inverseRelations: { nodes: [] },
  teamStates: { states: { nodes: [{ id: 'st-todo', name: 'Todo', type: 'unstarted' }, { id: 'st-prog', name: 'In Progress', type: 'started' }, { id: 'st-done', name: 'Done', type: 'completed' }] } },
};

type Sent = { query: string; variables: Record<string, unknown> };

function graphql(route: (sent: Sent) => unknown): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Sent;
    sent.push(body);
    return new Response(JSON.stringify({ data: route(body) }), { status: 200 });
  }));
  return sent;
}

function route(sent: Sent): unknown {
  const q = sent.query;
  if (q.includes('urlKey')) {
    return { viewer: { organization: { urlKey: 'acme' } } };
  }
  if (q.includes('issue(id: $id)')) {
    return { issue: FULL };
  }
  if (q.includes('teams(filter')) {
    return { teams: { nodes: [{ id: 'team-1', key: 'ENG' }] } };
  }
  if (q.includes('issueLabels')) {
    return { issueLabels: { nodes: [{ id: 'l-bug', name: 'Bug', team: null }, { id: 'l-ui', name: 'UI', team: { key: 'ENG' } }] } };
  }
  if (q.includes('issueCreate')) {
    return { issueCreate: { success: true, issue: { identifier: 'ENG-20', url: 'https://linear.app/acme/issue/ENG-20' } } };
  }
  if (q.includes('issueUpdate')) {
    return { issueUpdate: { success: true } };
  }
  if (q.includes('attachmentLinkURL')) {
    return { attachmentLinkURL: { success: true, attachment: { id: 'att-9' } } };
  }
  return {};
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Linear tracker provider', () => {
  it('reads an issue in the family\'s shape, with the team\'s other states as its transitions', async () => {
    graphql(route);
    const provider = await linearTrackerProvider('org_1', SOURCE);

    expect(provider.projectKeys).toEqual(['ENG']);
    expect(provider.issueUrl('ENG-7')).toBe('https://linear.app/acme/issue/ENG-7');

    const issue = await provider.readIssue('ENG-7');

    expect(issue).toMatchObject({ key: 'ENG-7', status: 'Todo', statusCategory: 'new', priority: 'Medium', labels: ['Bug'], reporter: 'Dana Reyes', fixVersions: [], issueType: null });
    expect(issue.comments).toEqual([expect.objectContaining({ id: 'c1', author: 'Dana Reyes', body: 'Repro attached' })]);
    expect(issue.links).toEqual([{ type: 'blocks', key: 'ENG-9', summary: 'Release' }]);
    expect(issue.transitions.map(t => t.to)).toEqual(['In Progress', 'Done']);
  });

  it('files an issue on the key\'s team, labels by name, a type that is a label added as one, and the priority mapped', async () => {
    const sent = graphql(route);
    const provider = await linearTrackerProvider('org_1', SOURCE);

    await expect(provider.createIssue({ projectKey: 'eng', issueType: 'Bug', summary: 'Totals are off', description: 'Seen on the October report.', labels: ['UI'], priority: 'High' })).resolves.toEqual({ key: 'ENG-20', url: 'https://linear.app/acme/issue/ENG-20' });

    const create = sent.find(s => s.query.includes('issueCreate'))!;

    expect(create.variables.input).toEqual({ teamId: 'team-1', title: 'Totals are off', description: 'Seen on the October report.', labelIds: ['l-ui', 'l-bug'], priority: 2 });
  });

  it('moves an issue to a state by name, and refuses one the team does not have', async () => {
    const sent = graphql(route);
    const provider = await linearTrackerProvider('org_1', SOURCE);

    await expect(provider.transition('ENG-7', 'in progress')).resolves.toEqual({ from: 'Todo', to: 'In Progress' });
    expect(sent.find(s => s.query.includes('issueUpdate'))!.variables).toEqual({ id: 'uuid-7', input: { stateId: 'st-prog' } });
    await expect(provider.transition('ENG-7', 'Shipped')).rejects.toThrow(/no state "Shipped".*Todo, In Progress, Done/);
  });

  it('updates priority and adds a link, returning what Undo needs; refuses a fix version by name', async () => {
    graphql(route);
    const provider = await linearTrackerProvider('org_1', SOURCE);

    await expect(provider.updateIssue('ENG-7', { priority: 'Urgent', remoteLink: { url: 'https://vocion.example/w/acme/requests/12', title: 'Request #12' } })).resolves.toEqual({ priority: 'Medium', remoteLinkId: 'att-9' });
    await expect(provider.updateIssue('ENG-7', { fixVersion: '2.4.0' })).rejects.toThrow(/no fix versions/);
    expect(linearPriority('No priority')).toBe(0);
    expect(() => linearPriority('P0')).toThrow(/no priority "P0"/);
  });
});
