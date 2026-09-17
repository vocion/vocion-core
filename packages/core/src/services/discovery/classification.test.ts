/**
 * The classifier's output CONTRACT, under test — because the defect this
 * replaces was not a wrong number, it was a number whose meaning nobody had
 * written down (`docs/specs/discovery-ledger-v2.md`).
 */
import { describe, expect, it } from 'vitest';
import {
  normaliseReasonCode,
  readClassification,
  REASON_CODES,
  recommendedAction,
  routeClassification,
} from './classification';

const T = { discoveryThreshold: 0.6, readyThreshold: 0.75 };

const stated = (over: Record<string, unknown> = {}) => readClassification({
  confidenceSemantics: 'stated-class',
  classification: 'discovery',
  classificationConfidence: 0.9,
  proposalReadiness: 'proposal-ready',
  proposalReadinessConfidence: 0.9,
  reasonCode: 'first-sales-conversation',
  reasonCodeFallback: false,
  reasonSummary: 'First conversation with a new buyer.',
  reasoning: 'long form',
  ...over,
} as never)!;

describe('readClassification', () => {
  it('reads a stated-class row with both confidences intact', () => {
    const c = stated();

    expect(c).toMatchObject({
      semantics: 'stated-class',
      classification: 'discovery',
      classificationConfidence: 0.9,
      proposalReadiness: 'proposal-ready',
    });
  });

  it('reads a legacy row as a verdict with NO confidence, and keeps the raw numbers labelled', () => {
    // The whole point: the old prompt admitted two readings of this number, so
    // the reader refuses to assert either. It does not halve it, invert it, or
    // pick the reading that makes the row look right.
    const c = readClassification({
      isDiscovery: false,
      isDiscoveryConfidence: 0.95,
      proposalReady: false,
      proposalReadyConfidence: 0.1,
      reasoning: 'Not a discovery call.',
    })!;

    expect(c.semantics).toBe('legacy');
    expect(c.classification).toBe('not-discovery');
    expect(c.classificationConfidence).toBeNull();
    expect(c.proposalReadinessConfidence).toBeNull();
    expect(c.legacyScores).toEqual({ isDiscoveryConfidence: 0.95, proposalReadyConfidence: 0.1 });
    // No reason code is invented for a row written before reason codes existed.
    expect(c.reasonCode).toBeNull();
  });

  it('returns null for an unassessed row', () => {
    expect(readClassification(null)).toBeNull();
  });
});

describe('routeClassification', () => {
  it('generates only for a confident discovery call that is confidently ready', () => {
    expect(routeClassification(stated(), T)).toBe('generate');
    expect(routeClassification(stated({ proposalReadinessConfidence: 0.5 }), T)).toBe('confirm');
  });

  it('drops a CONFIDENT not-discovery', () => {
    expect(routeClassification(stated({ classification: 'not-discovery', classificationConfidence: 0.95 }), T)).toBe('drop');
  });

  it('sends every class held below the threshold to a person, not to drop', () => {
    // The threshold now means what its name says: below it we are not sure
    // enough of the class we stated, whichever class that is.
    expect(routeClassification(stated({ classificationConfidence: 0.4 }), T)).toBe('confirm');
    expect(routeClassification(stated({ classification: 'not-discovery', classificationConfidence: 0.4 }), T)).toBe('confirm');
  });

  it('routes `uncertain` to human review however confident it is about being unsure', () => {
    expect(routeClassification(stated({ classification: 'uncertain', classificationConfidence: 0.99 }), T)).toBe('confirm');
  });

  it('routes a legacy row on its boolean alone — the number has no scale to compare against', () => {
    const high = readClassification({ isDiscovery: false, isDiscoveryConfidence: 0.95, proposalReady: false, proposalReadyConfidence: 0.1, reasoning: '' })!;
    const low = readClassification({ isDiscovery: false, isDiscoveryConfidence: 0.05, proposalReady: false, proposalReadyConfidence: 0.1, reasoning: '' })!;

    expect(routeClassification(high, T)).toBe('drop');
    expect(routeClassification(low, T)).toBe('drop');
  });
});

describe('reason codes', () => {
  it('has exactly the eight the spec lists', () => {
    expect([...REASON_CODES]).toEqual([
      'first-sales-conversation',
      'existing-opportunity',
      'internal-meeting',
      'customer-delivery-call',
      'follow-up-discovery',
      'diligence',
      'no-buyer-present',
      'insufficient-evidence',
    ]);
  });

  it('accepts a code from the set, tolerating spacing and case', () => {
    expect(normaliseReasonCode('Existing Opportunity')).toEqual({ code: 'existing-opportunity', fallback: false });
    expect(normaliseReasonCode('internal_meeting')).toEqual({ code: 'internal-meeting', fallback: false });
  });

  it('falls back to insufficient-evidence for anything else AND flags it, never inventing a code', () => {
    expect(normaliseReasonCode('vendor-check-in')).toEqual({ code: 'insufficient-evidence', fallback: true });
    expect(normaliseReasonCode(undefined)).toEqual({ code: 'insufficient-evidence', fallback: true });
  });
});

describe('recommendedAction', () => {
  it('names the action, which is a different dimension from the route that produced it', () => {
    expect(recommendedAction('generate')).toBe('generate-proposal');
    expect(recommendedAction('confirm')).toBe('continue-discovery');
    expect(recommendedAction('drop')).toBe('no-action');
    expect(recommendedAction(null)).toBeNull();
  });
});
