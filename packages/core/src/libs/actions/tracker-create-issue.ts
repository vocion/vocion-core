/**
 * `tracker.create_issue` — a request becomes an issue on the client's board.
 *
 * The factory files a request in Vocion, but the client reads their own
 * tracker. The PM proposes the issue in the asker's words, with a line that
 * names the Vocion request it mirrors, and the issue is the board's record of
 * the same work. Undo deletes the issue. Dedup is on the request when one is
 * named, so a second proposal for the same request refreshes the card rather
 * than filing twice.
 *
 * `external: true`, `medium`: an issue on a client's board is read by people
 * who did not ask for it, but it is deleted in one move.
 */

import type { Action } from './types';
import { z } from 'zod';

export const CREATE_ISSUE_ACTION_ID = 'tracker.create_issue';

const createIssueInput = z.object({
  projectKey: z.string().min(1).max(20).optional().describe('The project on the tracker. The source\'s only configured project when omitted.'),
  issueType: z.string().min(1).max(60).describe('The issue type as the tracker names it: Bug, Task, Story.'),
  summary: z.string().min(4).max(250).describe('The title, in the asker\'s words.'),
  description: z.string().min(1).max(30_000).describe('What was asked, who asked and where, the acceptance when there is one. Plain text; paragraphs separated by a blank line.'),
  labels: z.array(z.string().min(1).max(60)).max(20).optional(),
  priority: z.string().min(1).max(40).optional().describe('The priority as the tracker names it (Highest, High, Medium, Low).'),
  requestId: z.coerce.number().int().positive().optional().describe('The Vocion request this issue mirrors; its link is added to the description.'),
});

type Input = z.infer<typeof createIssueInput>;

export const trackerCreateIssueAction: Action<typeof createIssueInput> = {
  id: CREATE_ISSUE_ACTION_ID,
  name: 'Create a tracker issue',
  description: 'File an issue on the connected issue tracker (Jira or Linear) from a request, in the asker\'s words, with the Vocion request linked in its description. Undo deletes the issue.',
  inputSchema: createIssueInput,
  grant: 'factory_write',
  external: true,
  dedupKeyFor: input => `${CREATE_ISSUE_ACTION_ID}:${input.requestId ? `request:${input.requestId}` : `summary:${input.summary.trim().toLowerCase()}`}`.slice(0, 400),
  ownsDedupKey: true,
  async precheck(ctx, input) {
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    try {
      const provider = await trackerProviderFor(ctx.orgId);
      if (input.projectKey && !provider.projectKeys.includes(input.projectKey.toUpperCase())) {
        return `Project ${input.projectKey} is not one the ${provider.sourceSlug} source is configured for (${provider.projectKeys.join(', ')}).`;
      }
      if (!input.projectKey && provider.projectKeys.length !== 1) {
        return `Name the project: the ${provider.sourceSlug} source is configured for ${provider.projectKeys.join(', ') || 'no project'}.`;
      }
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  },
  async reviewCard(_ctx, raw) {
    const input = raw as Input;
    return {
      title: `Create ${input.issueType.toLowerCase()} on the tracker: ${input.summary}`,
      system: 'Issue tracker',
      headline: 'File this issue on the client\'s board; Undo deletes it.',
      badges: [{ label: 'Issue tracker' }, { label: 'Undo deletes the issue' }],
      content: [{ kind: 'message' as const, id: 'description', label: 'Description', body: input.description }],
      contentHeading: { label: 'Description' },
      fields: [
        ...(input.projectKey ? [{ label: 'Project', value: input.projectKey }] : []),
        { label: 'Type', value: input.issueType },
        ...(input.priority ? [{ label: 'Priority', value: input.priority }] : []),
        ...(input.labels?.length ? [{ label: 'Labels', value: input.labels.join(', ') }] : []),
        ...(input.requestId ? [{ label: 'Mirrors request', value: `#${input.requestId}` }] : []),
      ],
      nextAction: 'Approving files the issue now.',
      verbs: { approve: 'File it', reject: 'Leave it' },
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'description');
    return edit?.body === undefined ? input : { ...input, description: edit.body };
  },
  async execute(ctx, input) {
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const provider = await trackerProviderFor(ctx.orgId);
    const projectKey = (input.projectKey ?? provider.projectKeys[0] ?? '').toUpperCase();
    let description = input.description;
    if (input.requestId) {
      const { recordHref } = await import('@/services/objects/recordHref');
      const { appBaseUrl } = await import('@/libs/links');
      const href = await recordHref(ctx.orgId, { objectType: 'request', id: input.requestId }).catch(() => `/dashboard/objects/${input.requestId}`);
      description = `${description.trimEnd()}\n\nVocion request #${input.requestId}: ${appBaseUrl()}${href}`;
    }
    const created = await provider.createIssue({ projectKey, issueType: input.issueType, summary: input.summary, description, labels: input.labels, priority: input.priority });
    const line = `Filed ${created.key} on the tracker: ${input.summary}`;
    if (input.requestId) {
      const { noteOnRequest } = await import('@/services/factory/carry');
      await noteOnRequest(ctx.orgId, input.requestId, `${line} (${created.url})`, ctx.runId ?? null).catch(() => undefined);
    }
    return { created: true, key: created.key, url: created.url, sourceSlug: provider.sourceSlug, ...(input.requestId ? { objectId: input.requestId } : {}), line };
  },
  async undo(ctx, _input, result) {
    const key = typeof result?.key === 'string' ? result.key : null;
    if (!key) {
      return { note: 'This run recorded no issue, so there is nothing to delete.' };
    }
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const provider = await trackerProviderFor(ctx.orgId, { issueKey: key });
    await provider.deleteIssue(key);
    return { deleted: true, key, line: `Deleted ${key} from the tracker.` };
  },
};
