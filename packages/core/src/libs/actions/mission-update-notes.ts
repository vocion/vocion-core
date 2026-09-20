/**
 * mission.update_notes — a mission rewrites its own working notes.
 *
 * The notes are what the next scheduled check reads in its brief: open
 * threads with how many checks they have been open, commitments with dates,
 * escalation state. They are the clearest case of the system improving
 * itself, and until now they were a bare `db.update` from the agent's tool —
 * no run, no receipt, no way back. A check that hallucinated a closed thread
 * silently poisoned every check after it.
 *
 * As an action it is DONE FOR YOU with a bar (0.6, the same as a wiki page —
 * these are notes to itself, and asking about every one is the behaviour this
 * was built to remove) and `undo` restores the exact previous text, which
 * `execute` records on the run.
 */

import type { Action } from './types';
import { z } from 'zod';

const MAX_NOTES_CHARS = 8000;

const missionNotesInput = z.object({
  /** The mission, by slug. */
  slug: z.string().min(1).max(120),
  /** The complete new notes — a full replacement, never an append. */
  notes: z.string().min(1).max(MAX_NOTES_CHARS),
  /** Why the notes moved, in a sentence the run reads back. */
  reason: z.string().min(1).max(500),
});

export type MissionUpdateNotesInput = z.infer<typeof missionNotesInput>;

export const missionUpdateNotesAction: Action<typeof missionNotesInput> = {
  id: 'mission.update_notes',
  name: 'Update a mission\'s working notes',
  description: 'Rewrite a mission\'s working notes — its memory for the next scheduled check: open threads, commitments, escalation state. A full replacement. Reversible: the previous notes are one Undo away.',
  inputSchema: missionNotesInput,
  grant: 'manage_workspace',
  external: false,
  // The notes are the mission's own memory: on the learning dial.
  selfImproving: true,
  dedupKeyFor: input => `mission.update_notes:${input.slug.toLowerCase()}`,
  async precheck(ctx, input) {
    const { getMission } = await import('@/services/MissionService');
    const mission = await getMission(ctx.orgId, input.slug);
    return mission ? undefined : `no mission "${input.slug}" in this workspace`;
  },
  async reviewCard(ctx, input) {
    const { getMission } = await import('@/services/MissionService');
    const { diffLines } = await import('./selfUpdate');
    const mission = await getMission(ctx.orgId, input.slug);
    const diff = diffLines(mission?.workingNotes ?? '', input.notes);
    return {
      title: `Update working notes: ${mission?.name ?? input.slug}`,
      system: 'Mission',
      summary: input.reason,
      fields: [
        { label: 'Mission', value: mission?.name ?? input.slug, href: `/dashboard/missions/${input.slug}` },
        { label: 'Change', value: diff.summary },
        { label: 'New notes', value: input.notes.slice(0, 800) + (input.notes.length > 800 ? '…' : '') },
      ],
      nextAction: 'Approving replaces the notes the next scheduled check will read; the previous text stays on this run for Undo.',
      verbs: { approve: 'Update notes', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const { rewriteWorkingNotes } = await import('@/services/MissionService');
    const res = await rewriteWorkingNotes(ctx.orgId, input.slug, input.notes);
    if (!res) {
      throw new Error(`no mission "${input.slug}" in this workspace`);
    }
    const { diffLines } = await import('./selfUpdate');
    const diff = diffLines(res.previous ?? '', input.notes);
    return {
      slug: input.slug,
      missionName: res.name,
      previousNotes: res.previous,
      chars: input.notes.length,
      change: diff.summary,
      linesAdded: diff.added,
      linesRemoved: diff.removed,
      href: `/dashboard/missions/${input.slug}`,
    };
  },
  async undo(ctx, input, result) {
    const { rewriteWorkingNotes } = await import('@/services/MissionService');
    // A mission that had NO notes goes back to having none — `null`, not an
    // empty string. "Restores exactly" has to survive that distinction or the
    // undo leaves a mission looking like it once wrote something empty.
    const previous = typeof result.previousNotes === 'string' ? result.previousNotes : null;
    const res = await rewriteWorkingNotes(ctx.orgId, input.slug, previous);
    return { undone: res !== null, restoredChars: previous?.length ?? 0, restoredToEmpty: previous === null };
  },
};
