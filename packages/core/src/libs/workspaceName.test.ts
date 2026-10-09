import { describe, expect, it } from 'vitest';
import { wordsFromAddress, workspaceDisplayName } from './workspaceName';

describe('workspaceDisplayName', () => {
  it('passes a human name through, including one that starts with "Project"', () => {
    expect(workspaceDisplayName({ id: 'proj-1', slug: 'northwind', name: 'Northwind' })).toEqual({ name: 'Northwind', placeholder: false });
    expect(workspaceDisplayName({ id: 'proj-2', slug: 'apollo', name: 'Project Apollo' })).toEqual({ name: 'Project Apollo', placeholder: false });
  });

  it('turns the 0022 backfill shape back into words, marked as a placeholder', () => {
    expect(workspaceDisplayName({ id: 'proj-proj-northwind-0a1b2c3d4e5f60718293a4b5c6d7e8f9', slug: 'org-proj-northwind-0a1b2c3d4e5f60718293a4b5c6d7e8f9', name: 'Project proj-northwind-0a1b2c3d4e5f60718293a4b5c6d7e8f9' }))
      .toEqual({ name: 'Northwind (placeholder)', placeholder: true });
    expect(workspaceDisplayName({ id: 'proj-proj-kestrel-ops-9f3e1', slug: 'org-x', name: 'Project proj-kestrel-ops-9f3e1d07b2' }).name).toBe('Kestrel Ops (placeholder)');
  });

  it('never shows the slug or id as a name', () => {
    expect(workspaceDisplayName({ id: 'proj-9', slug: 'bellwater-hall', name: 'bellwater-hall' })).toEqual({ name: 'Bellwater Hall', placeholder: true });
    expect(workspaceDisplayName({ id: 'proj-acme-field-1a2b3c4d', slug: 'x1', name: 'proj-acme-field-1a2b3c4d' }).name).toBe('Acme Field');
    expect(workspaceDisplayName({ id: 'proj-1', slug: 'contoso', name: '  ' }).name).toBe('Contoso');
  });

  it('falls back to a calm label when nothing human is left', () => {
    expect(workspaceDisplayName({ id: 'proj-7d2a9c41e8b05f36', slug: '7d2a9c41e8b05f36', name: '' })).toEqual({ name: 'Untitled workspace', placeholder: true });
  });
});

describe('wordsFromAddress', () => {
  it('drops the id scheme prefixes and every id-like segment', () => {
    expect(wordsFromAddress('proj-larkfield-factory-9f3e1d07b2c45a6e8d10f7c3b9a2e4d6')).toBe('Larkfield Factory');
    expect(wordsFromAddress('org-proj-larkfield-systems-4e6b1f20a9d37c58')).toBe('Larkfield Systems');
    expect(wordsFromAddress('proj-1234')).toBeNull();
  });
});
