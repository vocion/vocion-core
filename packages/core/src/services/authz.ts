/**
 * Authorization model — the single decision point for "may this principal do
 * this, and does it need approval?". It unifies the two halves of access:
 *
 *   - **discovery** (read/search/retrieve) — governed by scope + ACL. This is
 *     the same boundary RetrievalService enforces in SQL (`scopeCond`);
 *     `scopeAllows` is the in-memory mirror for non-retrieval reads (listing
 *     objects, opening a doc).
 *   - **mutation** (write/send/change) — governed by an action *grant* plus the
 *     autonomy gate (does it need human approval?).
 *
 * One shape: **principal × scope × resource × mode × gate**. The mission
 * autonomy ladder delegates its gate decision here so there's a single rule.
 * Enforcement wiring (MCP tool calls, the skill/action runtime) and a unified
 * review service build on top of this — see firsthq/docs/platform-plan.md §4.
 */

import type { AutonomyLevel } from '@/services/missions/autonomy';

export type PrincipalKind = 'user' | 'agent';
export type WorkspaceRole = 'owner' | 'pm' | 'specialist' | 'client_reviewer';
export type Mode = 'discover' | 'mutate';
export type Gate = 'none' | 'approve';

/** Sub-org scope. `null` client/team = org-wide / shared. */
export type Scope = { orgId: string; clientId?: string | null; teamId?: string | null };

export type Principal = {
  kind: PrincipalKind;
  id: string;
  /** Workspace role (users). Maps to a default grant bundle. */
  role?: WorkspaceRole;
  scope: Scope;
  /** Explicit action grants (agents/teammates). `'*'` = all actions. */
  grants?: string[];
  /** Autonomy level 1–5 (agents). Drives the mutation gate. */
  autonomy?: AutonomyLevel;
};

export type Resource
  = | { kind: 'document' | 'object' | 'context'; scope: Scope }
    | { kind: 'action'; action: string; external?: boolean; approvalRequired?: boolean; scope?: Scope };

export type Decision = { allowed: boolean; gate: Gate; reason: string };

/**
 * Role → default action grants. Owner/PM are unrestricted; specialists draft;
 * client-reviewers approve/comment only. Composed with a principal's explicit grants.
 */
const ROLE_GRANTS: Record<WorkspaceRole, string[]> = {
  owner: ['*'],
  pm: ['*'],
  specialist: ['draft', 'comment'],
  client_reviewer: ['approve', 'comment'],
};

/**
 * Owners/PMs may search across all clients; everyone else is scope-bound.
 * @param principal
 */
function spansAllClients(principal: Principal): boolean {
  return principal.role === 'owner' || principal.role === 'pm';
}

/**
 * Does a mutation need approval, given the autonomy level + the action's nature?
 * The single source of truth for the autonomy gate (mission tasks delegate here).
 * - External side-effects: gated at levels 1–2, allowed at 3+ (within rules).
 * - Internal work (no side-effect): never gated.
 * - An explicit `approvalRequired` always gates.
 * @param level
 * @param opts
 * @param opts.external
 * @param opts.approvalRequired
 */
export function requiresApprovalForMutation(
  level: AutonomyLevel,
  opts: { external: boolean; approvalRequired?: boolean },
): boolean {
  if (opts.approvalRequired) {
    return true;
  }
  if (!opts.external) {
    return false;
  }
  return level <= 2;
}

/**
 * Scope containment for discovery: may a principal in `principalScope` see a
 * resource in `resourceScope`? Shared (null client) is always visible; a
 * client-specific resource only to that client; team narrows further.
 * @param principalScope
 * @param resourceScope
 * @param allClients
 */
export function scopeAllows(principalScope: Scope, resourceScope: Scope, allClients = false): boolean {
  if (resourceScope.orgId !== principalScope.orgId) {
    return false;
  }
  if (allClients) {
    return true;
  }
  if (resourceScope.clientId && resourceScope.clientId !== principalScope.clientId) {
    return false;
  }
  if (resourceScope.teamId && principalScope.teamId && resourceScope.teamId !== principalScope.teamId) {
    return false;
  }
  return true;
}

function hasGrant(principal: Principal, action: string): boolean {
  const fromRole = principal.role ? (ROLE_GRANTS[principal.role] ?? []) : [];
  const grants = [...fromRole, ...(principal.grants ?? [])];
  return grants.includes('*') || grants.includes(action);
}

/**
 * The decision point. `discover` checks scope/ACL (never gates); `mutate` checks
 * the action grant, scope of the target, then the autonomy gate for agents
 * (humans with the grant act directly).
 * @param principal
 * @param resource
 * @param mode
 */
export function authorize(principal: Principal, resource: Resource, mode: Mode): Decision {
  if (mode === 'discover') {
    if (!('scope' in resource) || !resource.scope) {
      return { allowed: true, gate: 'none', reason: 'unscoped-discovery' };
    }
    const ok = scopeAllows(principal.scope, resource.scope, spansAllClients(principal));
    return ok
      ? { allowed: true, gate: 'none', reason: 'in-scope' }
      : { allowed: false, gate: 'none', reason: 'out-of-scope' };
  }

  // mutate
  if (resource.kind !== 'action') {
    return { allowed: false, gate: 'none', reason: 'mutation-requires-action-resource' };
  }
  if (!hasGrant(principal, resource.action)) {
    return { allowed: false, gate: 'none', reason: 'no-grant' };
  }
  if (resource.scope && !scopeAllows(principal.scope, resource.scope, spansAllClients(principal))) {
    return { allowed: false, gate: 'none', reason: 'out-of-scope' };
  }
  if (principal.kind === 'agent') {
    const needsApproval = requiresApprovalForMutation(principal.autonomy ?? 1, {
      external: !!resource.external,
      approvalRequired: resource.approvalRequired,
    });
    return needsApproval
      ? { allowed: true, gate: 'approve', reason: 'autonomy-gate' }
      : { allowed: true, gate: 'none', reason: 'within-autonomy' };
  }
  return { allowed: true, gate: 'none', reason: 'human-grant' };
}

/** Thrown by `enforce` when a principal is not allowed to perform an action. */
export class AuthzDeniedError extends Error {
  decision: Decision;
  constructor(decision: Decision) {
    super(`authz denied: ${decision.reason}`);
    this.name = 'AuthzDeniedError';
    this.decision = decision;
  }
}

/**
 * Enforce a decision at a mutation/discovery site: throws `AuthzDeniedError`
 * when not allowed; otherwise returns the decision so the caller can act on
 * `gate` (e.g. enqueue a review when `gate === 'approve'`, else proceed).
 * @param principal
 * @param resource
 * @param mode
 */
export function enforce(principal: Principal, resource: Resource, mode: Mode): Decision {
  const decision = authorize(principal, resource, mode);
  if (!decision.allowed) {
    throw new AuthzDeniedError(decision);
  }
  return decision;
}
