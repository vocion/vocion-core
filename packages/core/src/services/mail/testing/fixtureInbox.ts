/**
 * A fictional inbox for the "what do I need to answer" tests, and a stub of the
 * slice of the Gmail API the connector reads. Every name and address is from
 * the fixture cast (`libs/fixtures/realDataGuard.ts`); the owner is the seller.
 *
 * Expected, from the owner's side: Contoso and Acme are owed sales replies,
 * Northwind an owed customer reply; Meridian waits on them (the owner wrote
 * last); Tideline is a cold pitch; Cobalt is bulk; Kestrel closed with a
 * thanks; Atlas is older than the state window.
 */

export const FIXTURE_OWNER = 'owner@metacto.example';
const OWNER = FIXTURE_OWNER;
const DAY = 86_400_000;

/** The classifier's verdicts on the threads the headers cannot settle, keyed by subject. */
export const FIXTURE_VERDICTS: Record<string, { state: string; category: string; ask: string }> = {
  'Pricing for the managed service': { state: 'needs_my_reply', category: 'sales', ask: 'Wants pricing for 40 seats before Friday' },
  'Agents for your field team': { state: 'needs_my_reply', category: 'sales', ask: 'Asks for a call next week' },
  'Invoice question': { state: 'needs_my_reply', category: 'customer', ask: 'Asks why the October invoice doubled' },
  'Triple your pipeline in 30 days': { state: 'outbound_spam', category: 'vendor', ask: '' },
  'Intro': { state: 'fyi', category: 'partner', ask: '' },
};
export type FixtureMessage = { id: string; from: string; to: string; subject: string; snippet: string; at: number; bulk?: boolean };
export type FixtureThread = { id: string; messages: FixtureMessage[] };

/**
 * The fictional inbox, dated relative to `now`. A fresh copy each call, so a test may add messages.
 * @param now - The clock.
 */
export function fixtureThreads(now: number): FixtureThread[] {
  return [
    { id: 't-contoso', messages: [
      { id: 'm1', from: 'Jamie Smith <jamie@contoso.example>', to: OWNER, subject: 'Pricing for the managed service', snippet: 'Could you send pricing for 40 seats? We decide Friday.', at: now - 2 * DAY },
    ] },
    { id: 't-acme', messages: [
      { id: 'm2', from: OWNER, to: 'pat@acme.example', subject: 'Agents for your field team', snippet: 'Saw your expansion — worth a look?', at: now - 6 * DAY },
      { id: 'm3', from: 'Pat Lee <pat@acme.example>', to: OWNER, subject: 'Re: Agents for your field team', snippet: 'Interesting. Could we talk next week?', at: now - 5 * DAY },
    ] },
    { id: 't-meridian', messages: [
      { id: 'm4', from: 'Rae <rae@meridiandental.example>', to: OWNER, subject: 'Questions on the proposal', snippet: 'Two questions on scope.', at: now - 4 * DAY },
      { id: 'm5', from: OWNER, to: 'rae@meridiandental.example', subject: 'Re: Questions on the proposal', snippet: 'Answers inline — did these help?', at: now - 3 * DAY },
    ] },
    { id: 't-northwind', messages: [
      { id: 'm6', from: 'Ops <ops@northwind.example>', to: OWNER, subject: 'Invoice question', snippet: 'Why did the October invoice double?', at: now - 1 * DAY },
    ] },
    { id: 't-tideline', messages: [
      { id: 'm7', from: 'Rowan Pike <rowan@tideline.example>', to: OWNER, subject: 'Triple your pipeline in 30 days', snippet: 'We help agencies like yours…', at: now - 1 * DAY },
    ] },
    { id: 't-cobalt', messages: [
      { id: 'm8', from: 'Cobalt Weekly <news@cobalt.example>', to: OWNER, subject: 'This week in AI ops', snippet: 'Five stories…', at: now - 1 * DAY, bulk: true },
    ] },
    { id: 't-kestrel', messages: [
      { id: 'm9', from: OWNER, to: 'dana@kestrel.example', subject: 'Intro', snippet: 'Thanks for the intro to Larkfield.', at: now - 3 * DAY },
      { id: 'm10', from: 'Dana Reyes <dana@kestrel.example>', to: OWNER, subject: 'Re: Intro', snippet: 'Anytime, talk soon.', at: now - 2 * DAY },
    ] },
    { id: 't-atlas', messages: [
      { id: 'm11', from: 'Lee <lee@atlasfield.example>', to: OWNER, subject: 'Old question', snippet: 'Still interested?', at: now - 45 * DAY },
    ] },
  ];
}

const headersOf = (m: FixtureMessage) => [
  { name: 'From', value: m.from },
  { name: 'To', value: m.to },
  { name: 'Subject', value: m.subject },
  { name: 'Date', value: new Date(m.at).toUTCString() },
  ...(m.bulk ? [{ name: 'List-Unsubscribe', value: '<mailto:unsub@cobalt.example>' }] : []),
];
const gmailMessage = (t: FixtureThread, m: FixtureMessage) => ({ id: m.id, threadId: t.id, snippet: m.snippet, internalDate: String(m.at), payload: { headers: headersOf(m) } });

/**
 * A stub of the slice of the Gmail API the connector reads.
 * @param threads - The inbox it serves.
 * @param url - The request URL.
 */
export function gmailApiStub(threads: FixtureThread[], url: string): Response {
  const u = new URL(url);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const all = threads.flatMap(t => t.messages.map(m => ({ t, m })));
  if (u.pathname.endsWith('/users/me/profile')) {
    return json({ emailAddress: OWNER });
  }
  if (u.pathname.endsWith('/users/me/messages')) {
    const q = u.searchParams.get('q') ?? '';
    const after = Number(/after:(\d+)/.exec(q)?.[1] ?? 0) * 1000;
    const sent = q.includes('in:sent');
    const hits = all.filter(({ m }) => m.at > after && (sent ? m.from === OWNER : m.from !== OWNER));
    return json({ messages: hits.map(({ t, m }) => ({ id: m.id, threadId: t.id })) });
  }
  const msg = /\/users\/me\/messages\/([^/?]+)/.exec(u.pathname);
  if (msg) {
    const hit = all.find(({ m }) => m.id === msg[1]);
    return hit ? json(gmailMessage(hit.t, hit.m)) : new Response('', { status: 404 });
  }
  const thread = /\/users\/me\/threads\/([^/?]+)/.exec(u.pathname);
  if (thread) {
    const t = threads.find(x => x.id === decodeURIComponent(thread[1]!));
    return t ? json({ id: t.id, messages: t.messages.map(m => gmailMessage(t, m)) }) : new Response('', { status: 404 });
  }
  return new Response('not stubbed', { status: 500 });
}
