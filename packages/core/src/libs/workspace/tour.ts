import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { logger } from '@/libs/Logger';
import { workspacePagesDir } from '@/libs/workspace/pages';
import { readWorkspaceTextFile } from '@/libs/workspace/template-vars';

/**
 * Workspace tours — guided, step-by-step walkthroughs of the dashboard,
 * declared by the tenant in `WORKSPACE_PATH/pages/tour.yaml` (one tour) and
 * `WORKSPACE_PATH/pages/tours/<slug>.yaml` (any number, one per file).
 * Rendered by the WorkspaceTour client overlay (spotlight + popover,
 * driver.js-style but dependency-free), mounted globally in the dashboard
 * layout so steps can walk across core pages and workspace pages alike.
 *
 * Start one with `?tour=<slug>` on any dashboard URL (`?tour=1` starts the
 * first), or the floating launcher that appears whenever a tour is defined.
 * `&autoplay=1` plays it hands-free: every step holds for its `dwellMs`,
 * a step that waits for a click performs the click itself, and a tour with
 * `next:` chains into that tour at the end — which is how one screen can
 * loop every tour unattended. `autoStart: true` starts a tour on a
 * visitor's first dashboard visit (dismissal is remembered in localStorage).
 */

const StepSchema = z.object({
  /** Dashboard route the step happens on, e.g. `/dashboard/p/command-center`. */
  route: z.string().startsWith('/dashboard'),
  title: z.string(),
  body: z.string(),
  /** Short label above the title, e.g. "Step 2 · the human gate". */
  eyebrow: z.string().optional(),
  /** CSS selector to spotlight. Omitted → centered popover, no spotlight. */
  selector: z.string().optional(),
  /** Popover placement relative to the spotlit element. */
  placement: z.enum(['top', 'bottom', 'left', 'right', 'center']).default('bottom'),
  /** Let the audience click the page (e.g. open a record) instead of blocking. */
  interactive: z.boolean().default(false),
  /** Match the route as a prefix — for steps that land on dynamic ids. */
  routePrefix: z.boolean().default(false),
  /**
   * How the step ends. `next` — the Next button. `click` — the audience taps
   * the spotlit element (the rest of the page stays blocked), and the tour
   * moves on. `appear` — the tour moves on by itself once `waitFor` is on the
   * page, for a step that watches work happen.
   */
  advance: z.enum(['next', 'click', 'appear']).default('next'),
  /** For `advance: appear`: the selector whose arrival ends the step. */
  waitFor: z.string().optional(),
  /** Text the `waitFor` element must contain — for waiting on a line an agent says. */
  waitForText: z.string().optional(),
  /**
   * Text that must be inside the `selector` element for it to count, for a
   * page that draws many elements matching one selector (the button labelled
   * Approve among many buttons).
   */
  selectorText: z.string().optional(),
  /** Label for the Next button, e.g. "Draft it". */
  nextLabel: z.string().optional(),
  /** Autoplay: how long the step holds before moving on. Defaults from the body's length. */
  dwellMs: z.number().int().positive().optional(),
  /** Override the tour's `mask` for this step. */
  mask: z.enum(['dim', 'none']).optional(),
  /** The takeaway for `presentation: caption` — one line, read from across a room. Defaults to the title. */
  caption: z.string().optional(),
  /** Override the tour's `presentation` for this step — a caption banner leaves a full-screen document readable. */
  presentation: z.enum(['popover', 'caption']).optional(),
  /**
   * Scroll something into view when the step opens — the tour paging through a
   * document. `target` is a selector; `index` picks among its matches (the
   * fourth `.sheet` is index 3); `frame` names a same-origin iframe to look in.
   */
  scrollTo: z.object({
    target: z.string(),
    index: z.number().int().nonnegative().default(0),
    frame: z.string().optional(),
  }).optional(),
})
  .refine(s => s.advance !== 'appear' || s.waitFor !== undefined, { message: 'advance: appear needs waitFor — the selector whose arrival ends the step', path: ['waitFor'] })
  .refine(s => s.advance !== 'click' || s.selector !== undefined, { message: 'advance: click needs selector — the element the audience taps', path: ['selector'] });

export const TourManifestSchema = z.object({
  /** Stable id, used in `?tour=<slug>`. Defaults to the file name. */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  title: z.string().default('Guided tour'),
  /** One line for the launcher menu. */
  description: z.string().optional(),
  /** Start automatically on first dashboard visit (per-browser). */
  autoStart: z.boolean().default(false),
  /** The tour autoplay chains into when this one finishes. */
  next: z.string().optional(),
  /** Launcher order; lower first. */
  order: z.number().default(0),
  /**
   * How the rest of the page looks while a step is up. `dim` darkens
   * everything but the spotlit element; `none` leaves the app at full
   * brightness and rings the element instead — for a recording, or a
   * screen people watch rather than tap.
   */
  mask: z.enum(['dim', 'none']).default('dim'),
  /**
   * `popover` — a card beside the element, for someone holding the screen.
   * `caption` — a full-width lower third with each step's takeaway in large
   * type, for a screen watched from a distance or a recording.
   */
  presentation: z.enum(['popover', 'caption']).default('popover'),
  /** Keep it out of the launcher menu (still startable by `?tour=<slug>`). */
  hidden: z.boolean().default(false),
  steps: z.array(StepSchema).min(1),
});

export type TourManifest = z.infer<typeof TourManifestSchema> & { slug: string };
export type TourStep = z.infer<typeof StepSchema>;

function readTourFile(file: string, fallbackSlug: string): TourManifest | null {
  try {
    const result = TourManifestSchema.safeParse(parseYaml(readWorkspaceTextFile(file)));
    if (!result.success) {
      logger.error(`workspace tour at ${file} is invalid`, { issues: result.error.issues });
      return null;
    }
    return { ...result.data, slug: result.data.slug ?? fallbackSlug };
  } catch (error) {
    // A malformed or untemplatable tour hides the launcher rather than
    // breaking the dashboard, but it should never do so quietly.
    logger.error(`workspace tour at ${file} could not be read`, { error });
    return null;
  }
}

/** Read + validate every workspace tour, in launcher order. Never throws. */
export function readWorkspaceTours(): TourManifest[] {
  const dir = workspacePagesDir();
  if (!dir) {
    return [];
  }
  const tours: TourManifest[] = [];
  // turbopackIgnore: these paths are only known at runtime, so the build must not
  // trace them, or Next copies the whole project into the image (next.config.ts, #832).
  const single = ['tour.yaml', 'tour.yml'].map(n => join(/* turbopackIgnore: true */ dir, n)).find(existsSync);
  if (single) {
    const tour = readTourFile(single, 'tour');
    if (tour) {
      tours.push(tour);
    }
  }
  const many = join(/* turbopackIgnore: true */ dir, 'tours');
  if (existsSync(many)) {
    for (const f of readdirSync(many).filter(f => /\.ya?ml$/.test(f)).sort()) {
      const tour = readTourFile(join(/* turbopackIgnore: true */ many, f), f.replace(/\.ya?ml$/, ''));
      if (tour && !tours.some(t => t.slug === tour.slug)) {
        tours.push(tour);
      }
    }
  }
  return tours.sort((a, b) => a.order - b.order);
}

/** The first workspace tour, if one is defined. Never throws. */
export function readWorkspaceTour(): TourManifest | null {
  return readWorkspaceTours()[0] ?? null;
}
