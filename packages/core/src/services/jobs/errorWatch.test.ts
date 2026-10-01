import type { ErrorWatchDeps } from './errorWatch';
import type { SentryIssue } from '@/libs/sentry/client';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadWorkspace } from '@/libs/workspace/loader';
import { causeFacts, runErrorWatch, watchInput } from './errorWatch';

/**
 * TODAY'S INCIDENT, ON THE PLUGIN (2026-10-01, fictional names). Release
 * aaaaaaa went out at 14:39; from 14:43 every signed-in call answered 500:
 * NW-API-3, an engine that could not start on the runtime's CPU, 184 events
 * in the hour, beside a one-off NW-API-2. Run through production-watch's own
 * `error-watch` input: the deploy of aaaaaaa caused it → an incident opened
 * with cause deploy → `incident.opened`.
 */
const SHA = 'aaaaaaa1111111111111111111111111111111aa';
const C = { token: 'sntrys_fixture_token_0001', org: 'northwind', host: 'https://us.sentry.io' };
const NOW = new Date('2026-10-01T15:00:00Z');
const ISSUE: SentryIssue = { id: '77', shortId: 'NW-API-3', title: 'EngineInitError: ', culprit: 'GET /v1/orgs', url: 'https://northwind.sentry.io/issues/77/', level: 'error', status: 'unresolved', project: 'northwind-api', events: 184, users: 0, firstSeen: '2026-10-01T14:43:54Z', lastSeen: '2026-10-01T14:59:00Z', firstRelease: SHA, firstReleaseAt: '2026-10-01T14:39:14Z', lastRelease: SHA };

/** The plugin's own automation input, with the workspace's watch list. */
function pluginInput(): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'error-watch-'));
  try {
    writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\nplugins: [production-watch]\n');
    const input = loadWorkspace(dir).automations.find(a => a.slug === 'error-watch')!.do.input as Record<string, unknown>;
    return { ...input, projects: [{ project: 'northwind-api', environment: 'production', product: 'northwind-send' }] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function harness(over: Partial<ErrorWatchDeps> = {}) {
  const upserts: Array<{ type: string; key: string; title: string; meta: Record<string, unknown> }> = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown>; key: string }> = [];
  const cause = vi.fn(async () => ({ cause: 'deploy' as const, why: `The deploy of ${SHA.slice(0, 7)} caused it: NW-API-3 first appeared in that release four minutes after it went out, and the engine it cannot find is the build's.` }));
  const deps: Partial<ErrorWatchDeps> = {
    sentry: async () => ({ ok: true, credentials: C }),
    countErrors: async (_c, q) => {
      const hourWindow = q.end.getTime() - q.start.getTime() > 30 * 60_000;
      return { ok: true, data: hourWindow
        ? [{ issueId: '77', shortId: 'NW-API-3', title: 'EngineInitError:', events: 184, firstAt: null, lastAt: null }, { issueId: '76', shortId: 'NW-API-2', title: 'EngineInitError:', events: 1, firstAt: null, lastAt: null }]
        : [{ issueId: '77', shortId: 'NW-API-3', title: 'EngineInitError:', events: 41, firstAt: null, lastAt: null }] };
    },
    readIssue: async () => ({ ok: true, data: ISSUE }),
    latestEvent: async () => ({ ok: true, data: { eventId: 'e1', at: null, release: SHA, environment: 'production', exceptions: [{ type: 'EngineInitError', value: '\nInvalid `db.user.find()` invocation:\nthe query engine for runtime "linux-arm64" was not found', frames: [{ file: '/app/packages/core/dist/auth/plugin.js', line: 210, column: 4, function: 'Object.?', module: null, inApp: true }] }], breadcrumbs: [], request: { method: 'GET', url: 'https://api.northwind.example/v1/documents', status: 500 }, tags: {} } }),
    releases: async () => ({ ok: true, data: [{ version: SHA, createdAt: '2026-10-01T14:39:14Z' }, { version: 'bbbbbbb2', createdAt: '2026-10-01T14:01:09Z' }] }),
    cause,
    records: async () => [],
    upsert: async (_o, o) => {
      upserts.push(o);
      return { id: 501, created: true };
    },
    emit: async (_o, type, payload, key) => {
      emitted.push({ type, payload, key });
    },
    ...over,
  };
  return { deps, upserts, emitted, cause };
}

describe('production-watch on today\'s incident', () => {
  it('the deploy of aaaaaaa caused it → incident opened with cause deploy → incident.opened', async () => {
    const h = harness();
    const out = await runErrorWatch('org_1', pluginInput(), NOW, h.deps);

    expect(out.acted).toEqual([{ project: 'northwind-api', shortId: 'NW-API-3', did: 'opened: deploy', recordId: 501 }]);
    // One incident, keyed on the issue, carrying the evidence and the cause.
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]).toMatchObject({ type: 'incident', key: 'northwind/77', title: 'NW-API-3: EngineInitError' });
    expect(h.upserts[0]!.meta).toMatchObject({ status: 'open', trigger: 'new', cause: 'deploy', release: SHA, product: 'northwind-send', environment: 'production', request: 'GET https://api.northwind.example/v1/documents → 500', frames: ['/app/packages/core/dist/auth/plugin.js:210 in Object.?'], eventsLastHour: 184 });
    // The event the factory's Release engineer and the notification listen to.
    expect(h.emitted).toEqual([{ type: 'incident.opened', key: 'incident.opened:northwind/77', payload: expect.objectContaining({ incidentId: 501, shortId: 'NW-API-3', cause: 'deploy', release: SHA, environment: 'production', project: 'northwind-api', product: 'northwind-send', events: 184 }) }]);

    // The cause was read from the facts: the release against when it went out, and the stack.
    const facts = (h.cause.mock.calls[0] as unknown as [string, string])[1];

    expect(facts).toContain(`in release ${SHA} (that release was created 2026-10-01T14:39:14Z)`);
    expect(facts).toContain('aaaaaaa11111 created 2026-10-01T14:39:14Z');
    expect(facts).toContain('the query engine for runtime');
  });

  it('updates the same incident on the next pass, raising nothing until it doubles, and resolves it after a quiet hour', async () => {
    const open = { id: 501, title: 'NW-API-3: EngineInitError', meta: { source: 'sentry', org: 'northwind', project: 'northwind-api', environment: 'production', issueId: '77', shortId: 'NW-API-3', status: 'open', cause: 'deploy', lastEmittedEvents: 150 } };
    const again = harness({ records: async () => [open] });
    await runErrorWatch('org_1', pluginInput(), NOW, again.deps);

    expect(again.cause).not.toHaveBeenCalled();
    expect(again.emitted).toEqual([]);
    expect(again.upserts[0]!.key).toBe('northwind/77');

    const quiet = harness({ records: async () => [open], countErrors: async () => ({ ok: true, data: [] }) });
    const out = await runErrorWatch('org_1', pluginInput(), NOW, quiet.deps);

    expect(out.acted).toEqual([{ project: 'northwind-api', shortId: 'NW-API-3', did: 'resolved', recordId: 501 }]);
    expect(quiet.emitted[0]).toMatchObject({ type: 'incident.updated', payload: { status: 'resolved', change: 'resolved', cause: 'deploy' } });
  });

  it('opens nothing for a one-off, and says unknown when the cause cannot be read', async () => {
    const oneOff = harness({ countErrors: async () => ({ ok: true, data: [{ issueId: '76', shortId: 'NW-API-2', title: null, events: 1, firstAt: null, lastAt: null }] }) });

    expect((await runErrorWatch('org_1', pluginInput(), NOW, oneOff.deps)).acted).toEqual([]);

    const unread = harness({ cause: async () => null });
    await runErrorWatch('org_1', pluginInput(), NOW, unread.deps);

    expect(unread.upserts[0]!.meta).toMatchObject({ cause: 'unknown', causeWhy: 'the cause could not be read' });
  });

  it('says why it read nothing: no project, no record type, no Sentry', async () => {
    expect((await runErrorWatch('org_1', { ...pluginInput(), projects: [] }, NOW, harness().deps)).problem).toMatch(/no project to watch/);
    expect(watchInput({ projects: ['northwind-api'] })).toBeNull();
    expect((await runErrorWatch('org_1', pluginInput(), NOW, harness({ sentry: async () => ({ ok: false, message: 'No Sentry token is stored for this workspace.' }) }).deps)).problem).toBe('No Sentry token is stored for this workspace.');
    expect(causeFacts(ISSUE, null, [])).toContain('No exception was read.');
  });
});
