import type { Principal } from '@/services/authz';
import { describe, expect, it } from 'vitest';
import {
  authorize,

  requiresApprovalForMutation,
  scopeAllows,
} from '@/services/authz';

const ORG = 'org_1';

describe('requiresApprovalForMutation (the autonomy gate)', () => {
  it('gates external actions at levels 1–2, allows at 3+', () => {
    expect(requiresApprovalForMutation(1, { external: true })).toBe(true);
    expect(requiresApprovalForMutation(2, { external: true })).toBe(true);
    expect(requiresApprovalForMutation(3, { external: true })).toBe(false);
    expect(requiresApprovalForMutation(5, { external: true })).toBe(false);
  });

  it('never gates internal (non-side-effecting) work', () => {
    expect(requiresApprovalForMutation(1, { external: false })).toBe(false);
    expect(requiresApprovalForMutation(5, { external: false })).toBe(false);
  });

  it('always gates when approvalRequired is set', () => {
    expect(requiresApprovalForMutation(5, { external: false, approvalRequired: true })).toBe(true);
    expect(requiresApprovalForMutation(3, { external: true, approvalRequired: true })).toBe(true);
  });
});

describe('scopeAllows (discovery boundary)', () => {
  it('allows shared (null client) and own client; denies another client', () => {
    const me = { orgId: ORG, clientId: 'a' };

    expect(scopeAllows(me, { orgId: ORG })).toBe(true); // shared
    expect(scopeAllows(me, { orgId: ORG, clientId: 'a' })).toBe(true); // own
    expect(scopeAllows(me, { orgId: ORG, clientId: 'b' })).toBe(false); // other client
  });

  it('isolates across orgs', () => {
    expect(scopeAllows({ orgId: ORG }, { orgId: 'org_2' })).toBe(false);
  });

  it('allClients bypasses the client check (admin)', () => {
    expect(scopeAllows({ orgId: ORG, clientId: 'a' }, { orgId: ORG, clientId: 'b' }, true)).toBe(true);
  });
});

describe('authorize — discovery', () => {
  const agent: Principal = { kind: 'agent', id: 'tm1', scope: { orgId: ORG, clientId: 'a' }, autonomy: 3 };

  it('allows in-scope, denies cross-client', () => {
    expect(authorize(agent, { kind: 'document', scope: { orgId: ORG, clientId: 'a' } }, 'discover').allowed).toBe(true);
    expect(authorize(agent, { kind: 'document', scope: { orgId: ORG } }, 'discover').allowed).toBe(true);
    expect(authorize(agent, { kind: 'document', scope: { orgId: ORG, clientId: 'b' } }, 'discover').allowed).toBe(false);
  });

  it('owner spans all clients', () => {
    const owner: Principal = { kind: 'user', id: 'u1', role: 'owner', scope: { orgId: ORG } };

    expect(authorize(owner, { kind: 'document', scope: { orgId: ORG, clientId: 'b' } }, 'discover').allowed).toBe(true);
  });
});

describe('authorize — mutation', () => {
  it('denies without a grant', () => {
    const agent: Principal = { kind: 'agent', id: 'tm1', scope: { orgId: ORG }, autonomy: 5, grants: ['draft'] };
    const d = authorize(agent, { kind: 'action', action: 'send_email', external: true }, 'mutate');

    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('no-grant');
  });

  it('agent with grant gates external actions by autonomy', () => {
    const lowAuto: Principal = { kind: 'agent', id: 'tm1', scope: { orgId: ORG }, autonomy: 2, grants: ['send_email'] };
    const hiAuto: Principal = { kind: 'agent', id: 'tm2', scope: { orgId: ORG }, autonomy: 3, grants: ['send_email'] };

    expect(authorize(lowAuto, { kind: 'action', action: 'send_email', external: true }, 'mutate').gate).toBe('approve');
    expect(authorize(hiAuto, { kind: 'action', action: 'send_email', external: true }, 'mutate').gate).toBe('none');
  });

  it('humans with the grant act directly (no gate)', () => {
    const owner: Principal = { kind: 'user', id: 'u1', role: 'owner', scope: { orgId: ORG } };
    const d = authorize(owner, { kind: 'action', action: 'send_email', external: true }, 'mutate');

    expect(d).toEqual({ allowed: true, gate: 'none', reason: 'human-grant' });
  });

  it('enforces scope on the action target', () => {
    const agent: Principal = { kind: 'agent', id: 'tm1', scope: { orgId: ORG, clientId: 'a' }, autonomy: 5, grants: ['*'] };
    const d = authorize(agent, { kind: 'action', action: 'send_email', external: true, scope: { orgId: ORG, clientId: 'b' } }, 'mutate');

    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('out-of-scope');
  });
});
