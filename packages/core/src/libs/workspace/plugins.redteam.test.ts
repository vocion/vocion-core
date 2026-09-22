import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';

/**
 * The three contract red-team gates, and the two ways they could quietly not
 * work.
 *
 * An automation wired to an event nothing raises looks finished and never
 * fires. There is no `plan.completed` or `qa.completed` in this product, and
 * writing one into a `when` would have shipped three automations that passed
 * review and then did nothing, forever, silently.
 *
 * And an automation with no explicit ceiling inherits the default of six
 * fires per ten minutes. That default exists because `wiki-debrief` spawned
 * sixty runs in minutes on 2026-09-20 — inheriting it silently is how the
 * next automation ends up tuned by an incident instead of by its author.
 */

const dirs: string[] = [];

function factoryWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'redteam-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\nplugins: [software-factory]\n');
  return loadWorkspace(dir);
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

/** Events this product actually raises. Anything else is fiction. */
const REAL_EVENTS = new Set([
  'automation_run.completed',
  'mission_run.completed',
  'pr.checks_completed',
  'pr.merged',
  'pr.opened',
  'pr.synchronized',
  'release.announce',
  'run.failed',
  'request.created',
  'request.triaged',
  'ask.decided',
  'ci.check_failed',
]);

const GATES = ['contract-red-team-proposal', 'contract-red-team-change', 'contract-red-team-evidence'];

/**
 * A `when.event` may name one event or several; both have to be real.
 * @param when
 * @param when.event
 */
function eventsOf(when: { event?: string | string[] }): string[] {
  const e = when.event;
  return e === undefined ? [] : Array.isArray(e) ? e : [e];
}

describe('the contract red-team gates', () => {
  it('ships one gate for each moment the contract can drift', () => {
    // It can drift when it is written, when the build interprets it, and when
    // the evidence is read.
    const slugs = factoryWorkspace().automations.map(a => a.slug);

    for (const slug of GATES) {
      expect(slugs, slug).toContain(slug);
    }
  });

  it('fires only on events this product actually raises', () => {
    for (const a of factoryWorkspace().automations.filter(a => GATES.includes(a.slug))) {
      const events = eventsOf(a.when);

      expect(events.length, `${a.slug} fires on no event`).toBeGreaterThan(0);

      for (const e of events) {
        expect(REAL_EVENTS.has(e), `${a.slug} fires on "${e}", which nothing raises`).toBe(true);
      }
    }
  });

  it('declares its own ceiling rather than inheriting the one an incident set', () => {
    for (const a of factoryWorkspace().automations.filter(a => GATES.includes(a.slug))) {
      expect(a.when.maxFiresPer10m, `${a.slug} has no explicit ceiling`).toBeDefined();
      expect(a.when.maxFiresPer10m).toBeGreaterThan(0);
    }
  });

  it('grades against one definition of proven', () => {
    // Three gates, one mission: otherwise "proven" means something slightly
    // different at each of them, which is how a criterion passes one gate and
    // fails the next for no reason a person can see.
    for (const a of factoryWorkspace().automations.filter(a => GATES.includes(a.slug))) {
      expect(a.do.checkMission).toBe('prove-the-contract');
    }

    expect(factoryWorkspace().missions.map(m => m.slug)).toContain('prove-the-contract');
  });

  it('never fires on an event its own run raises', () => {
    // `fireGuards` rule 1 stops a self-triggering ring, but the cheapest
    // version of that safety is not subscribing to your own output at all.
    for (const a of factoryWorkspace().automations.filter(a => GATES.includes(a.slug))) {
      expect(eventsOf(a.when)).not.toContain('mission_run.completed');
      expect(eventsOf(a.when)).not.toContain('automation_run.completed');
    }
  });
});
