import { describe, expect, it } from 'vitest';
import { buildRecordGrounding, describeRecordGrounding } from './recordGrounding';

const REQUEST = { id: 201, typeSlug: 'request', title: 'Document detail page is not scoped to the selected org', status: 'approved', fields: { state: 'building', kind: 'bug', why: ['production_bug'] } };

describe('the record on the page travels with the turn (conversation 378)', () => {
  it('carries the record\'s fields, what is filed under it, and what waits on the person with the call that decides it', () => {
    const text = describeRecordGrounding(
      REQUEST,
      [
        { id: 215, typeSlug: 'architecture_plan', title: 'Scope document detail reads to the acting org', status: 'approved', state: 'approvedBy the trust bar (factory.approve_plan)' },
        { id: 203, typeSlug: 'engineering_task', title: 'Document detail page is not scoped', status: 'dispatched', state: 'runStatus failed' },
      ],
      [
        { kind: 'proposal', id: 5201, title: 'factory.dispatch_task: Plan #215 is now approved', actionId: 'factory.dispatch_task' },
        { kind: 'ask', id: 221, title: 'Stopped: Document detail page is not scoped to the selected org', options: [] },
      ],
    );

    expect(text).toContain('--- the request on this page (read now, canonical) ---');
    expect(text).toContain('request #201 "Document detail page is not scoped to the selected org" — status approved');
    expect(text).toContain('"state":"building"');
    expect(text).toContain('architecture plan #215 "Scope document detail reads to the acting org" — approved (approvedBy the trust bar (factory.approve_plan))');
    expect(text).toContain('decide_proposal id 5201');
    expect(text).toContain('decide_ask id 221');
    expect(text).toContain('never say you cannot see it');
  });

  it('a long record is cut with the read that gets the rest', () => {
    const text = describeRecordGrounding({ ...REQUEST, fields: { story: 'x'.repeat(9_000) } }, [], []);

    expect(text).toContain('[the rest: read_object request 201]');
    expect(text).not.toContain('Filed under it');
    expect(text).not.toContain('Waiting on the person');
  });

  it('is nothing on a page that shows no record', async () => {
    expect(await buildRecordGrounding('org', null)).toBeNull();
    expect(await buildRecordGrounding('org', { path: '/w/x/dashboard', title: 'Home' } as never)).toBeNull();
    expect(await buildRecordGrounding('org', { path: '/w/x/dashboard/artifacts/9', title: 'Brief', record: { type: 'artifact', id: '9' } } as never)).toBeNull();
  });
});
