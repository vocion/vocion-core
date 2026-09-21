/**
 * The ladder's key and the action behind it. `policyKeyForRun` is what the
 * gate and the ledgers key on; `actionForPolicyKey` is how every reader turns
 * that key back into "what kind of action is this" — so a derived key is
 * judged as its action, never as an unknown kind.
 */
import { describe, expect, it } from 'vitest';
import { actionForPolicyKey, policyKeyForRun } from './policyKey';

describe('policyKeyForRun', () => {
  it('is the action id for a kind that derives none, and the derived key for one that does', () => {
    expect(policyKeyForRun('hubspot.update', { objectType: 'deals' })).toBe('hubspot.update');
    expect(policyKeyForRun('objects.update_meta', { objectType: 'Request', id: 1, set: {} })).toBe('objects.update_meta.request');
    expect(policyKeyForRun('git.merge', { riskClass: 'docs' })).toBe('git.merge.docs');
  });

  it('falls back to the action id when the input cannot yield a key', () => {
    expect(policyKeyForRun('objects.update_meta', null)).toBe('objects.update_meta');
    expect(policyKeyForRun('not.registered', { a: 1 })).toBe('not.registered');
  });
});

describe('actionForPolicyKey', () => {
  it('returns the action for its own id', () => {
    expect(actionForPolicyKey('hubspot.update')?.id).toBe('hubspot.update');
  });

  it('returns the action behind a derived key, by the longest registered prefix', () => {
    expect(actionForPolicyKey('objects.update_meta.request')?.id).toBe('objects.update_meta');
    expect(actionForPolicyKey('git.merge.schema')?.id).toBe('git.merge');
  });

  it('returns nothing for a key that prefixes no registered action, or that only shares a name', () => {
    expect(actionForPolicyKey('nothing.registered.here')).toBeUndefined();
    // `objects.update_metadata` is not `objects.update_meta.<x>`: the dot is the boundary.
    expect(actionForPolicyKey('objects.update_metadata')).toBeUndefined();
  });
});
