/**
 * THE SAVED AUTOMATIONS AN AGENT CAN RUN, in front of it and the router.
 *
 * Before 2026-11-06 an agent learnt the workspace's automations only by
 * calling `routine_list`, and the router's roster listed an agent's tools,
 * never the automations it runs, so "check the licenses for everyone who's
 * ready" had to be scripted ("Use the browser to…") into the agent's prompt.
 * Now each agent that can run automations is told, in its prompt, which ones
 * the workspace has approved — name, purpose, inputs per row, what it
 * changes, trust level, last run — and the router reads the same list on the
 * seats that run them.
 *
 * Short and stable: approved automations only, capped, a date not a time, so
 * the block changes only when an automation does and the prompt cache holds.
 */

import type { RoutineView } from '@/libs/routines/types';
import { automationChanges, automationSites } from '@/libs/routines/describe';
import { TRUST_LABEL } from '@/libs/routines/types';

/** An approved automation, as an agent and the router read it. */
export type SavedAutomation = {
  id: number;
  name: string;
  purpose: string;
  sites: string[];
  /** The inputs each row gives (not the ones every row shares, not secrets). */
  rowInputs: string[];
  /** Inputs the batch gives once (the sign-in), and whether they are saved on the automation. */
  sharedInputs: Array<{ name: string; saved: boolean }>;
  changes: string;
  trust: string;
  /** The day its last batch started (YYYY-MM-DD), when it has run. */
  lastRun: string | null;
};

/** How many automations an agent's prompt names; `routine_list` has the rest. */
export const AUTOMATIONS_IN_PROMPT = 8;

/**
 * An approved automation, as the prompt and the router read it. Pure.
 * @param r - The automation.
 * @param lastRun - The day its last batch started, when it has run.
 */
export function savedAutomation(r: RoutineView, lastRun: string | null): SavedAutomation | null {
  const v = r.version;
  if (r.status !== 'live' || !v || v.status !== 'approved') {
    return null;
  }
  const spec = v.spec;
  return {
    id: r.id,
    name: r.name,
    purpose: (r.description ?? spec.summary ?? '').replace(/\s+/g, ' ').trim(),
    sites: automationSites(r),
    rowInputs: spec.inputs.filter(i => !i.shared && !i.secret).map(i => `${i.name}${i.optional ? ' (optional)' : ''}`),
    sharedInputs: spec.inputs.filter(i => i.shared || i.secret).map(i => ({ name: i.name, saved: r.savedInputs.includes(i.name) })),
    changes: automationChanges(r),
    trust: TRUST_LABEL[r.trust],
    lastRun,
  };
}

/**
 * The workspace's approved automations, newest first, with the day each last
 * ran. Never throws: an empty list when they cannot be read.
 * @param orgId - The workspace.
 */
export async function savedAutomations(orgId: string): Promise<SavedAutomation[]> {
  try {
    const { listRoutines } = await import('./routineReads');
    const all = await listRoutines(orgId);
    const live = all.filter(r => r.status === 'live');
    if (live.length === 0) {
      return [];
    }
    const { and, eq, inArray, max } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { routineBatchSchema } = await import('@/models/Schema');
    const last = await db
      .select({ routineId: routineBatchSchema.routineId, at: max(routineBatchSchema.createdAt) })
      .from(routineBatchSchema)
      .where(and(eq(routineBatchSchema.orgId, orgId), inArray(routineBatchSchema.routineId, live.map(r => r.id))))
      .groupBy(routineBatchSchema.routineId);
    const day = new Map(last.map(l => [l.routineId, l.at ? new Date(l.at).toISOString().slice(0, 10) : null]));
    return live.map(r => savedAutomation(r, day.get(r.id) ?? null)).filter((a): a is SavedAutomation => a !== null);
  } catch (err) {
    console.warn('saved automations read failed', { orgId, message: (err as Error).message });
    return [];
  }
}

/**
 * The block an agent that can run automations reads in its prompt. Null when
 * there are none. Pure.
 * @param automations - The approved automations.
 */
export function savedAutomationsNote(automations: readonly SavedAutomation[]): string | null {
  if (automations.length === 0) {
    return null;
  }
  const shown = automations.slice(0, AUTOMATIONS_IN_PROMPT);
  const more = automations.length - shown.length;
  const lines = shown.map((a) => {
    const shared = a.sharedInputs.map(s => `${s.name}${s.saved ? ' (saved)' : ''}`);
    return [
      `- "${a.name}" (${a.trust} trust${a.lastRun ? `, last run ${a.lastRun}` : ', not run yet'}): ${a.purpose.slice(0, 280)}`,
      `  Each row: ${a.rowInputs.join(', ') || 'no inputs'}.${shared.length > 0 ? ` Once per batch: ${shared.join(', ')}.` : ''}`,
      a.changes ? `  Changes: ${a.changes.slice(0, 320)}.` : '',
    ].filter(Boolean).join('\n');
  });
  return [
    'SAVED AUTOMATIONS you can run with routine_run, one row per item:',
    ...lines,
    ...(more > 0 ? [`(${more} more: routine_list.)`] : []),
    'When the person asks for work one of these does, run it for their rows rather than doing the same work in a browser task. Read with a browser task only what you need to know which rows to run it for.',
  ].join('\n');
}

/**
 * The automations one seat runs, as the router reads them: name and purpose,
 * in a line. Pure.
 * @param automations - The approved automations.
 */
export function automationsForRouter(automations: readonly SavedAutomation[]): string[] {
  return automations.slice(0, AUTOMATIONS_IN_PROMPT).map(a => `"${a.name}" (${a.purpose.slice(0, 140)})`);
}
