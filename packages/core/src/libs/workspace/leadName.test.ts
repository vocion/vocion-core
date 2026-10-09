import { describe, expect, it } from 'vitest';
import { isSeededLead, leadGivenName, leadName, leadWorkspaceLabel } from './leadName';

describe('what a workspace\'s lead is called (founder, 2026-10-09)', () => {
  it('is "<workspace> lead", never "Workspace lead"', () => {
    expect(leadName({ agentName: 'Workspace lead', workspaceLabel: 'Revenue' })).toEqual({ given: null, role: 'Revenue lead', label: 'Revenue lead', short: 'Revenue lead' });
    expect(leadName({ agentName: 'Lead', workspaceLabel: 'Support' }).label).toBe('Support lead');
  });

  it('carries a given name when the Org gave one', () => {
    expect(leadName({ agentName: 'Ava', workspaceLabel: 'Revenue' })).toEqual({ given: 'Ava', role: 'Revenue lead', label: 'Ava · Revenue lead', short: 'Ava' });
    expect(leadGivenName('  ')).toBeNull();
  });

  it('builds the role from the workspace\'s current short name: the Org\'s for a default project, cut when long', () => {
    expect(leadWorkspaceLabel('Northwind', 'Default project')).toBe('Northwind');
    expect(leadWorkspaceLabel('Northwind', 'Northwind Field Ops')).toBe('Field Ops');
    expect(leadWorkspaceLabel('Northwind', 'Revenue')).toBe('Revenue');
    expect(leadWorkspaceLabel('Northwind', 'Customer Success and Renewals')).toBe('Customer');

    const long = leadWorkspaceLabel('Kestrel', 'Supercalifragilisticexpialidociousness');

    expect(long.length).toBeLessThanOrEqual(24);
    expect(long.endsWith('…')).toBe(true);
  });

  it('applies to the seeded lead only', () => {
    expect(isSeededLead('workspace-lead')).toBe(true);
    expect(isSeededLead('assistant')).toBe(false);
  });
});
