import { getAction } from '@/libs/actions/registry';
import { explainPermissionError } from '@/libs/connect/permissionError';
import { providerFor } from '@/libs/connect/registry';
import { sourceSlugOf } from '@/services/ActionService';
import { getCredentialsForSource } from '@/services/SourceCredentialService';

/**
 * WHETHER THE ACCESS A FAILED RUN LACKED IS NOW IN PLACE.
 *
 * A run that failed because its connection could not do the thing (Gmail
 * read-only asked for a draft) says so, with a reconnect that asks for the
 * missing access (`libs/connect/permissionError.ts`). Once the person has
 * reconnected, that banner is stale: it should say the access is there and
 * the run can go again (a failed run is retryable, #1423).
 *
 * Read from the stored grant the run will spend, never by calling the vendor:
 * true when the grant now holds the access, false when it still does not, and
 * null when it cannot be told (not a permission failure, no access named, a
 * grant that does not record its scopes). Never throws; a failure to read is
 * null, and the banner keeps the reconnect.
 * @param orgId - The workspace.
 * @param run - The failed run.
 * @param run.actionId - Its action.
 * @param run.input - Its input, for the action's per-input source.
 * @param run.error - What it recorded.
 */
export async function accessGrantedSince(orgId: string, run: { actionId: string; input: Record<string, unknown> | null; error: string | null }): Promise<boolean | null> {
  const problem = explainPermissionError(run.error, run.actionId);
  if (!problem || problem.kind !== 'scope' || !problem.access) {
    return null;
  }
  const provider = providerFor(problem.provider);
  const action = getAction(run.actionId);
  if (!provider?.hasAccess || !action) {
    return null;
  }
  const source = sourceSlugOf(action, run.input) ?? problem.connector;
  try {
    const credentials = await getCredentialsForSource(orgId, source);
    return credentials ? provider.hasAccess(credentials, problem.connector, problem.access) : null;
  } catch {
    return null;
  }
}
