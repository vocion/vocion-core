import { describe, expect, it, vi } from 'vitest';
import { startOnboardingConversation } from './onboardingStart';

describe('startOnboardingConversation', () => {
  it('opens the setup conversation the server created', async () => {
    const open = vi.fn();
    await startOnboardingConversation({ start: async () => ({ conversationId: 42 }), open });

    expect(open).toHaveBeenCalledWith('/dashboard/chat?conversation=42');
  });

  it('stays put when another admin opened it first', async () => {
    const open = vi.fn();
    await startOnboardingConversation({ start: async () => ({ conversationId: null }), open });

    expect(open).not.toHaveBeenCalled();
  });

  it('a failed start is logged, and the normal chat keeps working', async () => {
    const open = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await startOnboardingConversation({ start: async () => {
      throw new Error('offline');
    }, open });

    expect(open).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('onboarding: could not open setup', expect.objectContaining({ error: 'offline' }));

    warn.mockRestore();
  });

  it('logs a thrown non-Error as its text, not undefined', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await startOnboardingConversation({ start: async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'gateway timeout';
    }, open: vi.fn() });

    expect(warn).toHaveBeenCalledWith('onboarding: could not open setup', { error: 'gateway timeout' });

    warn.mockRestore();
  });
});
