/**
 * The short name of the environment this build is serving, or null in
 * production.
 *
 * A preview and production look identical in a tab strip, which is how you
 * end up reading a dev screen and filing a bug about prod — or worse, doing
 * the reverse. When `NEXT_PUBLIC_ENV_LABEL` is set the app says so twice, in
 * the two places a tab is identified: the favicon carries the label on an
 * amber ground, and every page title is prefixed with it.
 *
 * Unset in production, deliberately: the absence of a badge is what makes the
 * presence of one meaningful. Nothing has to be remembered or turned off.
 */
export function envLabel(): string | null {
  const raw = process.env.NEXT_PUBLIC_ENV_LABEL?.trim();
  if (!raw) {
    return null;
  }
  // Four characters is what fits a 32px favicon and still reads in a tab.
  return raw.slice(0, 4).toUpperCase();
}

/** What every page title is prefixed with — `[DEV] `, or nothing. */
export function titlePrefix(): string {
  const label = envLabel();
  return label === null ? '' : `[${label}] `;
}
