import { describe, expect, it } from 'vitest';
import { readPageContext, recordFromPath, scopeRefToRecord } from './pageContext';

describe('the page always names its record', () => {
  it('reads the record from the path when the page did not register one (Chris, 2026-09-28: feature #40)', () => {
    expect(readPageContext({ path: '/w/squatch-factory/dashboard/p/feature/40', title: 'Rename Send to Stamp' })?.record).toEqual({ type: 'object', id: '40', label: 'Rename Send to Stamp', href: '/dashboard/p/feature/40' });
    expect(recordFromPath('/en/dashboard/objects/131')).toMatchObject({ type: 'object', id: '131' });
    expect(recordFromPath('/w/squatch-factory/dashboard/p/runs/397?view=all')).toMatchObject({ type: 'worker_run', id: '397' });
    expect(recordFromPath('/w/squatch-factory/dashboard/p/runs/agent-5862')).toMatchObject({ type: 'mission_run', id: '5862' });
    expect(recordFromPath('/w/squatch-factory/dashboard/p/work')).toBeNull();
    expect(recordFromPath('/dashboard/p/wiki/how-stamp-ships')).toBeNull();
  });

  it('reads a release page as its release, so "Ask about this release" carries it', () => {
    expect(readPageContext({ path: '/w/northwind/dashboard/p/releases/197', title: 'Uploads that survive a bad connection' })?.record).toEqual({ type: 'object', id: '197', label: 'Uploads that survive a bad connection', href: '/dashboard/p/releases/197' });
  });

  it('never overrides a record the page registered itself', () => {
    expect(readPageContext({ path: '/dashboard/p/feature/40', title: 't', record: { type: 'deal', id: '9' } })?.record).toMatchObject({ type: 'deal', id: '9' });
  });
});

describe('a project page and a conversation scoped to a project name the project', () => {
  it('reads /dashboard/projects/<id> as that Project, so a conversation started there is scoped to it', () => {
    expect(recordFromPath('/w/agency/dashboard/projects/12', 'Northwind Home Services')).toEqual({ type: 'object', id: '12', label: 'Northwind Home Services', href: '/dashboard/projects/12', objectType: 'data_room' });
    expect(recordFromPath('/dashboard/projects')).toBeNull();
  });

  it('reads a project:<id> scope as that Project\'s record, never as an object named "project:12"', () => {
    expect(scopeRefToRecord('project:12')).toEqual({ type: 'object', id: '12', objectType: 'data_room', href: '/dashboard/projects/12' });
    expect(scopeRefToRecord('contacts:9412')).toEqual({ type: 'object', id: 'contacts:9412' });
  });
});

it.each(['routines', 'automations'])('recognizes %s links while emitting canonical automation links and stable record identities', (route) => {
  expect(recordFromPath(`/w/northwind/dashboard/${route}/7`)).toEqual({ type: 'routine', id: '7', label: 'Automation #7', href: '/dashboard/automations/7' });
  expect(recordFromPath(`/w/northwind/dashboard/${route}/batches/12`)).toEqual({ type: 'routine_batch', id: '12', label: 'Automation run 12', href: '/dashboard/automations/batches/12' });
});
