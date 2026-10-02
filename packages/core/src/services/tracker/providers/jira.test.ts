/**
 * The Jira provider: plain text becomes ADF the way Jira's v3 endpoints need
 * it, a search never leaves the configured projects, and a transition is
 * found by status name or id. Jira is mocked at `fetch`; the site is invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; method: string; body: unknown }>, answers: new Map<string, unknown>() }));

vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForConnector: async () => ({ email: 'bot@example.com', apiToken: 'tok' }) }));
vi.mock('@/libs/http/retryAfter', () => ({
  fetchRetryingRateLimits: async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    calls.list.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${new URL(url).pathname}`;
    const answer = calls.answers.get(key) ?? {};
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  },
}));

const { jiraTrackerProvider, textToAdf } = await import('./jira');
const source = { id: 1, slug: 'jira', kind: 'jira', config: { baseUrl: 'https://acme.atlassian.net/', projectKeys: ['NW', 'OPS'] }, apiTokenId: null };

beforeEach(() => {
  calls.list.length = 0;
  calls.answers.clear();
});

describe('textToAdf', () => {
  it('makes a paragraph per blank-line block and a hard break per newline inside one', () => {
    expect(textToAdf('one\ntwo\n\nthree')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
      ],
    });
    expect(textToAdf('')).toEqual({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [] }] });
  });
});

describe('the Jira provider', () => {
  it('bounds every search to the configured projects and links each row to the site', async () => {
    calls.answers.set('POST /rest/api/3/search/jql', { issues: [{ key: 'NW-7', fields: { summary: 'Report totals are off', status: { name: 'To Do' }, assignee: { displayName: 'Ada' }, updated: '2026-10-01T00:00:00Z', priority: { name: 'High' } } }] });
    const provider = await jiraTrackerProvider('org_1', source);

    const rows = await provider.searchIssues('status = "To Do"', 10);

    expect(calls.list[0]!.body).toMatchObject({ jql: 'project in ("NW", "OPS") AND (status = "To Do")', maxResults: 10 });
    expect(rows).toEqual([{ key: 'NW-7', summary: 'Report totals are off', status: 'To Do', assignee: 'Ada', updated: '2026-10-01T00:00:00Z', url: 'https://acme.atlassian.net/browse/NW-7', priority: 'High' }]);

    await provider.searchIssues('', 5);

    expect(calls.list[1]!.body).toMatchObject({ jql: 'project in ("NW", "OPS") ORDER BY updated DESC' });
  });

  it('orders by priority after the bounded clause, never inside it, and keeps the project bound', async () => {
    calls.answers.set('POST /rest/api/3/search/jql', { issues: [{ key: 'NW-9', fields: { summary: 'Outage', status: { name: 'Ready' }, priority: { name: 'Highest' } } }, { key: 'NW-4', fields: { summary: 'Typo', status: { name: 'Ready' } } }] });
    const provider = await jiraTrackerProvider('org_1', source);

    const rows = await provider.searchIssues('status in ("Ready")', 10, 'priority');
    await provider.searchIssues('', 10, 'priority');

    expect(calls.list[0]!.body).toMatchObject({ jql: 'project in ("NW", "OPS") AND (status in ("Ready")) ORDER BY priority DESC, created ASC' });
    expect(calls.list[1]!.body).toMatchObject({ jql: 'project in ("NW", "OPS") ORDER BY priority DESC, created ASC' });
    expect(rows.map(r => [r.key, r.priority])).toEqual([['NW-9', 'Highest'], ['NW-4', null]]);
  });

  it('reads an issue whole — text from ADF, comments, attachments, links and the transitions open to it', async () => {
    calls.answers.set('GET /rest/api/3/issue/NW-7', {
      key: 'NW-7',
      fields: {
        summary: 'Report totals are off',
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Totals differ by 3%.' }] }] },
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        issuetype: { name: 'Bug' },
        priority: { name: 'High' },
        labels: ['reporting'],
        reporter: { displayName: 'Grace' },
        fixVersions: [{ name: '1.8' }],
        comment: { comments: [{ id: '10', author: { displayName: 'Ada' }, created: 'c', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Seen on prod.' }] }] } }] },
        attachment: [{ id: '55', filename: 'shot.png', mimeType: 'image/png', size: 12, created: 'a' }],
        issuelinks: [{ type: { name: 'Blocks', outward: 'blocks' }, outwardIssue: { key: 'NW-8', fields: { summary: 'Release 1.8' } } }],
      },
    });
    calls.answers.set('GET /rest/api/3/issue/NW-7/transitions', { transitions: [{ id: '21', name: 'Start', to: { name: 'In Progress' } }] });
    const provider = await jiraTrackerProvider('org_1', source);

    const issue = await provider.readIssue('NW-7');

    expect(issue).toMatchObject({
      key: 'NW-7',
      url: 'https://acme.atlassian.net/browse/NW-7',
      description: 'Totals differ by 3%.',
      status: 'To Do',
      statusCategory: 'new',
      issueType: 'Bug',
      priority: 'High',
      labels: ['reporting'],
      reporter: 'Grace',
      fixVersions: ['1.8'],
      comments: [{ id: '10', author: 'Ada', body: 'Seen on prod.' }],
      attachments: [{ id: '55', filename: 'shot.png', mimeType: 'image/png' }],
      links: [{ type: 'blocks', key: 'NW-8', summary: 'Release 1.8' }],
      transitions: [{ id: '21', name: 'Start', to: 'In Progress' }],
    });
  });

  it('transitions by status name or transition id and records where it came from', async () => {
    calls.answers.set('GET /rest/api/3/issue/NW-7/transitions', { transitions: [{ id: '21', name: 'Start', to: { name: 'In Progress' } }, { id: '31', name: 'Done', to: { name: 'Done' } }] });
    calls.answers.set('GET /rest/api/3/issue/NW-7', { key: 'NW-7', fields: { status: { name: 'To Do' } } });
    const provider = await jiraTrackerProvider('org_1', source);

    await expect(provider.transition('NW-7', 'in progress')).resolves.toEqual({ from: 'To Do', to: 'In Progress' });
    expect(calls.list.find(c => c.method === 'POST')?.body).toEqual({ transition: { id: '21' } });
    await expect(provider.transition('NW-7', '31')).resolves.toEqual({ from: 'To Do', to: 'Done' });
    await expect(provider.transition('NW-7', 'Archived')).rejects.toThrow(/no transition to "Archived"/);
  });

  it('writes a comment as ADF and a field update with what was there before', async () => {
    calls.answers.set('POST /rest/api/3/issue/NW-7/comment', { id: '77' });
    calls.answers.set('GET /rest/api/3/issue/NW-7', { key: 'NW-7', fields: { priority: { name: 'Low' }, labels: ['a'], fixVersions: [] } });
    calls.answers.set('POST /rest/api/3/issue/NW-7/remotelink', { id: 9001 });
    const provider = await jiraTrackerProvider('org_1', source);

    await expect(provider.addComment('NW-7', 'Shipped in 1.8.')).resolves.toEqual({ id: '77', url: 'https://acme.atlassian.net/browse/NW-7?focusedCommentId=77' });
    expect(calls.list[0]!.body).toEqual({ body: textToAdf('Shipped in 1.8.') });

    const previous = await provider.updateIssue('NW-7', { priority: 'High', labels: ['a', 'factory'], fixVersion: '1.8', remoteLink: { url: 'https://vocion.example/w/acme/dashboard/objects/12', title: 'Request #12' } });

    expect(previous).toEqual({ priority: 'Low', labels: ['a'], fixVersions: [], remoteLinkId: '9001' });
    expect(calls.list.find(c => c.method === 'PUT')?.body).toEqual({ fields: { priority: { name: 'High' }, labels: ['a', 'factory'], fixVersions: [{ name: '1.8' }] } });
  });
});
