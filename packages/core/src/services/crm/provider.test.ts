/**
 * Which CRM answers: the source named, else the workspace's only one; with
 * none or several the error names what is connected, so an agent can say
 * which CRM it can and cannot reach. Sources are invented.
 */
import { describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({ rows: [] as Array<{ id: number; slug: string; kind: string; config: Record<string, unknown>; apiTokenId: string | null }> }));
vi.mock('@/libs/connectors/families', () => ({ familySourcesForOrg: async () => sources.rows }));
vi.mock('./providers/salesforce', () => ({ salesforceCrmProvider: async (_org: string, s: { slug: string }) => ({ kind: 'salesforce', sourceSlug: s.slug }) }));
vi.mock('./providers/pipedrive', () => ({ pipedriveCrmProvider: async (_org: string, s: { slug: string }) => ({ kind: 'pipedrive', sourceSlug: s.slug }) }));

const { crmProviderFor } = await import('./provider');

const SF = { id: 1, slug: 'salesforce', kind: 'salesforce', config: {}, apiTokenId: null };
const PD = { id: 2, slug: 'pipedrive-emea', kind: 'pipedrive', config: {}, apiTokenId: null };

describe('crmProviderFor', () => {
  it('says no CRM is connected, and where to connect one', async () => {
    sources.rows = [];

    await expect(crmProviderFor('org_1')).rejects.toThrow(/no CRM connected.*\/dashboard\/connectors/);
  });

  it('answers with the workspace\'s only CRM', async () => {
    sources.rows = [SF];

    await expect(crmProviderFor('org_1')).resolves.toMatchObject({ kind: 'salesforce', sourceSlug: 'salesforce' });
  });

  it('asks which one when there are several, and serves the one named', async () => {
    sources.rows = [SF, PD];

    await expect(crmProviderFor('org_1')).rejects.toThrow(/2 CRM sources; name one.*salesforce \(salesforce\); pipedrive-emea \(pipedrive\)/);
    await expect(crmProviderFor('org_1', { sourceSlug: 'pipedrive-emea' })).resolves.toMatchObject({ kind: 'pipedrive' });
    await expect(crmProviderFor('org_1', { sourceSlug: 'attio' })).rejects.toThrow(/No CRM source named attio/);
  });
});
