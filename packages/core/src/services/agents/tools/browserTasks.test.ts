import { describe, expect, it } from 'vitest';
import { outputsForAgent } from './browserTasks';

describe('a done browser run\'s outputs, as the agent receives them', () => {
  const result = { total_unpaid: 40_689.35, unpaid_invoices: [{ number: 'FS-10563', amount: 9874 }, { number: 'FS-10598', amount: 3150.75 }] };

  it('gives single values, and a table only as its size and columns: the run draws the rows', () => {
    expect(outputsForAgent(result)).toEqual({ total_unpaid: 40_689.35, unpaid_invoices: { shown_under_your_answer: true, rows: 2, columns: ['number', 'amount'] } });
  });

  it('hands the rows over numbered in the page\'s order when asked for them', () => {
    expect(outputsForAgent(result, true)).toEqual({ total_unpaid: 40_689.35, unpaid_invoices: [{ '#': 1, 'number': 'FS-10563', 'amount': 9874 }, { '#': 2, 'number': 'FS-10598', 'amount': 3150.75 }] });
  });

  it('has nothing to give when the run found nothing', () => {
    expect(outputsForAgent(null)).toBeNull();
  });
});
