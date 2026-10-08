/**
 * How core reads the extensions a package provides: every list in extension
 * order, a page found by name (and never through the prototype), an Org hook
 * that throws lifting nothing.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@vocion/enterprise/index', () => {
  const guardA = async () => null;
  const guardB = async () => null;
  const observer = async () => {};
  const Page = () => null;
  const Slot = () => null;
  return {
    extensions: [
      { name: 'first', budgetGuards: [guardA], chargeObservers: [observer], router: { ping: 'first-ping' }, pages: { first: Page }, slots: { 'system.actions': [Slot] }, orgs: { multiOrg: () => {
        throw new Error('misconfigured');
      } } },
      { name: 'second', budgetGuards: [guardB], orgs: { multiOrg: () => true, scopeWorkspaceSwitcher: true } },
      { name: 'third' },
    ],
  };
});

const lib = await import('./extensions');

describe('extensions a package provides', () => {
  it('lists each seam across extensions, in extension order', () => {
    expect(lib.extensions().map(e => e.name)).toEqual(['first', 'second', 'third']);
    expect(lib.budgetGuards()).toHaveLength(2);
    expect(lib.chargeObservers()).toHaveLength(1);
    expect(lib.slotComponents('system.actions')).toHaveLength(1);
    expect(lib.slotComponents('spend.stats')).toEqual([]);
  });

  it('serves each router under its extension\'s name, and only those that have one', () => {
    expect(lib.extensionRouters()).toEqual({ first: { ping: 'first-ping' } });
  });

  it('finds a page by name and nothing for an unknown or inherited name', () => {
    expect(lib.extensionPage('first')).toBeTypeOf('function');
    expect(lib.extensionPage('second')).toBeNull();
    expect(lib.extensionPage('constructor')).toBeNull();
    expect(lib.extensionPage('toString')).toBeNull();
  });

  it('lifts the single-Org rule when any extension says so, ignoring one whose hook throws', () => {
    expect(lib.extensionAllowsMultiOrg()).toBe(true);
    expect(lib.extensionScopesSwitcherToOrg()).toBe(true);
  });
});
