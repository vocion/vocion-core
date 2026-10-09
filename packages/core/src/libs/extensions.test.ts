/**
 * Core without an enterprise package: `@vocion/enterprise` resolves to the
 * empty stub, and every seam is a no-op. This is the build every self-hosted
 * installation and this repository's CI run.
 */
import { describe, expect, it } from 'vitest';
import { clientExtensions, navSlotComponents } from './clientExtensions';
import {
  budgetGuards,
  chargeObservers,
  extensionAllowsMultiOrg,
  extensionPage,
  extensionRouters,
  extensions,
  extensionWhiteLabel,
  slotComponents,
} from './extensions';

describe('core with no extension built in', () => {
  it('has no extensions and every seam is empty', () => {
    expect(extensions()).toEqual([]);
    expect(budgetGuards()).toEqual([]);
    expect(chargeObservers()).toEqual([]);
    expect(extensionRouters()).toEqual({});
    expect(extensionPage('operator')).toBeNull();
    expect(slotComponents('system.actions')).toEqual([]);
    expect(slotComponents('spend.stats')).toEqual([]);
  });

  it('keeps the single-Org rule', () => {
    expect(extensionAllowsMultiOrg()).toBe(false);
  });

  it('keeps "Powered by Vocion": white-labelling is not core', () => {
    expect(extensionWhiteLabel()).toBe(false);
  });

  it('puts nothing in the sidebar', () => {
    expect(clientExtensions()).toEqual([]);
    expect(navSlotComponents('nav.workspacePicker.org')).toEqual([]);
  });
});
