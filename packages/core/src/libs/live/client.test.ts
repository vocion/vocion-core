/**
 * The browser's one connection per tab (`LiveClient`), against a fake
 * EventSource: every follower on the page shares one stream for the union
 * of their topics; a change of set replaces it, resuming after the last
 * notice; each notice reaches only the followers it concerns, once; a gap the
 * server could not replay makes everyone read again; a refused or dead
 * stream is `down` (followers poll) and retries itself; a hidden tab lets
 * its stream go and comes back where it left off.
 */
import type { LiveNotice } from './topics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveClient } from './client';
import { parseTopic, topicsForRef } from './topics';

class FakeSource {
  static all: FakeSource[] = [];
  readyState = 0;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  private handlers = new Map<string, Array<(e: MessageEvent) => void>>();
  constructor(public url: string) {
    FakeSource.all.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string, data: unknown) {
    for (const fn of this.handlers.get(type) ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.(new Event('error'));
  }

  get topics(): string[] {
    return new URL(this.url, 'https://vocion.test').searchParams.get('topics')!.split(',');
  }

  param(name: string): string | null {
    return new URL(this.url, 'https://vocion.test').searchParams.get(name);
  }
}

const notice = (id: number, topics: string[]): LiveNotice => ({ id, topics, ref: topics[0]!, kind: 'changed', at: '2026-09-30T12:00:00.000Z' });

let visible = true;
function client() {
  return new LiveClient({ EventSource: FakeSource as never, settleMs: 5, hiddenGraceMs: 20, loadedAt: 1_000, visible: () => visible });
}
const latest = () => FakeSource.all.at(-1)!;
const settle = () => new Promise(r => setTimeout(r, 20));

beforeEach(() => {
  FakeSource.all = [];
  visible = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveClient', () => {
  it('opens one stream for every follower on the page, and hands each notice only to the followers it concerns', async () => {
    const c = client();
    const card: LiveNotice[] = [];
    const record: LiveNotice[] = [];
    c.add({ topics: new Set(['card:7']), onNotice: n => card.push(n) });
    c.add({ topics: new Set(['record:12', 'run:3']), onNotice: n => record.push(n) });
    await settle();

    expect(FakeSource.all).toHaveLength(1);
    expect(latest().topics).toEqual(['card:7', 'record:12', 'run:3']);
    expect(latest().param('since')).toBe('1000');
    expect(c.getState()).toBe('connecting');

    latest().emit('ready', { topics: latest().topics, refused: [] });

    expect(c.getState()).toBe('open');

    latest().emit('notice', notice(40, ['run:3', 'runs', 'record:12']));
    latest().emit('notice', notice(40, ['run:3', 'runs', 'record:12']));
    latest().emit('notice', notice(41, ['card:7', 'cards']));

    expect(record.map(n => n.id)).toEqual([40]);
    expect(card.map(n => n.id)).toEqual([41]);
  });

  it('replaces the stream when the set changes, resuming after the last notice, and stays up while it does', async () => {
    const c = client();
    c.add({ topics: new Set(['record:12']), onNotice: () => {} });
    await settle();
    latest().emit('ready', {});
    latest().emit('notice', notice(55, ['record:12']));
    const first = latest();

    const remove = c.add({ topics: new Set(['card:9']), onNotice: () => {} });
    await settle();

    expect(first.closed).toBe(true);
    expect(latest().topics).toEqual(['card:9', 'record:12']);
    expect(latest().param('after')).toBe('55');
    expect(c.getState()).toBe('open');

    remove();
    await settle();

    expect(latest().topics).toEqual(['record:12']);
  });

  it('closes the stream when nothing on the page follows anything', async () => {
    const c = client();
    const remove = c.add({ topics: new Set(['record:12']), onNotice: () => {} });
    await settle();
    remove();
    await settle();

    expect(latest().closed).toBe(true);
    expect(c.getState()).toBe('idle');
  });

  it('makes every follower read again when the server says it could not replay a gap', async () => {
    const c = client();
    const got: LiveNotice[] = [];
    c.add({ topics: new Set(['record:12']), onNotice: n => got.push(n) });
    await settle();
    latest().emit('reset', { reason: 'pruned' });

    expect(got).toEqual([expect.objectContaining({ kind: 'resync', topics: ['record:12'] })]);
  });

  it('is down on an error — so followers poll — and retries a refused stream itself', async () => {
    vi.useFakeTimers();
    const c = client();
    c.add({ topics: new Set(['record:12']), onNotice: () => {} });
    await vi.advanceTimersByTimeAsync(10);
    latest().emit('ready', {});
    latest().fail(false);

    expect(c.getState()).toBe('down');

    // The browser reconnects this one on its own.
    latest().emit('ready', {});

    expect(c.getState()).toBe('open');

    latest().fail(true);

    expect(c.getState()).toBe('down');
    expect(FakeSource.all).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_100);

    expect(FakeSource.all).toHaveLength(2);
  });

  it('lets a hidden tab\'s stream go, and comes back after the last notice it had', async () => {
    const c = client();
    c.add({ topics: new Set(['record:12']), onNotice: () => {} });
    await settle();
    latest().emit('ready', {});
    latest().emit('notice', notice(70, ['record:12']));

    visible = false;
    c.visibilityChanged();
    await settle();

    expect(latest().closed).toBe(true);
    expect(c.getState()).toBe('paused');

    visible = true;
    c.visibilityChanged();

    expect(FakeSource.all).toHaveLength(2);
    expect(latest().param('after')).toBe('70');
  });
});

describe('topics', () => {
  it('is a closed grammar: what the stream publishes, and nothing else', () => {
    expect(parseTopic('record:12')).toEqual({ kind: 'record', id: 12, topic: 'record:12' });
    expect(parseTopic('list:engineering_task')).toEqual({ kind: 'list', slug: 'engineering_task', topic: 'list:engineering_task' });
    expect(parseTopic('runs')).toEqual({ kind: 'feed', feed: 'runs', topic: 'runs' });
    expect(parseTopic('notification:user_ada')).toMatchObject({ kind: 'notification', userId: 'user_ada' });
    expect(parseTopic('record:0')).toBeNull();
    expect(parseTopic('record:12abc')).toBeNull();
    expect(parseTopic('deal:12')).toBeNull();
    expect(parseTopic('everything')).toBeNull();
  });

  it('maps the refs the app points at onto the topics that carry their changes', () => {
    expect(topicsForRef({ type: 'object', id: '12' })).toEqual(['record:12']);
    expect(topicsForRef({ type: 'request', id: '12' })).toEqual(['record:12']);
    expect(topicsForRef({ type: 'record_history', id: '12@3' })).toEqual(['record:12']);
    expect(topicsForRef({ type: 'worker_run', id: 5 })).toEqual(['run:5']);
    expect(topicsForRef({ type: 'mission_run', id: '6' })).toEqual(['mission:6']);
    expect(topicsForRef({ type: 'artifact', id: '8' })).toEqual(['artifact:8']);
    expect(topicsForRef({ type: 'deal', id: '8' })).toEqual([]);
    expect(topicsForRef({ type: 'object', id: 'hubspot-8' })).toEqual([]);
  });
});
