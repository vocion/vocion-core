import type { KeyScope } from '@/services/routing/jevKey';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { Link } from '@/libs/I18nNavigation';
import { orgsMode } from '@/services/OrgPolicy';
import { jevSettings } from '@/services/routing/jev';
import { jevKeyStatus } from '@/services/routing/jevKey';
import { JevKeyCard } from './JevKeyCard';

/**
 * DYNAMIC ROUTING (ADR 0006) on a settings page: the Jev key at one level,
 * and what a run in this workspace uses right now. System shows the instance
 * level; Developers shows this workspace's override.
 * @param props - Where it sits.
 * @param props.scope - `instance` (System) or `workspace` (Developers).
 * @param props.orgId - The viewer's workspace.
 * @param props.isAdmin - Whether the viewer may set the key.
 */
export async function JevRoutingSection({ scope, orgId, isAdmin }: { scope: KeyScope; orgId: string; isAdmin: boolean }) {
  const status = await jevKeyStatus(orgId);
  const lock = scope === 'instance' && orgsMode() === 'multi'
    ? 'This server holds several Orgs, so the instance key is set in the server environment (VOCION_JEV_API_KEY), not here.'
    : null;
  const onFile = scope === 'instance' ? status.instance : status.workspace;
  const otherwise = scope === 'instance'
    ? (status.workspace ? 'This workspace runs on its own key (Developers).' : 'Without a key here or on a workspace, routing is static.')
    : (status.instance ? `Runs here use the instance key (${status.instance.hint}).` : 'With no instance key either, routing here is static.');
  const now = status.effective
    ? `On here, on the ${status.effective} key.`
    : 'Off here: every run takes the static route.';
  return (
    <DashboardSection
      title="Dynamic routing (Jev)"
      description={`Jev, TypeSafe's decision model on OpenRouter, picks each factory run's engine, model and effort from the seat's candidates; anything it cannot decide takes the static route. A key turns it on. ${now}`}
    >
      <JevKeyCard scope={scope} onFile={onFile} otherwise={otherwise} canEdit={isAdmin} lock={lock} jevModel={jevSettings().model} />
      <p className="mt-3 text-[12px] text-muted-foreground">
        {scope === 'instance'
          ? 'A workspace can use its own key instead, for its own tracking: Developers → Dynamic routing. '
          : 'The instance key is on System → Dynamic routing. '}
        How each run was routed is on
        {' '}
        <Link href="/dashboard/p/engines" className="underline underline-offset-2">Engines</Link>
        .
      </p>
    </DashboardSection>
  );
}
