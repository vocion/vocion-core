import { describe, expect, it } from 'vitest';
import { planHandBack } from './relayOwnership';

const enrolledAt = new Date('2026-10-19T17:00:00Z');
const enrollment = { contactId: '9412', enrolledAt, senderOwnerId: '501', relayOwnerId: '502', ownerBefore: null };
const task = (id: string, owner: string, created: string, status = 'NOT_STARTED') => ({ id, properties: { hubspot_owner_id: owner, hs_task_status: status, hs_createdate: created } });

describe('handing back what a relayed enrollment gave the colleague', () => {
  it('moves the sequence\'s open tasks and the contact HubSpot gave the relay user', () => {
    const plan = planHandBack([enrollment], { 9412: '502' }, {
      9412: [task('t1', '502', '2026-10-19T17:00:20Z'), task('t2', '502', '2026-10-21T17:00:00Z')],
    });

    expect(plan).toEqual({
      contacts: [{ id: '9412', ownerId: '501' }],
      tasks: [{ id: 't1', ownerId: '501' }, { id: 't2', ownerId: '501' }],
    });
  });

  it('gives the contact back to whoever owned it before the enrollment', () => {
    const plan = planHandBack([{ ...enrollment, ownerBefore: '777' }], { 9412: '502' }, {});

    expect(plan.contacts).toEqual([{ id: '9412', ownerId: '777' }]);
  });

  it('leaves alone what the relay user owned before, finished tasks, and anyone else\'s', () => {
    const plan = planHandBack([{ ...enrollment, ownerBefore: '502' }], { 9412: '502' }, {
      9412: [
        task('older', '502', '2026-10-01T00:00:00Z'),
        task('done', '502', '2026-10-20T00:00:00Z', 'COMPLETED'),
        task('theirs', '640', '2026-10-20T00:00:00Z'),
      ],
    });

    expect(plan).toEqual({ contacts: [], tasks: [] });
  });

  it('does nothing once the sender already owns everything', () => {
    expect(planHandBack([enrollment], { 9412: '501' }, { 9412: [task('t1', '501', '2026-10-20T00:00:00Z')] })).toEqual({ contacts: [], tasks: [] });
  });
});
