/**
 * Write the HTML the `documents` E2E script plays with, from the fictional
 * Northwind fixture module. Run before the first scripted turn (the spec does
 * it in `beforeAll`); the scripted model reads `$file` refs lazily, so the
 * server may already be up.
 *
 *   npx tsx e2e/documents/support/write-fixtures.ts [outDir]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { northwindProposal } from '../../../src/libs/documents/__fixtures__/northwind';
import { parseSheets } from '../../../src/libs/documents/sheets';

const out = process.argv[2] ?? path.join(__dirname, '..', 'fixtures', 'generated');
mkdirSync(out, { recursive: true });

const v1 = northwindProposal();
writeFileSync(path.join(out, 'northwind-v1.html'), v1);
writeFileSync(path.join(out, 'northwind-overflow.html'), northwindProposal({ overflowSheet: true }));

// The third agent's sheet and the per-role pricing sheet, as the sheet-level
// edits the script plays ("make it three agents", "price it per opening").
const three = parseSheets(northwindProposal({ threeAgents: true, pricePerRole: true, version: '1.1' }));
writeFileSync(path.join(out, 'sheet-agent-3.html'), three.sheets[4]!.html);
writeFileSync(path.join(out, 'sheet-pricing-per-role.html'), three.sheets[5]!.html);
// The screener sheet trimmed back to size — what the agent sends to fix an overflow.
writeFileSync(path.join(out, 'sheet-screener-trimmed.html'), parseSheets(v1).sheets[2]!.html);

console.warn(`fixtures written to ${out}`);
