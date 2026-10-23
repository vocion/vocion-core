import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createApp, request, sourceFiles } from './helpers.mjs';

// Every email of a busy fortnight, exactly as the product sent them before the change.
const EXPECTED = [{ type: 'reminder', to: 'legal@contoso.example', subject: 'Reminder: Olivia Park shared "Draft Contract" with you', body: 'x', key: 'reminder:l4:2026-09-23' }, { type: 'link.shared', to: 'amy@kestrel.example', subject: 'Olivia Park shared "Pricing Sheet" with you', body: 'Olivia Park shared "Pricing Sheet" with you on Northwind Dataroom.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0001\n', key: 'shared:lnk_0001' }, { type: 'link.shared', to: 'zed@contoso.example', subject: 'Ana Silva shared "Private Notes" with you', body: 'Ana Silva shared "Private Notes" with you on Northwind Dataroom.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0002\n', key: 'shared:lnk_0002' }, { type: 'link.shared', to: 'new@northwind.example', subject: 'Tom Reyes shared "Onboarding "Guide" & <FAQ>" with you', body: 'Tom Reyes shared "Onboarding "Guide" & <FAQ>" with you on Northwind Dataroom.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0003\n', key: 'shared:lnk_0003' }, { type: 'reminder', to: 'board@kestrel.example', subject: 'Reminder: Olivia Park shared "Q3 Board Deck" with you', body: 'Olivia Park shared "Q3 Board Deck" with you on Sep 30 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/l2\n', key: 'reminder:l2:2026-10-03' }, { type: 'reminder', to: 'legal@contoso.example', subject: 'Reminder: Olivia Park shared "Draft Contract" with you', body: 'Olivia Park shared "Draft Contract" with you on Sep 20 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/l4\n', key: 'reminder:l4:2026-10-03' }, { type: 'reminder', to: 'board@kestrel.example', subject: 'Reminder: Olivia Park shared "Q3 Board Deck" with you', body: 'Olivia Park shared "Q3 Board Deck" with you on Sep 30 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/l2\n', key: 'reminder:l2:2026-10-04' }, { type: 'reminder', to: 'legal@contoso.example', subject: 'Reminder: Olivia Park shared "Draft Contract" with you', body: 'Olivia Park shared "Draft Contract" with you on Sep 20 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/l4\n', key: 'reminder:l4:2026-10-04' }, { type: 'reminder', to: 'amy@kestrel.example', subject: 'Reminder: Olivia Park shared "Pricing Sheet" with you', body: 'Olivia Park shared "Pricing Sheet" with you on Oct 1 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0001\n', key: 'reminder:lnk_0001:2026-10-04' }, { type: 'reminder', to: 'zed@contoso.example', subject: 'Reminder: Ana Silva shared "Private Notes" with you', body: 'Ana Silva shared "Private Notes" with you on Oct 1 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0002\n', key: 'reminder:lnk_0002:2026-10-04' }, { type: 'reminder', to: 'new@northwind.example', subject: 'Reminder: Tom Reyes shared "Onboarding "Guide" & <FAQ>" with you', body: 'Tom Reyes shared "Onboarding "Guide" & <FAQ>" with you on Oct 1 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0003\n', key: 'reminder:lnk_0003:2026-10-04' }, { type: 'reminder', to: 'board@kestrel.example', subject: 'Reminder: Olivia Park shared "Q3 Board Deck" with you', body: 'Olivia Park shared "Q3 Board Deck" with you on Sep 30 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/l2\n', key: 'reminder:l2:2026-10-05' }, { type: 'reminder', to: 'amy@kestrel.example', subject: 'Reminder: Olivia Park shared "Pricing Sheet" with you', body: 'Olivia Park shared "Pricing Sheet" with you on Oct 1 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0001\n', key: 'reminder:lnk_0001:2026-10-05' }, { type: 'reminder', to: 'zed@contoso.example', subject: 'Reminder: Ana Silva shared "Private Notes" with you', body: 'Ana Silva shared "Private Notes" with you on Oct 1 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0002\n', key: 'reminder:lnk_0002:2026-10-05' }, { type: 'reminder', to: 'new@northwind.example', subject: 'Reminder: Tom Reyes shared "Onboarding "Guide" & <FAQ>" with you', body: 'Tom Reyes shared "Onboarding "Guide" & <FAQ>" with you on Oct 1 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0003\n', key: 'reminder:lnk_0003:2026-10-05' }, { type: 'reminder', to: 'amy@kestrel.example', subject: 'Reminder: Olivia Park shared "Pricing Sheet" with you', body: 'Olivia Park shared "Pricing Sheet" with you on Oct 1 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0001\n', key: 'reminder:lnk_0001:2026-10-06' }, { type: 'reminder', to: 'zed@contoso.example', subject: 'Reminder: Ana Silva shared "Private Notes" with you', body: 'Ana Silva shared "Private Notes" with you on Oct 1 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0002\n', key: 'reminder:lnk_0002:2026-10-06' }, { type: 'reminder', to: 'new@northwind.example', subject: 'Reminder: Tom Reyes shared "Onboarding "Guide" & <FAQ>" with you', body: 'Tom Reyes shared "Onboarding "Guide" & <FAQ>" with you on Oct 1 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/lnk_0003\n', key: 'reminder:lnk_0003:2026-10-06' }, { type: 'digest', to: 'olivia@northwind.example', subject: 'Your week in Northwind Deals', body: 'Week of Oct 5\n\n- Q3 Board Deck: 2 opens\n- Pricing Sheet: 0 opens\n- Onboarding "Guide" & <FAQ>: 2 opens\n- Draft Contract: 0 opens\n- Product One-Pager: 0 opens\n', key: 'digest:lib_team:2026-10-12:u_owner' }, { type: 'digest', to: 'ana@acme.example', subject: 'Your week in Acme Board', body: 'Week of Oct 5\n\n- Private Notes: 1 opens\n', key: 'digest:lib_other:2026-10-12:u_other' }];

async function scenario() {
  const app = createApp();
  await request(app, { method: 'POST', path: '/api/documents/d2/links', user: 'u_owner', body: { recipientEmail: 'amy@kestrel.example' } });
  await request(app, { method: 'POST', path: '/api/documents/d6/links', user: 'u_other', body: { recipientEmail: 'zed@contoso.example' } });
  await request(app, { method: 'PATCH', path: '/api/documents/d3', user: 'u_teammate', body: { title: 'Onboarding "Guide" & <FAQ>' } });
  await request(app, { method: 'POST', path: '/api/documents/d3/links', user: 'u_teammate', body: { recipientEmail: 'new@northwind.example' } });
  for (const at of ['2026-10-03T13:00:00.000Z', '2026-10-04T13:00:00.000Z', '2026-10-05T13:00:00.000Z', '2026-10-06T13:00:00.000Z']) {
    app.clock.set(at);
    app.runJob('reminders');
  }
  app.clock.set('2026-10-12T09:00:00.000Z');
  app.runJob('digest');
  return app.repos.outbox.all().map(o => ({ type: o.type, to: o.to, subject: o.subject, body: o.body, key: o.key }));
}

test('A1: src/emails renders each type from plain data', async () => {
  const { render } = await import('../src/emails/index.mjs');
  assert.deepEqual(render('link.shared', { ownerName: 'Olivia Park', docTitle: 'Q3 Board Deck', linkId: 'l9' }), {
    subject: 'Olivia Park shared "Q3 Board Deck" with you',
    body: 'Olivia Park shared "Q3 Board Deck" with you on Northwind Dataroom.\n\nOpen it: https://dataroom.northwind.example/l/l9\n',
  });
  assert.deepEqual(render('reminder', { ownerName: 'Tom Reyes', docTitle: 'Pricing Sheet', linkId: 'l7', sharedAt: '2026-09-30T23:30:00.000Z' }), {
    subject: 'Reminder: Tom Reyes shared "Pricing Sheet" with you',
    body: 'Tom Reyes shared "Pricing Sheet" with you on Sep 30 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/l7\n',
  });
  assert.deepEqual(render('digest', { libraryName: 'Northwind Deals', weekStart: '2026-10-05T09:00:00.000Z', lines: [{ title: 'Q3 Board Deck', opens: 2 }, { title: 'Pricing Sheet', opens: 0 }] }), {
    subject: 'Your week in Northwind Deals',
    body: 'Week of Oct 5\n\n- Q3 Board Deck: 2 opens\n- Pricing Sheet: 0 opens\n',
  });
  assert.throws(() => render('nope', {}));
});

test('A2: every email the product sends is byte-identical to before', async () => {
  const got = await scenario();
  assert.equal(got.length, EXPECTED.length);
  got.forEach((m, i) => assert.deepEqual(m, EXPECTED[i], `email ${i + 1} (${EXPECTED[i].type} to ${EXPECTED[i].to})`));
});

test('A3: no service writes email copy any more; it all lives in src/emails', async () => {
  const offenders = (await sourceFiles('src'))
    .filter(f => !f.file.startsWith('src/emails/') && !f.file.startsWith('src/db/'))
    .filter(f => /Open it:|Reminder: |Your week in|shared "\$\{|Week of /.test(f.text))
    .map(f => f.file);
  assert.deepEqual(offenders, []);
});

test('A4: the existing tests are unchanged', () => {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=MDR', process.env.EVAL_BASE_SHA, '--', 'test/'], { encoding: 'utf8' }).trim();
  assert.equal(out, '');
});
