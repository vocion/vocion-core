/**
 * The workspace off switch — one hold over everything the factory does by
 * itself, and one guard that every caller asks.
 *
 * On 21 September 2026 stopping the Squatch factory meant twenty
 * `POST /api/v1/automations/:slug/pause` calls, typed by hand, by someone who
 * had to know every slug first. They worked. They were also not a control: a
 * stop assembled twenty times under pressure is twenty chances to miss one,
 * and the one missed is the one still spending. Worse, automations are only
 * one of four ways work starts here — a mission run, a worker run and a gated
 * action all carried on while every automation sat paused.
 *
 * So the workspace gets its own hold, and it is a DIFFERENT fact from
 * `automation.paused_at`. A workspace pause writes no automation row. Resume
 * therefore restores exactly what was there before: an automation a person
 * paused last Tuesday is still paused, because nothing touched it. Nothing is
 * snapshotted and nothing is replayed, which is why nothing can be lost.
 *
 * **What it refuses** — every one of these through {@link assertWorkspaceRunning},
 * the single function, before any model call:
 *
 *   1. every automation fire, scheduled or event (recorded as a `skipped`
 *      `automation_run` with reason `workspace_paused`, so the log says why
 *      the gap is there);
 *   2. starting a mission run — the API, MCP `mission_start`, or a chat turn
 *      that reaches for one;
 *   3. queueing or claiming a worker run;
 *   4. executing a gated action, except a hand-off — `libs/actions/manual.ts`
 *      kinds are performed by a person, and a person is not the factory.
 *
 * **What it allows, deliberately.** Chat with an agent stays open: a person
 * talking is not the factory working, and the first thing anyone does after
 * pulling the switch is ask what happened. If that turn tries to start a
 * mission, queue a worker run or execute a gated action, the guard refuses it
 * with the pause note — the refusal lands where the work would have started,
 * not on the conversation. A worker already mid-run is not killed either: it
 * finishes and reports, its completion events are still written to the event
 * log, and they raise no automation, because the fire is what is refused.
 *
 * That judgement — chat open, work refused — is the one real decision in
 * here. It is written down in `docs/entities/workspace-manifest.md` as such.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema, userSchema } from '@/models/Schema';

/** The person (or token) placing the hold. `name` is what the banner shows. */
export type WorkspacePauseActor = { id: string; name?: string | null };

/** The hold a surface shows: who, when, and the note they left. */
export type WorkspacePause = {
  by: { id: string; name: string | null };
  at: Date;
  note: string | null;
};

/**
 * The kinds of work the switch is over. Naming them here rather than passing
 * free text means the refusal a caller sees, the docs and the banner all say
 * the same four things.
 */
export const PAUSED_CAPABILITIES = {
  automation_fire: 'an automation fire',
  mission_run: 'a mission run',
  worker_run: 'a worker run',
  gated_action: 'a gated action',
} as const;

/** Which of the four a caller is asking about. */
export type PausedCapability = keyof typeof PAUSED_CAPABILITIES;

/** Thrown by {@link assertWorkspaceRunning}. Carries the hold, so a surface can show who and why. */
export class WorkspacePausedError extends Error {
  /** Stable, for the HTTP envelope and the MCP error text. */
  readonly code = 'WORKSPACE_PAUSED';
  readonly pause: WorkspacePause;
  readonly capability: PausedCapability;

  constructor(pause: WorkspacePause, capability: PausedCapability) {
    super(refusalMessage(pause, capability));
    this.name = 'WorkspacePausedError';
    this.pause = pause;
    this.capability = capability;
  }
}

/** Pause on a paused workspace, or resume on a running one — the state already is what was asked for. */
export class WorkspacePauseStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePauseStateError';
  }
}

/** Nothing to pause: the org id names no project row. */
export class WorkspaceNotFoundError extends Error {
  constructor(orgId: string) {
    super(`no workspace found for org ${orgId}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

/**
 * The hold on a workspace, or null when it is running. Names are NOT resolved
 * here — this is the hot path every guard takes, and a join per automation
 * fire buys nothing the refusal message needs.
 *
 * `paused_by` is carried through as the name when no user row resolves, which
 * is what happens for an API token (`token:<id>`): the token id is the most
 * honest thing to show, because there is no person behind it in the moment.
 * @param orgId - The project.
 */
export async function readWorkspacePause(orgId: string): Promise<WorkspacePause | null> {
  const [row] = await db
    .select({ pausedAt: projectSchema.pausedAt, pausedBy: projectSchema.pausedBy, pausedNote: projectSchema.pausedNote })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!row?.pausedAt) {
    return null;
  }
  return { by: { id: row.pausedBy ?? '', name: null }, at: row.pausedAt, note: row.pausedNote };
}

/**
 * The hold with the person's name resolved — for the banner, the API read and
 * the apply summary. One user lookup; never called from a guard.
 * @param orgId - The project.
 */
export async function readWorkspacePauseWithName(orgId: string): Promise<WorkspacePause | null> {
  const pause = await readWorkspacePause(orgId);
  if (!pause) {
    return null;
  }
  return { ...pause, by: { ...pause.by, name: await displayName(pause.by.id) } };
}

/**
 * **The guard.** One function, asked by every path that starts work the
 * factory does by itself — the automation fire, the mission run, the worker
 * run, the gated action. It throws {@link WorkspacePausedError} when the
 * workspace is held, and returns otherwise.
 *
 * Call it before any model call, not after: the point of a stop is that
 * nothing was spent, and a refusal written after the tokens were burned is a
 * log entry, not a switch.
 * @param orgId - The project the work would run in.
 * @param capability - Which of the four kinds of work this is, for the refusal.
 */
export async function assertWorkspaceRunning(orgId: string, capability: PausedCapability): Promise<void> {
  const pause = await readWorkspacePause(orgId);
  if (pause) {
    // The name lookup is paid only on the refusal. A running workspace — the
    // case this runs in a thousand times a day — costs one indexed read.
    throw new WorkspacePausedError({ ...pause, by: { ...pause.by, name: await displayName(pause.by.id) } }, capability);
  }
}

/**
 * What a refusal says. The note comes first after the fact of the pause,
 * because the note is the only part that tells the reader what to do.
 * @param pause - The hold in force.
 * @param capability - What was refused.
 */
export function refusalMessage(pause: WorkspacePause, capability: PausedCapability): string {
  const who = pause.by.name ?? pause.by.id ?? 'someone';
  const when = pause.at.toISOString().slice(0, 16).replace('T', ' ');
  const note = pause.note ? ` — ${pause.note}` : '';
  return `this workspace is paused${note}. ${PAUSED_CAPABILITIES[capability]} will not start until someone resumes it. Paused by ${who} at ${when} UTC.`;
}

/**
 * Pull the switch. One row update and nothing else — no automation is
 * touched, no schedule is changed, no run is killed.
 *
 * Deliberately NOT a bulk pause of the automations underneath. Pausing them
 * would mean un-pausing them on resume, and there is no honest way to tell
 * the ones this switch paused from the ones a person paused last week. Two
 * facts, kept apart, need no reconciliation.
 * @param orgId - The project.
 * @param opts - Who, and why.
 * @param opts.by
 * @param opts.note - Required by every surface; a stop with no reason is the row nobody can act on a week later.
 * @param opts.now
 */
export async function pauseWorkspace(
  orgId: string,
  opts: { by: WorkspacePauseActor; note: string; now?: Date },
): Promise<WorkspacePause> {
  const current = await loadProjectPause(orgId);
  if (current.pausedAt) {
    throw new WorkspacePauseStateError('this workspace is already paused. Reload to see its current state.');
  }
  const now = opts.now ?? new Date();
  const note = cleanNote(opts.note);
  if (!note) {
    throw new WorkspacePauseStateError('a pause needs a note saying why — it is what the banner shows everyone else');
  }
  await db
    .update(projectSchema)
    .set({ pausedAt: now, pausedBy: opts.by.id, pausedNote: note })
    .where(eq(projectSchema.id, orgId));
  // Names are resolved here and nowhere else. Every surface hands in an id
  // and gets back the name the banner will show, so no router or route has
  // to reach for the profile service — which would drag next-auth into the
  // import graph of anything that imports a caller of this.
  return { by: { id: opts.by.id, name: opts.by.name ?? await displayName(opts.by.id) }, at: now, note };
}

/**
 * Lift the switch, and say whose hold it was.
 *
 * What comes back is what was already there: schedules fire on their next
 * tick, event automations match again, worker runs may be claimed, and every
 * automation a person paused individually is still paused, untouched. There
 * is nothing to restore because there was nothing to save — that is the
 * point of keeping the two pauses as separate facts.
 * @param orgId - The project.
 * @param opts - Who lifted it.
 * @param opts.by - Returned as `by`, so a caller's log names them; the hold itself is gone after this.
 */
export async function resumeWorkspace(
  orgId: string,
  opts: { by: WorkspacePauseActor },
): Promise<{ lifted: WorkspacePause; by: { id: string; name: string | null } }> {
  const current = await loadProjectPause(orgId);
  if (!current.pausedAt) {
    throw new WorkspacePauseStateError('this workspace is not paused. Reload to see its current state.');
  }
  const lifted: WorkspacePause = {
    by: { id: current.pausedBy ?? '', name: await displayName(current.pausedBy ?? '') },
    at: current.pausedAt,
    note: current.pausedNote,
  };
  await db
    .update(projectSchema)
    .set({ pausedAt: null, pausedBy: null, pausedNote: null })
    .where(eq(projectSchema.id, orgId));
  return { lifted, by: { id: opts.by.id, name: opts.by.name ?? await displayName(opts.by.id) } };
}

/**
 * The project's three pause columns, or a refusal when the org names no project.
 * @param orgId
 */
async function loadProjectPause(orgId: string): Promise<{ pausedAt: Date | null; pausedBy: string | null; pausedNote: string | null }> {
  const [row] = await db
    .select({ pausedAt: projectSchema.pausedAt, pausedBy: projectSchema.pausedBy, pausedNote: projectSchema.pausedNote })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!row) {
    throw new WorkspaceNotFoundError(orgId);
  }
  return row;
}

/**
 * The name to show for an actor id — a person's, or the id itself for a token.
 * @param id
 */
async function displayName(id: string): Promise<string | null> {
  if (!id) {
    return null;
  }
  if (id.startsWith('token:')) {
    return `API token ${id.slice('token:'.length)}`;
  }
  // Read here rather than through AutomationService's `userNamesById`: this
  // module is imported BY the automation, mission, worker and action paths,
  // so it must not import any of them back.
  const [row] = await db.select({ name: userSchema.name, email: userSchema.email }).from(userSchema).where(eq(userSchema.id, id)).limit(1);
  return row ? (row.name?.trim() || row.email) : null;
}

function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, 500);
}
