/**
 * What this build actually is.
 *
 * Answering "is my fix deployed?" used to mean SSHing to the box and reading a
 * submodule pin out of a deploy repo. On 2026-09-17 that was done by hand
 * repeatedly and got the wrong answer twice, which sent two fixes chasing a bug
 * that was already fixed but not shipped. `scripts/write-version.mjs` stamps
 * this at build time; the account menu shows it and `/version.txt` serves it.
 *
 * The import is optional on purpose: a dev server started without a build has
 * no generated file, and that must not be a crash. It reports `dev` instead,
 * which is the truth.
 */

import raw from '@/generated/version.json';

export type BuildInfo = {
  /** The release: the nearest tag without its `v`, `+N` when N commits past it; the package version only when no tag was readable. */
  version: string;
  /** The release tag itself (`v2.109.1`), when known. */
  releaseTag?: string | null;
  commit: string;
  shortCommit: string;
  subject: string;
  committedAt: string;
  branch: string;
  builtAt: string;
  /** The deploy repo's own commit, when a parent project passed it in. */
  pin: string | null;
  /** The agent-runtime image tag, which can lag the app. See CLAUDE.md. */
  agentRuntimeImage: string | null;
};

const UNBUILT: BuildInfo = {
  version: 'dev',
  commit: 'unknown',
  shortCommit: 'dev',
  subject: 'running from source, not a build',
  committedAt: 'unknown',
  branch: 'unknown',
  builtAt: 'unknown',
  pin: null,
  agentRuntimeImage: null,
};

/**
 * The build stamp. A `dev` placeholder is committed so this import always
 * resolves — the account menu that shows it is a client component — and the
 * build overwrites the file with the real thing.
 */
export function buildInfo(): BuildInfo {
  return { ...UNBUILT, ...(raw as Partial<BuildInfo>) };
}

/**
 * The one-line form for the account menu: `v2.109.1 · 56ad0e91`.
 * @param info - A build stamp.
 */
export function versionLabel(info: BuildInfo): string {
  return info.version === 'dev' ? 'dev build' : `v${info.version} · ${info.shortCommit}`;
}
