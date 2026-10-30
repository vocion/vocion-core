/**
 * WHAT A RUN IS DOING, TO WHAT (product owner, 2026-10-29).
 *
 * Running work was listed by its definition, and the definition was often
 * only its slug: the chat's Background work pane showed "seo-continue: Every
 * client's SEO pages keep moving" (the fire's `<slug>: <charter>` title) and
 * "Seo continue" (the automation's slug, title-cased) for one piece of work —
 * researching Google and writing the briefs for the three pages of one batch.
 * A person could not tell what was being done, or to what.
 *
 * So a run carries its own label, set by the code that knows the record it is
 * working on: an event's payload names it under {@link RUN_LABEL_KEY}
 * (`runLabel`), which rides the fire's input onto the automation run and
 * becomes the title of the mission run it starts. Every list of running work
 * reads it through {@link runLabel}: the run's own label first, then the
 * definition's present-tense words (`doing`), then its plain name — and never
 * a slug or the old `<slug>: <charter>` form. Names themselves are held to
 * plain words where they are authored (`plainNames.ts`).
 *
 * Pure: no database, no clock.
 */

/** The key in an event payload (and so a fire's input) that names the run: "Writing the sample drafts · SB-506". */
export const RUN_LABEL_KEY = 'runLabel';

/** A label longer than this is cut: it is a line in a list, not a paragraph. */
export const RUN_LABEL_MAX = 160;

/**
 * Whether a name is only a slug: `seo-continue`, `software-factory/request`.
 * @param name - The name a person would read.
 */
export function isSlugName(name: string | null | undefined): boolean {
  const n = name?.trim() ?? '';
  return !n || /^[a-z0-9]+(?:[-_/.][a-z0-9]+)+$/.test(n);
}

/**
 * Whether a name is its slug with the hyphens turned to spaces ("Seo
 * continue" for `seo-continue`) — what a list used to make from a slug, and
 * what an author writes when they have not said what the work is. Only the
 * authoring check holds names to it (`plainNames.ts`): at run time a name a
 * person wrote is shown as written.
 * @param name - The name.
 * @param slug - The definition's slug.
 */
export function isTitledSlug(name: string | null | undefined, slug: string | null | undefined): boolean {
  const n = name?.trim().toLowerCase() ?? '';
  const s = slug?.trim() ?? '';
  // A one-word slug ("finance" → "Finance") is how a short plain name is spelled.
  return n !== '' && /[-_]/.test(s) && n === s.replace(/[-_]+/g, ' ').toLowerCase();
}

/**
 * The title a mission check's fire used to write: `<automation slug>: <mission charter>`.
 * @param title - A stored run title.
 */
export function isMachineTitle(title: string | null | undefined): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+: /.test(title?.trim() ?? '');
}

/**
 * A label as a list shows it: one line, cut to {@link RUN_LABEL_MAX}, or
 * null when it is empty, a slug or the machine form.
 * @param text - The candidate.
 */
function usable(text: string | null | undefined): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || isSlugName(t) || isMachineTitle(t)) {
    return null;
  }
  return t.length > RUN_LABEL_MAX ? `${t.slice(0, RUN_LABEL_MAX - 1).trimEnd()}…` : t;
}

/**
 * The per-run label a fire was handed (`input.runLabel`), cleaned, or null.
 * @param input - A fire's input or an event's payload.
 */
export function givenRunLabel(input: unknown): string | null {
  const v = input && typeof input === 'object' ? (input as Record<string, unknown>)[RUN_LABEL_KEY] : undefined;
  return typeof v === 'string' ? usable(v) : null;
}

export type RunLabelFacts = {
  /** The label the code that knows the record gave this run (`input.runLabel`). */
  given?: string | null;
  /** The run's stored title (a mission run's `title`), which may be a label or the old machine form. */
  stored?: string | null;
  /** The definition's words while it runs ("Drawing the mockup"). */
  doing?: string | null;
  /** The definition's name. */
  name?: string | null;
  /** What to say when nothing above names the run ("Automation run"). */
  fallback: string;
};

/**
 * The run as a list of running work names it: the concrete work when a label
 * was given, else the definition's plain words. Never a slug.
 * @param f - What is known about the run.
 */
export function runLabel(f: RunLabelFacts): string {
  return usable(f.given) ?? usable(f.stored) ?? usable(f.doing) ?? usable(f.name) ?? f.fallback;
}

/**
 * Whether a mission run's stored title is a label of its own — set from the
 * record it worked on — rather than the starting automation's own words or
 * the old machine form. Lists that title a run by its automation's past-tense
 * words (`runTitle`) keep the run's own label when it has one.
 * @param stored - The run's stored title.
 * @param automation - The automation that started it.
 * @param automation.name - Its name.
 * @param automation.doing - Its present-tense words.
 */
export function hasOwnLabel(stored: string | null | undefined, automation: { name?: string | null; doing?: string | null }): boolean {
  const t = usable(stored);
  return t !== null && t !== automation.name?.trim() && t !== automation.doing?.trim();
}
