import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { logger } from '@/libs/Logger';
import { workspacePagesDir } from '@/libs/workspace/pages';
import { readWorkspaceTextFile } from '@/libs/workspace/template-vars';

/**
 * Workspace tour — a guided, step-by-step walkthrough of the dashboard,
 * declared by the tenant in `WORKSPACE_PATH/pages/tour.yaml`. Rendered by
 * the WorkspaceTour client overlay (spotlight + popover, driver.js-style but
 * dependency-free), mounted globally in the dashboard layout so steps can
 * walk across core pages and workspace pages alike.
 *
 * Start it with `?tour=1` on any dashboard URL, or the floating “Guided
 * tour” launcher that appears whenever a tour is defined. `autoStart: true`
 * starts it on a visitor's first dashboard visit (dismissal is remembered
 * in localStorage).
 */

const StepSchema = z.object({
  /** Dashboard route the step happens on, e.g. `/dashboard/p/command-center`. */
  route: z.string().startsWith('/dashboard'),
  title: z.string(),
  body: z.string(),
  /** CSS selector to spotlight. Omitted → centered popover, no spotlight. */
  selector: z.string().optional(),
  /** Popover placement relative to the spotlit element. */
  placement: z.enum(['top', 'bottom', 'left', 'right', 'center']).default('bottom'),
  /** Let the audience click the page (e.g. open a record) instead of blocking. */
  interactive: z.boolean().default(false),
  /** Match the route as a prefix — for steps that land on dynamic ids. */
  routePrefix: z.boolean().default(false),
});

export const TourManifestSchema = z.object({
  title: z.string().default('Guided tour'),
  /** Start automatically on first dashboard visit (per-browser). */
  autoStart: z.boolean().default(false),
  steps: z.array(StepSchema).min(1),
});

export type TourManifest = z.infer<typeof TourManifestSchema>;
export type TourStep = z.infer<typeof StepSchema>;

/** Read + validate the workspace tour, if one is defined. Never throws. */
export function readWorkspaceTour(): TourManifest | null {
  const dir = workspacePagesDir();
  if (!dir) {
    return null;
  }
  const file = ['tour.yaml', 'tour.yml'].map(n => join(dir, n)).find(existsSync);
  if (!file) {
    return null;
  }
  try {
    const result = TourManifestSchema.safeParse(parseYaml(readWorkspaceTextFile(file)));
    return result.success ? result.data : null;
  } catch (error) {
    // A malformed or untemplatable tour hides the launcher rather than
    // breaking the dashboard, but it should never do so quietly.
    logger.error(`workspace tour at ${file} could not be read`, { error });
    return null;
  }
}
