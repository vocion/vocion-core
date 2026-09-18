/**
 * The zone a workspace lives in — for the runs no browser is behind:
 * missions, automations, the morning briefing, mail and Slack surfaces.
 * Authored as `defaults.timezone` in workspace.yaml and applied onto the
 * project row; `VOCION_TIMEZONE` is the server-wide fallback; UTC is last.
 */

import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { resolveTimeZone } from './zone';

/**
 * @param orgId - The project (org) whose zone is wanted.
 */
export async function workspaceTimeZone(orgId: string): Promise<string> {
  let stored: string | null = null;
  try {
    const [row] = await db.select({ timeZone: projectSchema.timeZone }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
    stored = row?.timeZone ?? null;
  } catch {
    // No row or no database in a unit test: fall through to the server default.
  }
  return resolveTimeZone(stored, process.env.VOCION_TIMEZONE);
}
