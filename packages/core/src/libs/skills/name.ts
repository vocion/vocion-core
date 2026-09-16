/**
 * The Agent Skills name spec, and the one place Vocion reconciles it with its
 * own SKILL.md frontmatter.
 *
 * Vocion's SKILL.md carries TWO identity fields: `slug` (what everything
 * references — the folder name, the agent's `skills:` list, the catalog row)
 * and `name` (a human label for the catalog UI, e.g. "Pipeline Health"). The
 * Agent Skills specification deepagents implements carries ONE: `name`, which
 * must be a lowercase-hyphen slug matching the containing directory.
 *
 * That mismatch had the runtime log
 *
 *   Skill 'Pipeline Health' … does not follow Agent Skills specification
 *
 * on EVERY turn, for every skill any tenant had ever given a readable name —
 * which is all of them, including the base pack this repo ships. Two ways out
 * were on the table:
 *
 *   - make `workspace:check` reject a human-readable `name`. Rejected: it
 *     deletes a field the catalog UI needs and makes every workspace in
 *     existence, this repo's own base pack included, fail validation to fix a
 *     warning.
 *   - fix the seam. Taken: the identity deepagents validates is the SLUG, so
 *     `workspace:check` validates THAT against the spec (loud, at apply time),
 *     and the mount hands deepagents frontmatter whose `name` IS the slug,
 *     with the human label preserved as `title`.
 *
 * So the loud failure lands on the field that is actually an identity, and the
 * runtime warning disappears because the file it reads is now spec-compliant.
 */

/** Longest name the specification allows. */
export const MAX_SKILL_NAME_LENGTH = 64;

/**
 * Why a name is not spec-compliant, or null when it is.
 *
 * The rules, as deepagents enforces them: 1–64 characters, unicode lowercase
 * letters or decimal digits plus single hyphens, never leading, trailing or
 * doubled.
 * @param name - The candidate skill name (for Vocion, the folder slug).
 */
export function agentSkillsNameError(name: string): string | null {
  if (!name) {
    return 'it is empty';
  }
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    return `it is ${name.length} characters (the limit is ${MAX_SKILL_NAME_LENGTH})`;
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return 'it starts or ends with a hyphen';
  }
  if (name.includes('--')) {
    return 'it contains a doubled hyphen';
  }
  for (const c of name) {
    if (c === '-') {
      continue;
    }
    if (/\p{Ll}/u.test(c) || /\p{Nd}/u.test(c)) {
      continue;
    }
    return `"${c}" is not a lowercase letter, a digit or a hyphen`;
  }
  return null;
}

/**
 * Does this name satisfy the Agent Skills specification?
 * @param name
 */
export function isAgentSkillsName(name: string): boolean {
  return agentSkillsNameError(name) === null;
}

/**
 * Turn anything into the nearest spec-compliant name. Used only as the
 * fallback for a slug that somehow reached the mount unvalidated — the real
 * answer is the apply-time check, because a silently renamed skill is a skill
 * the agent's `skills:` list can no longer find.
 * @param raw - Whatever the file said.
 */
export function toAgentSkillsName(raw: string): string {
  const slug = (raw ?? '')
    .toLowerCase()
    .replaceAll(/[^\p{Ll}\p{Nd}]+/gu, '-')
    .replaceAll(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SKILL_NAME_LENGTH)
    .replace(/-+$/, '');
  return slug || 'skill';
}

const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---\s*(?:\n|$))/;
/** A top-level `name:` line inside the frontmatter block. */
const NAME_LINE_RE = /^name:[ \t]*(\S.*)?$/m;

/**
 * Rewrite one mounted SKILL.md so the file deepagents parses is
 * spec-compliant: `name` becomes the folder slug, and the human label — the
 * thing the catalog UI shows and the thing that triggered the warning — is
 * preserved on a `title` line right beside it.
 *
 * Deliberately a text rewrite rather than a YAML round-trip: the body below
 * the frontmatter is the skill, and re-emitting somebody's YAML would reflow
 * multi-line descriptions and drop comments for no benefit. Anything it does
 * not recognise (no frontmatter at all, no `name` line) is returned untouched
 * with the `name` inserted, so a malformed file degrades to what it did
 * before rather than to nothing.
 * @param body - The SKILL.md exactly as it is on disk.
 * @param slug - The folder slug this file mounts under.
 */
export function withSpecCompliantName(body: string, slug: string): string {
  const name = isAgentSkillsName(slug) ? slug : toAgentSkillsName(slug);
  const fm = FRONTMATTER_RE.exec(body ?? '');
  if (!fm) {
    return body;
  }
  const [, open, inner, close] = fm as unknown as [string, string, string, string];
  const rest = body.slice(fm[0].length);
  const existing = NAME_LINE_RE.exec(inner);
  const human = existing?.[1]?.trim() ?? '';
  if (existing && human === name) {
    return body;
  }
  const replacement = human && human !== name
    ? `name: ${name}\ntitle: ${human}`
    : `name: ${name}`;
  const nextInner = existing
    ? inner.replace(NAME_LINE_RE, replacement)
    : `${replacement}\n${inner}`;
  return `${open}${nextInner}${close}${rest}`;
}
