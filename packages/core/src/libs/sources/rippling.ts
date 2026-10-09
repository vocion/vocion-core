/**
 * Rippling connector — the capability carrier for the people family's
 * Rippling reads (`services/people/providers/rippling.ts`), and nothing else.
 *
 * Read LIVE and never mirrored, for the reason Gusto's is (`./gusto.ts`): an
 * HR system's records stay in the HR system. Registering it buys the token
 * in the vault, a Rippling tile on Connections, `people_list` /
 * `people_get` for agents given the source, and a Test connection that
 * reads one record of each kind.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { inspectByListing } from '@/libs/connectors/inspectByListing';
import { InspectInputError } from './inspect';

const ripplingConfigSchema = z.object({});

export const ripplingConnector: SourceConnector<typeof ripplingConfigSchema> = {
  slug: 'rippling',
  name: 'Rippling',
  brand: 'rippling',
  description: 'HR, read live: who works here, their title, department and manager, and who is on leave. Work information only; read-only.',
  icon: 'Users',
  category: 'finance-people',
  authKind: 'apikey',
  syncless: true,
  configSchema: ripplingConfigSchema,
  inspectNote: 'Reads one employee, department and leave request. Read-only. Nothing is saved.',

  async inspect({ credentials }) {
    const { ripplingPeopleProvider } = await import('@/services/people/providers/rippling');
    let provider;
    try {
      provider = ripplingPeopleProvider({ orgId: '', source: { id: 0, slug: 'rippling', config: {} }, credentials, persistence: { kind: 'never' } });
    } catch (error) {
      throw new InspectInputError((error as Error).message);
    }
    return inspectByListing(provider);
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by people_list / people_get, never mirrored.
  },
};
