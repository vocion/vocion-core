'use client';

import * as amplitude from '@amplitude/unified';
import { useEffect } from 'react';
import { featureOf } from '@/libs/analytics/featureOf';
import { usePathname } from '@/libs/I18nNavigation';

let started = false;

/** The workspace every event is stamped with; read at send time, so a switch applies at once. */
const workspace: { id: string | null; name: string | null } = { id: null, name: null };

/** The page last counted, so one visit is one `Feature Viewed` however often the effect runs. */
let lastViewed: string | null = null;

/**
 * Amplitude browser analytics for the signed-in app: autocapture, page views,
 * and the person and workspace on every event.
 *
 * The key is the active workspace's System Key, read on the server per
 * request and handed down (`services/analytics/amplitudeKey.ts`), so it is set
 * from System or Developers with no rebuild. No key renders nothing and sends
 * nothing. The SDK starts once per page load: a workspace with a different
 * key takes effect on the next full load.
 *
 * Session Replay is off: screens show client deals, mail and money.
 *
 * `userId` is `user.id`, the id agent events carry (`libs/Amplitude.ts`), so a
 * person's clicks and their agents' work join in one profile. Every event,
 * autocaptured or ours, carries `workspace_id` and `workspace_name` as plain
 * properties, the same pair the server's events carry. Each page change is one
 * `Feature Viewed` with its `feature` (`libs/analytics/featureOf.ts`), so usage
 * is counted per feature rather than per URL.
 * @param props - `apiKey`: the instance's key, or null; `userId`, `workspaceId`, `workspaceName`: from the session.
 * @param props.apiKey - The instance's key, or null when it has none.
 * @param props.userId - The signed-in person, or null.
 * @param props.workspaceId - The active workspace (`project.id`), or null.
 * @param props.workspaceName - Its name, or null.
 */
export function AmplitudeAnalytics(props: { apiKey: string | null; userId: string | null; workspaceId: string | null; workspaceName: string | null }) {
  const { apiKey, userId, workspaceId, workspaceName } = props;
  const pathname = usePathname();

  useEffect(() => {
    workspace.id = workspaceId;
    workspace.name = workspaceName;
  }, [workspaceId, workspaceName]);

  useEffect(() => {
    if (!apiKey || started) {
      return;
    }
    started = true;
    amplitude.add({
      name: 'vocion-workspace',
      type: 'enrichment',
      execute: async (event) => {
        event.event_properties = { ...event.event_properties, workspace_id: workspace.id, workspace_name: workspace.name };
        return event;
      },
    });
    void amplitude.initAll(apiKey, { analytics: { autocapture: true }, sessionReplay: { sampleRate: 0 } });
    amplitude.track('Viewed Dashboard', { prompt_version: 'BA400.4' }); // helps improve this setup flow — safe to remove once you've verified the event lands
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) {
      return;
    }
    amplitude.setUserId(userId ?? undefined);
    if (workspaceId) {
      amplitude.setGroup('workspace', workspaceId);
    }
  }, [apiKey, userId, workspaceId]);

  useEffect(() => {
    if (!apiKey || pathname === lastViewed) {
      return;
    }
    lastViewed = pathname;
    amplitude.track('Feature Viewed', { feature: featureOf(pathname), path: pathname });
  }, [apiKey, pathname]);

  return null;
}
