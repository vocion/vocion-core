import { describe, expect, it } from 'vitest';
import { itemTitle, queuePosition, toggleType, typeLabel } from './reviewQueueModel';

const TYPES = [
  { actionId: 'hubspot.update', label: 'Update HubSpot record', count: 101 },
  { actionId: 'personalization.enroll', label: 'Enroll MQL in sequence', count: 82 },
];

describe('toggleType', () => {
  it('adds a type that is not active and removes one that is', () => {
    expect(toggleType([], 'hubspot.update')).toEqual(['hubspot.update']);
    expect(toggleType(['hubspot.update'], 'personalization.enroll')).toEqual(['hubspot.update', 'personalization.enroll']);
    expect(toggleType(['hubspot.update', 'personalization.enroll'], 'hubspot.update')).toEqual(['personalization.enroll']);
  });

  it('turning the last chip off returns to All', () => {
    expect(toggleType(['hubspot.update'], 'hubspot.update')).toEqual([]);
  });
});

describe('typeLabel', () => {
  it('uses the registered name and falls back to the id', () => {
    expect(typeLabel(TYPES, 'hubspot.update')).toBe('Update HubSpot record');
    expect(typeLabel(TYPES, 'gmail.send')).toBe('gmail.send');
  });
});

describe('queuePosition', () => {
  it('is 1-based against the real total', () => {
    expect(queuePosition(2, 213)).toBe('3 of 213');
    expect(queuePosition(0, 1)).toBe('1 of 1');
  });

  it('treats an unknown index as the first item and never exceeds the total', () => {
    expect(queuePosition(-1, 5)).toBe('1 of 5');
    expect(queuePosition(9, 5)).toBe('5 of 5');
  });

  it('is empty for an empty queue', () => {
    expect(queuePosition(0, 0)).toBe('');
  });
});

describe('itemTitle', () => {
  it('leads with the type and names the subject and company', () => {
    expect(itemTitle({ label: 'Enroll MQL in sequence', title: 'New MQL ready to enroll', subject: { name: 'Dev Okonkwo', company: 'Vantage Automation' } }))
      .toBe('Enroll MQL in sequence — Dev Okonkwo · Vantage Automation');
  });

  it('omits the company when absent and falls back to the card title without a subject', () => {
    expect(itemTitle({ label: 'Send email', title: 'SEND email → x', subject: { name: 'Dana' } })).toBe('Send email — Dana');
    expect(itemTitle({ label: 'Update HubSpot record', title: 'Update HubSpot deal record' })).toBe('Update HubSpot deal record');
  });
});
