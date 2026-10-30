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

    expect(links).toEqual([{ label: 'feature #201', href: '/w/acme/dashboard/p/feature/201', ref: { type: 'object', id: '201' } }]);
  });

  it('a dispatch that started a build links the run first, then the request, task and plan', () => {
    const links = resultLinks({
      actionId: 'factory.dispatch_task',
      input: {},
      result: { workerRunId: 355, taskId: 206, createdTaskId: 206, planId: 215, requestId: 201, previousTask: { workerRunId: 300 } },
    }, link);

    expect(links.map(l => l.label)).toEqual(['RUN-355', 'feature #201', 'task #206', 'plan #215']);
    expect(links[0]).toMatchObject({ href: '/dashboard/p/runs/355', ref: { type: 'worker_run', id: '355' } });
    expect(links[2]!.ref).toEqual({ type: 'object', id: '206' });
    expect(links[2]!.href).toBe('/w/acme/dashboard/objects/206');
  });

  it('a filed record, an ask, an artifact and a PR each get one link', () => {
    expect(resultLinks({ actionId: 'objects.propose_candidate', input: { objectType: 'request' }, result: { objectId: 131 } }, link))
      .toEqual([{ label: 'feature #131', href: '/w/acme/dashboard/p/feature/131', ref: { type: 'object', id: '131' } }]);
    expect(resultLinks({ actionId: 'ask.file', input: {}, result: { askId: 88 } }, link)).toEqual([{ label: 'View question', href: '/dashboard/inbox/88', ref: { type: 'ask', id: '88' } }]);
    expect(resultLinks({ actionId: 'x.render', input: {}, result: { artifactId: 7 } }, link)).toEqual([{ label: 'ART-7', href: '/dashboard/artifacts/7', ref: { type: 'artifact', id: '7' } }]);
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

  it('links the message a mail action wrote, by the label it names, else the caller\'s', () => {
    const draft = { mode: 'draft', draftId: 'r-77', messageId: 'm-77', link: 'https://mail.google.com/mail/u/ann%40noco.example/#drafts?compose=m-77' };

    expect(resultLinks({ actionId: 'gmail.send', input: {}, result: { ...draft, linkLabel: 'Open in Gmail' } }, link)).toEqual([
      { label: 'Open in Gmail', href: draft.link, external: true },
    ]);
    // A run made before results named their link takes the card's label.
    expect(resultLinks({ actionId: 'gmail.send', input: {}, result: draft }, link, undefined, { openLabel: 'Open in Gmail' })).toEqual([
      { label: 'Open in Gmail', href: draft.link, external: true },
    ]);
    expect(resultLinks({ actionId: 'gmail.send', input: {}, result: draft }, link)).toEqual([
      { label: 'Open', href: draft.link, external: true },
    ]);
  });

  it('a record in another system links its own page by name, never as a workspace record (a HubSpot deal, 2026-10-30)', () => {
    const links = resultLinks({
      actionId: 'hubspot.update',
      input: { objectType: 'deals', objectId: '67204827168' },
      result: { objectType: 'deals', objectId: '67204827168', ref: 'deals:67204827168', name: 'Northwind renewal', url: 'https://app.hubspot.com/contacts/2040/record/0-3/67204827168' },
    }, link);

    expect(links).toEqual([{ label: 'Northwind renewal', href: 'https://app.hubspot.com/contacts/2040/record/0-3/67204827168', external: true }]);
    // An id past a workspace record's range is never one, even without a ref.
    expect(resultLinks({ actionId: 'x.update', input: {}, result: { objectType: 'deals', objectId: '67204827168' } }, link)).toEqual([]);
  });
});
