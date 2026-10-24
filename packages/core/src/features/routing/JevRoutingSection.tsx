import type { KeyScope } from '@/services/routing/jevKey';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { orgsMode } from '@/services/OrgPolicy';
import { jevKeyStatus } from '@/services/routing/jevKey';
import { JevKeyCard } from './JevKeyCard';

/**
 * SYSTEM KEYS on a settings page: the keys that switch on optional services,
 * one card each. Today that is the Jev key (dynamic routing, ADR 0006) at one
 * level. System shows the instance level; Developers shows this workspace's
 * override, under Workspace Keys.
 * @param props - Where it sits.
 * @param props.scope - `instance` (System) or `workspace` (Developers).
 * @param props.orgId - The viewer's workspace.
 * @param props.isAdmin - Whether the viewer may set the key.
 */
export async function JevRoutingSection({ scope, orgId, isAdmin }: { scope: KeyScope; orgId: string; isAdmin: boolean }) {
  const status = await jevKeyStatus(orgId);
  const lock = scope === 'instance' && orgsMode() === 'multi'
    ? 'This server holds several Orgs, so this key is set in the server environment (TYPESAFE_API_KEY).'
    : null;
  const onFile = scope === 'instance' ? status.instance : status.workspace;
  const note = scope === 'workspace'
    ? (status.instance && !onFile ? `Overrides the instance key (${status.instance.hint}).` : 'Overrides the instance key.')
    : null;
  return (
    <DashboardSection title={scope === 'instance' ? 'System Keys' : 'Workspace Keys'}>
      <div className="grid gap-3">
        <JevKeyCard scope={scope} onFile={onFile} note={note} canEdit={isAdmin} lock={lock} />
      </div>
    </DashboardSection>
  );
}
