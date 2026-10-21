import { describe, expect, it } from 'vitest';
import { askedForFromRefs, browserRef } from '@/features/dashboard/chat/composerTags';
import { askedForLine, readAskedFor } from './askedFor';

describe('@browser, the tag that says "do this in the browser"', () => {
  it('travels as a typed field, read off the composer\'s tags and nothing else', () => {
    expect(askedForFromRefs([browserRef()])).toEqual(['browser']);
    expect(askedForFromRefs([{ type: 'source', id: 'browser' }, { type: 'agent', id: 'browser' }])).toEqual([]);
  });

  it('is read on the server as known values only, once each', () => {
    expect(readAskedFor(['browser', 'browser', 'shell', 7])).toEqual(['browser']);
    expect(readAskedFor('browser')).toEqual([]);
    expect(readAskedFor(undefined)).toEqual([]);
  });

  it('tells the model what the person asked for, and nothing when they asked for nothing', () => {
    expect(askedForLine(['browser'])).toContain('browser_task');
    expect(askedForLine([])).toBe('');
  });
});
