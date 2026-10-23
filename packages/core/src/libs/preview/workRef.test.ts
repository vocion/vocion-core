import { describe, expect, it } from 'vitest';
import { describeRef } from './describeRef';
import { previewKey } from './types';
import { parseWorkRefId, workPreviewRef } from './workRef';

describe('a conversation\'s work as a preview', () => {
  it('is a view of the conversation, read back from its id', () => {
    const ref = workPreviewRef(12);

    expect(previewKey(ref)).toBe('conversation:12.work');
    expect(parseWorkRefId(ref.id)).toEqual({ conversationId: 12 });
    expect(parseWorkRefId('12')).toBeNull();
    expect(parseWorkRefId('12.sources')).toBeNull();
  });

  it('is named in words, and opens on its conversation', () => {
    expect(describeRef({ type: 'conversation', id: '12.work' })).toEqual({ label: 'Background work', href: '/dashboard/chat?c=12' });
  });
});
