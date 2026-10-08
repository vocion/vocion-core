// THE HANDOFF (Vocion 5.1): a runner's long-lived credential never shares a process, or an
// environment, with the repository's code.
//
// A runner starts holding something that can claim runs: an account's runner token, the
// installation's (single-tenant only), a workspace token, or a start token for the one run a
// target started it for. Repository code runs as the same user in the same container, and can read
// any of its ancestors' environments (/proc/<pid>/environ) for as long as they live. So the claim
// happens in a process of its own (`runner.mjs --claim-to <file>`), which writes what the claim
// handed back (the run, the run's own token, the push credential) to a private file and exits.
// The entrypoint then replaces itself with the runner proper, started with every long-lived
// credential removed from its environment (`exec env -u …`), and that runner reads the file and
// deletes it before it clones anything. What is left in reach of the repository is the run token:
// one run's calls, refused once the run is over (core: services/runners/runTokenAccess.ts).

import fs from 'node:fs';
import path from 'node:path';

/**
 * Every variable that can claim a run, or push to a repository, and so must not be in the
 * environment of the process that runs alongside repository code. The entrypoint unsets exactly
 * these (entrypoint.sh reads this list's twin; handoff.test.mjs holds the two equal).
 */
export const LONG_LIVED_ENV = ['VOCION_RUNNER_TOKEN', 'VOCION_RUN_TOKEN', 'VOCION_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'];

/**
 * Which credential the claim uses, strongest scoping first: a start token claims only its run, so
 * when a target put one in, it is the one used even if a runner token is also there.
 * @param cfg - The runner's config.
 * @param cfg.runToken - A start token (VOCION_RUN_TOKEN).
 * @param cfg.runnerToken - An account's or the installation's runner token (VOCION_RUNNER_TOKEN).
 * @param cfg.vocionToken - A workspace token (VOCION_TOKEN).
 * @returns {{ kind: 'start' | 'runner' | 'workspace', token: string } | null} The credential, or null.
 */
export function claimCredential(cfg) {
  if (cfg.runToken) {
    return { kind: 'start', token: cfg.runToken };
  }
  if (cfg.runnerToken) {
    return { kind: 'runner', token: cfg.runnerToken };
  }
  if (cfg.vocionToken) {
    return { kind: 'workspace', token: cfg.vocionToken };
  }
  return null;
}

/**
 * Write what the claim handed back for the runner proper, readable by this user only and never
 * over an existing file.
 * @param file - Where (the entrypoint's private temp directory).
 * @param handoff - The run, its token, the lease holder's id and the push credential.
 */
export function writeHandoff(file, handoff) {
  fs.writeFileSync(file, JSON.stringify(handoff), { mode: 0o600, flag: 'wx' });
}

/**
 * Read the handoff and delete it, and its directory when that is left empty, before anything else
 * happens. Throws when the file is missing or unreadable: a runner told to pick up a claim that is
 * not there has nothing to build.
 * @param file - The path the entrypoint passed in VOCION_CLAIM_FILE.
 */
export function readHandoff(file) {
  const text = fs.readFileSync(file, 'utf8');
  fs.rmSync(file, { force: true });
  try {
    fs.rmdirSync(path.dirname(file));
  } catch {}
  const handoff = JSON.parse(text);
  if (!handoff || typeof handoff !== 'object' || !handoff.run || typeof handoff.run.id === 'undefined') {
    throw new Error('the claim handoff carries no run');
  }
  return handoff;
}

/**
 * Remove the long-lived credentials from this process's environment, for a runner started without
 * the entrypoint (local, tests). The entrypoint's exec is what keeps them out of /proc; this only
 * keeps them out of anything this process spawns.
 * @param env - The environment to scrub (process.env).
 */
export function scrubLongLived(env) {
  for (const k of LONG_LIVED_ENV) {
    if (k !== 'GITHUB_TOKEN' && k !== 'GH_TOKEN') {
      delete env[k];
    }
  }
}
