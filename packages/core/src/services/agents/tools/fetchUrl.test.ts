/**
 * fetch_url paging suite (VEERIO-258) — a page longer than one 12,000-char
 * window must be readable to the end via `offset`, with every response
 * (including the first) reporting the page's total length. Covers: the
 * unchanged short-page default, walking a long page to its exact end,
 * asking past the end, landing exactly on a window boundary, and the
 * argument-validation branches (negative, non-numeric, beyond the server
 * cap) — none of which ever calls fetchPage.
 *
 * No live network call: the browse provider registry is mocked and fed a
 * synthetic document built from a repeating digit ruler, so slicing it at
 * any offset is easy to verify by eye.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchPage = vi.fn();

vi.mock('@/libs/tools/browse/registry', () => ({
  getBrowseProvider: () => ({ name: 'mock', requiredEnv: [], isReady: () => true, fetchPage }),
}));

const { fetchUrlTool } = await import('./fetchUrl');

const CTX = {} as RuntimeContext;
const URL = 'https://example.com/listing';
const TITLE = 'Listing Page';
const HEADER = `# ${TITLE}\n${URL}\n\n`;

type Invokable = { invoke: (input: Record<string, unknown>) => Promise<string> };

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

/**
 * Splits a fetch_url response into its window text and its trailer note (the bracketed status line the tool appends after the window).
 * @param result - the raw string fetch_url returned
 */
function splitResponse(result: string): { window: string; trailer: string } {
  expect(result.startsWith(HEADER)).toBe(true);

  const afterHeader = result.slice(HEADER.length);
  const trailerStart = afterHeader.lastIndexOf('\n\n[');
  return {
    window: afterHeader.slice(0, trailerStart),
    trailer: afterHeader.slice(trailerStart),
  };
}

beforeEach(() => {
  fetchPage.mockReset();
  fetchPage.mockResolvedValue(null);
});

describe('fetch_url paging', () => {
  it('leaves a short page (under the 12,000-char window) unchanged, and reports its total length', async () => {
    const content = textOfLength(500);
    fetchPage.mockResolvedValue({ url: URL, title: TITLE, content });

    const result = await theTool().invoke({ url: URL });
    const { window, trailer } = splitResponse(result);

    expect(window).toBe(content);
    expect(trailer).not.toContain('more characters remain');
    expect(trailer).toContain('Total length: 500 characters.');
    expect(fetchPage).toHaveBeenCalledWith(URL);
  });

  it('reads a 56,662-character page to the end in five calls, offset by the value each response suggests, reporting the total on every call', async () => {
    const total = 56_662;
    const content = textOfLength(total);
    fetchPage.mockResolvedValue({ url: URL, title: TITLE, content });
    const tool = theTool();

    let offset = 0;
    let calls = 0;
    let done = false;
    let collected = '';

    while (!done) {
      calls += 1;
      const result = await tool.invoke(offset === 0 ? { url: URL } : { url: URL, offset });
      const { window, trailer } = splitResponse(result);

      expect(trailer).toContain(`Total length: ${total} characters.`);

      collected += window;

      const nextOffsetMatch = trailer.match(/offset: (\d+) to continue/);
      if (nextOffsetMatch) {
        offset = Number(nextOffsetMatch[1]);
      } else {
        expect(trailer).toContain('End of page');

        done = true;
      }
    }

    expect(calls).toBe(5);
    expect(collected).toBe(content);
  });

  it('returns a clear "already past the end" message, still reporting total length, for an offset past the end', async () => {
    const total = 5_000;
    fetchPage.mockResolvedValue({ url: URL, title: TITLE, content: textOfLength(total) });

    const result = await theTool().invoke({ url: URL, offset: 10_000 });

    expect(result).toContain('Already at or past the end');
    expect(result).toContain(`Total length: ${total} characters.`);
  });

  it('lands exactly on the last window with no "more characters" trailer when offset + window equals the total exactly', async () => {
    const total = 24_000; // exactly two 12,000-char windows
    fetchPage.mockResolvedValue({ url: URL, title: TITLE, content: textOfLength(total) });

    const result = await theTool().invoke({ url: URL, offset: 12_000 });
    const { window, trailer } = splitResponse(result);

    expect(window).toHaveLength(12_000);
    expect(trailer).toContain('End of page');
    expect(trailer).not.toContain('more characters remain');
    expect(trailer).toContain(`Total length: ${total} characters.`);
  });

  it('rejects a negative offset without ever calling fetchPage', async () => {
    await expect(theTool().invoke({ url: URL, offset: -1 })).rejects.toThrow();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric offset without ever calling fetchPage', async () => {
    await expect(theTool().invoke({ url: URL, offset: 'twelve-thousand' })).rejects.toThrow();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('rejects an offset beyond the server cap without ever calling fetchPage', async () => {
    await expect(theTool().invoke({ url: URL, offset: 50_000_000 })).rejects.toThrow();
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
