/**
 * fetch_url suite (VEERIO-258) — the tool returns a page's full extracted
 * text on every call, with no character cap and no truncation. Covers: a
 * short page returned whole, a long page (well over the old 12,000-char
 * cap) returned whole with nothing truncated, a page with no readable
 * text, a not-configured provider, a fetch error, and two regression
 * guards — the schema takes only `url` (no `offset`/`maxChars` snuck back
 * in) and the tool's own description says nothing about paging.
 *
 * No live network call: the browse provider registry is mocked and fed a
 * synthetic document built from a repeating digit ruler, so its exact
 * content is easy to assert on.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderNotConfiguredError } from '@/libs/tools/types';

const fetchPage = vi.fn();

vi.mock('@/libs/tools/browse/registry', () => ({
  getBrowseProvider: () => ({ name: 'mock', requiredEnv: [], isReady: () => true, fetchPage }),
}));

const { fetchUrlTool } = await import('./fetchUrl');

const CTX = {} as RuntimeContext;
const URL = 'https://example.com/listing';
const TITLE = 'Listing Page';

type Invokable = {
  invoke: (input: Record<string, unknown>) => Promise<string>;
  description: string;
  schema: { shape: Record<string, unknown> };
};

function theTool(): Invokable {
  return fetchUrlTool(CTX) as unknown as Invokable;
}

/**
 * Builds a string of exactly `length` characters from a repeating digit ruler.
 * @param length - the exact character count the returned string must have
 */
function textOfLength(length: number): string {
  let out = '';
  while (out.length < length) {
    out += '0123456789';
  }
  return out.slice(0, length);
}

beforeEach(() => {
  fetchPage.mockReset();
});

describe('fetch_url', () => {
  it('returns a short page whole, with its total length reported', async () => {
    const content = textOfLength(500);
    fetchPage.mockResolvedValue({ url: URL, title: TITLE, content });

    const result = await theTool().invoke({ url: URL });

    expect(result).toContain(content);
    expect(result).toContain('Total length: 500 characters.');
    expect(fetchPage).toHaveBeenCalledWith(URL);
  });

  it('returns a 56,662-character page whole in one call, with nothing truncated and no paging wording left anywhere', async () => {
    const total = 56_662; // well over the old 12,000-char cap
    const content = textOfLength(total);
    fetchPage.mockResolvedValue({ url: URL, title: TITLE, content });

    const result = await theTool().invoke({ url: URL });

    expect(result).toContain(content);
    expect(result).toContain(`Total length: ${total} characters.`);
    expect(result).not.toContain('truncated');
    expect(result).not.toContain('offset');
  });

  it('reports no readable text without throwing, when the provider finds nothing', async () => {
    fetchPage.mockResolvedValue(null);

    const result = await theTool().invoke({ url: URL });

    expect(result).toBe(`Fetched ${URL} but found no readable text.`);
  });

  it('reports plainly when browse is not configured, instead of throwing the turn away', async () => {
    fetchPage.mockRejectedValue(new ProviderNotConfiguredError('browse', 'firecrawl', ['FIRECRAWL_API_KEY']));

    const result = await theTool().invoke({ url: URL });

    expect(result).toContain('Browse is not configured');
  });

  it('reports a fetch error as data, instead of throwing the turn away', async () => {
    fetchPage.mockRejectedValue(new Error('HTTP 404 fetching the page'));

    const result = await theTool().invoke({ url: URL });

    expect(result).toBe(`Could not fetch ${URL}: HTTP 404 fetching the page`);
  });

  it('only accepts `url` — no `offset`/`maxChars` argument survives in the schema', () => {
    const schemaKeys = Object.keys(theTool().schema.shape);

    expect(schemaKeys).toEqual(['url']);
  });

  it('never mentions paging, offsets or truncation in its own description', () => {
    const description = theTool().description.toLowerCase();

    expect(description).not.toContain('offset');
    expect(description).not.toContain('paging');
    expect(description).not.toContain('window');
    expect(description).toContain('never truncated');
  });
});
