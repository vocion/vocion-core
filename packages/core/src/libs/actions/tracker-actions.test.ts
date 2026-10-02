/**
 * The tracker family's writes: each proposes through the provider the issue
 * key resolves to, records what Undo needs, and dedups on the record rather
 * than the wording. The provider is mocked; the board is invented.
 */
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  kind: 'jira',
  sourceSlug: 'jira',
  projectKeys: ['NW'],
  issueUrl: (key: string) => `https://acme.atlassian.net/browse/${key}`,
  createIssue: vi.fn(async () => ({ key: 'NW-20', url: 'https://acme.atlassian.net/browse/NW-20' })),
  deleteIssue: vi.fn(async () => undefined),
  transitions: vi.fn(async () => [{ id: '11', name: 'Back', to: 'To Do' }]),
  transition: vi.fn(async (_key: string, to: string) => ({ from: 'To Do', to: to === '11' || to === 'To Do' ? 'To Do' : 'In Progress' })),
  updateIssue: vi.fn(async () => ({ priority: 'Low', labels: ['a'], remoteLinkId: '9001' })),
  removeRemoteLink: vi.fn(async () => undefined),
  addComment: vi.fn(async () => ({ id: '77', url: 'https://acme.atlassian.net/browse/NW-7?focusedCommentId=77' })),
  deleteComment: vi.fn(async () => undefined),
  attach: vi.fn(async () => ({ id: '55' })),
  deleteAttachment: vi.fn(async () => undefined),
}));
const resolved = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@/services/tracker/provider', () => ({ trackerProviderFor: async (_org: string, opts?: unknown) => {
  resolved.calls.push(opts ?? {});
  return provider;
} }));
vi.mock('@/services/objects/recordHref', () => ({ recordHref: async () => '/w/acme/dashboard/work/12' }));
vi.mock('@/libs/links', () => ({ appBaseUrl: () => 'https://vocion.example' }));
const notes = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('@/services/factory/carry', () => ({ noteOnRequest: async (_o: string, _id: number, line: string) => {
  notes.lines.push(line);
} }));
vi.mock('@/libs/tools/artifacts/url', () => ({ isStoredArtifactUrl: (url: string) => url.startsWith('/api/artifacts/') }));
vi.mock('@/libs/tools/artifacts/ingest', () => ({ readStoredArtifact: async () => Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) }));
vi.mock('@/libs/tools/image/inspect', () => ({ sniffImage: (bytes: Buffer) => (bytes[0] === 0x89 ? 'png' : null), CONTENT_TYPES: { png: 'image/png' } }));

const { trackerCreateIssueAction } = await import('./tracker-create-issue');
const { trackerTransitionIssueAction } = await import('./tracker-transition-issue');
const { trackerUpdateIssueAction } = await import('./tracker-update-issue');
const { trackerCommentAction } = await import('./tracker-comment');
const { trackerAttachFileAction } = await import('./tracker-attach-file');

const ctx = { orgId: 'org_1', runId: 5, invokedBy: 'agent:product-manager' };

beforeEach(() => {
  resolved.calls.length = 0;
  notes.lines.length = 0;
  vi.clearAllMocks();
});

describe('tracker.create_issue', () => {
  const parse = (i: Record<string, unknown>) => trackerCreateIssueAction.inputSchema.parse(i);

  it('files the issue in the asker\'s words with the Vocion request linked, and Undo deletes it', async () => {
    const out = await trackerCreateIssueAction.execute(ctx, parse({ issueType: 'Bug', summary: 'Totals are off', description: 'Seen on the October report.', requestId: 12 }));

    expect(provider.createIssue).toHaveBeenCalledWith({ projectKey: 'NW', issueType: 'Bug', summary: 'Totals are off', description: 'Seen on the October report.\n\nVocion request #12: https://vocion.example/w/acme/dashboard/work/12', labels: undefined, priority: undefined });
    expect(out).toMatchObject({ created: true, key: 'NW-20', objectId: 12 });
    expect(notes.lines[0]).toMatch(/Filed NW-20/);

    await expect(trackerCreateIssueAction.undo!(ctx, parse({ issueType: 'Bug', summary: 'Totals are off', description: 'y' }), out)).resolves.toMatchObject({ deleted: true, key: 'NW-20' });
    expect(provider.deleteIssue).toHaveBeenCalledWith('NW-20');
  });

  it('refuses a project the source is not configured for, at the door', async () => {
    await expect(trackerCreateIssueAction.precheck!(ctx, parse({ projectKey: 'ZZ', issueType: 'Bug', summary: 'Totals', description: 'd' }))).resolves.toMatch(/Project ZZ is not one/);
    await expect(trackerCreateIssueAction.precheck!(ctx, parse({ issueType: 'Bug', summary: 'Totals', description: 'd' }))).resolves.toBeUndefined();
  });

  it('dedups on the request, else on the summary', () => {
    expect(trackerCreateIssueAction.dedupKeyFor!(parse({ issueType: 'Bug', summary: 'Totals are off', description: 'd', requestId: 12 }))).toBe(trackerCreateIssueAction.dedupKeyFor!(parse({ issueType: 'Task', summary: 'Report totals', description: 'e', requestId: 12 })));
    expect(trackerCreateIssueAction.dedupKeyFor!(parse({ issueType: 'Bug', summary: 'Totals are off', description: 'd' }))).toBe(trackerCreateIssueAction.dedupKeyFor!(parse({ issueType: 'Bug', summary: 'totals are off ', description: 'e' })));
  });
});

describe('tracker.transition_issue', () => {
  const parse = (i: Record<string, unknown>) => trackerTransitionIssueAction.inputSchema.parse(i);

  it('moves the issue through the provider its key resolves to and Undo moves it back', async () => {
    const out = await trackerTransitionIssueAction.execute(ctx, parse({ key: 'nw-7', to: 'In Progress', reason: 'task #41 dispatched' }));

    expect(resolved.calls[0]).toEqual({ issueKey: 'NW-7' });
    expect(out).toMatchObject({ moved: true, key: 'NW-7', from: 'To Do', to: 'In Progress' });
    expect(out.line).toBe('Moved NW-7 from To Do to In Progress: task #41 dispatched');

    await expect(trackerTransitionIssueAction.undo!(ctx, parse({ key: 'NW-7', to: 'In Progress' }), out)).resolves.toMatchObject({ restored: true, to: 'To Do' });
    expect(provider.transition).toHaveBeenLastCalledWith('NW-7', 'To Do');
  });

  it('says so when the workflow cannot go back', async () => {
    provider.transitions.mockResolvedValueOnce([{ id: '31', name: 'Done', to: 'Done' }]);

    await expect(trackerTransitionIssueAction.undo!(ctx, parse({ key: 'NW-7', to: 'In Progress' }), { key: 'NW-7', from: 'To Do' })).resolves.toMatchObject({ restored: false });
  });

  it('is one move per issue and target', () => {
    expect(trackerTransitionIssueAction.dedupKeyFor!(parse({ key: 'nw-7', to: 'In Progress' }))).toBe(trackerTransitionIssueAction.dedupKeyFor!(parse({ key: 'NW-7', to: 'in progress', reason: 'r' })));
  });
});

describe('tracker.update_issue', () => {
  const parse = (i: Record<string, unknown>) => trackerUpdateIssueAction.inputSchema.parse(i);

  it('needs at least one field', () => {
    expect(trackerUpdateIssueAction.inputSchema.safeParse({ key: 'NW-7' }).success).toBe(false);
  });

  it('writes the fields, keeps what was there, and Undo restores it and removes the link it added', async () => {
    const input = parse({ key: 'NW-7', priority: 'High', labels: ['a', 'factory'], remoteLink: { url: 'https://vocion.example/w/acme/dashboard/work/12', title: 'Request #12' } });
    const out = await trackerUpdateIssueAction.execute(ctx, input);

    expect(provider.updateIssue).toHaveBeenCalledWith('NW-7', { priority: 'High', labels: ['a', 'factory'], fixVersion: undefined, remoteLink: { url: 'https://vocion.example/w/acme/dashboard/work/12', title: 'Request #12' } });
    expect(out).toMatchObject({ updated: true, previous: { priority: 'Low', labels: ['a'], remoteLinkId: '9001' } });

    await expect(trackerUpdateIssueAction.undo!(ctx, input, out)).resolves.toMatchObject({ restored: true });
    expect(provider.updateIssue).toHaveBeenLastCalledWith('NW-7', { priority: 'Low', labels: ['a'] });
    expect(provider.removeRemoteLink).toHaveBeenCalledWith('NW-7', '9001');
  });
});

describe('tracker.comment', () => {
  const parse = (i: Record<string, unknown>) => trackerCommentAction.inputSchema.parse(i);

  it('keys the ladder on the kind, with the parent rule governing a kind without one', () => {
    expect(trackerCommentAction.policyKeyFor!(parse({ key: 'NW-7', text: 'Shipped.', kind: 'completion' }))).toBe('tracker.comment.completion');
    expect(trackerCommentAction.policyKeyFor!(parse({ key: 'NW-7', text: 'Shipped.' }))).toBe('tracker.comment');
    expect(trackerCommentAction.parentRuleGoverns).toBe(true);
  });

  it('shows the words as an editable message, writes the comment, and Undo deletes it', async () => {
    const input = parse({ key: 'NW-7', text: 'Shipped in 1.8.', kind: 'completion' });
    const card = await trackerCommentAction.reviewCard!(ctx, input);

    expect(card.content).toEqual([{ kind: 'message', id: 'message', label: 'Comment', body: 'Shipped in 1.8.' }]);
    expect(trackerCommentAction.applyContentEdits!(input, [{ id: 'message', body: 'Shipped in 1.8, see the release.' }])).toMatchObject({ text: 'Shipped in 1.8, see the release.' });

    const out = await trackerCommentAction.execute(ctx, input);

    expect(provider.addComment).toHaveBeenCalledWith('NW-7', 'Shipped in 1.8.');
    expect(out).toMatchObject({ commented: true, commentId: '77' });

    await expect(trackerCommentAction.undo!(ctx, input, out)).resolves.toMatchObject({ deleted: true });
    expect(provider.deleteComment).toHaveBeenCalledWith('NW-7', '77');
    await expect(trackerCommentAction.undo!(ctx, input, { commented: true })).rejects.toThrow(/nothing to take back/);
  });
});

describe('tracker.attach_file', () => {
  const parse = (i: Record<string, unknown>) => trackerAttachFileAction.inputSchema.parse(i);

  it('needs an artifact or a url', () => {
    expect(trackerAttachFileAction.inputSchema.safeParse({ key: 'NW-7' }).success).toBe(false);
  });

  it('attaches a stored artifact by url and Undo deletes the attachment', async () => {
    const input = parse({ key: 'NW-7', url: '/api/artifacts/org_1-abc.png', caption: 'The mockup' });
    const out = await trackerAttachFileAction.execute(ctx, input);

    expect(provider.attach).toHaveBeenCalledWith('NW-7', expect.objectContaining({ filename: 'org_1-abc.png', mimeType: 'image/png' }));
    expect(out).toMatchObject({ attached: true, attachmentId: '55', line: 'Attached org_1-abc.png to NW-7: The mockup' });

    await expect(trackerAttachFileAction.undo!(ctx, input, out)).resolves.toMatchObject({ deleted: true });
    expect(provider.deleteAttachment).toHaveBeenCalledWith('55');
  });
});
