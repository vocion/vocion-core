/**
 * Stamp the build with what it actually is.
 *
 * "Is my fix deployed?" was answered by hand all day on 2026-09-17 — SSHing to
 * the box, reading a submodule pin out of a deploy repo, diffing commit lists —
 * and twice the answer was wrong, which sent two fixes chasing a bug that had
 * already been fixed but not shipped. The build knows all of this at the moment
 * it runs, and it cost nothing to write it down.
 *
 * Two outputs, because they answer the question for two different people:
 *
 *   src/generated/version.json  the app imports, to show in the account menu
 *   public/version.txt          `curl https://host/version.txt`, no login
 *
 * Everything is best-effort. A build from a tarball with no git history still
 * succeeds; the fields it cannot know say "unknown" rather than failing the
 * build or, worse, inventing a plausible SHA.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { versionFromDescribe } from './versionFromDescribe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const core = join(here, '..');

/**
 * Run a git command, or return null when there is no usable git context.
 * @param cmd - The git arguments.
 */
function git(cmd) {
  try {
    const out = execSync(`git ${cmd}`, { cwd: core, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString().trim() || null;
  } catch {
    return null;
  }
}

/** The app's own package version. */
function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// CI often builds from a detached HEAD, where `git branch --show-current` is
// empty; the ref the pipeline was given is the honest answer there.
const branch = git('rev-parse --abbrev-ref HEAD');
// A Docker build has no .git in its context (.dockerignore), so the values a
// parent deploy knows are handed in as build-args and win when git cannot say.
const env = name => process.env[name]?.trim() || null;
const commit = git('rev-parse HEAD') ?? env('VOCION_BUILD_SHA') ?? 'unknown';
// The release is the nearest tag (semantic-release tags, it never commits a
// version), so `package.json` is only the answer when no tag can be read.
const release = versionFromDescribe(git('describe --tags --long') ?? env('VOCION_BUILD_DESCRIBE'), packageVersion());
const info = {
  version: release.version,
  /** The release tag this build is, or is past (`v2.109.1`); null when unknown. */
  releaseTag: release.tag,
  commit,
  shortCommit: git('rev-parse --short HEAD') ?? (commit === 'unknown' ? 'unknown' : commit.slice(0, 8)),
  subject: git('log -1 --pretty=%s') ?? env('VOCION_BUILD_SUBJECT') ?? 'unknown',
  committedAt: git('log -1 --pretty=%cI') ?? 'unknown',
  branch: (branch === 'HEAD' ? null : branch)
    ?? env('GITHUB_REF_NAME')
    ?? env('VOCION_BUILD_REF')
    ?? 'unknown',
  builtAt: new Date().toISOString(),
  // The parent deploy repo pins this checkout as a submodule and knows its own
  // SHA; it passes it in so one page can show both halves of "what is running".
  pin: env('VOCION_DEPLOY_PIN'),
  agentRuntimeImage: env('VOCION_AGENT_RUNTIME_IMAGE'),
};

mkdirSync(join(core, 'src/generated'), { recursive: true });
writeFileSync(join(core, 'src/generated/version.json'), `${JSON.stringify(info, null, 2)}\n`);

const lines = [
  `version      ${info.version}`,
  `release      ${info.releaseTag ?? 'unknown'}`,
  `commit       ${info.commit}`,
  `subject      ${info.subject}`,
  `committed    ${info.committedAt}`,
  `branch       ${info.branch}`,
  `built        ${info.builtAt}`,
];
if (info.pin) {
  lines.push(`deploy-pin   ${info.pin}`);
}
if (info.agentRuntimeImage) {
  // Deploying the app without redeploying the agent-runtime container is half a
  // deploy, and nothing used to say so. See CLAUDE.md, "a deploy is two deploys".
  lines.push(`agent-image  ${info.agentRuntimeImage}`);
}
mkdirSync(join(core, 'public'), { recursive: true });
writeFileSync(join(core, 'public/version.txt'), `${lines.join('\n')}\n`);

console.warn(`version: ${info.version} ${info.shortCommit} (${info.branch}) — ${info.subject}`);
