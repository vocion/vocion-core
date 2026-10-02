/**
 * The URL after an automatic post-login send: the connect outcome goes, the
 * conversation stays, so a reload resumes the thread without sending again.
 */
import { describe, expect, it } from 'vitest';
import { withoutConnectParams } from './useSendOnConnectReturn';

describe('withoutConnectParams', () => {
  it('drops the connect outcome and keeps the conversation and any other param', () => {
    expect(withoutConnectParams('?conversation=7&connect=ok&connector=github&source=github&reason=x&preview=a')).toBe('?conversation=7&preview=a');
  });

  it('leaves no question mark when nothing else remains', () => {
    expect(withoutConnectParams('?connect=error&reason=access_denied&connector=slack')).toBe('');
  });
});
