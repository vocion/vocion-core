/**
 * `tracker.transition_issue` — the board says what Vocion knows.
 *
 * A request's state moves in Vocion as the factory works it; the client
 * watches their own board. The PM moves the issue through its tracker's
 * status transitions so both say the same thing (the product's status map,
 * `mirror-the-tracker`). Reversible: the status it came from is recorded, and
 * Undo transitions back when the workflow allows it, so the plugin runs it
 * done for you (`low`).
 */

import type { Action } from './types';
import { z } from 'zod';

export const TRANSITION_ISSUE_ACTION_ID = 'tracker.transition_issue';

const transitionInput = z.object({
  key: z.string().min(3).max(40).describe('The issue key, e.g. NOCO-123.'),
  to: z.string().min(1).max(80).describe('The status to move it to, as the tracker names it (In Progress, In Review, Done), or a transition id from tracker_read_issue.'),
  reason: z.string().max(400).optional().describe('What in Vocion this mirrors: "task #41 dispatched", "PR #12 opened", "released in 1.8".'),
});

type Input = z.infer<typeof transitionInput>;

export const trackerTransitionIssueAction: Action<typeof transitionInput> = {
  id: TRANSITION_ISSUE_ACTION_ID,
  name: 'Move a tracker issue',
  description: 'Move an issue on the connected issue tracker to a status, through one of the transitions its workflow allows from where it stands (read them with tracker_read_issue). Undo moves it back to the status it left.',
  inputSchema: transitionInput,
  grant: 'factory_write',
  external: true,
  // One move per issue and target status; a different target is a new move.
  dedupKeyFor: input => `${TRANSITION_ISSUE_ACTION_ID}:${input.key.trim().toUpperCase()}:${input.to.trim().toLowerCase()}`,
  ownsDedupKey: true,
  async reviewCard(_ctx, raw) {
    const input = raw as Input;
    return {
      title: `Move ${input.key.toUpperCase()} to ${input.to}`,
      system: 'Issue tracker',
      headline: `Move the issue to ${input.to} now; Undo moves it back.`,
      badges: [{ label: 'Issue tracker' }, { label: 'Undo moves it back' }],
      fields: [
        { label: 'Issue', value: input.key.toUpperCase() },
        { label: 'To', value: input.to },
        ...(input.reason ? [{ label: 'Because', value: input.reason }] : []),
      ],
      nextAction: 'Approving moves the issue now.',
      verbs: { approve: 'Move it', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const key = input.key.trim().toUpperCase();
    const provider = await trackerProviderFor(ctx.orgId, { issueKey: key });
    const moved = await provider.transition(key, input.to);
    return { moved: true, key, from: moved.from, to: moved.to, url: provider.issueUrl(key), line: `Moved ${key} from ${moved.from} to ${moved.to}${input.reason ? `: ${input.reason}` : ''}` };
  },
  async undo(ctx, input, result) {
    const from = typeof result?.from === 'string' ? result.from : null;
    const key = typeof result?.key === 'string' ? result.key : input.key.trim().toUpperCase();
    if (!from) {
      return { note: 'This move recorded no previous status, so there is nothing to go back to.' };
    }
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const provider = await trackerProviderFor(ctx.orgId, { issueKey: key });
    const moves = await provider.transitions(key);
    if (!moves.some(m => m.to.toLowerCase() === from.toLowerCase())) {
      return { restored: false, key, from, note: `${key} cannot be moved back to ${from} from where it stands now: the workflow allows ${moves.map(m => m.to).join(', ') || 'no transition'}. A person moves it on the tracker.` };
    }
    const back = await provider.transition(key, from);
    return { restored: true, key, from: back.from, to: back.to, line: `Moved ${key} back to ${back.to}.` };
  },
};
