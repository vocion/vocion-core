import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';
import { loadPlugin, pluginContents } from './plugins';

// PRODUCTION WATCH — one seat, one skill, one record, one watch, one
// notification; loosely coupled to the software factory by one event.

const dirs: string[] = [];

function workspace(plugins: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'production-watch-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: test_org\nname: test\nplugins: [${plugins}]\n`);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('the production-watch plugin', () => {
  it('ships small: one seat, one skill, one record, the watch and its answer', () => {
    const p = pluginContents(loadPlugin('production-watch'));

    expect(p.agents).toEqual(['on-call-engineer']);
    expect(p.skills).toEqual(['debug-a-production-error']);
    expect(p.objectTypes).toEqual(['incident']);
    expect(p.automations).toEqual(['error-watch', 'incident-opened']);
    expect(p.missions).toEqual(['answer-every-incident']);
  });

  it('stands alone: the watch runs the core job on a schedule, the seat holds the Sentry reads, a person hears once per incident', () => {
    const ws = loadWorkspace(workspace('production-watch'));

    expect(ws.sha).toContain('+production-watch@0.3.0');
    expect(ws.automations.find(a => a.slug === 'error-watch')).toMatchObject({ status: 'active', when: { schedule: '*/10 * * * *' }, do: { job: 'error-watch', input: { recordType: 'incident', events: { opened: 'incident.opened', updated: 'incident.updated' }, threshold: 20, windowMinutes: 10 } } });
    expect(ws.agents.find(a => a.slug === 'on-call-engineer')?.harness?.grantTools).toEqual(['sentry_issues', 'sentry_issue']);
    expect(ws.notifications).toEqual([expect.objectContaining({ kind: 'incident', event: 'incident.opened', dedupe: 'incident:{incidentId}', source: 'plugin:production-watch' })]);
    // Without the factory, nothing subscribes a Release engineer.
    expect(ws.automations.some(a => a.slug === 'incident-deploy-caused')).toBe(false);
  });

  it('beside the software factory, a deploy-caused incident wakes the Release engineer through one subscription, and the kinds do not collide', () => {
    const ws = loadWorkspace(workspace('software-factory, production-watch'));

    expect(ws.automations.find(a => a.slug === 'incident-deploy-caused')).toMatchObject({ agent: 'release-engineer', when: { event: 'incident.opened', filter: { cause: 'deploy' } } });
    expect(ws.notifications.map(n => n.kind).sort()).toEqual(['incident', 'needs-person', 'released']);
  });
});

describe('an error answered as it stands now', () => {
  it('an incident the on-call engineer opens is done for you, with Undo', () => {
    const ws = loadWorkspace(workspace('production-watch'));

    expect(pluginContents(loadPlugin('production-watch')).hasTrust).toBe(true);
    expect(ws.trust?.rules.find(r => r.action === 'objects.propose_candidate.incident')).toMatchObject({ enabled: true, rung: 'execute-within-bounds', autoApproveAbove: 0.5 });
  });

  it('the debugging skill asks whether it is still happening before any move', () => {
    const ws = loadWorkspace(workspace('production-watch'));
    const skill = ws.skills.find(s => s.slug === 'debug-a-production-error');
    const body = skill?.body ?? '';

    expect(body.indexOf('## 3. Is it still happening?')).toBeGreaterThan(0);
    expect(body.indexOf('## 3. Is it still happening?')).toBeLessThan(body.indexOf('## 5. Decide and move (only while it is still happening)'));
    expect(body).toContain('File no request, open no incident, raise no alert');
  });
});
