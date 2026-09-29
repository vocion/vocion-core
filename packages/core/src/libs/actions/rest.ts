/**
 * rest.request — one write against a `rest` source, through an endpoint the
 * source declared under `actions[]`.
 *
 * The generic write beside the generic read: a REST source's `tools[]` become
 * live read tools, and this is the only way its `actions[]` are reached. The
 * action itself knows no product. Which source, which endpoint and which
 * arguments all arrive in the input; the method, the path, the body template
 * and the review wording come off the source's declaration
 * (`libs/rest/spec.ts`); the base URL and bearer token come from that
 * source's vault entry, resolved per input through `sourceSlugFor`.
 *
 * `external: true` — it changes a system outside Vocion, so an agent's
 * proposal lands in the review queue at working autonomy. The trust ladder
 * keys on `rest.request.<sourceSlug>.<action>` (`policyKeyFor`), so
 * `trust.yaml` can promote one endpoint while every other still waits for a
 * person, and each endpoint earns its own evidence. Not reversible: core
 * cannot know how to undo an arbitrary endpoint, so every run asks first
 * unless a rule says otherwise, and the card carries an Irreversible badge
 * unless the endpoint declares `reversible: true`.
 *
 * The proposal is checked against tenant state before any row exists
 * (`precheck`): the source must exist and be a REST source, the action must
 * be declared, the input must match the endpoint's schema, and every path
 * parameter must be present. Each refusal is a sentence the model acts on.
 */

import type { Action, ReviewCard } from './types';
import type { RestAction as RestEndpointAction, RestSourceSpec } from '@/libs/rest/spec';
import type { TemplateClock } from '@/libs/rest/template';
import { z } from 'zod';
import { buildUrl, capJson, pickPath, restCall, restCredentialsOf } from '@/libs/rest/client';
import { zodFromInputSchema } from '@/libs/rest/jsonSchema';
import { selectPaths } from '@/libs/rest/select';
import { restSourceForOrg } from '@/libs/rest/sources';
import { endpointDescription } from '@/libs/rest/spec';
import { renderPath, renderQuery, renderString, renderTemplate } from '@/libs/rest/template';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';

const restRequestInput = z.object({
  /** The REST source, by its slug — what `<prefix>_list_actions` reports as `sourceSlug`. */
  sourceSlug: z.string().min(1),
  /** The endpoint, by the name the source declares under `actions[]`. */
  action: z.string().min(1),
  /** The endpoint's arguments, matching its declared input schema. */
  input: z.record(z.string(), z.unknown()).default({}),
  /**
   * What this change does, in plain language — the headline a reviewer
   * reads. The why and the evidence are NOT here: the proposal envelope
   * (`propose_action`'s rationale, evidence, confidence) already carries
   * them, and the card shell renders them from the run.
   */
  summary: z.string().min(1),
});

type RestRequestInput = z.infer<typeof restRequestInput>;

/** The source and the endpoint an input names, or the sentence that refuses it. */
type Resolved = { ok: true; spec: RestSourceSpec; endpoint: RestEndpointAction } | { ok: false; message: string };

/**
 * The declared endpoint behind an input.
 * @param orgId - The workspace.
 * @param input - The action input.
 */
async function resolveEndpoint(orgId: string, input: Pick<RestRequestInput, 'sourceSlug' | 'action'>): Promise<Resolved> {
  const spec = await restSourceForOrg(orgId, input.sourceSlug);
  if (!spec) {
    return { ok: false, message: `No REST source "${input.sourceSlug}" exists in this workspace. sourceSlug must be the slug of a source with kind: rest — the one <prefix>_list_actions reports.` };
  }
  const endpoint = spec.config.actions.find(a => a.name === input.action);
  if (!endpoint) {
    const declared = spec.config.actions.map(a => a.name);
    return { ok: false, message: `The "${spec.slug}" source declares no action "${input.action}". ${declared.length > 0 ? `Declared: ${declared.join(', ')}.` : 'It declares no actions at all, so nothing can be written through it.'}` };
  }
  return { ok: true, spec, endpoint };
}

/** What one call to the endpoint is made of, rendered from the input. */
type RenderedRequest = { path: string; query: Record<string, string>; body: unknown };

/**
 * The clock an action's templates resolve built-in dates against: now, in
 * the workspace's zone (UTC when it has none).
 * @param orgId - The workspace.
 */
async function clockFor(orgId: string): Promise<TemplateClock> {
  return { now: new Date(), timeZone: await workspaceTimeZone(orgId) };
}

/**
 * The endpoint's request rendered from the arguments, or the reason it cannot be.
 * @param endpoint - The declared action.
 * @param args - The endpoint's arguments, already validated.
 * @param clock - What built-in dates resolve against.
 */
function renderRequest(endpoint: RestEndpointAction, args: Record<string, unknown>, clock: TemplateClock): { ok: true; request: RenderedRequest } | { ok: false; message: string } {
  const path = renderPath(endpoint.path, args, clock);
  if (!path.ok) {
    return { ok: false, message: `${endpoint.name} needs ${path.missing.map(n => `"${n}"`).join(', ')} in input to build its path.` };
  }
  let body: unknown;
  if (endpoint.body !== undefined) {
    body = renderTemplate(endpoint.body, args, clock);
    // An object template whose every key dropped still sends `{}`: the
    // endpoint declared a body, and the API decides what an empty one means.
    if (body === undefined && typeof endpoint.body === 'object' && endpoint.body !== null && !Array.isArray(endpoint.body)) {
      body = {};
    }
  }
  return {
    ok: true,
    request: {
      path: path.path,
      query: renderQuery(endpoint.query, args, clock),
      body,
    },
  };
}

/**
 * The arguments checked against the endpoint's declared schema, as the
 * validated object or a sentence naming the faults.
 * @param endpoint - The declared action.
 * @param raw - The arguments as proposed.
 */
function validateArgs(endpoint: RestEndpointAction, raw: Record<string, unknown>): { ok: true; args: Record<string, unknown> } | { ok: false; message: string } {
  const parsed = zodFromInputSchema(endpoint.input).safeParse(raw);
  if (!parsed.success) {
    const faults = parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
    return { ok: false, message: `input for ${endpoint.name} does not match its schema — ${faults}. Declared properties: ${Object.keys(endpoint.input.properties ?? {}).join(', ') || 'none'}.` };
  }
  return { ok: true, args: parsed.data };
}

export const restRequestAction: Action<typeof restRequestInput> = {
  id: 'rest.request',
  name: 'Call a REST endpoint',
  description: 'Write to a REST source through an endpoint it declares under actions[] — sourceSlug, action, input (the endpoint\'s arguments), summary. Read the source\'s <prefix>_list_actions tool first for the names and schemas.',
  inputSchema: restRequestInput,
  grant: 'rest_request',
  external: true,
  // The credential is the named source's, not a fixed one: the same action
  // serves every REST source in the workspace.
  sourceSlugFor: input => input.sourceSlug,
  // One ledger per endpoint. A rule on the bare id binds to nothing, so a
  // workspace grants autonomy endpoint by endpoint.
  policyKeyFor: input => `rest.request.${input.sourceSlug}.${input.action}`,

  async precheck(ctx, input) {
    const resolved = await resolveEndpoint(ctx.orgId, input);
    if (!resolved.ok) {
      return resolved.message;
    }
    const args = validateArgs(resolved.endpoint, input.input);
    if (!args.ok) {
      return args.message;
    }
    const request = renderRequest(resolved.endpoint, args.args, await clockFor(ctx.orgId));
    if (!request.ok) {
      return request.message;
    }
    return undefined;
  },

  async reviewCard(ctx, input): Promise<ReviewCard> {
    const resolved = await resolveEndpoint(ctx.orgId, input);
    const base: ReviewCard = {
      title: `${input.action} on ${input.sourceSlug}`,
      system: input.sourceSlug,
      headline: input.summary,
      fields: [],
      verbs: { approve: 'Send request', reject: 'Reject' },
    };
    if (!resolved.ok) {
      return { ...base, fields: [{ label: 'Refused', value: resolved.message }] };
    }
    const { spec, endpoint } = resolved;
    const args = input.input;
    const clock = await clockFor(ctx.orgId);
    const title = endpoint.review?.title ? renderString(endpoint.review.title, args, clock) : undefined;
    // A row whose value resolved to nothing is left off the card.
    const fields: Array<{ label: string; value: string }> = [];
    for (const field of endpoint.review?.fields ?? []) {
      const value = renderString(field.value, args, clock);
      if (value !== undefined && value !== '') {
        fields.push({ label: field.label, value: typeof value === 'string' ? value : JSON.stringify(value) });
      }
    }
    const request = renderRequest(endpoint, args, clock);
    const requestText = request.ok
      ? `${endpoint.method} ${buildUrl('', request.request.path, request.request.query)}${request.request.body === undefined ? '' : `\n\n${JSON.stringify(request.request.body, null, 2)}`}`
      : request.message;
    return {
      ...base,
      title: typeof title === 'string' && title.trim() ? title : `${endpointDescription(endpoint)} — ${spec.name}`,
      system: spec.name,
      badges: [
        { label: spec.name },
        ...(endpoint.reversible ? [] : [{ label: 'Irreversible', tone: 'warn' as const }]),
      ],
      fields: [
        ...fields,
        { label: 'Method', value: endpoint.method },
        { label: 'Path', value: request.ok ? request.request.path : endpoint.path },
      ],
      content: [{ kind: 'text', id: 'request', label: 'Request', body: requestText, preformatted: true }],
    };
  },

  async execute(ctx, input) {
    const credentials = restCredentialsOf(ctx.credentials);
    if (!credentials) {
      throw new Error(`rest.request needs a connected credential (base URL and bearer token) for the "${input.sourceSlug}" source — connect one on the Connectors page.`);
    }
    const resolved = await resolveEndpoint(ctx.orgId, input);
    if (!resolved.ok) {
      throw new Error(resolved.message);
    }
    const args = validateArgs(resolved.endpoint, input.input);
    if (!args.ok) {
      throw new Error(args.message);
    }
    const request = renderRequest(resolved.endpoint, args.args, await clockFor(ctx.orgId));
    if (!request.ok) {
      throw new Error(request.message);
    }
    const { endpoint } = resolved;
    const result = await restCall({
      credentials,
      method: endpoint.method,
      path: request.request.path,
      query: request.request.query,
      body: request.request.body,
    });
    if (!result.ok) {
      // Actions run through the review queue, whose contract is throw-on-failure.
      throw new Error(`${endpoint.name} failed: ${result.message}`);
    }
    // Picked, then the contract's leaves only, then capped — as the reads are.
    const picked = selectPaths(pickPath(result.data, endpoint.response.pick), endpoint.response.select);
    const text = capJson(picked, endpoint.response.maxChars);
    return {
      sourceSlug: input.sourceSlug,
      action: endpoint.name,
      method: endpoint.method,
      path: request.request.path,
      status: result.status,
      // The picked response as data when it fits, else the capped text.
      body: text.length <= endpoint.response.maxChars ? (picked ?? null) : text,
    };
  },
};
