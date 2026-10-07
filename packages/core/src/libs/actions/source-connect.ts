import type { Action, ActionContext } from './types';
import { z } from 'zod';
import { adminCheck, connectorLabel, connectPrecheck, createSourceOnLogin, undoCreatedSource } from '@/services/connect/createSourceOnLogin';

export const sourceConnectInput = z.object({
  connector: z.string().min(1),
  /**
   * What the person picked, checked against the connector's `configSchema`: `{repos}` for GitHub,
   * `{baseUrl, projectKeys}` for Jira. A pick is ADDED to the source's existing lists, never a
   * replacement: send only the new items.
   */
  config: z.record(z.string(), z.unknown()),
  /** Which existing source of this connector the pick is for. Required when the workspace has several. */
  sourceSlug: z.string().min(1).optional(),
});

type SourceConnectInput = z.infer<typeof sourceConnectInput>;

/** What each config key is called on the review card. */
const FIELD_LABELS: Record<string, string> = {
  repos: 'Repositories',
  baseUrl: 'Site',
  projectKeys: 'Projects',
};

/**
 * JSON with its keys in order, so the same pick written two ways is one key.
 * @param value - Any JSON value.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stableJson(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * One config value as a line a person reads.
 * @param value - A config value.
 */
function displayValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(String).join(', ');
  }
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * Save a source from what the person picked (#1080), on the login they
 * already made. The work is `createSourceOnLogin`, shared with the Connectors
 * page form; this is the chat card around it.
 */
export const sourceConnectAction: Action<typeof sourceConnectInput> = {
  id: 'source.connect',
  name: 'Connect a source',
  description: 'Save a source (GitHub repositories, a Jira site and its projects) from what the person picked, on the login they already made. The pick is ADDED to the existing repositories or projects; nothing is removed. Name sourceSlug when the workspace has several sources of the connector. Its first sync starts as soon as it is saved. Undo removes a new source and what it has read, or puts an updated one back.',
  inputSchema: sourceConnectInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `source.connect:${input.connector}:${input.sourceSlug ?? ''}:${stableJson(input.config)}`,
  async precheck(ctx: ActionContext, input: SourceConnectInput) {
    // A person who proposes is checked now, so a member never gets a card that fails at Approve.
    // An agent or token proposer has no account role; the approver is checked at execute.
    const proposer = ctx.invokedBy;
    if (proposer && !proposer.startsWith('agent:') && !proposer.startsWith('token:')) {
      const notAdmin = await adminCheck(ctx.orgId, proposer);
      if (notAdmin) {
        return notAdmin;
      }
    }
    return (await connectPrecheck({ orgId: ctx.orgId, actorUserId: proposer, ...input })) ?? undefined;
  },
  async reviewCard(_ctx, input) {
    const label = connectorLabel(input.connector);
    return {
      title: `Connect ${label}`,
      system: label,
      summary: `Save ${label} as a source with what you picked.`,
      fields: Object.entries(input.config).map(([key, value]) => ({ label: FIELD_LABELS[key] ?? key, value: displayValue(value) })),
      nextAction: 'Approving adds this to the source (nothing already there is removed). Its first sync starts as soon as you approve. Undo removes it, with anything it has read so far.',
      verbs: { approve: 'Connect', reject: 'Not now' },
    };
  },
  async execute(ctx, input) {
    const outcome = await createSourceOnLogin({ orgId: ctx.orgId, actorUserId: ctx.reviewedBy ?? ctx.invokedBy, connector: input.connector, config: input.config, sourceSlug: input.sourceSlug });
    if (!outcome.ok) {
      throw new Error(outcome.reason);
    }
    const { ok: _ok, ...saved } = outcome;
    return saved;
  },
  async undo(ctx, input, result) {
    // At undo time `reviewedBy` is the person pressing Undo: same admin rule as connecting.
    const notAdmin = await adminCheck(ctx.orgId, ctx.reviewedBy ?? ctx.invokedBy);
    if (notAdmin) {
      throw new Error(notAdmin);
    }
    const sourceId = Number(result.sourceId);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      throw new TypeError('This run recorded no source to undo');
    }
    await undoCreatedSource(ctx.orgId, { sourceId, connector: input.connector, created: result.created === true, before: result.before as Record<string, unknown> | undefined });
    return { undone: true };
  },
};
