import { describe, expect, it } from 'vitest';
import { stopOptions, workerRebuiltSince } from './recovery';

// Every name, sha and time is invented.
const STOP = new Date('2026-09-28T19:09:54Z');

describe('was the worker rebuilt after the stop?', () => {
  it('a worker environment deployed after the stop is a rebuild, named by its slug and sha', () => {
    expect(workerRebuiltSince({ stoppedAt: STOP, failedVersion: null, environments: [{ slug: 'northwind-worker-production', lastDeployedAt: '2026-09-28T21:06:01Z', lastDeployedSha: '3c9e1a7b55d0e4f1' }], reported: [] }))
      .toEqual({ version: 'northwind-worker-production 3c9e1a7b', at: '2026-09-28T21:06:01.000Z', source: 'environment' });
  });

  it('a run that reported a different worker version after the stop is a rebuild; the same version is not', () => {
    expect(workerRebuiltSince({ stoppedAt: STOP, failedVersion: 'img-a', environments: [], reported: [{ version: 'img-b', at: new Date('2026-09-28T20:00:00Z') }] }))
      .toMatchObject({ version: 'img-b', source: 'run' });
    expect(workerRebuiltSince({ stoppedAt: STOP, failedVersion: 'img-a', environments: [], reported: [{ version: 'img-a', at: new Date('2026-09-28T20:00:00Z') }] })).toBeNull();
  });

  it('nothing after the stop is no rebuild; the newest sighting wins', () => {
    expect(workerRebuiltSince({ stoppedAt: STOP, failedVersion: null, environments: [{ slug: 'w', lastDeployedAt: '2026-09-28T18:00:00Z', lastDeployedSha: null }], reported: [{ version: 'img-old', at: new Date('2026-09-28T18:30:00Z') }] })).toBeNull();
    expect(workerRebuiltSince({ stoppedAt: STOP, failedVersion: null, environments: [{ slug: 'w', lastDeployedAt: '2026-09-28T21:00:00Z', lastDeployedSha: null }], reported: [{ version: 'img-new', at: new Date('2026-09-28T22:00:00Z') }] })?.version).toBe('img-new');
  });
});

describe('what the stop\'s Approve does, in its own words', () => {
  it('an infrastructure stop builds again on the current worker image, and says it resolves itself on a rebuild', () => {
    const [approve, reject] = stopOptions(124, { class: 'transient', sentence: 'services failed: prisma:sync failed' });

    expect(approve).toEqual({ id: 'approve', label: 'Build again on the current worker image', description: 'Starts a new build of request #124 on whichever worker image is deployed when you approve. It stopped on the infrastructure (services failed: prisma:sync failed), so approve once the worker is fixed; when the worker is rebuilt first, this ask resolves itself and the build starts.' });
    expect(reject).toMatchObject({ id: 'reject', label: 'Leave it stopped' });
  });

  it('any other stop builds again with the note', () => {
    expect(stopOptions(7, { class: 'checks_failed', sentence: 'the required checks failed (test)' })[0]).toMatchObject({ label: 'Build again', description: expect.stringContaining('a note you write here goes to the engineer') });
    expect(stopOptions(7, null)[0]!.label).toBe('Build again');
  });
});
