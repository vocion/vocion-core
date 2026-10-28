import type { BundleTrack } from './bundleTrack';
import { describe, expect, it } from 'vitest';
import { fieldsAfter, keepEdits, mergeFields, valueHash } from './bundleTrack';

const track = (last: BundleTrack['last'] = {}): BundleTrack => ({ last, kept: [], wrote: {} });

describe('keepEdits', () => {
  it('takes the new template where nobody changed the field since the bundle wrote it', () => {
    const t = track({ agent: { lead: { systemPrompt: valueHash('v1') } } });
    const payload = { orgId: 'o', slug: 'lead', systemPrompt: 'v2', active: 'true' };

    expect(keepEdits(t, 'agent', 'lead', { systemPrompt: 'v1' }, payload)).toEqual([]);
    expect(payload.systemPrompt).toBe('v2');
    expect(t.wrote.agent?.lead).toEqual(['systemPrompt']);
  });

  it('keeps a field a person changed, and says so', () => {
    const t = track({ agent: { lead: { systemPrompt: valueHash('v1') } } });
    const payload = { systemPrompt: 'v2' };

    expect(keepEdits(t, 'agent', 'lead', { systemPrompt: 'mine' }, payload)).toEqual(['systemPrompt']);
    expect(payload.systemPrompt).toBe('mine');
    expect(t.kept).toEqual([{ resource: 'agent', slug: 'lead', field: 'systemPrompt' }]);
  });

  it('records nothing kept when the person\'s value is the new template\'s', () => {
    const t = track({ agent: { lead: { systemPrompt: valueHash('v1') } } });

    expect(keepEdits(t, 'agent', 'lead', { systemPrompt: 'v2' }, { systemPrompt: 'v2' })).toEqual([]);
  });

  it('lets the template win where nothing was recorded, and does nothing with no track', () => {
    const payload = { systemPrompt: 'v2' };

    expect(keepEdits(track(), 'agent', 'lead', { systemPrompt: 'mine' }, payload)).toEqual([]);
    expect(keepEdits(undefined, 'agent', 'lead', { systemPrompt: 'mine' }, payload)).toEqual([]);
    expect(payload.systemPrompt).toBe('v2');
  });

  it('never tracks the lifecycle the app switch owns', () => {
    const t = track({ automation: { guard: { status: valueHash('active') } } });
    const payload = { status: 'active' };

    expect(keepEdits(t, 'automation', 'guard', { status: 'disabled' }, payload)).toEqual([]);
    expect(t.wrote.automation?.guard).toEqual([]);
  });
});

describe('the record', () => {
  it('hashes what is stored, and carries a kept field\'s old hash forward', () => {
    const t = track({ agent: { lead: { systemPrompt: valueHash('v1'), model: valueHash('m1') } } });
    keepEdits(t, 'agent', 'lead', { systemPrompt: 'mine', model: 'm1' }, { systemPrompt: 'v2', model: 'm2' });

    expect(fieldsAfter(t, { agent: [{ slug: 'lead', systemPrompt: 'mine', model: 'm2' }] })).toEqual({
      agent: { lead: { systemPrompt: valueHash('v1'), model: valueHash('m2') } },
    });
  });

  it('folds records oldest first, a later one replacing a row whole', () => {
    expect(mergeFields([
      { fields: { agent: { a: { x: '1' }, b: { x: '1' } } } },
      { fields: { agent: { a: { y: '2' } } } },
    ])).toEqual({ agent: { a: { y: '2' }, b: { x: '1' } } });
  });

  it('hashes jsonb the same whatever its key order', () => {
    expect(valueHash({ a: 1, b: [1, 2] })).toBe(valueHash({ b: [1, 2], a: 1 }));
    expect(valueHash(undefined)).toBe(valueHash(null));
  });
});
