/**
 * THE CRM FAMILY — a CRM as an agent sees it.
 *
 * Every CRM a sales team runs keeps the same three things: the ACCOUNTS it
 * sells to (Salesforce accounts, Pipedrive organizations, Attio companies),
 * the CONTACTS at them (contacts, persons, people) and the DEALS it is
 * working (opportunities, deals) — plus the ACTIVITY logged on each (tasks,
 * events, notes). So the agent's tools and actions are named for those
 * (`crm_get_record`, `crm.update_record`) and this interface is what each
 * provider fills in, the way the tracker family's is (`services/tracker`).
 *
 * Which provider answers is decided by the workspace's sources
 * (`libs/connectors/families.ts`): the source named, else the workspace's
 * only CRM source. An agent never names a vendor; the source does.
 *
 * Ids are the vendor's own (an 18-character Salesforce id, a Pipedrive
 * number, an Attio record uuid), handed back by search and read, and each
 * provider checks the shape of one before it goes into a request.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { familySourcesForOrg } from '@/libs/connectors/families';

export const CRM_OBJECTS = ['account', 'contact', 'deal'] as const;
export type CrmObject = (typeof CRM_OBJECTS)[number];

/** A value the tools read and the update action writes. */
export type CrmFieldValue = string | number | boolean | null;

export type CrmRecord = {
  object: CrmObject;
  /** The vendor's id for the record. */
  id: string;
  name: string;
  /** The record on the vendor's own site. */
  url: string | null;
  owner: string | null;
  created: string | null;
  updated: string | null;
  /** A contact's email. */
  email?: string | null;
  /** An account's web domain. */
  domain?: string | null;
  /** A contact's job title. */
  title?: string | null;
  /** An account's industry, as the CRM names it. */
  industry?: string | null;
  /** What the record says about itself, in its own words. */
  description?: string | null;
  /** The account a contact or a deal belongs to. */
  account?: { id: string; name: string | null } | null;
  /** A deal's stage, by its label. */
  stage?: string | null;
  amount?: number | null;
  currency?: string | null;
  closeDate?: string | null;
  /** A deal that is neither won nor lost; null when the vendor would not say. */
  open?: boolean | null;
  /** Every other field the vendor returned, by its own API name. */
  fields: Record<string, CrmFieldValue>;
};

/** One record read whole, with what hangs off it. */
export type CrmRecordDetail = CrmRecord & {
  related: { contacts: CrmRecord[]; deals: CrmRecord[] };
};

/** One thing logged on a record: a task, an event, a call, a note. */
export type CrmActivity = {
  id: string;
  /** The vendor's kind: `task`, `event`, `call`, `note`, `meeting`, `email`. */
  kind: string;
  subject: string;
  body: string;
  /** When it happened, or is due. */
  when: string | null;
  /** Whether a task is done; null for something that is not a task. */
  done: boolean | null;
  owner: string | null;
  /** The record it is logged on, when the vendor says. */
  on?: { object: CrmObject | null; id: string; name: string | null } | null;
  updated?: string | null;
};

/** One field a record of an object carries, as the update action names it. */
export type CrmField = {
  /** The API name the update action takes. */
  name: string;
  label: string;
  type: string;
  writable: boolean;
  /** The allowed values of a pick-list field, by label. */
  options?: string[];
};

export type CrmProvider = {
  /** The connector kind behind this provider (`salesforce`). */
  kind: string;
  /** The source slug it answers for. */
  sourceSlug: string;
  /** Records of one object whose name (or a contact's email) matches the words. */
  search: (object: CrmObject, query: string, limit: number) => Promise<CrmRecord[]>;
  /** One record whole, with an account's contacts and deals and a deal's contacts. */
  getRecord: (object: CrmObject, id: string) => Promise<CrmRecordDetail>;
  /** What was logged on a record, newest first. */
  activity: (object: CrmObject, id: string, limit: number) => Promise<CrmActivity[]>;
  /** Deals, open ones only by default, least recently updated first: the pipeline-hygiene view. */
  listDeals: (input: { status: 'open' | 'all'; limit: number }) => Promise<CrmRecord[]>;
  /** The fields an object carries, the writable ones and their allowed values. */
  fields: (object: CrmObject) => Promise<CrmField[]>;
  /** Set fields on a record; returns what each field held before, for Undo. */
  updateRecord: (object: CrmObject, id: string, values: Record<string, CrmFieldValue>) => Promise<{ previous: Record<string, CrmFieldValue>; url: string | null }>;
  /** Log a note on a record. */
  addNote: (object: CrmObject, id: string, note: { title?: string; text: string }) => Promise<{ id: string; url: string | null }>;
  /** Take a note back. */
  deleteNote: (id: string) => Promise<void>;
};

/**
 * The provider for the workspace's CRM: the source named, else the only one.
 * Anything else is an error that names what is connected, so the agent can
 * say which CRM it can and cannot reach.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - A source slug, when the caller knows the source.
 */
export async function crmProviderFor(orgId: string, opts: { sourceSlug?: string | null } = {}): Promise<CrmProvider> {
  const sources = await familySourcesForOrg(orgId, 'crm');
  if (sources.length === 0) {
    throw new Error('This workspace has no CRM connected. Connect one (Salesforce, Pipedrive or Attio) at /dashboard/connectors and give this agent the source.');
  }
  let chosen: FamilySource | undefined;
  if (opts.sourceSlug) {
    chosen = sources.find(s => s.slug === opts.sourceSlug);
    if (!chosen) {
      throw new Error(`No CRM source named ${opts.sourceSlug}. Connected: ${describe(sources)}.`);
    }
  } else {
    if (sources.length > 1) {
      throw new Error(`This workspace has ${sources.length} CRM sources; name one (source). Connected: ${describe(sources)}.`);
    }
    chosen = sources[0]!;
  }
  return providerFor(orgId, chosen);
}

async function providerFor(orgId: string, source: FamilySource): Promise<CrmProvider> {
  switch (source.kind) {
    case 'salesforce':
      return (await import('./providers/salesforce')).salesforceCrmProvider(orgId, source);
    case 'pipedrive':
      return (await import('./providers/pipedrive')).pipedriveCrmProvider(orgId, source);
    case 'attio':
      return (await import('./providers/attio')).attioCrmProvider(orgId, source);
    default:
      throw new Error(`${source.slug} is a ${source.kind} source, which no CRM provider serves yet.`);
  }
}

function describe(sources: FamilySource[]): string {
  return sources.map(s => `${s.slug} (${s.kind})`).join('; ');
}
