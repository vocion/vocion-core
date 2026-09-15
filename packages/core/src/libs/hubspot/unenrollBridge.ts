/**
 * Sequence unenrollment via a workflow bridge.
 *
 * HubSpot allows one active sequence per contact and the public sequences API
 * has NO unenroll endpoint (verified against the 2026-03 and 2026-09 versions:
 * the enrollment routes allow only GET and POST). The sanctioned path is the
 * "Unenroll from sequence" WORKFLOW action, so the platform provisions a
 * bridge in the portal and drives it through a contact property:
 *
 *   1. `ensureUnenrollBridge` creates (idempotently) a datetime contact
 *      property and an enabled workflow that unenrolls any contact whose
 *      property becomes known.
 *   2. `requestUnenroll` stamps the property, polls the portal-wide
 *      `hs_sequences_is_enrolled` flag until it clears, then empties the
 *      property so the workflow can re-trigger next time.
 *
 * Measured live on 2026-09-14: the workflow completed in ~80s, so the default
 * timeout leaves headroom without letting an approve click hang forever.
 */

import type { HubspotClient, HubspotResult } from './client';

export const UNENROLL_REQUEST_PROPERTY = 'vocion_unenroll_requested';
export const UNENROLL_FLOW_NAME = 'Vocion · Unenroll from sequence on request';

/** The built-in "Unenroll from sequence" workflow action. */
const UNENROLL_ACTION_TYPE_ID = '0-4702372';

const DEFAULT_TIMEOUT_MS = 3 * 60_000;
const DEFAULT_POLL_MS = 6_000;

type FlowSummary = { id: string; name?: string };
type FlowsPage = { results?: FlowSummary[]; paging?: { next?: { after?: string } } };

/** The contact's portal-wide enrollment flag — true across every user's sequence library. */
export async function readSequenceEnrollmentState(
  client: HubspotClient,
  contactId: string,
): Promise<HubspotResult<{ enrolled: boolean; latestSequenceId: string | null }>> {
  const res = await client.get<{ properties?: Record<string, string | null> }>(
    `/crm/v3/objects/contacts/${contactId}`,
    { properties: 'hs_sequences_is_enrolled,hs_latest_sequence_enrolled' },
  );
  if (!res.ok) {
    return res;
  }
  const p = res.data.properties ?? {};
  return {
    ok: true,
    data: {
      enrolled: p.hs_sequences_is_enrolled === 'true',
      latestSequenceId: p.hs_latest_sequence_enrolled ?? null,
    },
  };
}

/**
 * Idempotently provision the bridge: the trigger property and the workflow.
 * Safe to call before every unenroll — two GETs when everything exists.
 * @param client
 */
export async function ensureUnenrollBridge(
  client: HubspotClient,
): Promise<HubspotResult<{ flowId: string; created: boolean }>> {
  const prop = await client.get<{ name?: string }>(`/crm/v3/properties/contacts/${UNENROLL_REQUEST_PROPERTY}`);
  if (!prop.ok) {
    if (prop.error !== 'hubspot_error' || prop.status !== 404) {
      return prop;
    }
    const created = await client.post(`/crm/v3/properties/contacts`, {
      name: UNENROLL_REQUEST_PROPERTY,
      label: 'Vocion: unenroll from sequence requested',
      description: 'Set by the Vocion platform when an approved enrollment must replace the contact\'s current sequence. The bridge workflow unenrolls on it; the platform clears it afterwards.',
      groupName: 'contactinformation',
      type: 'datetime',
      fieldType: 'date',
    });
    if (!created.ok) {
      return created;
    }
  }

  let after: string | undefined;
  do {
    const page = await client.get<FlowsPage>('/automation/v4/flows', {
      limit: '100',
      ...(after ? { after } : {}),
    });
    if (!page.ok) {
      return page;
    }
    const found = (page.data.results ?? []).find(f => f.name === UNENROLL_FLOW_NAME);
    if (found) {
      return { ok: true, data: { flowId: String(found.id), created: false } };
    }
    after = page.data.paging?.next?.after;
  } while (after);

  // Shape verified live against this API on 2026-09-14 (flow 1884288655).
  const flow = await client.post<{ id?: string | number }>('/automation/v4/flows', {
    type: 'CONTACT_FLOW',
    flowType: 'WORKFLOW',
    objectTypeId: '0-1',
    name: UNENROLL_FLOW_NAME,
    description: 'Managed by the Vocion platform. When vocion_unenroll_requested is set, unenroll the contact from their current sequence. The platform clears the property afterwards so the next request re-triggers. Do not edit by hand.',
    isEnabled: true,
    startActionId: '1',
    actions: [{
      actionId: '1',
      actionTypeId: UNENROLL_ACTION_TYPE_ID,
      actionTypeVersion: 0,
      type: 'SINGLE_CONNECTION',
      fields: {},
    }],
    enrollmentCriteria: {
      type: 'LIST_BASED',
      shouldReEnroll: true,
      listFilterBranch: {
        filterBranchType: 'OR',
        filterBranchOperator: 'OR',
        filters: [],
        filterBranches: [{
          filterBranchType: 'AND',
          filterBranchOperator: 'AND',
          filterBranches: [],
          filters: [{
            filterType: 'PROPERTY',
            property: UNENROLL_REQUEST_PROPERTY,
            operation: { operationType: 'ALL_PROPERTY', operator: 'IS_KNOWN', includeObjectsWithNoValueSet: false },
          }],
        }],
      },
    },
  });
  if (!flow.ok) {
    return flow;
  }
  return { ok: true, data: { flowId: String(flow.data.id ?? ''), created: true } };
}

/**
 * Unenroll a contact from whatever sequence currently holds them, and wait
 * until the portal confirms it. Returns ok only once `hs_sequences_is_enrolled`
 * reads false; a timeout names the bridge workflow so the fix is actionable.
 * @param client
 * @param opts
 * @param opts.contactId
 * @param opts.timeoutMs
 * @param opts.pollMs
 * @param opts.sleep - injectable for tests
 */
export async function requestUnenroll(
  client: HubspotClient,
  opts: {
    contactId: string;
    timeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<HubspotResult<{ unenrolled: true; waitedMs: number }>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const sleep = opts.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));

  const bridge = await ensureUnenrollBridge(client);
  if (!bridge.ok) {
    return bridge;
  }

  const stamped = await client.patch(`/crm/v3/objects/contacts/${opts.contactId}`, {
    properties: { [UNENROLL_REQUEST_PROPERTY]: String(Date.now()) },
  });
  if (!stamped.ok) {
    return stamped;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(pollMs);
    const state = await readSequenceEnrollmentState(client, opts.contactId);
    if (state.ok && !state.data.enrolled) {
      // Clear the trigger so the next request re-fires the workflow
      // (re-enrollment is on the property BECOMING known). Best-effort: a
      // failed clear costs the next unenroll one extra stamp, nothing more.
      await client.patch(`/crm/v3/objects/contacts/${opts.contactId}`, {
        properties: { [UNENROLL_REQUEST_PROPERTY]: '' },
      });
      return { ok: true, data: { unenrolled: true, waitedMs: Date.now() - startedAt } };
    }
  }
  return {
    ok: false,
    error: 'hubspot_error',
    status: 408,
    message: `The contact was still enrolled after ${Math.round(timeoutMs / 1000)}s. The "${UNENROLL_FLOW_NAME}" workflow should unenroll within ~2 minutes — check that it is enabled in HubSpot and retry.`,
  };
}
