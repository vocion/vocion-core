/**
 * The live READ tools of every `rest` source an agent holds — one
 * `<prefix>_<name>` tool per `tools[]` entry the source declares, plus one
 * `<prefix>_list_actions` that says which writes the agent may propose
 * through `rest.request`.
 *
 * Access boundary: built only for agents whose `connectorSources` name a REST
 * source, AND (when a per-user ACL is set) only when that ACL also permits
 * it. The declarations come off the source row, which `buildDomainTools`
 * cannot read (it is synchronous), so they are resolved once per graph build
 * onto `ctx.restSources` — the same seam `filingTypes` uses — and the tool
 * endpoint rebuilds them the same way for the out-of-process loop.
 * Credentials come from the source's vault entry via
 * `getCredentialsForSource`, exactly like the HubSpot and Apollo tools.
 *
 * Failures are data (`libs/rest/client.ts`), never throws: no vaulted
 * credential → `no_credentials` naming the Connectors-page fix; a refused
 * token → `http_401` / `http_403` saying it may have expired or lack rights;
 * `http_404`, `http_5xx`, `timeout`, `invalid_json`. A missing path parameter
 * is refused before any call is made. The token is never logged.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { RestSourceSpec, RestTool } from '@/libs/rest/spec';
import type { TemplateClock } from '@/libs/rest/template';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { capJson, noRestCredentials, pickPath, restCall, restCredentialsOf } from '@/libs/rest/client';
import { zodFromInputSchema } from '@/libs/rest/jsonSchema';
import { selectPaths } from '@/libs/rest/select';
import { endpointDescription, REST_LIST_ACTIONS_TOOL, restToolName, toolPrefixFor } from '@/libs/rest/spec';
import { renderPath, renderQuery } from '@/libs/rest/template';
import { resolveTimeZone } from '@/libs/time/zone';
import { getCredentialsForSource } from '@/services/SourceCredentialService';
import { asJson } from './hubspotDirect';

export { loadRestSources } from '@/libs/rest/sources';

/**
 * The REST sources this agent may reach on this request: those in its
 * `connectorSources`, narrowed by the per-user ACL when one is set.
 * @param ctx - The agent runtime context.
 */
export function restSourcesInScope(ctx: RuntimeContext): RestSourceSpec[] {
  return (ctx.restSources ?? []).filter(spec =>
    ctx.connectorSources.includes(spec.slug)
    && (!ctx.allowedSourceSlugs || ctx.allowedSourceSlugs.includes(spec.slug)));
}

/**
 * Whether the agent has any REST source in scope.
 * @param ctx - The agent runtime context.
 */
export function restInScope(ctx: RuntimeContext): boolean {
  return restSourcesInScope(ctx).length > 0;
}

/**
 * One declared read endpoint as a tool.
 * @param ctx - The agent runtime context.
 * @param spec - The source the endpoint belongs to.
 * @param prefix - The source's tool prefix.
 * @param endpoint - The `tools[]` entry.
 */
function restReadTool(ctx: RuntimeContext, spec: RestSourceSpec, prefix: string, endpoint: RestTool) {
  return tool(
    async (input) => {
      const args = input as Record<string, unknown>;
      // Built-in dates resolve in the person's zone for this turn, else the workspace's.
      const clock: TemplateClock = { now: new Date(), timeZone: resolveTimeZone(ctx.timeZone, ctx.defaultTimeZone) };
      const path = renderPath(endpoint.path, args, clock);
      if (!path.ok) {
        return asJson({ ok: false, error: 'missing_path_param', message: `This endpoint needs ${path.missing.map(name => `"${name}"`).join(', ')} to build its path. Pass ${path.missing.length === 1 ? 'it' : 'them'} and call again.` });
      }
      const credentials = restCredentialsOf(await getCredentialsForSource(ctx.orgId, spec.slug).catch(() => undefined));
      if (!credentials) {
        return asJson(noRestCredentials(spec.slug));
      }
      const result = await restCall({
        credentials,
        method: endpoint.method,
        path: path.path,
        query: renderQuery(endpoint.query, args, clock),
      });
      if (!result.ok) {
        return asJson({ ok: false, error: result.error, status: result.status, message: result.message });
      }
      const picked = pickPath(result.data, endpoint.response.pick);
      if (picked === undefined && endpoint.response.pick) {
        return asJson({ ok: false, error: 'pick_missing', status: result.status, message: `The API answered ${result.status} but the response has no "${endpoint.response.pick}" — the endpoint's response.pick may be wrong for this call. Top-level keys: ${Object.keys((result.data as Record<string, unknown> | null) ?? {}).join(', ') || 'none'}.` });
      }
      // The contract's leaves only, in their nesting, then the cap.
      return capJson(selectPaths(picked, endpoint.response.select), endpoint.response.maxChars);
    },
    {
      name: restToolName(prefix, endpoint.name),
      description: `${endpointDescription(endpoint)} Live read from ${spec.name} (${endpoint.method} ${endpoint.path}); the result is the API's own answer at the time of the call, so quote it as of now. A failure comes back as {ok:false, error, message} — say what it says rather than guessing.`,
      schema: zodFromInputSchema(endpoint.input),
    },
  );
}

/**
 * The action catalog of one source, so the model knows what it can propose
 * through `rest.request` and with which arguments.
 * @param spec - The source.
 * @param prefix - Its tool prefix.
 */
function restListActionsTool(spec: RestSourceSpec, prefix: string) {
  return tool(
    async () => asJson({
      sourceSlug: spec.slug,
      source: spec.name,
      how: `Propose one with propose_action: action_id "rest.request", action_input { sourceSlug: "${spec.slug}", action: <name>, input: {…}, summary: <what this change does, in plain language> }. Writes are gated by the review queue and the trust ladder; never claim one was made until it reports DONE.`,
      actions: spec.config.actions.map(action => ({
        name: action.name,
        description: endpointDescription(action),
        method: action.method,
        path: action.path,
        input: action.input,
        reversible: action.reversible,
      })),
    }),
    {
      name: restToolName(prefix, REST_LIST_ACTIONS_TOOL),
      description: `Lists the writes an agent may propose against ${spec.name} through the rest.request action — name, what it does, its input schema and whether it can be undone. Read it before proposing, so the action name and its arguments are the declared ones.`,
      schema: z.object({}),
    },
  );
}

/**
 * The REST tool set — every in-scope source's declared reads and its
 * action catalog. Empty for an agent with no REST source in scope.
 * @param ctx - The agent runtime context.
 */
export function restTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [];
  for (const spec of restSourcesInScope(ctx)) {
    const prefix = toolPrefixFor(spec.slug, spec.config);
    for (const endpoint of spec.config.tools) {
      tools.push(restReadTool(ctx, spec, prefix, endpoint) as StructuredToolInterface);
    }
    tools.push(restListActionsTool(spec, prefix) as StructuredToolInterface);
  }
  return tools;
}
