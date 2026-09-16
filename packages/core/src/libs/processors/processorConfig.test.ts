/**
 * The model-free half of a processor: its config schema and the budget its
 * `limits` block can lower.
 *
 * Both are what an operator's YAML actually meets, and both fail in the same
 * expensive way when they are lenient, a typo'd key silently dropped is a
 * rule the operator believes is in force and is not, and a cap a manifest can
 * RAISE is no cap at all. Nothing here imports the model stage, which is the
 * point: apply-time validation must never load it.
 */
import { describe, expect, it } from 'vitest';
import { createSyncBudget, SYNC_BUDGET_DEFAULTS } from './budget';
import { candidateExtractorConfigSchema } from './candidateExtractor/config';
import { getProcessor, processorConfigSchema } from './registry';

/** The smallest config the extractor accepts. */
const minimal = {
  objectType: 'event-candidate',
  agentSlug: 'event-ingestion-lead',
  dedupOn: ['title', 'startDate', 'venueName'],
  titleFrom: 'title',
  promptFragment: 'Only list events open to the public.',
};

describe('candidate-extractor config', () => {
  it('fills in the defaults a manifest did not state', () => {
    const parsed = candidateExtractorConfigSchema.parse(minimal);

    expect(parsed.maxRecordsPerDocument).toBe(25);
    expect(parsed.minConfidence).toBe(0.5);
    expect(parsed.recurrenceHorizonDays).toBe(60);
    expect(parsed.onViolation).toBe('dropValue');
    expect(parsed.dryRun).toBe(false);
  });

  it('rejects a key it does not know, at the top level', () => {
    expect(() => candidateExtractorConfigSchema.parse({ ...minimal, maxRecordsPerDoc: 10 }))
      .toThrow(/maxRecordsPerDoc/);
  });

  it('rejects a key it does not know inside a nested block', () => {
    expect(() => candidateExtractorConfigSchema.parse({
      ...minimal,
      knownCandidates: { keyedBy: 'venueName', dateField: 'startDate', horizon: 30 },
    })).toThrow();
  });

  it('refuses anything path-shaped where a field name belongs', () => {
    // No knob in this schema is ever a filesystem path, that is
    // `_manifestDir`'s job, for connectors, so `../` must not parse into one.
    expect(() => candidateExtractorConfigSchema.parse({ ...minimal, titleFrom: '../../etc/passwd' })).toThrow();
    expect(() => candidateExtractorConfigSchema.parse({ ...minimal, imageFrom: './image' })).toThrow();
    expect(() => candidateExtractorConfigSchema.parse({ ...minimal, defaults: { '../x': 'y' } })).toThrow();
  });

  it('accepts a timezone, which is the one value that carries a slash', () => {
    const parsed = candidateExtractorConfigSchema.parse({ ...minimal, timezone: 'America/New_York' });

    expect(parsed.timezone).toBe('America/New_York');
    expect(() => candidateExtractorConfigSchema.parse({ ...minimal, timezone: '../../etc' })).toThrow();
  });

  it('accepts the full knob set a tenant configures', () => {
    const parsed = candidateExtractorConfigSchema.parse({
      ...minimal,
      learningSteps: ['event-extraction'],
      timezone: 'America/New_York',
      imageFrom: 'imageUrl',
      followLinks: { enabled: true, maxPerDocument: 5, urlPattern: 'tickets' },
      defaults: { venueName: 'The Fillmore', venueCity: 'Burlington' },
      knownCandidates: { keyedBy: 'venueName', dateField: 'startDate' },
      dropIfPast: { field: 'startDate', keepIfField: 'endDate' },
      allowedValues: { categories: ['music', 'theatre'] },
      onViolation: 'dropRecord',
      mustAppearInDocument: ['price'],
      collapseWithinDocument: true,
      resolveAgainst: [{
        objectType: 'venue-candidate',
        matchFields: { venueName: 'name', venueCity: 'city' },
        normalise: { venueName: { dropWords: ['the'], abbreviations: { '&': 'and' } } },
      }],
      relatedProposals: [{
        objectType: 'venue-candidate',
        fromFields: { name: 'venueName', city: 'venueCity' },
        dedupOn: ['name', 'city'],
        writeRunIdTo: 'venueCandidateRun',
      }],
      seriesLabel: {
        sameOn: ['title', 'venueName'],
        differsOn: 'startDate',
        evidenceField: 'recurrence',
        flagField: 'seriesMatch',
        keyField: 'seriesKey',
      },
      limits: { maxModelCalls: 5 },
      dryRun: true,
    });

    expect(parsed.knownCandidates?.maxChars).toBe(4000);
    expect(parsed.seriesLabel?.maxAnchors).toBe(40);
    expect(parsed.resolveAgainst?.[0]?.copyOnMatch).toBe(true);
  });

  it('accepts seriesLabel without keyField and rejects an unknown key', () => {
    // The group key is opt-in: a tenant that configures none gets the label
    // and no key, which is the shape every existing source is in. And the
    // block is `.strict()`, so a typo has to fail rather than be ignored.
    const parsed = candidateExtractorConfigSchema.parse({
      ...minimal,
      seriesLabel: { sameOn: ['title'], differsOn: 'startDate', flagField: 'seriesMatch' },
    });

    expect(parsed.seriesLabel?.keyField).toBeUndefined();
    expect(() => candidateExtractorConfigSchema.parse({
      ...minimal,
      seriesLabel: { sameOn: ['title'], differsOn: 'startDate', flagField: 'seriesMatch', keyFeild: 'seriesKey' },
    })).toThrow(/keyFeild/);
  });

  it('rejects a keyField that collides with flagField or evidenceField', () => {
    // Three jobs on three fields: the label sentence, the group key, and the
    // recurrence text an anchor is recognised by. Aim two at one field and the
    // later write erases the earlier one with nothing said, which is the
    // failure `.strict()` prevents one level up.
    expect(() => candidateExtractorConfigSchema.parse({
      ...minimal,
      seriesLabel: { sameOn: ['title'], differsOn: 'startDate', flagField: 'seriesMatch', keyField: 'seriesMatch' },
    })).toThrow(/flagField/);
    expect(() => candidateExtractorConfigSchema.parse({
      ...minimal,
      seriesLabel: { sameOn: ['title'], differsOn: 'startDate', evidenceField: 'recurrence', flagField: 'seriesMatch', keyField: 'recurrence' },
    })).toThrow(/evidenceField/);
  });

  it('caps followLinks at twenty pages a document', () => {
    expect(() => candidateExtractorConfigSchema.parse({
      ...minimal,
      followLinks: { enabled: true, maxPerDocument: 50 },
    })).toThrow();
  });
});

describe('the processor registry', () => {
  it('exposes the extractor config schema without loading the model stage', () => {
    expect(getProcessor('candidate-extractor')).toBeDefined();
    expect(processorConfigSchema('candidate-extractor')).toBe(candidateExtractorConfigSchema);
    expect(getProcessor('candidate-extractor')?.name).toBe('Candidate extractor');
  });

  it('knows nothing about a slug it does not have', () => {
    expect(getProcessor('no-such-processor')).toBeUndefined();
    expect(processorConfigSchema('no-such-processor')).toBeUndefined();
    expect(getProcessor('no-such-processor')).toBeUndefined();
  });
});

describe('the sync budget', () => {
  it('lets a manifest lower a cap', () => {
    const budget = createSyncBudget({ limits: { maxModelCalls: 2 } });

    expect(budget.caps.maxModelCalls).toBe(2);
    expect(budget.take('maxModelCalls')).toBe(true);
    expect(budget.take('maxModelCalls')).toBe(true);
    expect(budget.take('maxModelCalls')).toBe(false);
  });

  it('ignores a manifest asking to raise one', () => {
    const budget = createSyncBudget({ limits: { maxModelCalls: 10_000, maxProposalsPerSync: 99_999 } });

    expect(budget.caps.maxModelCalls).toBe(SYNC_BUDGET_DEFAULTS.maxModelCalls);
    expect(budget.caps.maxProposalsPerSync).toBe(SYNC_BUDGET_DEFAULTS.maxProposalsPerSync);
  });

  it('lets a source lower modelTimeoutMs but never raise it', () => {
    // The deadline is a cap like any other: the 60s default is the ceiling,
    // and it is 60s because 20s was below what a healthy call costs and so
    // abandoned every real extraction mid-flight.
    expect(SYNC_BUDGET_DEFAULTS.modelTimeoutMs).toBe(60_000);
    expect(createSyncBudget({ limits: { modelTimeoutMs: 30_000 } }).caps.modelTimeoutMs).toBe(30_000);
    expect(createSyncBudget({ limits: { modelTimeoutMs: 600_000 } }).caps.modelTimeoutMs).toBe(60_000);
    expect(candidateExtractorConfigSchema.parse({
      ...minimal,
      limits: { modelTimeoutMs: 30_000 },
    }).limits?.modelTimeoutMs).toBe(30_000);
  });

  it('sizes the sync caps for one model call per document, and still only lets a source lower them', () => {
    // A document is one feed entry or one detail page now, not one listing
    // page, so the cap is per document. The second dev shadow (2026-09-15)
    // crawled 59 detail pages on one source, spent all 25 calls and skipped 44
    // documents; the fourth (2026-09-16, Higher Ground, 117 documents) spent
    // 400,000 tokens after 88 calls at about 4,500 a detail page and left 29
    // documents unread, so the token cap is 150 calls at the measured cost.
    expect(SYNC_BUDGET_DEFAULTS.maxModelCalls).toBe(150);
    expect(SYNC_BUDGET_DEFAULTS.maxInputTokensPerSync).toBe(800_000);
    expect(createSyncBudget({ limits: { maxModelCalls: 40 } }).caps.maxModelCalls).toBe(40);
    expect(createSyncBudget({ limits: { maxInputTokensPerSync: 1_000_000 } }).caps.maxInputTokensPerSync).toBe(800_000);
    expect(createSyncBudget({ limits: { maxInputTokensPerSync: 200_000 } }).caps.maxInputTokensPerSync).toBe(200_000);
  });

  it('ignores a limits value that is not a number at all', () => {
    // The blob is read back from the database, where an older writer may have
    // left anything at all.
    const budget = createSyncBudget({ limits: { maxPages: 'lots' } });

    expect(budget.caps.maxPages).toBe(SYNC_BUDGET_DEFAULTS.maxPages);
  });

  it('reports every refusal, and the wall clock, to the caller', () => {
    const hits: string[] = [];
    let clock = 0;
    const budget = createSyncBudget({
      limits: { maxModelCalls: 0 },
      onCapHit: cap => hits.push(cap),
      now: () => clock,
    });

    expect(budget.take('maxModelCalls')).toBe(false);
    expect(budget.take('maxModelCalls')).toBe(false);
    expect(budget.outOfTime()).toBe(false);

    clock = SYNC_BUDGET_DEFAULTS.maxWallClockMs;

    expect(budget.outOfTime()).toBe(true);
    // Every hit, so the run can count them; recording one line per cap is the
    // caller's job.
    expect(hits).toEqual(['maxModelCalls', 'maxModelCalls', 'maxWallClockMs']);
  });

  it('takes the slot before the work, so a spent cap stays spent', () => {
    const budget = createSyncBudget({ limits: { maxProposalsPerSync: 3 } });

    expect(budget.take('maxProposalsPerSync', 2)).toBe(true);
    expect(budget.take('maxProposalsPerSync', 2)).toBe(false);
    expect(budget.spent.maxProposalsPerSync).toBe(2);
  });
});
