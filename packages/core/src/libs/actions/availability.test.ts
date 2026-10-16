import { describe, expect, it } from 'vitest';
import { actionConnectionGuidance, actionInSourceScope } from './availability';

const ledger = { id: 'finance.recategorize_expense', sourceKinds: ['quickbooks'] };
const mcp = { connectorSources: ['ledger'], sourceKinds: { ledger: 'mcp' } };

describe('source-aware action discovery', () => {
  it('hides a native ledger action for an MCP workspace and preserves generic actions', () => {
    expect(actionInSourceScope(ledger, mcp)).toBe(false);
    expect(actionInSourceScope({}, mcp)).toBe(true);

    const guidance = actionConnectionGuidance(ledger, mcp)!;

    expect(guidance).toContain('mcp_list_tools');
    expect(guidance).toContain('propose mcp.call');
    expect(guidance).toContain('not evidence that MCP is disconnected');
  });

  it('offers setup when no connection exists, without requesting credentials in chat', () => {
    const guidance = actionConnectionGuidance(ledger, { connectorSources: [] })!;

    expect(guidance).toContain('offer_connection');
    expect(guidance).toContain('where_to');
    expect(guidance).toContain('Nothing was proposed or changed');
  });

  it('supports a renamed native source but does not expose it past the user ACL', () => {
    const scope = { connectorSources: ['books'], sourceKinds: { books: 'quickbooks' } };

    expect(actionInSourceScope(ledger, scope)).toBe(true);
    expect(actionConnectionGuidance(ledger, scope)).toBeUndefined();
    expect(actionInSourceScope(ledger, { ...scope, allowedSourceSlugs: [] })).toBe(false);
  });

  it('does not leak inaccessible MCP source names in setup guidance', () => {
    const guidance = actionConnectionGuidance(ledger, { ...mcp, allowedSourceSlugs: [] })!;

    expect(guidance).not.toContain('assigned MCP source');
    expect(guidance).toContain('offer_connection');
  });

  it('does not offer native invoice creation for a ledger-only provider', () => {
    expect(actionInSourceScope({ sourceKinds: ['stripe'] }, { connectorSources: ['quickbooks'] })).toBe(false);
  });
});
