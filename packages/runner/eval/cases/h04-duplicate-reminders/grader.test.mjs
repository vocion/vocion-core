import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, request } from './helpers.mjs';

const H = 3600000;
const reminders = (app, to) => app.repos.outbox.all().filter(o => o.type === 'reminder' && (!to || o.to === to));

/** Runs the hourly job from `from` for `hours`, at `minute` past each hour. */
function hourly(app, from, hours, { onHour } = {}) {
  const start = new Date(from).getTime();
  for (let h = 0; h < hours; h++) {
    app.clock.set(new Date(start + h * H).toISOString());
    onHour?.(h);
    app.runJob('reminders');
  }
}

function gaps(app, to) {
  const at = reminders(app, to).map(o => new Date(o.at).getTime()).sort((a, b) => a - b);
  return at.slice(1).map((t, i) => (t - at[i]) / H);
}

test('A1: no second reminder an hour later across midnight', async () => {
  const app = createApp();
  app.clock.set('2026-10-01T23:30:00.000Z');
  app.runJob('reminders');
  assert.equal(reminders(app, 'legal@contoso.example').length, 2, 'the l4 reminder is due');
  app.clock.set('2026-10-02T00:30:00.000Z');
  app.runJob('reminders');
  assert.equal(reminders(app, 'legal@contoso.example').length, 2);
  app.clock.set('2026-10-02T23:29:00.000Z');
  app.runJob('reminders');
  assert.equal(reminders(app, 'legal@contoso.example').length, 2);
  app.clock.set('2026-10-02T23:30:00.000Z');
  app.runJob('reminders');
  assert.equal(reminders(app, 'legal@contoso.example').length, 3);
});

test('A2: ten days of hourly runs: at most one per 24 hours, at most 3 in all, and they still go out', async () => {
  const app = createApp();
  hourly(app, '2026-10-01T12:30:00.000Z', 240);
  for (const to of ['board@kestrel.example', 'legal@contoso.example']) {
    assert.equal(reminders(app, to).length, 3, to);
    assert.ok(gaps(app, to).every(g => g >= 24), `${to}: ${gaps(app, to)}`);
  }
  assert.equal(reminders(app, 'cfo@kestrel.example').length, 0);
});

test('A3: the same in a server time zone far from UTC', async () => {
  const saved = process.env.TZ;
  try {
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      const app = createApp();
      hourly(app, '2026-10-01T12:30:00.000Z', 240);
      assert.equal(reminders(app, 'board@kestrel.example').length, 3, tz);
      assert.ok(gaps(app, 'board@kestrel.example').every(g => g >= 24), `${tz}: ${gaps(app, 'board@kestrel.example')}`);
      assert.ok(gaps(app, 'legal@contoso.example').every(g => g >= 24), tz);
    }
  } finally {
    process.env.TZ = saved;
  }
});

test('A4: opening the link still stops reminders', async () => {
  const app = createApp();
  hourly(app, '2026-10-03T12:30:00.000Z', 72, {
    onHour: (h) => {
      if (h === 10) {
        request(app, { path: '/l/l2', headers: { 'user-agent': 'Mozilla/5.0 Safari/605.1' } });
      }
    },
  });
  assert.equal(reminders(app, 'board@kestrel.example').length, 1);
});
