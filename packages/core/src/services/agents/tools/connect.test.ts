/**
 * The one structural change, tested where it matters: the model sees a tool,
 * and calling it produces a typed event core owns rather than a sentence the
 * model invented.
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { Capability } from '../capabilityLedger';
import type { AgentEvent, RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { connectStub, scopesFor } from './connect';

// The intent write is Phase 4's; this suite is about the stub's shape and the
// event it emits, so the row is stubbed and covered in `connectionIntent`.
vi.mock('../connectionIntent', () => ({ saveIntent: vi.fn(async () => 77) }));
// Adoption counting is fire-and-forget and has its own coverage.
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));
// The queue write outside chat — asserted here by call, executed elsewhere.
const proposeAction = vi.fn(async () => ({ runId: 1, status: 'pending' as const }));
vi.mock('@/services/ActionService', () => ({ proposeAction }));

const REAL = tool(
  async () => 'real data',
  {
    name: 'list_events',
    description: 'List calendar events in a window.',
    schema: z.object({ timeMin: z.string(), timeMax: z.string() }),
  },
) as StructuredToolInterface;

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    slug: 'google-calendar',
    name: 'Google Calendar',
    icon: 'Calendar',
    identity: 'personal',
    authKind: 'oauth',
    state: { kind: 'connectable', scope: 'user', authKind: 'oauth' },
    workspaceGrantAvailable: false,
    ...overrides,
  };
}

function ctxFor(events: AgentEvent[]): RuntimeContext {
  return {
    orgId: 'org_1',
    actor: { kind: 'user', id: 'user_jamie' },
    agentSlug: 'revenue-lead',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: e => events.push(e),
    citationSeq: { current: 0 },
  };
}

describe('connectStub', () => {
  it('keeps the name and the schema, so the model cannot tell it apart when choosing', () => {
    const stub = connectStub(REAL, capability(), ctxFor([]));

    expect(stub.name).toBe('list_events');
    expect(stub.schema).toBe(REAL.schema);
    // Only the description differs — it says the tool is not connected and
    // that calling it asks the person.
    expect(stub.description).toContain('NOT CONNECTED');
    expect(stub.description).toContain('Google Calendar');
  });

  it('emits the card when called, with the scope stated and no data returned', async () => {
    const events: AgentEvent[] = [];
    const stub = connectStub(REAL, capability(), ctxFor(events));

    const output = await stub.invoke({ timeMin: '2026-09-19T00:00', timeMax: '2026-09-19T23:59' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'connect_source',
      connect: {
        connectorSlug: 'google-calendar',
        state: 'connect',
        scope: 'user',
        tool: 'list_events',
        intentId: 77,
        requestedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      },
    });
    // The model is told a card is on screen and told not to loop on it —
    // one card per connector per turn is a rule, not a hope.
    expect(String(output)).toContain('connect card is on screen');
    expect(String(output)).toContain('Do not call this tool again this turn');
    expect(String(output)).not.toContain('real data');
  });

  it('says whose connection it would be for a shared connector', async () => {
    const events: AgentEvent[] = [];
    const stub = connectStub(REAL, capability({ slug: 'hubspot', name: 'HubSpot', identity: 'shared', authKind: 'apikey', state: { kind: 'needs-admin' } }), ctxFor(events));

    const output = await stub.invoke({ timeMin: 'a', timeMax: 'b' });

    expect(events[0]).toMatchObject({ type: 'connect_source', connect: { scope: 'workspace', state: 'needs-admin' } });
    // The member is told who connects it, not offered a button that binds a
    // company asset.
    expect(String(output)).toContain('admin');
  });

  it('offers a reconnect rather than a connect for a credential that broke', async () => {
    const events: AgentEvent[] = [];
    const stub = connectStub(REAL, capability({ state: { kind: 'broken', reason: 'revoked' } }), ctxFor(events));
    await stub.invoke({ timeMin: 'a', timeMax: 'b' });

    expect(events[0]).toMatchObject({ type: 'connect_source', connect: { state: 'reconnect' } });
  });

  it('emits nothing for a connector this build does not ship', async () => {
    const events: AgentEvent[] = [];
    const stub = connectStub(REAL, capability({ state: { kind: 'unavailable' } }), ctxFor(events));

    const output = await stub.invoke({ timeMin: 'a', timeMax: 'b' });

    // A card nobody could act on is worse than no card.
    expect(events).toEqual([]);
    expect(String(output)).toContain('not available');
  });
});

describe('a gap outside chat', () => {
  it('files a review item instead of quietly answering short', async () => {
    proposeAction.mockClear();
    const events: AgentEvent[] = [];
    // No `conversationId`: a scheduled run, a workflow step, an API caller.
    // There is nobody to show a card to.
    const ctx = { ...ctxFor(events), conversationId: undefined, actor: { kind: 'system' } as const };
    const stub = connectStub(REAL, capability({ slug: 'hubspot', name: 'HubSpot', identity: 'shared', state: { kind: 'needs-admin' } }), ctx);

    await stub.invoke({ timeMin: 'a', timeMax: 'b' });

    expect(proposeAction).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'connection.connect_source',
      input: expect.objectContaining({ connector: 'hubspot', surface: 'schedule', scope: 'workspace' }),
    }));
  });

  it('files nothing when somebody is looking at a card instead', async () => {
    proposeAction.mockClear();
    const events: AgentEvent[] = [];
    const stub = connectStub(REAL, capability(), { ...ctxFor(events), conversationId: 42 });

    await stub.invoke({ timeMin: 'a', timeMax: 'b' });

    expect(proposeAction).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
  });
});

describe('scopesFor', () => {
  it('asks for what the TOOL needs, so consent stays minimal', () => {
    expect(scopesFor('google-calendar', 'list_events')).toEqual(['https://www.googleapis.com/auth/calendar.readonly']);
    expect(scopesFor('gmail', 'get_gmail_thread')).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
  });

  it('answers empty for a connector that declares none, rather than guessing', () => {
    expect(scopesFor('hubspot', 'hubspot_get_deal')).toEqual([]);
  });
});
