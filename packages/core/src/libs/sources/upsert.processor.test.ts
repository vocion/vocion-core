/**
 * The cross-field checks a source's `processor` block gets at apply time.
 *
 * Zod can only say a knob is a field NAME. Whether that name is one of the
 * record's identity fields is a question about the rest of the config, and it
 * is the difference between a rule that runs and a rule that silently compares
 * against undefined: both the known-cards block and the sibling rule read
 * dedup-key SEGMENTS, found by the field's position in `dedupOn`. An operator
 * whose rule matches nothing at all should hear about it when they apply the
 * manifest, not never.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { upsertSourceRow } = await import('./upsert');

const ORG = 'org_processor_checks';

const known = { learningSteps: new Set<string>(), agentSlugs: new Set(['event-ingestion-lead']) };

/**
 * The extractor config a venue source declares.
 * @param over - The knobs this case overrides.
 */
function processorConfig(over: Record<string, unknown> = {}) {
  return {
    objectType: 'event-candidate',
    agentSlug: 'event-ingestion-lead',
    dedupOn: ['title', 'startDate', 'venueName'],
    titleFrom: 'title',
    promptFragment: 'Only public events.',
    ...over,
  };
}

/**
 * Apply one source, without writing it.
 * @param config - The processor config under test.
 */
function apply(config: Record<string, unknown>) {
  return upsertSourceRow(ORG, {
    slug: 'higher-ground',
    kind: 'web',
    config: { urls: ['https://highergroundmusic.com/events'] },
    enabled: true,
    processor: { slug: 'candidate-extractor', config },
  }, { known, dryRun: true });
}

describe('processor cross-field validation', () => {
  it('accepts a config whose identity-relative knobs all name dedupOn fields', async () => {
    const outcome = await apply(processorConfig({
      knownCandidates: { keyedBy: 'venueName', dateField: 'startDate' },
      seriesLabel: { sameOn: ['title', 'venueName'], differsOn: 'startDate', flagField: 'seriesMatch', keyField: 'seriesKey' },
    }));

    // `dateField`, `flagField` and `keyField` are ordinary payload fields, not
    // identity, so they are deliberately not held to `dedupOn`.
    expect(outcome.outcome).toBe('created');
  });

  it('refuses a knownCandidates key that is not part of the identity', async () => {
    // `knownCards.ts` has said "validated at apply time" since it shipped, and
    // until now it was not: the run-time belt returns an empty block, so the
    // operator gets no known cards and no explanation.
    await expect(apply(processorConfig({
      knownCandidates: { keyedBy: 'venueCity', dateField: 'startDate' },
    }))).rejects.toThrow(/venueCity.*knownCandidates\.keyedBy/);
  });

  it('refuses a sameOn field that is not part of the identity', async () => {
    await expect(apply(processorConfig({
      seriesLabel: { sameOn: ['title', 'venueCity'], differsOn: 'startDate', flagField: 'seriesMatch' },
    }))).rejects.toThrow(/venueCity.*seriesLabel\.sameOn/);
  });

  it('refuses a differsOn field that is not part of the identity', async () => {
    // This one fails loudest at run time: `findAnchor` returns null on a
    // missing index, so every record loses its label with no counter moving.
    await expect(apply(processorConfig({
      seriesLabel: { sameOn: ['title'], differsOn: 'doorsAt', flagField: 'seriesMatch' },
    }))).rejects.toThrow(/doorsAt.*seriesLabel\.differsOn/);
  });

  it('refuses a keyField that is part of the identity', async () => {
    // The mirror image of the three above, and the only knob that has to be
    // OUTSIDE `dedupOn`: the label stage writes this field before the proposal
    // is filed, so an identity field here would change the record's own dedup
    // key on the way past, and every occurrence would key on its group instead
    // of itself.
    await expect(apply(processorConfig({
      seriesLabel: { sameOn: ['title'], differsOn: 'startDate', flagField: 'seriesMatch', keyField: 'venueName' },
    }))).rejects.toThrow(/venueName.*seriesLabel\.keyField/);
  });

  it('still refuses an unknown agent, which is the check this one was modelled on', async () => {
    await expect(apply(processorConfig({ agentSlug: 'nobody' }))).rejects.toThrow(/unknown agent/);
  });
});
