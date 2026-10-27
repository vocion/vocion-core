/**
 * A page's meta title, meta description and slug — checked in code before
 * they are stored on the page, where publishing reads them. A draft's body
 * carries none of them.
 *
 *   metaTitle        at most 60 characters; 55 and over is said, since
 *                    search results cut long titles by width, not count
 *   metaDescription  at most 155 characters
 *   slug             the page's planned slug (`slug`, set when the batch is
 *                    planned) or a new one: kebab-case, path segments allowed
 *                    (`fairview/water-heater-repair`), unique within the
 *                    client's project
 */

export const META_TITLE_MAX = 60;
export const META_TITLE_WARN = 55;
export const META_DESCRIPTION_MAX = 155;

/** Kebab-case words, path segments allowed (`fairview/water-heater-repair`). */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/**
 * A slug as compared for uniqueness: the path, without its slashes at either end.
 * @param slug
 */
const slugKey = (slug: string) => `/${slug.trim().toLowerCase().replace(/^\/+|\/+$/g, '')}`;

export type PageMetaInput = { metaTitle?: string | null; metaDescription?: string | null; slug?: string | null };
export type PageMetaCheck = { value: { metaTitle: string; metaDescription: string; slug: string } | null; problems: string[]; warnings: string[] };

/**
 * Check a page's meta fields. Every problem is named, so the writer fixes all
 * of them in one go.
 * @param input - The fields as given (missing ones fall back to `current`).
 * @param current - What the page already carries.
 * @param takenSlugs - Paths other pages of the project already use (`/a/b`).
 */
export function checkPageMeta(input: PageMetaInput, current: PageMetaInput = {}, takenSlugs: ReadonlySet<string> = new Set()): PageMetaCheck {
  const metaTitle = (input.metaTitle ?? current.metaTitle ?? '').trim();
  const metaDescription = (input.metaDescription ?? current.metaDescription ?? '').trim();
  const slug = (input.slug ?? current.slug ?? '').trim().replace(/^\/+|\/+$/g, '');
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!metaTitle) {
    problems.push('meta_title is missing');
  } else if (metaTitle.length > META_TITLE_MAX) {
    problems.push(`meta_title is ${metaTitle.length} characters; at most ${META_TITLE_MAX}`);
  } else if (metaTitle.length >= META_TITLE_WARN) {
    warnings.push(`meta_title is ${metaTitle.length} characters, close to the ${META_TITLE_MAX} where results cut it`);
  }
  if (!metaDescription) {
    problems.push('meta_description is missing');
  } else if (metaDescription.length > META_DESCRIPTION_MAX) {
    problems.push(`meta_description is ${metaDescription.length} characters; at most ${META_DESCRIPTION_MAX}`);
  }
  if (!slug) {
    problems.push('slug is missing');
  } else if (!KEBAB.test(slug)) {
    problems.push(`slug "${slug}" is not kebab-case (lowercase words joined by hyphens, e.g. trail-running-shoes)`);
  } else if (takenSlugs.has(slugKey(slug))) {
    problems.push(`slug "${slug}" is already used by another page of this project`);
  }
  return { value: problems.length === 0 ? { metaTitle, metaDescription, slug } : null, problems, warnings };
}
