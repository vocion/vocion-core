import process from 'node:process';
import { z } from 'zod';

const Scripts = z.record(z.string().min(1), z.string().startsWith('/'));

/**
 * Explicit, deployment-owned demo fixtures keyed by exact workspace ID.
 * @param orgId
 */
export function workspaceDemoScript(orgId: string): string | undefined {
  const raw = process.env.VOCION_DEMO_WORKSPACE_SCRIPTS;
  if (!raw) {
    return undefined;
  }
  if (process.env.VOCION_ALLOW_SCRIPTED_MODEL !== '1') {
    throw new Error('Workspace demo scripts require VOCION_ALLOW_SCRIPTED_MODEL=1');
  }
  const scripts = Scripts.parse(JSON.parse(raw));
  return Object.hasOwn(scripts, orgId) ? scripts[orgId] : undefined;
}
