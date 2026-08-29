/**
 * Direct-to-HubSpot CONTACT tools — record-level reads the mirror cannot do.
 *
 *   - `hubspot_get_contact`: one person's full live record by email or id.
 *   - `hubspot_search_contacts`: find people by free text (name / email
 *     fragment / company), feeding ids into `hubspot_get_contact`.
 *   - `hubspot_contact_emails` (Phase 3): the logged email history.
 *
 * Routing rule, encoded in every description: fetching a record goes to the
 * SOURCE (these tools); counting goes to the MIRROR (`hubspot_count_*`).
 */

import type { RuntimeContext } from '../types';
import type { HubspotClient, HubspotPage, HubspotRecord } from '@/libs/hubspot/client';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { asJson, clampLimit, distinctiveTokens, emailDirection, emailSnippet, hubspotClientForCtx, isAutoReply } from './hubspotDirect';

/**
 * Curated contact properties: the normalized record every call returns.
 * `hubspot_get_contact` additionally fetches EVERY non-archived property, so
 * custom fields ride along as extras without a code change per new field.
 */
export const CONTACT_PROPS = [
  'firstname',
  'lastname',
  'email',
  'company',
  'jobtitle',
  'phone',
  'city',
  'state',
  'country',
  'lifecyclestage',
  'hs_lead_status',
  'hubspot_owner_id',
  'hs_object_id',
  'hs_analytics_source',
  'hs_object_source',
  'recent_conversion_event_name',
  'notes_last_contacted',
  'createdate',
  'lastmodifieddate',
];
const CONTACT_PROPS_SET = new Set(CONTACT_PROPS);

const FIELD_LABELS: Record<string, string> = {
  id: 'HubSpot ID',
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email',
  company: 'Company',
  title: 'Job title',
  phone: 'Phone',
  city: 'City',
  state: 'State',
  country: 'Country',
  lifecycle_stage: 'Lifecycle stage',
  lead_status: 'Lead status',
  owner_id: 'Owner ID',
  original_source: 'Original source',
  object_source: 'Record source',
  form_name: 'Last form submitted',
  last_contacted_at: 'Last contacted',
  created_at: 'Created',
  last_modified_at: 'Last modified',
};

type Props = Record<string, string | null>;

/**
 * Normalize a raw HubSpot property bag into the canonical contact shape.
 * @param props
 * @param id
 */
export function normalizeContact(props: Props, id?: string): Record<string, unknown> {
  return {
    id: id ?? props.hs_object_id ?? null,
    first_name: props.firstname ?? null,
    last_name: props.lastname ?? null,
    email: props.email ?? null,
    company: props.company ?? null,
    title: props.jobtitle ?? null,
    phone: props.phone ?? null,
    city: props.city ?? null,
    state: props.state ?? null,
    country: props.country ?? null,
    lifecycle_stage: props.lifecyclestage ?? null,
    lead_status: props.hs_lead_status ?? null,
    owner_id: props.hubspot_owner_id ?? null,
    original_source: props.hs_analytics_source ?? null,
    object_source: props.hs_object_source ?? null,
    form_name: props.recent_conversion_event_name ?? null,
    last_contacted_at: props.notes_last_contacted ?? null,
    created_at: props.createdate ?? null,
    last_modified_at: props.lastmodifieddate ?? null,
  };
}

function prettify(key: string): string {
  return key.replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * The ordered `{key, label, value}` field list: the normalized record first
 * (stable order), then every OTHER non-empty property HubSpot returned —
 * whatever a form or teammate named a custom field, it shows up here with
 * HubSpot's own display label.
 * @param contact
 * @param props
 * @param labels
 */
export function buildFieldList(
  contact: Record<string, unknown>,
  props: Props,
  labels: Record<string, string>,
): Array<{ key: string; label: string; value: unknown }> {
  const fields = Object.entries(contact)
    .filter(([, v]) => v !== null && v !== '')
    .map(([key, value]) => ({ key, label: FIELD_LABELS[key] ?? prettify(key), value }));
  const extras = Object.entries(props)
    .filter(([key, v]) => !CONTACT_PROPS_SET.has(key) && v != null && v !== '')
    .map(([key, value]) => ({ key, label: labels[key] ?? prettify(key), value: value as unknown }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...fields, ...extras];
}

type PropertySchema = { results?: Array<{ name?: string; label?: string; archived?: boolean }> };

/**
 * Every non-archived contact property name + display label. A schema-fetch
 * failure degrades to the curated list rather than failing the lookup.
 * @param client
 */
async function allContactProps(client: HubspotClient): Promise<{ names: string[]; labels: Record<string, string> }> {
  const res = await client.get<PropertySchema>('/crm/v3/properties/contacts');
  if (!res.ok) {
    return { names: CONTACT_PROPS, labels: {} };
  }
  const names: string[] = [];
  const labels: Record<string, string> = {};
  for (const p of res.data.results ?? []) {
    if (p.archived || !p.name) {
      continue;
    }
    names.push(p.name);
    labels[p.name] = p.label ?? p.name;
  }
  return { names: [...new Set([...CONTACT_PROPS, ...names])], labels };
}

function noMatch(identifier: string) {
  return {
    ok: true,
    contact: null,
    reason: 'no_match',
    identifier,
    message: `HubSpot has no contact with the exact identifier "${identifier}".`,
    retry_hint: 'If you only have a name, use hubspot_search_contacts (free-text match over name, email, company) and pass a returned id back here.',
  };
}

export function hubspotGetContactTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { identifier } = args as { identifier: string };
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const id = identifier.trim();
      if (!id) {
        return asJson({ ok: false, error: 'bad_argument', message: 'identifier is required (an email address or HubSpot contact id).' });
      }
      const { names, labels } = await allContactProps(resolved.client);
      // Properties travel in a POST body both ways: the full property list can
      // exceed URL length limits as a GET query string.
      const res = /^\d+$/.test(id)
        ? await resolved.client.post<HubspotPage>('/crm/v3/objects/contacts/batch/read', {
            inputs: [{ id }],
            properties: names,
          })
        : await resolved.client.post<HubspotPage>('/crm/v3/objects/contacts/search', {
            filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: id }] }],
            properties: names,
            limit: 1,
          });
      if (!res.ok) {
        // An id that does not exist is a no-match, not an API failure.
        if (res.error === 'hubspot_error' && res.status === 404) {
          return asJson(noMatch(id));
        }
        return asJson(res);
      }
      const row = (res.data.results ?? [])[0];
      if (!row) {
        return asJson(noMatch(id));
      }
      const props = row.properties ?? {};
      const contact = normalizeContact(props, row.id);
      const fields = buildFieldList(contact, props, labels);
      return asJson({
        ok: true,
        source: 'hubspot_live',
        identifier: id,
        field_count: fields.length,
        contact,
        fields,
      });
    },
    {
      name: 'hubspot_get_contact',
      description: 'Reads HubSpot LIVE, current as of this call (no sync lag, no freshen step): fetch ONE contact\'s full record by email address or HubSpot contact id, including every custom property. Use this whenever a question is about one specific person ("what do we know about jane@x.com", "what did their form say"). Returns the normalized record plus an ordered {key, label, value} field list; an unknown identifier returns reason "no_match", never an error. Routing: only a NAME in hand → hubspot_search_contacts first, then pass the returned id here; "how many contacts / MQLs / broken down by" → hubspot_count_contacts (the synced mirror, which counts exactly); one account or its deals → hubspot_get_company / hubspot_company_deals.',
      schema: z.object({
        identifier: z.string().min(1).describe('An email address or a numeric HubSpot contact id.'),
      }),
    },
  );
}

export function hubspotSearchContactsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { query, limit } = args as { query: string; limit?: number };
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const q = (query ?? '').trim();
      if (!q) {
        return asJson({ ok: false, error: 'bad_argument', message: 'query is required (a partial name, email fragment, or company).' });
      }
      const cap = clampLimit(limit, 10, 50);
      const client = resolved.client;

      // HubSpot CRM Search: the top-level `query` token-matches across the
      // default searchable properties (firstname, lastname, email, company).
      async function search(term: string) {
        return client.post<HubspotPage>('/crm/v3/objects/contacts/search', {
          query: term,
          properties: CONTACT_PROPS,
          limit: cap,
        });
      }

      let broadened = false;
      let res = await search(q);
      if (res.ok && (res.data.results ?? []).length === 0) {
        // A multi-word miss often over-constrains the token match (initials,
        // suffixes, a middle name). Broaden ONCE to the most distinctive
        // token before concluding nobody exists.
        const tokens = distinctiveTokens(q);
        if (tokens.length > 1) {
          broadened = true;
          res = await search(tokens[0]!);
        }
      }
      if (!res.ok) {
        return asJson(res);
      }
      const contacts = (res.data.results ?? []).map((row: HubspotRecord) => normalizeContact(row.properties ?? {}, row.id));
      return asJson({
        ok: true,
        source: 'hubspot_live',
        query: q,
        count: contacts.length,
        broadened,
        ...(contacts.length === 0
          ? { retry_hint: `No HubSpot contact matched "${q}"${broadened ? ' even after broadening to the most distinctive word' : ''}. Try just the last name, a company name, or an email fragment before concluding the person is not in HubSpot.` }
          : {}),
        contacts,
      });
    },
    {
      name: 'hubspot_search_contacts',
      description: 'Reads HubSpot LIVE, current as of this call: find PEOPLE by free text — a partial name ("Jane"), an email fragment, or a company name. Names are not unique, so this returns a candidate list (default 10, max 50); pass a returned id into hubspot_get_contact for the full record. A multi-word query that matches nothing automatically broadens ONCE to its most distinctive word and says so (broadened: true). Routing: accounts (not people) → hubspot_search_companies; "how many / broken down by" → hubspot_count_contacts on the synced mirror, which counts exactly.',
      schema: z.object({
        query: z.string().min(1).describe('Free text: full or partial name, email fragment, or company.'),
        limit: z.number().int().positive().optional().describe('Max candidates to return (default 10, max 50).'),
      }),
    },
  );
}

const EMAIL_ENGAGEMENT_PROPS = [
  'hs_email_subject',
  'hs_email_text',
  'hs_email_html',
  'hs_email_direction',
  'hs_timestamp',
  'hs_email_status',
];

/** Association reads page unordered, so gather up to this many before sorting. */
const EMAIL_FETCH_CAP = 200;

/**
 * Resolve a contact id from a numeric id or an email address (mirrors
 * hubspot_get_contact's handling). `null` = no such contact.
 * @param client
 * @param identifier
 */
async function resolveContactId(client: HubspotClient, identifier: string) {
  if (/^\d+$/.test(identifier)) {
    return { ok: true as const, id: identifier };
  }
  const res = await client.post<HubspotPage>('/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: identifier }] }],
    properties: ['email'],
    limit: 1,
  });
  if (!res.ok) {
    return res;
  }
  return { ok: true as const, id: (res.data.results ?? [])[0]?.id ?? null };
}

export function hubspotContactEmailsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { identifier, limit } = args as { identifier: string; limit?: number };
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const client = resolved.client;
      const id = (identifier ?? '').trim();
      if (!id) {
        return asJson({ ok: false, error: 'bad_argument', message: 'identifier is required (an email address or HubSpot contact id).' });
      }
      const cap = clampLimit(limit, 25, 100);

      const contact = await resolveContactId(client, id);
      if (!contact.ok) {
        return asJson(contact);
      }
      if (!contact.id) {
        return asJson(noMatch(id));
      }

      // Associations → batch-read is the reliable path (search results lag).
      // Association pages are not timestamp-ordered, so gather them all (up
      // to the cap) before sorting.
      type AssocPage = { results?: Array<{ toObjectId?: string | number; id?: string | number }>; paging?: { next?: { after?: string } } };
      const emailIds: string[] = [];
      let after: string | undefined;
      do {
        const page = await client.get<AssocPage>(`/crm/v3/objects/contacts/${contact.id}/associations/emails`, {
          limit: '100',
          ...(after ? { after } : {}),
        });
        if (!page.ok) {
          return asJson(page);
        }
        for (const r of page.data.results ?? []) {
          const eid = r.toObjectId ?? r.id;
          if (eid !== undefined && eid !== null) {
            emailIds.push(String(eid));
          }
        }
        after = page.data.paging?.next?.after;
      } while (after && emailIds.length < EMAIL_FETCH_CAP);

      const rows: Array<Record<string, unknown>> = [];
      // HubSpot's batch-read caps inputs at 100 — chunk it. This endpoint is
      // where a token without sales-email-read gets its 403 → missing_scope.
      for (let i = 0; i < Math.min(emailIds.length, EMAIL_FETCH_CAP); i += 100) {
        const read = await client.post<HubspotPage>('/crm/v3/objects/emails/batch/read', {
          properties: EMAIL_ENGAGEMENT_PROPS,
          inputs: emailIds.slice(i, i + 100).map(x => ({ id: x })),
        });
        if (!read.ok) {
          return asJson(read);
        }
        for (const r of read.data.results ?? []) {
          const p = r.properties ?? {};
          const subject = (p.hs_email_subject ?? '').trim();
          // Out-of-office / auto-replies carry no signal — drop them.
          if (isAutoReply(subject, p.hs_email_text ?? p.hs_email_html)) {
            continue;
          }
          rows.push({
            email_id: r.id,
            subject: subject || null,
            snippet: emailSnippet(p.hs_email_text, p.hs_email_html),
            direction: emailDirection(p.hs_email_direction),
            status: p.hs_email_status ?? null,
            timestamp: p.hs_timestamp ?? null,
          });
        }
      }
      // hs_timestamp is ISO 8601 — lexical sort is chronological.
      rows.sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')));
      return asJson({
        ok: true,
        source: 'hubspot_live',
        contact_id: contact.id,
        total: rows.length,
        returned: Math.min(rows.length, cap),
        truncated: rows.length > cap,
        emails: rows.slice(0, cap),
      });
    },
    {
      name: 'hubspot_contact_emails',
      description: 'Reads HubSpot LIVE, current as of this call: the emails logged for ONE contact (sent and received), newest first — real subject + snippet, direction ("in" = the contact wrote to us, "out" = sent by our side, derived from HubSpot\'s own engagement records), and timestamp. Use it to see what has already been sent to someone before drafting new outreach, or to check who went quiet. Out-of-office / auto-replies are dropped. Takes an email address or contact id; default 25 rows, max 100. Requires the sales-email-read scope: without it the result is missing_scope naming it. For the full account-level story (notes, meetings, calls too) use hubspot_company_activity.',
      schema: z.object({
        identifier: z.string().min(1).describe('An email address or a numeric HubSpot contact id.'),
        limit: z.number().int().positive().optional().describe('Max emails to return, newest first (default 25, max 100).'),
      }),
    },
  );
}

export function hubspotLeadsTools(ctx: RuntimeContext) {
  return [hubspotGetContactTool(ctx), hubspotSearchContactsTool(ctx), hubspotContactEmailsTool(ctx)];
}
