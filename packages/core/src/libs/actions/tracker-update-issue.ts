/**
 * `tracker.update_issue` — the fields the factory keeps in step on the board:
 * priority, labels, the fix version a release gives it, and a remote issue
 * link to the Vocion record it mirrors. Every write returns what was there
 * before, so Undo restores it (and removes a link it added): reversible,
 * internal to a record the client already owns, done for you (`low`).
 */

import type { Action } from './types';
import { z } from 'zod';

export const UPDATE_ISSUE_ACTION_ID = 'tracker.update_issue';

const updateInput = z.object({
  key: z.string().min(3).max(40).describe('The issue key, e.g. NOCO-123.'),
  priority: z.string().min(1).max(40).optional().describe('The priority as the tracker names it.'),
  labels: z.array(z.string().min(1).max(60)).max(30).optional().describe('The whole label list after the change.'),
  fixVersion: z.string().min(1).max(80).optional().describe('A version to add to the issue\'s fix versions — the release it shipped in.'),
  remoteLink: z.object({ url: z.string().url(), title: z.string().min(1).max(200) }).optional().describe('A remote issue link to add: the Vocion request, plan or pull request.'),
}).refine(i => i.priority !== undefined || i.labels !== undefined || i.fixVersion !== undefined || i.remoteLink !== undefined, { message: 'Give at least one field to change.' });

type Input = z.infer<typeof updateInput>;

export const trackerUpdateIssueAction: Action<typeof updateInput> = {
  id: UPDATE_ISSUE_ACTION_ID,
  name: 'Update a tracker issue',
  description: 'Set an issue\'s priority, labels or fix version, or add a remote issue link, on the connected issue tracker. Undo restores the previous values and removes the link.',
  inputSchema: updateInput,
  grant: 'factory_write',
  external: true,
  dedupKeyFor: input => `${UPDATE_ISSUE_ACTION_ID}:${input.key.trim().toUpperCase()}:${['priority', 'labels', 'fixVersion', 'remoteLink'].filter(f => (input as Record<string, unknown>)[f] !== undefined).join(',')}`,
  ownsDedupKey: true,
  async reviewCard(_ctx, raw) {
    const input = raw as Input;
    return {
      title: `Update ${input.key.toUpperCase()} on the tracker`,
      system: 'Issue tracker',
      headline: 'Write these fields on the issue now; Undo puts the previous values back.',
      badges: [{ label: 'Issue tracker' }, { label: 'Reversible' }],
      fields: [
        { label: 'Issue', value: input.key.toUpperCase() },
        ...(input.priority ? [{ label: 'Priority', value: input.priority }] : []),
        ...(input.labels ? [{ label: 'Labels', value: input.labels.join(', ') || '(none)' }] : []),
        ...(input.fixVersion ? [{ label: 'Fix version', value: input.fixVersion }] : []),
        ...(input.remoteLink ? [{ label: 'Link', value: input.remoteLink.title, href: input.remoteLink.url }] : []),
      ],
      nextAction: 'Approving writes the fields now.',
      verbs: { approve: 'Update it', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const key = input.key.trim().toUpperCase();
    const provider = await trackerProviderFor(ctx.orgId, { issueKey: key });
    const previous = await provider.updateIssue(key, { priority: input.priority, labels: input.labels, fixVersion: input.fixVersion, remoteLink: input.remoteLink });
    const changed = [input.priority ? `priority ${input.priority}` : null, input.labels ? `labels ${input.labels.join(', ') || '(none)'}` : null, input.fixVersion ? `fix version ${input.fixVersion}` : null, input.remoteLink ? `link "${input.remoteLink.title}"` : null].filter(Boolean).join(', ');
    return { updated: true, key, previous, url: provider.issueUrl(key), line: `Updated ${key}: ${changed}` };
  },
  async undo(ctx, input, result) {
    const key = typeof result?.key === 'string' ? result.key : input.key.trim().toUpperCase();
    const previous = (result?.previous ?? null) as { priority?: string | null; labels?: string[]; fixVersions?: string[]; remoteLinkId?: string | null } | null;
    if (!previous) {
      return { note: 'This run recorded no previous values, so there is nothing to put back.' };
    }
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const provider = await trackerProviderFor(ctx.orgId, { issueKey: key });
    const restore: { priority?: string; labels?: string[] } = {};
    if (previous.priority) {
      restore.priority = previous.priority;
    }
    if (previous.labels) {
      restore.labels = previous.labels;
    }
    if (Object.keys(restore).length > 0) {
      await provider.updateIssue(key, restore);
    }
    if (previous.remoteLinkId) {
      await provider.removeRemoteLink(key, previous.remoteLinkId);
    }
    const left = previous.fixVersions !== undefined && input.fixVersion ? ` The fix version ${input.fixVersion} stays; a version is removed on the tracker.` : '';
    return { restored: true, key, line: `Restored ${key}'s previous fields.${left}` };
  },
};
