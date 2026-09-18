/**
 * Run one consolidation pass by hand — the same pass the feedback worker's
 * hourly tick runs when ENABLE_CONSOLIDATION=1 (per-org interval:
 * VOCION_CONSOLIDATION_INTERVAL_HOURS, default 24).
 *
 * Usage, from packages/core:
 *   npx dotenv -c -- tsx src/scripts/run-consolidation.ts --org <orgId>
 */

import { runConsolidation } from '@/services/ConsolidationService';

const i = process.argv.indexOf('--org');
const orgId = i >= 0 ? process.argv[i + 1] : undefined;
if (!orgId) {
  console.error('pass --org <orgId>');
  process.exit(1);
}

runConsolidation(orgId)
  .then((result) => {
    console.warn(`[consolidation] ${orgId}: ${result.compactions} merge proposal(s), ${result.proposed} mined rule(s) from ${result.mined} episode(s), ${result.amendments} amendment(s)`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
