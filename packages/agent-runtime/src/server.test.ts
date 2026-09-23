/**
 * The runtime server stops a turn when its caller hangs up (#272).
 *
 * vocion-core stops a turn that reached its budget by dropping the connection.
 * If the server kept going, its model calls would run with nobody left to
 * charge them to — spend no budget would ever see.
 */
import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { abortWhenCallerLeft, writeWhileOpen } from './server.js';

function response(state: { writableEnded?: boolean; destroyed?: boolean }) {
  return { writableEnded: false, destroyed: false, write: vi.fn(), ...state } as unknown as ServerResponse & { write: ReturnType<typeof vi.fn> };
}

describe('when the response closes', () => {
  it('aborts the turn if the caller hung up before it finished', () => {
    const callerLeft = new AbortController();

    abortWhenCallerLeft(response({ writableEnded: false }), callerLeft);

    expect(callerLeft.signal.aborted).toBe(true);
  });

  it('aborts nothing when the turn finished and the response ended normally', () => {
    const callerLeft = new AbortController();

    abortWhenCallerLeft(response({ writableEnded: true }), callerLeft);

    expect(callerLeft.signal.aborted).toBe(false);
  });
});

describe('writing an event', () => {
  it('writes while the caller is still there', () => {
    const res = response({});

    writeWhileOpen(res, 'data: {}\n\n');

    expect(res.write).toHaveBeenCalledWith('data: {}\n\n');
  });

  it('drops the write once the caller has gone, instead of raising an error nobody handles', () => {
    const res = response({ destroyed: true });

    writeWhileOpen(res, 'data: {}\n\n');

    expect(res.write).not.toHaveBeenCalled();
  });
});
