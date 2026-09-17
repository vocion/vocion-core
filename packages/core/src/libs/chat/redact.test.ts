import { describe, expect, it } from 'vitest';

import { failureReport, isEmptyWorkspaceFailure, readerFailure, redactInternalIds } from './redact';

/**
 * The rule: a user-facing error never shows an internal identifier, and the
 * raw text lives in Copy details instead (docs/design/patterns.md → Never).
 */

describe('redactInternalIds', () => {
  it('removes the tenant id and the sentinel slug from the sentence the CEO was shown', () => {
    const raw = 'Error  agent __search__ not found in org proj-2df61364-8d21-4f0b-9a6e-77c1e0a2b911';

    expect(redactInternalIds(raw)).toBe('Error agent [internal] not found in org [id]');
    expect(redactInternalIds(raw)).not.toContain('proj-');
    expect(redactInternalIds(raw)).not.toContain('__search__');
  });

  it('covers the other prefixes that name us rather than the reader', () => {
    expect(redactInternalIds('denied for usr_01H9K3 and acct-9f2c11aa in workspace_7d1e44b2')).toBe('denied for [id] and [id] in [id]');
  });

  it('leaves an ordinary message alone — redaction is not censorship', () => {
    const plain = 'HubSpot returned 429: rate limited, retry in 30s';

    expect(redactInternalIds(plain)).toBe(plain);
  });
});

describe('isEmptyWorkspaceFailure', () => {
  it('recognises the fresh-database case, which is a state and not an error', () => {
    expect(isEmptyWorkspaceFailure('agent __search__ not found in org proj-2df6')).toBe(true);
    expect(isEmptyWorkspaceFailure('HubSpot returned 429')).toBe(false);
  });
});

describe('failureReport', () => {
  it('carries all six fields, unredacted, so it can be pasted into a PR', () => {
    const block = failureReport({
      turnId: 913,
      conversationId: 41,
      at: Date.parse('2026-09-16T10:04:00.000Z'),
      tool: 'task',
      delegate: 'Proposal Writer',
      message: 'agent __search__ not found in org proj-2df61364',
    });

    expect(block).toContain('turn:         913');
    expect(block).toContain('conversation: 41');
    expect(block).toContain('when:         2026-09-16T10:04:00.000Z');
    expect(block).toContain('tool:         task');
    expect(block).toContain('delegate:     Proposal Writer');
    // The whole point of redacting on screen: the operator still gets the id.
    expect(block).toContain('proj-2df61364');
    expect(block).toContain('__search__');
  });

  it('says "unknown" rather than omitting a field it does not have', () => {
    const block = failureReport({ tool: 'hubspot_search', message: 'timed out' });

    expect(block).toContain('turn:         unknown');
    expect(block).toContain('conversation: unknown');
    expect(block).toContain('when:         unknown');
    expect(block).toContain('delegate:     none');
  });
});

/**
 * A configuration identifier is ours, not theirs.
 *
 * Chris, 2026-09-16, reading `TAVILY_API_KEY not configured` on a lead review:
 * "That belongs in admin observability, logs, or developer tooling. It should
 * never leak into a revenue review UX."*
 */
describe('configuration identifiers', () => {
  it('takes the environment variable out of a message a reader will see', () => {
    expect(redactInternalIds('web search provider "tavily" is not configured — set TAVILY_API_KEY.'))
      .not
      .toContain('TAVILY_API_KEY');
  });

  it('leaves a shouted word alone — an underscore is what makes it config', () => {
    expect(redactInternalIds('The MQL never arrived.')).toBe('The MQL never arrived.');
  });

  it('names the capability and never the provider or the variable', () => {
    const reader = readerFailure('web search provider "tavily" is not configured — set TAVILY_API_KEY.');

    expect(reader).toBe('Web search was unavailable for this run.');
    expect(reader).not.toContain('tavily');
    expect(reader).not.toContain('TAVILY_API_KEY');
  });

  it('says "for this run", because thin evidence today is retryable and not a property of the lead', () => {
    expect(readerFailure('browse provider "firecrawl" is not configured — set FIRECRAWL_API_KEY.'))
      .toMatch(/for this run\.$/);
  });

  it('still redacts, rather than inventing a sentence, for a failure it does not recognise', () => {
    const reader = readerFailure('write failed for org proj-2df61364-aaaa in __search__');

    expect(reader).not.toContain('proj-2df61364');
    expect(reader).not.toContain('__search__');
    expect(reader).toContain('write failed');
  });
});
