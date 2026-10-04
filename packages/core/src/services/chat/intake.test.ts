import { describe, expect, it } from 'vitest';
import { intakeOf } from './intake';

describe('the workspace intake', () => {
  it('is the type that declares itself the intake, handed to the agent it names', () => {
    expect(intakeOf([
      { slug: 'release', label: 'Release', schema: { 'x-owner': 'release-engineer' } },
      { slug: 'request', label: 'Request', schema: { 'x-intake': true, 'x-owner': 'product-manager' } },
    ])).toEqual({ typeSlug: 'request', label: 'Request', ownerSlug: 'product-manager' });
  });

  it('is nothing when no type declares itself, so no card offers Build it', () => {
    expect(intakeOf([{ slug: 'deal', label: 'Deal', schema: { 'x-owner': 'revenue-lead' } }])).toBeNull();
    expect(intakeOf([{ slug: 'deal', label: 'Deal', schema: { 'x-intake': 'yes' } }])).toBeNull();
  });

  it('has no owner when the type names none: the agent already in the chat files it', () => {
    expect(intakeOf([{ slug: 'idea', label: '', schema: { 'x-intake': true } }])).toEqual({ typeSlug: 'idea', label: 'idea', ownerSlug: null });
  });
});
