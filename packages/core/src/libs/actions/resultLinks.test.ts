import { describe, expect, it } from 'vitest';
import { recordLinker, recordLinksOf } from '@/libs/workspace/recordHref';
import { resultLinks } from './resultLinks';

// A workspace whose requests open on a feature page, like the factory's.
const link = recordLinker({ pages: new Map([['request', '/dashboard/p/feature/{id}']]), workspaceSlug: 'acme' });

describe('what a done run made, as links (Chris, 2026-09-29: "I expected a path to open it")', () => {
  it('a dispatch that re-planned links the request it sent back, not what it replaced', () => {
    // Action run 5201's shape: planning again, nothing built; the superseded
    // plan and previous recovery are nested and are not what it made.
    const links = resultLinks({
      actionId: 'factory.dispatch_task',
      input: { taskId: 203, planId: 215 },
      result: { planning: true, requestId: 201, planId: null, workerRunId: null, supersededPlan: { id: 215 }, previousRecovery: { askId: 221 } },
    }, link);

    expect(links).toEqual([{ label: 'request #201', href: '/w/acme/dashboard/p/feature/201' }]);
  });

  it('a dispatch that started a build links the run first, then the request, task and plan', () => {
    const links = resultLinks({
      actionId: 'factory.dispatch_task',
      input: {},
      result: { workerRunId: 355, taskId: 206, createdTaskId: 206, planId: 215, requestId: 201, previousTask: { workerRunId: 300 } },
    }, link);

    expect(links.map(l => l.label)).toEqual(['engineering run #355', 'request #201', 'engineering task #206', 'architecture plan #215']);
    expect(links[0]!.href).toBe('/dashboard/p/runs/355');
    expect(links[2]!.href).toBe('/w/acme/dashboard/objects/206');
  });

  it('a filed record, an ask, an artifact and a PR each get one link', () => {
    expect(resultLinks({ actionId: 'objects.propose_candidate', input: { objectType: 'request' }, result: { objectId: 131 } }, link))
      .toEqual([{ label: 'request #131', href: '/w/acme/dashboard/p/feature/131' }]);
    expect(resultLinks({ actionId: 'ask.file', input: {}, result: { askId: 88 } }, link)).toEqual([{ label: 'ask #88', href: '/dashboard/inbox/88' }]);
    expect(resultLinks({ actionId: 'x.render', input: {}, result: { artifactId: 7 } }, link)).toEqual([{ label: 'artifact #7', href: '/dashboard/artifacts/7' }]);
    expect(resultLinks({ actionId: 'manual.handoff', input: {}, result: { prUrl: 'https://git.example/pr/4', url: 'https://other.example' } }, link))
      .toEqual([{ label: 'Pull request', href: 'https://git.example/pr/4', external: true }]);
  });

  it('names nothing it cannot back', () => {
    const generic = recordLinker(recordLinksOf([]));

    expect(resultLinks({ actionId: 'gmail.send', input: {}, result: null }, generic)).toEqual([]);
    // An id whose only "type" is the action itself is not a record.
    expect(resultLinks({ actionId: 'ask.file', input: {}, result: { id: 3, objectType: 'ask.file' } }, generic)).toEqual([]);
    expect(resultLinks({ actionId: 'x', input: {}, result: { url: 'javascript:alert(1)', requestId: 0, workerRunId: 'abc' } }, generic)).toEqual([]);
  });
});
