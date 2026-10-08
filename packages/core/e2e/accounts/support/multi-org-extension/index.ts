/**
 * A stand-in enterprise extension that lifts the single-Org rule the
 * conventional way, from `VOCION_ORGS=multi` (`libs/extensions.ts`), so the
 * accounts spec's multi-Org case can run against a local server:
 *
 *   VOCION_ENTERPRISE_DIR=e2e/accounts/support/multi-org-extension \
 *     VOCION_ORGS=multi npx playwright test --project=accounts
 *
 * Test-only. Nothing in core imports it; the build-time loader snapshots it
 * when that variable points here (`libs/enterpriseCheckout.ts`).
 */
import process from 'node:process';

export const extensions = [
  { name: 'e2e-multi-org', orgs: { multiOrg: () => process.env.VOCION_ORGS === 'multi' } },
];
