import { describe, expect, it } from 'vitest';
import { approveVerb, changeRows, shortTitle } from './mcpCard';

const RECLAIM = 'Reclaim (reclaim ai), Oct 12, $96.00 (Capital One Master Card): move from Operations:Software & SaaS (non-AI) to Operations:AI Vendors. Reclaim.ai is an AI scheduling assistant for Google/Outlook calendars (reclaim.ai, Google Workspace Marketplace). The Aug 9 charge (5633) is also in non-AI.';

describe('mcp.call card', () => {
  it('titles the card with the first sentence, cut at a word', () => {
    const t = shortTitle(RECLAIM);

    expect(t.length).toBeLessThanOrEqual(91);
    expect(t.startsWith('Reclaim (reclaim ai), Oct 12, $96.00')).toBe(true);
    expect(shortTitle('Move Granola to AI Vendors.')).toBe('Move Granola to AI Vendors');
  });

  it('reads a recategorization as from → to, with the names the summary gives, and drops plumbing', () => {
    const rows = changeRows({ line_id: '1', expense_id: '6278', to_account_id: '53', idempotency_key: 'bk-x', expected_account_id: '54', expected_sync_token: '0' }, RECLAIM);

    expect(rows).toEqual([
      { label: 'Account', value: 'Operations:Software & SaaS (non-AI) (54) → Operations:AI Vendors (53)' },
      { label: 'Line', value: '1' },
      { label: 'Expense', value: '6278' },
    ]);
  });

  it('says what approving does', () => {
    expect(approveVerb('Metacto Finance', 'finance-production', 'quickbooks_recategorize_expense')).toBe('Approve and update QuickBooks');
    expect(approveVerb('Linear', 'linear', 'create_issue')).toBe('Approve and run in Linear');
  });
});
