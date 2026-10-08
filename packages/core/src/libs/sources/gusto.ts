/**
 * Gusto connector — the capability carrier for the people family's Gusto
 * reads (`services/people/providers/gusto.ts`), and nothing else.
 *
 * Read LIVE and never mirrored: an HR system is where personal data lives,
 * and copying even its work fields into the index would put them in front of
 * an embedding model for nothing a live read does not already answer. So
 * this connector ingests nothing (`syncless`). Registering it buys the login
 * in the vault, a Gusto tile on Connections, `people_list` / `people_get` for
 * agents given the source, and a Test connection that reads one record of
 * each kind.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { testConnectionPersistence } from '@/libs/connect/loginGrant';
import { inspectByListing } from '@/libs/connectors/inspectByListing';
import { InspectInputError } from './inspect';

const gustoConfigSchema = z.object({});

export const gustoConnector: SourceConnector<typeof gustoConfigSchema> = {
  slug: 'gusto',
  name: 'Gusto',
  brand: 'gusto',
  description: 'Payroll and HR, read live: who works here, in which department, who is out, and what each pay run cost in total. Work information only; read-only.',
  icon: 'Users',
  authKind: 'oauth',
  syncless: true,
  configSchema: gustoConfigSchema,
  inspectNote: 'Reads one employee, department, pay run and time-off request. Read-only. Nothing is saved.',

  async inspect({ credentials, savedSource }) {
    const { gustoPeopleProvider } = await import('@/services/people/providers/gusto');
    let provider;
    try {
      provider = await gustoPeopleProvider({ orgId: savedSource?.orgId ?? '', source: { id: savedSource?.sourceId ?? 0, slug: 'gusto', config: {} }, credentials, persistence: testConnectionPersistence('gusto', savedSource) });
    } catch (error) {
      throw new InspectInputError((error as Error).message);
    }
    const company = typeof credentials.companyName === 'string' && credentials.companyName ? `Company: ${credentials.companyName}.` : null;
    return inspectByListing(provider, company);
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by people_list / people_get, never mirrored.
  },
};
