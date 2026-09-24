import { describe, expect, it } from 'vitest';
import { ensureNurtureSlotProperties, isNurtureSequence, nurtureSlotProperties, readNurtureSlotsConfig } from './nurtureSlots';

describe('nurture slots', () => {
  it('recognises a ladder rung by its name prefix, case-insensitively', () => {
    expect(isNurtureSequence('Personalized Nurture · 3 Steady')).toBe(true);
    expect(isNurtureSequence('personalized nurture · 1 Ambient')).toBe(true);
    expect(isNurtureSequence('AI-Readiness Nurture')).toBe(false);
  });

  it('maps sends to slots in order and stamps generated-at as midnight UTC ms', () => {
    const props = nurtureSlotProperties(
      [{ subject: 'A', body: 'a' }, { subject: 'B', body: 'b' }, { subject: 'C', body: 'c' }],
      undefined,
      new Date('2026-09-10T15:42:00.000Z'),
    );

    expect(props).toEqual({
      pn_email_1_subject: 'A',
      pn_email_1_body: '<p>a</p>',
      pn_email_2_subject: 'B',
      pn_email_2_body: '<p>b</p>',
      pn_email_3_subject: 'C',
      pn_email_3_body: '<p>c</p>',
      pn_generated_at: String(Date.UTC(2026, 8, 10)),
    });
  });

  it('writes the body as email HTML — paragraphs survive the sequence template', () => {
    const props = nurtureSlotProperties([{ subject: 'A', body: 'Musa,\n\nFirst.\nSecond line.\n\nBest,' }]);

    expect(props.pn_email_1_body).toBe('<p>Musa,</p><p>First.<br>Second line.</p><p>Best,</p>');
    expect(props.pn_email_1_subject).toBe('A');
  });

  it('refuses more sends than slots rather than dropping copy', () => {
    expect(() => nurtureSlotProperties(Array.from({ length: 5 }, (_, i) => ({ subject: `S${i}`, body: 'b' })))).toThrow(/4 slots/);
  });

  it('reads a source config with defaults, and falls back to the defaults on a malformed one', () => {
    expect(readNurtureSlotsConfig({ maxSlots: 3 })).toMatchObject({ maxSlots: 3, sequencePrefix: 'Personalized Nurture' });
    expect(readNurtureSlotsConfig({ subjectProperty: 'no-placeholder' })).toEqual(readNurtureSlotsConfig(undefined));
  });

  it('carries a reviewer\'s formatting into the slot, unflattened', () => {
    // The whole point of the editor: what a reviewer composed is what the
    // ladder sends. Before this, the body was plain text and any formatting
    // a reviewer wanted had nowhere to live.
    const props = nurtureSlotProperties([
      { subject: 'Your platform hires', body: '<p>Rowan, saw the <strong>hires</strong>.</p><ul><li>One</li><li>Two</li></ul>' },
    ]);

    expect(props.pn_email_1_body).toBe('<p>Rowan, saw the <strong>hires</strong>.</p><ul><li>One</li><li>Two</li></ul>');
  });

  it('never lets markup a body should not carry reach the contact', () => {
    const props = nurtureSlotProperties([
      { subject: 'A', body: '<p>Hi</p><script>fetch("//evil.test")</script><img src="x" onerror="go()">' },
    ]);

    expect(props.pn_email_1_body).toBe('<p>Hi</p>');
  });
});

describe('ensureNurtureSlotProperties', () => {
  type Call = { method: 'GET' | 'POST'; path: string; body?: unknown };
  function fakeClient(existing: Set<string>, failOn?: string) {
    const calls: Call[] = [];
    const client = {
      get: async (path: string) => {
        calls.push({ method: 'GET', path });
        const name = path.split('/').pop()!;
        if (failOn && name === failOn) {
          return { ok: false as const, error: 'hubspot_error' as const, status: 500, message: 'portal down' };
        }
        return existing.has(name)
          ? { ok: true as const, data: { name } }
          : { ok: false as const, error: 'hubspot_error' as const, status: 404, message: 'not found' };
      },
      post: async (path: string, body: unknown) => {
        calls.push({ method: 'POST', path, body });
        return { ok: true as const, data: {} };
      },
    } as unknown as import('./client').HubspotClient;
    return { client, calls };
  }

  it('creates only the slot properties the portal lacks, and leaves the rest alone', async () => {
    const { client, calls } = fakeClient(new Set(['pn_email_1_subject', 'pn_email_1_body', 'pn_email_2_subject', 'pn_email_2_body', 'pn_email_3_subject', 'pn_email_3_body', 'pn_email_4_subject', 'pn_email_4_body']));
    const cfg = readNurtureSlotsConfig({ maxSlots: 5 });

    const res = await ensureNurtureSlotProperties(client, cfg, 5);

    expect(res).toEqual({ ok: true, data: { created: ['pn_email_5_subject', 'pn_email_5_body'] } });

    const posts = calls.filter(c => c.method === 'POST');

    expect(posts).toHaveLength(2);
    expect(posts[0]!.body).toMatchObject({ name: 'pn_email_5_subject', type: 'string', fieldType: 'text', groupName: 'contactinformation' });
    expect(posts[1]!.body).toMatchObject({ name: 'pn_email_5_body', type: 'string', fieldType: 'textarea' });
  });

  it('is two reads per slot and no writes when everything exists', async () => {
    const all = new Set(Array.from({ length: 4 }, (_, i) => [`pn_email_${i + 1}_subject`, `pn_email_${i + 1}_body`]).flat());
    const { client, calls } = fakeClient(all);

    const res = await ensureNurtureSlotProperties(client, readNurtureSlotsConfig({}), 4);

    expect(res).toEqual({ ok: true, data: { created: [] } });
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    expect(calls.filter(c => c.method === 'GET')).toHaveLength(8);
  });

  it('never checks beyond maxSlots, and hands back a portal error that is not a missing property', async () => {
    const { client, calls } = fakeClient(new Set(), 'pn_email_2_subject');

    const res = await ensureNurtureSlotProperties(client, readNurtureSlotsConfig({ maxSlots: 2 }), 9);

    expect(res).toMatchObject({ ok: false, status: 500 });
    // Slot 1 was created (two POSTs) before slot 2's read failed.
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(2);
    expect(calls.some(c => c.path.endsWith('pn_email_3_subject'))).toBe(false);
  });
});
