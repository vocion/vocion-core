/**
 * WHICH SENTRY PROJECT AN ENVIRONMENT REPORTS TO, read off its record.
 *
 * The structured field is `observability.sentry: {org, project, environment?}`.
 * Records written before it carry the same fact as free text in
 * `observability.errors` ("Sentry northwind/northwind-api"); that is read too,
 * so no record needs a migration. What is read from the text is an
 * identifier, `<org>/<project>`, never a meaning: a line that does not hold
 * one reads as no project, and the structured field always wins.
 *
 * `environment` is Sentry's environment tag. Left out, it is the record's own
 * `stage` (`production`), which is what an SDK is usually initialised with.
 */

export type SentryRef = { org: string; project: string; environment: string | null; from: 'sentry' | 'errors' };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const SLUG = /^[\w-]+$/;

/**
 * The environment's Sentry project, or null when its record names none.
 * @param meta - The environment record's metadata.
 */
export function sentryRefOf(meta: Record<string, unknown> | null | undefined): SentryRef | null {
  const o = obj(meta?.observability);
  const stage = str(meta?.stage);
  const s = obj(o?.sentry);
  if (s) {
    const org = str(s.org);
    const project = str(s.project);
    if (org && project && SLUG.test(org) && SLUG.test(project)) {
      return { org, project, environment: str(s.environment) ?? stage, from: 'sentry' };
    }
  }
  const text = str(o?.errors);
  if (!text) {
    return null;
  }
  // `<org>/<project>`, on a line that says it is Sentry's.
  const m = /(?:^|\s)([\w-]+)\/([\w-]+)(?:\s|$)/.exec(text);
  if (!m || !/\bsentry\b/i.test(text)) {
    return null;
  }
  return { org: m[1]!, project: m[2]!, environment: stage, from: 'errors' };
}
