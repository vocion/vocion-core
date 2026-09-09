/**
 * "Sources" reads "connectors" everywhere a person can see it.
 *
 * Only the sidebar nav label still comes from the locale files. The dashboard
 * pages that used to hold this copy — the `Connectors`, `Objects`, `Search`
 * and `DashboardIndex` namespaces — no longer read from next-intl at all, and
 * their keys have been removed as unused. The assertions that covered them
 * went with the keys: asserting on a message tree nothing renders proves
 * nothing. If those pages are put back on next-intl, bring the assertions back
 * with them.
 */
import { describe, expect, it } from 'vitest';
import en from './en.json';
import fr from './fr.json';

describe('the nav item', () => {
  it('reads Connectors, not Sources', () => {
    // The key name stays `sources` — internal identifiers are unchanged, and
    // only the value is what anybody reads.
    expect(en.DashboardLayout.sources).toBe('Connectors');
    expect(fr.DashboardLayout.sources).toBe('Connecteurs');
  });
});
