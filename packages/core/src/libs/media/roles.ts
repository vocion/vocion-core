/**
 * The one definition of how a narrated recording's role is spelled: the
 * source's role with `-narrated` (`qa-live-video` → `qa-live-video-narrated`).
 * Pure, so the feature page's report and the filing share it.
 */

/** The suffix a narrated recording's role carries. */
export const NARRATED_SUFFIX = '-narrated';

/**
 * The role a recording's narrated version is filed under.
 * @param role - The source recording's role.
 */
export function narratedRole(role: string): string {
  return role.endsWith(NARRATED_SUFFIX) ? role : `${role}${NARRATED_SUFFIX}`;
}
