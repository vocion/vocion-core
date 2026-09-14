/**
 * The sentences a tool page shows about whose key it spends, and the lookup
 * behind the name a replacement key inherits.
 *
 * These lived inside the tool detail page. They are here because they are the
 * decisions on that page rather than its markup — which sentence a member
 * reads, and what a replaced credential ends up called — and a decision that
 * only a server component can reach is a decision nobody can test.
 */

import type { CredentialPlatformId } from '@/libs/platforms/registry';
import { listPlatformCredentials } from '@/services/ApiTokenService';

/**
 * What a member — someone who cannot store keys — is told about this tool.
 *
 * Three states, not two. "The workspace has no key of its own" is not the same
 * as "no key exists": a deployment that sets the server's env var runs this
 * tool perfectly well, and asking that member to go find an admin would
 * contradict the green "Ready" badge printed directly above the sentence.
 * @param platformLabel - The vendor's name, e.g. `Tavily`.
 * @param workspaceHasKey - Whether this workspace stored a key of its own.
 * @param serverHasKey - Whether the deployment's own key is covering the call.
 */
export function memberKeyExplanation(
  platformLabel: string,
  workspaceHasKey: boolean,
  serverHasKey: boolean,
): string {
  if (workspaceHasKey) {
    return `This tool runs on this workspace's own ${platformLabel} key. A workspace admin can change it under API credentials.`;
  }
  if (serverHasKey) {
    return `This tool runs on the Vocion server's ${platformLabel} key. A workspace admin can put this workspace on its own key under API credentials.`;
  }
  return `This tool runs on a ${platformLabel} key. Ask a workspace admin to add one under API credentials.`;
}

/**
 * What the workspace calls the key it currently holds for `platform`.
 *
 * The card needs it because saving replaces the row rather than editing it,
 * and a replacement has to carry a name. Inventing one there would rename
 * whatever the admin called this credential on the credentials screen — on
 * OpenAI, the same one their chat and embeddings spend.
 *
 * Null when there is nothing live to replace, which is also what the card
 * treats as "this is a first key, name it after the platform". An expired row
 * is not something to inherit a name from: the vendor has already stopped
 * honouring it, and carrying its name onto a fresh key would hide that a
 * different credential is now in play.
 * @param orgId - The workspace whose credential to look at.
 * @param platformId - The platform the key is stored under.
 */
export async function liveCredentialName(
  orgId: string,
  platformId: CredentialPlatformId,
): Promise<string | null> {
  const credentials = await listPlatformCredentials(orgId, platformId);
  const live = credentials.find(credential =>
    credential.expiresAt === null || credential.expiresAt.getTime() > Date.now());
  return live?.name ?? null;
}
