import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withUsage } from './usage.mjs';

test('usage that did not land is put back as it was, or summed beside usage reported since', () => {
  const a = { model: 'm', inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, cents: 352 };
  assert.equal(withUsage(null, null), null);
  assert.equal(withUsage(null, a), a);
  assert.equal(withUsage(a, null), a);
  assert.deepEqual(withUsage(a, { model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cents: 8 }), { model: 'm', inputTokens: 11, outputTokens: 3, cacheReadTokens: 5, cents: 360 });
});
