/**
 * Workday connector — the capability carrier for the people family's
 * Workday reads (`services/people/providers/workday.ts`), and nothing else.
 *
 * Read LIVE and never mirrored, for the reason Gusto's is (`./gusto.ts`).
 * The source names the custom reports to read (Report-as-a-Service); the
 * integration user's sign-in is the credential. Test connection reads each
 * named report once.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { inspectByListing } from '@/libs/connectors/inspectByListing';
import { InspectInputError } from './inspect';

const workdayConfigSchema = z.object({
  /** The workers report, `<owner>/<report name>` or its whole web service URL. */
  workersReport: z.string().min(1),
  /** Optional: a time off report, the same way. */
  timeOffReport: z.string().optional(),
});

export const workdayConnector: SourceConnector<typeof workdayConfigSchema> = {
  slug: 'workday',
  name: 'Workday',
  brand: 'workday',
  description: 'HR, read live from the custom reports you name: who works here, their title, organization and manager, and who is out. Work information only; read-only.',
  icon: 'Users',
  category: 'finance-people',
  authKind: 'apikey',
  syncless: true,
  configSchema: workdayConfigSchema,
  inspectNote: 'Reads each report the source names, once. Read-only. Nothing is saved.',

  async inspect({ config, credentials }) {
    const { workdayPeopleProvider } = await import('@/services/people/providers/workday');
    let provider;
    try {
      provider = workdayPeopleProvider({ orgId: '', source: { id: 0, slug: 'workday', config }, credentials, persistence: { kind: 'never' } });
    } catch (error) {
      throw new InspectInputError((error as Error).message);
    }
    return inspectByListing(provider, typeof config.workersReport === 'string' && config.workersReport ? null : 'Name the workers report in the source\'s settings.');
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by people_list / people_get, never mirrored.
  },
};
