/** `defaults.jev` (ADR 0007): which decisions a workspace lets Jev make survives the parse, and nothing else does. */
import { describe, expect, it } from 'vitest';
import { WorkspaceManifestSchema } from './schemas';

const base = { version: 1, orgId: 'proj_jev', name: 'Jev workspace' };

describe('defaults.jev', () => {
  it('keeps the duplicate check opt-in, and refuses a use core does not know', () => {
    expect(WorkspaceManifestSchema.parse({ ...base, defaults: { jev: { duplicateCheck: true } } }).defaults?.jev).toEqual({ duplicateCheck: true });
    expect(WorkspaceManifestSchema.parse(base).defaults?.jev).toBeUndefined();
    expect(WorkspaceManifestSchema.safeParse({ ...base, defaults: { jev: { autoApprove: true } } }).success).toBe(false);
  });
});
