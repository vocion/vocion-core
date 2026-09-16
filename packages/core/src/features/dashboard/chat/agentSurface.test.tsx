import { describe, expect, it, vi } from 'vitest';
import { AGENT_SURFACE_EVENT, agentSurfaceRequestOf, CHAT_HANDOFF_KEY, openAgentSurface, requestAgentSurface } from './agentSurface';

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

  it('carries the intent on the event for the surface to read', () => {
    let seen: ReturnType<typeof agentSurfaceRequestOf> | null = null;
    const claim = (e: Event) => {
      seen = agentSurfaceRequestOf(e);
      e.preventDefault();
    };
    window.addEventListener(AGENT_SURFACE_EVENT, claim);
    try {
      const ctx = { path: '/dashboard/briefings', title: 'Briefings', record: { type: 'briefing' as const, id: '61' }, openedFrom: true as const };

      expect(requestAgentSurface({ prompt: 'Do this: nudge StreetTalk', context: ctx, send: true })).toBe(true);
      expect(seen).toEqual({ prompt: 'Do this: nudge StreetTalk', context: ctx, send: true });
    } finally {
      window.removeEventListener(AGENT_SURFACE_EVENT, claim);
    }
  });

  it('reads a plain legacy request as an empty intent', () => {
    expect(agentSurfaceRequestOf(new Event(AGENT_SURFACE_EVENT))).toEqual({});
  });
});

describe('openAgentSurface', () => {
  it('is claimed synchronously when a surface is mounted and never navigates', () => {
    const claim = (e: Event) => e.preventDefault();
    const navigate = vi.fn();
    window.addEventListener(AGENT_SURFACE_EVENT, claim);
    try {
      expect(openAgentSurface({ prompt: 'hi' }, navigate)).toBe('claimed');
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(AGENT_SURFACE_EVENT, claim);
    }
  });

  it('falls back to the full-page chat with a stashed handoff when nothing claims it', () => {
    sessionStorage.removeItem(CHAT_HANDOFF_KEY);
    const navigate = vi.fn();
    const ctx = { path: '/dashboard/briefings', title: 'Briefings', record: { type: 'briefing' as const, id: '61', label: 'Revenue Briefing' }, selection: { text: 'StreetTalk', quote: true as const } };

    expect(openAgentSurface({ prompt: 'what about this?', context: ctx, agentSlug: 'revenue-lead', fallbackContext: '# brief' }, navigate)).toBe('navigated');
    expect(navigate).toHaveBeenCalledWith('/dashboard/chat?agent=revenue-lead&prompt=what+about+this%3F');

    const stash = JSON.parse(sessionStorage.getItem(CHAT_HANDOFF_KEY) ?? '{}');

    expect(stash).toMatchObject({ question: 'what about this?', contextTitle: 'Revenue Briefing', context: '# brief', excerpt: 'StreetTalk', agentSlug: 'revenue-lead' });
    expect(stash.pageContext).toEqual(ctx);

    sessionStorage.removeItem(CHAT_HANDOFF_KEY);
  });

  it('keeps a send-now prompt off the URL (the stash carries it) and stashes nothing for an empty open', () => {
    sessionStorage.removeItem(CHAT_HANDOFF_KEY);
    const navigate = vi.fn();
    openAgentSurface({ prompt: 'Do this: x', send: true }, navigate);

    expect(navigate).toHaveBeenCalledWith('/dashboard/chat');
    expect(sessionStorage.getItem(CHAT_HANDOFF_KEY)).not.toBeNull();

    sessionStorage.removeItem(CHAT_HANDOFF_KEY);

    openAgentSurface({}, navigate);

    expect(sessionStorage.getItem(CHAT_HANDOFF_KEY)).toBeNull();
  });
});
