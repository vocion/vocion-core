import { describe, expect, it } from 'vitest';
import {
  emptyQueue,
  findQueued,
  nextInQueue,
  parseStoredQueue,
  queueReducer,
  queueStorageKey,
} from './queueReducer';

function withItems(...texts: string[]) {
  return texts.reduce(
    (state, text, i) => queueReducer(state, { type: 'enqueue', id: `q${i}`, text, at: 1000 + i }),
    emptyQueue,
  );
}

describe('queueReducer — ordering', () => {
  it('keeps queued messages in the order they were typed', () => {
    const state = withItems('first', 'second', 'third');

    expect(state.items.map(i => i.text)).toEqual(['first', 'second', 'third']);
  });

  it('trims the text and refuses a blank line', () => {
    const state = queueReducer(
      queueReducer(emptyQueue, { type: 'enqueue', id: 'a', text: '  spaced  ', at: 1 }),
      { type: 'enqueue', id: 'b', text: '   \n ', at: 2 },
    );

    expect(state.items).toHaveLength(1);
    expect(state.items[0]!.text).toBe('spaced');
  });

  it('shift takes the head and leaves the tail in order', () => {
    const state = queueReducer(withItems('first', 'second', 'third'), { type: 'shift' });

    expect(state.items.map(i => i.text)).toEqual(['second', 'third']);
  });
});

describe('queueReducer — drop', () => {
  it('the ✕ removes exactly that row and nothing else', () => {
    const state = queueReducer(withItems('first', 'second', 'third'), { type: 'drop', id: 'q1' });

    expect(state.items.map(i => i.text)).toEqual(['first', 'third']);
  });

  it('dropping an id that is gone is a no-op', () => {
    const before = withItems('first');
    const after = queueReducer(before, { type: 'drop', id: 'nope' });

    expect(after.items.map(i => i.text)).toEqual(['first']);
  });
});

describe('queueReducer — edit back into the composer', () => {
  it('the row is readable before it leaves, so its text can go back in the box', () => {
    const before = withItems('first', 'second');

    const picked = findQueued(before, 'q1');
    const after = queueReducer(before, { type: 'edit', id: 'q1' });

    expect(picked?.text).toBe('second');
    expect(after.items.map(i => i.text)).toEqual(['first']);
  });

  it('findQueued returns null for an unknown id', () => {
    expect(findQueued(withItems('first'), 'ghost')).toBeNull();
  });
});

describe('nextInQueue — flush on complete', () => {
  it('releases the head once the turn lands', () => {
    const state = withItems('first', 'second');

    expect(nextInQueue(state, { streaming: false, outcome: 'completed' })?.text).toBe('first');
  });

  it('holds everything while the turn is still streaming', () => {
    const state = withItems('first');

    expect(nextInQueue(state, { streaming: true, outcome: 'running' })).toBeNull();
  });

  it('drains in order across successive turns', () => {
    let state = withItems('first', 'second', 'third');
    const sent: string[] = [];

    for (let i = 0; i < 3; i++) {
      const next = nextInQueue(state, { streaming: false, outcome: 'completed' });
      sent.push(next!.text);
      state = queueReducer(state, { type: 'shift' });
    }

    expect(sent).toEqual(['first', 'second', 'third']);
    expect(nextInQueue(state, { streaming: false, outcome: 'completed' })).toBeNull();
  });

  it('does not fire on mount, before any turn has completed', () => {
    const state = queueReducer(emptyQueue, { type: 'hydrate', items: [{ id: 'q0', text: 'restored', at: 1 }] });

    expect(nextInQueue(state, { streaming: false, outcome: 'idle' })).toBeNull();
  });
});

describe('nextInQueue / hold — preserve on error or stop', () => {
  it('a failed turn sends nothing', () => {
    expect(nextInQueue(withItems('first'), { streaming: false, outcome: 'error' })).toBeNull();
  });

  it('a stopped turn sends nothing', () => {
    expect(nextInQueue(withItems('first'), { streaming: false, outcome: 'stopped' })).toBeNull();
  });

  it('hold keeps every queued message and raises the notice', () => {
    const state = queueReducer(withItems('first', 'second'), { type: 'hold' });

    expect(state.items.map(i => i.text)).toEqual(['first', 'second']);
    expect(state.held).toBe(true);
  });

  it('holds nothing when the queue is empty', () => {
    expect(queueReducer(emptyQueue, { type: 'hold' }).held).toBe(false);
  });

  it('typing again clears the notice but keeps the backlog', () => {
    const held = queueReducer(withItems('first'), { type: 'hold' });
    const after = queueReducer(held, { type: 'enqueue', id: 'q9', text: 'and also', at: 9 });

    expect(after.held).toBe(false);
    expect(after.items.map(i => i.text)).toEqual(['first', 'and also']);
  });

  it('release clears the notice on its own', () => {
    const held = queueReducer(withItems('first'), { type: 'hold' });

    expect(queueReducer(held, { type: 'release' }).held).toBe(false);
  });

  it('a held queue still flushes once a later turn completes', () => {
    const held = queueReducer(withItems('first'), { type: 'hold' });

    expect(nextInQueue(held, { streaming: false, outcome: 'completed' })?.text).toBe('first');
  });
});

describe('queueReducer — clear and hydrate', () => {
  it('clear empties the queue', () => {
    expect(queueReducer(withItems('first', 'second'), { type: 'clear' })).toEqual(emptyQueue);
  });

  it('hydrate replaces the queue wholesale', () => {
    const state = queueReducer(withItems('stale'), { type: 'hydrate', items: [{ id: 'r0', text: 'restored', at: 5 }] });

    expect(state.items.map(i => i.text)).toEqual(['restored']);
  });
});

describe('queue persistence helpers', () => {
  it('keys storage per conversation, with a stable key for a thread with no id yet', () => {
    expect(queueStorageKey(41)).toBe('vocion.chat.queue.41');
    expect(queueStorageKey(null)).toBe('vocion.chat.queue.new');
  });

  it('round-trips a queue', () => {
    const items = withItems('first', 'second').items;

    expect(parseStoredQueue(JSON.stringify(items))).toEqual(items);
  });

  it('reads anything malformed as empty rather than throwing', () => {
    expect(parseStoredQueue(null)).toEqual([]);
    expect(parseStoredQueue('not json')).toEqual([]);
    expect(parseStoredQueue('{"not":"an array"}')).toEqual([]);
    expect(parseStoredQueue('[{"id":1}]')).toEqual([]);
  });
});
