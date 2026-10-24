import { describe, expect, it } from 'vitest';
import { copyOf, landedOf, outboundEntry } from './outboundHistory';

const row = {
  id: 9353,
  actionId: 'gmail.send',
  status: 'done',
  input: { to: 'dana@kestrel.example', subject: 'Next steps', body: 'Hi Dana,\n\nThanks for the time.', draft: true, baseUrl: 'https://gmail.googleapis.com/gmail/v1', attachments: [{ artifactId: 5 }] },
  result: { mode: 'draft', threadId: 't-1', messageId: 'm-1', link: 'https://mail.google.com/mail/#drafts', attachments: [{ bytes: 10 }] },
  error: null,
  invokedBy: 'agent:followup-writer',
  proposal: { agentSlug: 'followup-writer' },
  revisions: [{ kind: 'approved', version: 2, body: 'Hi Dana,\n\nThanks for the time.', contentId: 'message', at: '2026-10-23T19:36:31.791Z' }],
  createdAt: new Date('2026-10-23T19:09:51.992Z'),
  decidedAt: new Date('2026-10-23T21:30:58.269Z'),
  executedAt: new Date('2026-10-23T21:30:59.724Z'),
};

describe('list_outbound_history', () => {
  it('keeps the words of a payload and drops links, flags and ids', () => {
    expect(copyOf(row.input)).toEqual({ to: 'dana@kestrel.example', subject: 'Next steps', body: 'Hi Dana,\n\nThanks for the time.', attachments: [{}] });
  });

  it('reads a sequence\'s sends the same way, with no action named', () => {
    expect(copyOf({ contactName: 'Dana Reyes', sends: [{ step: 1, subject: 'A', body: 'One' }, { step: 2, subject: 'B', body: 'Two' }] }))
      .toEqual({ contactName: 'Dana Reyes', sends: [{ subject: 'A', body: 'One' }, { subject: 'B', body: 'Two' }] });
  });

  it('says where a run landed, so the sent version is one read away', () => {
    expect(landedOf(row.result)).toEqual({ mode: 'draft', threadId: 't-1', messageId: 'm-1', link: 'https://mail.google.com/mail/#drafts' });
  });

  it('names the agent, the decision dates and each revision by kind', () => {
    const e = outboundEntry(row);

    expect(e).toMatchObject({ action: 'gmail.send', status: 'done', agent: 'followup-writer', decidedAt: '2026-10-23T21:30:58.269Z', landed: { threadId: 't-1' } });
    expect(e.revisions).toEqual([{ kind: 'approved', version: 2, contentId: 'message', at: '2026-10-23T19:36:31.791Z', body: 'Hi Dana,\n\nThanks for the time.' }]);
  });

  it('cuts a very long field and says how long it was', () => {
    const long = 'x'.repeat(7000);

    expect(String(copyOf({ body: long }).body)).toMatch(/… \[7000 chars\]$/);
  });
});
