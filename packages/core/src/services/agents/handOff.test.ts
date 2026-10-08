/**
 * The hand-off guard: a card put in front of a person ends the turn before
 * the next model call, on a person's turn only, and every card the same step
 * asked for lands first.
 */
import { describe, expect, it } from 'vitest';
import { HandOffGateCallback, HandOffGuard, handsOff, TurnHandedOff } from './handOff';

describe('HandOffGuard', () => {
  it('does nothing until a card is up, then stops the turn at the next model call', () => {
    const guard = new HandOffGuard();
    guard.arm(true);

    guard.beforeModelCall();

    expect(guard.stopped).toBe(false);
    expect(guard.signal.aborted).toBe(false);

    guard.handOff('Connect GitHub');
    guard.handOff('Connect Jira');

    expect(guard.handedOff).toEqual(['Connect GitHub', 'Connect Jira']);
    expect(guard.stopped).toBe(false);

    guard.beforeModelCall();

    expect(guard.stopped).toBe(true);
    expect(guard.signal.aborted).toBe(true);
    expect(guard.stopError).toBeInstanceOf(TurnHandedOff);
    expect(guard.stopError?.cards).toEqual(['Connect GitHub', 'Connect Jira']);
    expect(guard.stopError?.message).toContain('2 cards');
  });

  it('stops once and stays stopped', () => {
    const guard = new HandOffGuard();
    guard.arm(true);
    guard.handOff('Approve the build');
    guard.beforeModelCall();
    const first = guard.stopError;
    guard.handOff('Another');
    guard.beforeModelCall();

    expect(guard.stopError).toBe(first);
  });

  it('records but never stops a turn nobody is waiting on (a mission run)', () => {
    const guard = new HandOffGuard();
    guard.arm(false);
    guard.handOff('Connect GitHub');
    guard.beforeModelCall();

    expect(guard.handedOff).toEqual(['Connect GitHub']);
    expect(guard.stopped).toBe(false);
    expect(guard.signal.aborted).toBe(false);
  });

  it('is told about model calls by the callback, awaited', async () => {
    const guard = new HandOffGuard();
    guard.arm(true);
    guard.handOff('Connect GitHub');
    const cb = new HandOffGateCallback(guard);

    expect(cb.awaitHandlers).toBe(true);

    await cb.handleChatModelStart();

    expect(guard.stopped).toBe(true);
  });
});

describe('raising a Decision ends the turn', () => {
  const asked = { id: 41, kind: 'choice' as const, question: 'Which repo should the factory build in?', options: [], allowOther: true, multiple: false, agentSlug: 'product-manager', ownerUserId: 'usr-dana', conversationId: 392 };

  it('an open Decision and an approval gate hand the next move to the person', () => {
    expect(handsOff({ type: 'decision', decision: { ...asked, state: 'open' } })).toBe('Which repo should the factory build in?');
    expect(handsOff({ type: 'hitl_gate', gate: { name: 'send-email', question: 'Send this follow-up to Northwind?' } })).toBe('Send this follow-up to Northwind?');
  });

  it('an answered Decision, or anything else, hands nothing off', () => {
    expect(handsOff({ type: 'decision', decision: { ...asked, state: 'answered' } })).toBeNull();
    expect(handsOff({ type: 'response_delta', delta: 'One question before I go on.' })).toBeNull();
  });

  it('the gate stops the turn at the next model call, where it used to say "wait" and talk on', () => {
    const guard = new HandOffGuard();
    guard.arm(true);
    const handed = handsOff({ type: 'hitl_gate', gate: { name: 'send-email', question: 'Send this follow-up to Northwind?' } });
    guard.handOff(handed!);
    guard.beforeModelCall();

    expect(guard.stopped).toBe(true);
    expect(guard.stopError?.cards).toEqual(['Send this follow-up to Northwind?']);
  });
});
