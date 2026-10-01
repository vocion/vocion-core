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

    expect(ws.sha).toContain('+production-watch@0.2.0');
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

describe('the Incidents page', () => {
  it('is one page in its own section: open incidents first, then the latest resolved, live, and says what is watched when empty', async () => {
    const { readWorkspacePages } = await import('./pages');
    const { pages, issues } = readWorkspacePages({ enabledPlugins: ['production-watch'], mounted: false });
    const page = pages.find(p => p.slug === 'incidents');

    expect(issues).toEqual([]);
    expect(pages.filter(p => p.origin === 'plugin:production-watch').map(p => p.slug)).toEqual(['incidents']);
    expect(page).toMatchObject({
      title: 'Incidents',
      nav: { section: 'Production Watch' },
      source: { kind: 'objects', objectType: 'incident' },
      groupBy: 'meta.status',
      groupOrder: [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Recently resolved', limit: 20 }],
      live: { follow: ['list:incident'] },
      empty: { text: 'No incidents.', watch: { automation: 'error-watch', items: 'projects', itemLabel: 'project' } },
    });
    expect(page!.fields!.map(f => f.key)).toEqual(['title', 'issue', 'product', 'events', 'lastSeen', 'cause', 'status', 'action']);
    expect(page!.fields!.find(f => f.key === 'issue')).toMatchObject({ from: 'meta.url', format: 'link', labelFrom: 'meta.shortId' });
  });

  it('reads INC-<id>', () => {
    const ws = loadWorkspace(workspace('production-watch'));

    expect(ws.objectTypes.find(t => t.slug === 'incident')?.code).toBe('INC');
  });
});
