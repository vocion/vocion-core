import type { KeyOnFile, KeyScope, SystemKeyStatus } from '@/services/keys/systemKeys';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { amplitudeKeyStatus } from '@/services/analytics/amplitudeKey';
import { orgsMode } from '@/services/OrgPolicy';
import { jevKeyStatus } from '@/services/routing/jevKey';
import { AmplitudeKeyCard } from './AmplitudeKeyCard';
import { JevKeyCard } from './JevKeyCard';

/**
 * SYSTEM KEYS on a settings page: the keys that switch on optional services,
 * one card each: Jev (dynamic routing, ADR 0006) and Amplitude (analytics).
 * System shows the instance level; Developers shows this workspace's
 * override, under Workspace Keys.
 * @param props - Where it sits.
 * @param props.scope - `instance` (System) or `workspace` (Developers).
 * @param props.orgId - The viewer's workspace.
 * @param props.isAdmin - Whether the viewer may set the keys.
 */
export async function SystemKeysSection({ scope, orgId, isAdmin }: { scope: KeyScope; orgId: string; isAdmin: boolean }) {
  const [jev, amplitude] = await Promise.all([jevKeyStatus(orgId), amplitudeKeyStatus(orgId)]);
  const multi = scope === 'instance' && orgsMode() === 'multi';
  const lockFor = (envVar: string) => (multi ? `This server holds several Orgs, so this key is set in the server environment (${envVar}).` : null);
  const onFileOf = <T extends KeyOnFile>(status: { instance: T | null; workspace: T | null }): T | null => (scope === 'instance' ? status.instance : status.workspace);
  const noteOf = (status: Pick<SystemKeyStatus, 'instance' | 'workspace'>): string | null => {
    if (scope === 'instance') {
      return null;
    }
    return status.instance && !status.workspace ? `Overrides the instance key (${status.instance.hint}).` : 'Overrides the instance key.';
  };
  return (
    <DashboardSection title={scope === 'instance' ? 'System Keys' : 'Workspace Keys'}>
      <div className="grid gap-3">
        <JevKeyCard scope={scope} onFile={onFileOf(jev)} note={noteOf(jev)} canEdit={isAdmin} lock={lockFor('TYPESAFE_API_KEY')} />
        <AmplitudeKeyCard scope={scope} onFile={onFileOf(amplitude)} note={noteOf(amplitude)} canEdit={isAdmin} lock={lockFor('AMPLITUDE_API_KEY')} />
      </div>
    </DashboardSection>
  );
}
