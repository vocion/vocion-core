import type { Action, ActionContext } from './types';
import { z } from 'zod';
import { connectorLabel, connectPrecheck, createSourceOnLogin, undoCreatedSource } from '@/services/connect/createSourceOnLogin';

export const sourceConnectInput = z.object({
  connector: z.string().min(1),
  /** The connector's own config, checked against its `configSchema`: `{repos}` for GitHub, `{baseUrl, projectKeys}` for Jira. */
  config: z.record(z.string(), z.unknown()),
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
 * Save a source from what the person picked (#1028), on the login they
 * already made. The work is `createSourceOnLogin`, shared with the Connectors
 * page form; this is the chat card around it.
 */
export const sourceConnectAction: Action<typeof sourceConnectInput> = {
  id: 'source.connect',
  name: 'Connect a source',
  description: 'Save a source (GitHub repositories, a Jira site and its projects) from what the person picked, on the login they already made. Reversible until it has synced.',
  inputSchema: sourceConnectInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `source.connect:${input.connector}:${stableJson(input.config)}`,
  async precheck(ctx: ActionContext, input: SourceConnectInput) {
    return (await connectPrecheck(ctx.orgId, input.connector, input.config)) ?? undefined;
  },
  async reviewCard(_ctx, input) {
    const label = connectorLabel(input.connector);
    return {
      title: `Connect ${label}`,
      system: label,
      summary: `Save ${label} as a source with what you picked.`,
      fields: Object.entries(input.config).map(([key, value]) => ({ label: FIELD_LABELS[key] ?? key, value: displayValue(value) })),
      nextAction: 'Approving saves the source. Nothing is read from it until its first sync. Undo removes it while it has not synced.',
      verbs: { approve: 'Connect', reject: 'Not now' },
    };
  },
  async execute(ctx, input) {
    const outcome = await createSourceOnLogin({ orgId: ctx.orgId, actorUserId: ctx.reviewedBy ?? ctx.invokedBy, connector: input.connector, config: input.config });
    if (!outcome.ok) {
      throw new Error(outcome.reason);
    }
    const { ok: _ok, ...saved } = outcome;
    return saved;
  },
  async undo(ctx, _input, result) {
    const refusal = await undoCreatedSource(ctx.orgId, { sourceId: Number(result.sourceId), created: result.created === true, before: result.before as Record<string, unknown> | undefined });
    if (refusal) {
      throw new Error(refusal);
    }
    return { undone: true };
  },
};
