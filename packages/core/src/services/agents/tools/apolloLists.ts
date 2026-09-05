/**
 * Apollo LIST tools — the staging area between "we found someone" and "they
 * are in the CRM".
 *
 * This is the shape the client's own process asks for. Andrew pushed 500 to
 * 700 Apollo contacts into HubSpot once, they did not convert, and now only a
 * contact that turns into a meeting gets imported. So a prospect worth keeping
 * is staged on an Apollo list, and the HubSpot write is a separate, deliberate
 * promotion — never a side effect of finding someone.
 *
 * The two READS come free with the source. The two WRITES are grant-gated on
 * top of it: a saved list can feed one of Andrew's live Apollo cadences, so
 * adding someone to a list can indirectly start outreach. That is the
 * platform's existing shape for a tool too consequential to be default-on.
 *
 * Ported from the existing toolkit with behaviour preserved: implicit list
 * creation, case-insensitive label matching where the existing casing wins,
 * membership-only removal, and the `raw_json` passthrough that keeps person
 * signals the normalized row drops.
 */

import type { RuntimeContext } from '../types';
import type { ApolloClient, ApolloResult } from '@/libs/apollo/client';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { APOLLO_ABSENCE, APOLLO_ROUTING, apolloClientForCtx, apolloWriteGranted } from './apolloDirect';
import { asJson, clampLimit } from './hubspotDirect';

const MAX_PER_PAGE = 100;

type ApolloLabel = {
  id?: string;
  _id?: string;
  name?: string;
  modality?: string;
  cached_count?: number;
  updated_at?: string;
};

type LabelsBody = ApolloLabel[] | { labels?: ApolloLabel[] };

type ApolloContact = {
  id?: string;
  _id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  city?: string;
  state?: string;
  country?: string;
  linkedin_url?: string;
  organization_name?: string;
  organization?: { name?: string };
  account?: { name?: string };
  label_ids?: string[];
  typed_custom_fields?: Record<string, unknown>;
};

type ContactsBody = {
  contacts?: ApolloContact[];
  people?: ApolloContact[];
  pagination?: { page?: number; per_page?: number; total_entries?: number; total_pages?: number };
};

type ContactWriteBody = { contact?: ApolloContact; contacts?: ApolloContact[] };

/**
 * Every label Apollo returned, whichever envelope it used.
 * @param body
 */
function labelsFrom(body: LabelsBody): ApolloLabel[] {
  return Array.isArray(body) ? body : (body.labels ?? []);
}

/**
 * One label as this tool reports it.
 * @param label
 */
function labelRow(label: ApolloLabel): Record<string, unknown> {
  return {
    id: label.id ?? label._id ?? null,
    name: label.name ?? '',
    modality: label.modality ?? null,
    count: label.cached_count ?? null,
    updated_at: label.updated_at ?? null,
  };
}

/**
 * Fetch every label in the account.
 * @param client - The resolved Apollo client.
 */
async function fetchLabels(client: ApolloClient): Promise<ApolloResult<ApolloLabel[]>> {
  const res = await client.get<LabelsBody>('/api/v1/labels');
  return res.ok ? { ok: true, data: labelsFrom(res.data) } : res;
}

/**
 * Find a label by name, case-insensitively.
 *
 * Ported rule: the EXISTING casing wins. "MSP Outbound" and "msp outbound" are
 * one list, and asking for the second one adds to the first rather than
 * creating a near-duplicate nobody will notice for months.
 * @param labels - Every label in the account.
 * @param name - The name asked for.
 */
export function matchLabel(labels: ApolloLabel[], name: string): ApolloLabel | undefined {
  const needle = name.trim().toLowerCase();
  return labels.find(label => (label.name ?? '').trim().toLowerCase() === needle);
}

/**
 * One contact row, with the raw record kept alongside it.
 * @param contact
 */
function contactRow(contact: ApolloContact): Record<string, unknown> {
  const org = contact.organization ?? contact.account ?? {};
  return {
    id: contact.id ?? contact._id ?? null,
    name: contact.name ?? ([contact.first_name, contact.last_name].filter(Boolean).join(' ') || null),
    first_name: contact.first_name ?? null,
    last_name: contact.last_name ?? null,
    title: contact.title ?? null,
    email: contact.email ?? null,
    email_status: contact.email_status ?? null,
    email_verified: contact.email_status === 'verified',
    company: org.name ?? contact.organization_name ?? null,
    city: contact.city ?? null,
    state: contact.state ?? null,
    country: contact.country ?? null,
    linkedin_url: contact.linkedin_url ?? null,
    // Everything the normalized row drops. Person signals Apollo adds later
    // reach the model through here without this tool needing a change.
    raw_json: contact,
  };
}

export function apolloListLabelsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { name_filter } = args as { name_filter?: string };
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const res = await fetchLabels(resolved.client);
      if (!res.ok) {
        return asJson(res);
      }
      const needle = (name_filter ?? '').trim().toLowerCase();
      const rows = res.data
        .filter(label => needle === '' || (label.name ?? '').toLowerCase().includes(needle))
        .map(labelRow);
      return asJson({
        ok: true,
        source: 'apollo_live',
        total: rows.length,
        total_in_account: res.data.length,
        filter: name_filter ?? null,
        ...(rows.length === 0 ? { absence: APOLLO_ABSENCE } : {}),
        labels: rows,
      });
    },
    {
      name: 'apollo_list_labels',
      description: `Lists the saved LISTS (Apollo calls them labels) in the Apollo account, with how many records each holds and whether it holds people or accounts. Free. Start here before adding anyone to a list, so the name you use is the name that already exists. ${APOLLO_ROUTING} ${APOLLO_ABSENCE}`,
      schema: z.object({
        name_filter: z.string().optional().describe('Case-insensitive substring; only lists whose name contains it are returned.'),
      }),
    },
  );
}

export function apolloListContactsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { label_id, page, limit } = args as { label_id: string; page?: number; limit?: number };
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      if (!label_id || label_id.trim() === '') {
        return asJson({ ok: false, error: 'bad_argument', message: 'label_id is required — get it from apollo_list_labels.' });
      }
      const perPage = clampLimit(limit, 25, MAX_PER_PAGE);
      const pageNumber = Math.max(1, Math.trunc(page ?? 1) || 1);
      const res = await resolved.client.post<ContactsBody>('/api/v1/contacts/search', {
        label_ids: [label_id.trim()],
        page: pageNumber,
        per_page: perPage,
      });
      if (!res.ok) {
        return asJson(res);
      }
      const rows = (res.data.contacts ?? res.data.people ?? []).map(contactRow);
      const total = res.data.pagination?.total_entries ?? rows.length;
      const totalPages = res.data.pagination?.total_pages ?? 1;
      return asJson({
        ok: true,
        source: 'apollo_live',
        label_id,
        total,
        returned: rows.length,
        page: pageNumber,
        has_more: pageNumber < totalPages,
        note: `Report the TOTAL (${total}), not the page size (${rows.length}).`,
        ...(rows.length === 0 ? { absence: APOLLO_ABSENCE } : {}),
        contacts: rows,
      });
    },
    {
      name: 'apollo_list_contacts',
      description: `Reads the people on ONE Apollo saved list, paged. Free. Get the label_id from apollo_list_labels first. Addresses here are whatever Apollo already holds on the saved contact; \`email_status\` says whether it is verified. ${APOLLO_ROUTING} ${APOLLO_ABSENCE}`,
      schema: z.object({
        label_id: z.string().min(1).describe('Apollo label id, from apollo_list_labels.'),
        page: z.number().int().positive().optional().describe('Page to fetch (default 1).'),
        limit: z.number().int().positive().optional().describe(`People per page (default 25, max ${MAX_PER_PAGE}). Does NOT limit \`total\`.`),
      }),
    },
  );
}

export function apolloAddToListTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const a = args as { list_name: string; contact: Record<string, unknown> };
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const listName = (a.list_name ?? '').trim();
      const email = typeof a.contact?.email === 'string' ? a.contact.email.trim() : '';
      if (listName === '' || email === '') {
        return asJson({
          ok: false,
          error: 'bad_argument',
          message: 'apollo_add_to_list needs a list_name and a contact carrying at least an email.',
        });
      }
      const labels = await fetchLabels(resolved.client);
      if (!labels.ok) {
        return asJson(labels);
      }
      // Existing casing wins: "MSP Outbound" and "msp outbound" are one list.
      const existing = matchLabel(labels.data, listName);
      const effectiveName = existing?.name ?? listName;

      const body: Record<string, unknown> = {
        email,
        label_names: [effectiveName],
      };
      for (const [from, to] of [['first_name', 'first_name'], ['last_name', 'last_name'], ['title', 'title'], ['company', 'organization_name'], ['company_domain', 'website_url']] as const) {
        const value = a.contact[from];
        if (typeof value === 'string' && value.trim() !== '') {
          body[to] = value.trim();
        }
      }
      // One call creates the saved contact and, when the list is new, the list
      // with it. Apollo has no "create label" endpoint to call first.
      const res = await resolved.client.post<ContactWriteBody>('/api/v1/contacts', body);
      if (!res.ok) {
        return asJson(res);
      }
      const contact = res.data.contact ?? res.data.contacts?.[0];
      return asJson({
        ok: true,
        source: 'apollo_live',
        list_name: effectiveName,
        list_created: existing === undefined,
        ...(existing !== undefined && existing.name !== listName
          ? { matched_existing_casing: `Added to the existing list "${existing.name}" rather than creating "${listName}" beside it.` }
          : {}),
        contact_id: contact?.id ?? contact?._id ?? null,
        email,
        note: 'This stages the prospect in Apollo. It does NOT create a HubSpot record: promoting someone to the CRM is a separate, deliberate step.',
      });
    },
    {
      name: 'apollo_add_to_list',
      description: `WRITES to Apollo: saves a contact and puts them on a named list, creating the list if it does not exist. A list name that already exists case-insensitively is reused with its existing spelling, so near-duplicate lists do not pile up. This is the STAGING step for a prospect worth keeping — it does not create a HubSpot record, and promoting someone to the CRM is a separate deliberate step. An Apollo list can feed a live Apollo cadence, so treat adding someone as an outreach-adjacent action. ${APOLLO_ROUTING}`,
      schema: z.object({
        list_name: z.string().min(1).describe('The saved list to add them to. Check apollo_list_labels first so this matches a list that already exists.'),
        contact: z.record(z.string(), z.unknown()).describe('The person: { email } at minimum, plus first_name, last_name, title, company, company_domain where known.'),
      }),
    },
  );
}

export function apolloRemoveFromListTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const a = args as { contact_id: string; label_id: string };
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const contactId = (a.contact_id ?? '').trim();
      const labelId = (a.label_id ?? '').trim();
      if (contactId === '' || labelId === '') {
        return asJson({ ok: false, error: 'bad_argument', message: 'apollo_remove_from_list needs both a contact_id and a label_id.' });
      }
      const found = await resolved.client.post<ContactsBody>('/api/v1/contacts/search', {
        contact_ids: [contactId],
        page: 1,
        per_page: 1,
      });
      if (!found.ok) {
        return asJson(found);
      }
      const contact = (found.data.contacts ?? found.data.people ?? [])[0];
      if (!contact) {
        return asJson({
          ok: true,
          source: 'apollo_live',
          removed: false,
          reason: 'no_such_contact',
          message: `Apollo has no saved contact with id "${contactId}".`,
        });
      }
      const memberships = contact.label_ids ?? [];
      if (!memberships.includes(labelId)) {
        return asJson({
          ok: true,
          source: 'apollo_live',
          removed: false,
          reason: 'not_a_member',
          remaining_label_ids: memberships,
          message: 'That contact is not on that list, so nothing was changed. The contact itself is untouched.',
        });
      }
      const remaining = memberships.filter(id => id !== labelId);
      // Membership only. Removing someone from a list must never delete the
      // saved contact: the two are different acts and only one was asked for.
      const res = await resolved.client.post<ContactWriteBody>(`/api/v1/contacts/${contactId}`, { label_ids: remaining });
      if (!res.ok) {
        return asJson(res);
      }
      const updated = res.data.contact ?? res.data.contacts?.[0];
      return asJson({
        ok: true,
        source: 'apollo_live',
        removed: true,
        contact_id: contactId,
        label_id: labelId,
        remaining_label_ids: updated?.label_ids ?? remaining,
        note: 'List membership only — the saved contact still exists in Apollo.',
      });
    },
    {
      name: 'apollo_remove_from_list',
      description: `WRITES to Apollo: takes one saved contact OFF one list. Membership only — the contact itself is never deleted. Returns \`removed\` (or \`not_a_member\` when they were not on it) plus the lists they remain on, so the effect is visible without a second call. ${APOLLO_ROUTING}`,
      schema: z.object({
        contact_id: z.string().min(1).describe('Apollo saved-contact id, from apollo_list_contacts.'),
        label_id: z.string().min(1).describe('The list to remove them from, from apollo_list_labels.'),
      }),
    },
  );
}

/** Tool names that additionally need `harness.grantTools` to exist. */
export const APOLLO_WRITE_TOOL_NAMES = ['apollo_add_to_list', 'apollo_remove_from_list'] as const;

/**
 * The list tools: reads come with the source, writes come with the grant.
 * @param ctx - The agent runtime context.
 */
export function apolloListTools(ctx: RuntimeContext) {
  const writes = [apolloAddToListTool(ctx), apolloRemoveFromListTool(ctx)]
    .filter(t => apolloWriteGranted(ctx, t.name));
  return [
    apolloListLabelsTool(ctx),
    apolloListContactsTool(ctx),
    ...writes,
  ];
}
