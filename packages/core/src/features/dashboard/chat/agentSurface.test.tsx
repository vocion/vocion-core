import { describe, expect, it } from 'vitest';
import { AGENT_SURFACE_EVENT, requestAgentSurface } from './agentSurface';

describe('requestAgentSurface', () => {
  it('returns false when no surface is mounted to claim it', () => {
    expect(requestAgentSurface()).toBe(false);
  });

  it('returns true when a mounted surface claims the request', () => {
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener(AGENT_SURFACE_EVENT, claim);
    try {
      expect(requestAgentSurface()).toBe(true);
    } finally {
      window.removeEventListener(AGENT_SURFACE_EVENT, claim);
    }
  });
});
