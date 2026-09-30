// What the runner starts and runs for a contract, as pure decisions: which services to wait for and
// how each is prepared, and how each required check runs. The contract carries everything a
// repository needs (from its repo record); nothing here names a product. No I/O, so the tests pin it.

import { BUILTIN_CHECKS } from './contract.mjs';

const DEFAULT_ENV = ['DATABASE_URL', 'TEST_DATABASE_URL'];

/**
 * One service entry, whether the contract wrote a name or an object: { name, url, env, setup }.
 *
 * Where it answers: the target's own database when the target provides one (RUNNER_POSTGRES_URL:
 * the Fargate -db task's sidecar, the on-box runner's database), since one installation fleet
 * builds every repository and a repo record cannot know its address; else the url the repo record
 * names; else the runner's default. The repository's tests read the exported variables.
 * @param {string | { name: string, url?: string, env?: string[], setup?: string[] }} entry
 * @param {{ postgresUrl: string, targetPostgresUrl?: string }} defaults
 */
export function serviceSpec(entry, defaults) {
  const o = typeof entry === 'string' ? { name: entry } : (entry || {});
  return {
    name: o.name,
    url: o.name === 'postgres' ? (defaults.targetPostgresUrl || o.url || defaults.postgresUrl) : (o.url || ''),
    env: Array.isArray(o.env) && o.env.length ? [...o.env] : [...DEFAULT_ENV],
    setup: Array.isArray(o.setup) ? [...o.setup] : [],
  };
}

/**
 * How each required check runs, in order: the command the contract's `checks` gives it (the repo
 * record's, exactly as CI runs it); the em-dash scan; the package.json script of that name; or
 * skipped with the reason when the repository has none.
 * @param {{ required_checks: string[], checks?: Array<{ name: string, command: string }> }} task
 * @param {Record<string, string>} scripts package.json scripts
 * @returns {Array<{ name: string, kind: 'command' | 'em-dashes' | 'script' | 'skipped', command?: string, reason?: string }>}
 */
export function checkPlan(task, scripts = {}) {
  const commands = new Map((task.checks || []).map(c => [c.name, c.command]));
  return (task.required_checks || []).map((name) => {
    if (commands.has(name)) {
      return { name, kind: 'command', command: commands.get(name) };
    }
    if (name === 'no-em-dashes') {
      return { name, kind: 'em-dashes' };
    }
    if (BUILTIN_CHECKS.includes(name)) {
      return scripts[name] ? { name, kind: 'script', command: `npm run ${name} --silent` } : { name, kind: 'skipped', reason: `package.json has no "${name}" script` };
    }
    return { name, kind: 'skipped', reason: `check not supported by this runner (built-ins: ${BUILTIN_CHECKS.join(', ')}; any other needs a command)` };
  });
}
