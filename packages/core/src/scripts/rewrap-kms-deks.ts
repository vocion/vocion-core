#!/usr/bin/env tsx
/**
 * Bind every KMS-wrapped DEK to its org, and say whether the unbound fallback
 * can be closed.
 *
 * The KMS vault wraps each org's DEK under the EncryptionContext `{ orgId }`.
 * DEKs wrapped before that still open through a fallback and are re-wrapped
 * when they are next read, but a DEK nobody reads stays unbound, and while the
 * fallback is open an unbound blob planted on another org's row opens there.
 * This re-wraps them all now, so the fallback can be turned off with evidence
 * rather than hope: it exits 0 only when no DEK still needs it, and then
 * `VOCION_KMS_ALLOW_UNBOUND_DEKS=0` is safe to set.
 *
 * Idempotent. A fresh deployment has nothing to re-wrap and can set the
 * variable without running this. Needs the vault role's KMS permissions plus
 * `kms:ReEncryptFrom` and `kms:ReEncryptTo`.
 *
 * Usage: npm run vault:rewrap-deks [-- --dry-run]
 */
import process from 'node:process';
import { bindKmsDeks } from '@/libs/crypto/kmsVault';

async function main() {
  const kmsKeyArn = process.env.VOCION_KMS_KEY_ARN;
  if (!kmsKeyArn) {
    console.error('VOCION_KMS_KEY_ARN is not set. This re-wraps the DEKs under that key; a deployment on the local vault has none.');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const report = await bindKmsDeks({ kmsKeyArn, dryRun });

  console.log(`${report.total} DEK(s) under ${kmsKeyArn}${dryRun ? ' (dry run: nothing written)' : ''}:`);
  console.log(`  ${report.bound} already bound to their org`);
  console.log(`  ${report.rewrapped} ${dryRun ? 'would be re-wrapped' : 're-wrapped'} under their org`);
  if (report.unopenable.length > 0) {
    console.log(`  ${report.unopenable.length} open under neither their own org nor none — another org's blob or damaged, so no setting opens them. Their credentials need reconnecting. DEK ids: ${report.unopenable.join(', ')}`);
  }
  for (const { dekId, message } of report.failed) {
    console.log(`  DEK ${dekId}: KMS refused (${message})`);
  }

  if (report.fallbackStillNeeded) {
    console.log(dryRun
      ? 'Some DEKs still need the unbound fallback. Run without --dry-run to re-wrap them.'
      : 'Some DEKs could not be checked or re-wrapped. Fix the KMS refusals above and run this again before setting VOCION_KMS_ALLOW_UNBOUND_DEKS=0.');
    process.exit(1);
  }
  console.log('Every DEK that opens is bound to its org. VOCION_KMS_ALLOW_UNBOUND_DEKS=0 is safe to set.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Re-wrap failed:', err);
  process.exit(1);
});
