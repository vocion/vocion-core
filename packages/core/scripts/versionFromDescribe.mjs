/**
 * The release a build is, read off `git describe --tags --long`.
 *
 * `version.txt` said `0.1.0` for every build for as long as it existed
 * (Chris, 2026-09-18: "you say deployed, but I still see 0.1.0 in prod"): it
 * read `package.json`, which nobody bumps, because semantic-release tags the
 * repo (`v2.109.2`) instead of committing a version. The tag is the release,
 * so the tag is what the stamp reports — exactly when the commit IS a
 * release, and `2.109.1+2` when it is two commits past one, so a hotfix
 * deployed ahead of its release never claims to be that release.
 *
 * Plain ESM with no imports: the build script runs it under node before the
 * TypeScript build exists, and the unit test imports the same file.
 */

/**
 * @param describe - `git describe --tags --long` output, e.g. `v2.109.1-2-gf4b693e3`, or a bare tag.
 * @param fallback - What to say when there is no tag to read (the package version).
 * @returns
 */
export function versionFromDescribe(describe, fallback) {
  const raw = (describe ?? '').trim();
  if (!raw) {
    return { version: fallback, tag: null, ahead: 0 };
  }
  // `--long` always appends `-<ahead>-g<sha>`; a bare tag has neither.
  const m = /^(.*?)(?:-(\d+)-g[0-9a-f]+)?$/.exec(raw);
  const tag = m?.[1] || raw;
  const ahead = m?.[2] ? Number.parseInt(m[2], 10) : 0;
  const bare = tag.replace(/^v(?=\d)/, '');
  return { version: ahead > 0 ? `${bare}+${ahead}` : bare, tag, ahead };
}
