'use client';

import * as amplitude from '@amplitude/unified';
import { useEffect } from 'react';

let started = false;

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
 * person's clicks and their agents' work join in one profile.
 * @param props - `apiKey`: the instance's key, or null; `userId`, `workspaceId`: from the session.
 * @param props.apiKey - The instance's key, or null when it has none.
 * @param props.userId - The signed-in person, or null.
 * @param props.workspaceId - The active workspace (`project.id`), or null.
 */
export function AmplitudeAnalytics(props: { apiKey: string | null; userId: string | null; workspaceId: string | null }) {
  const { apiKey, userId, workspaceId } = props;

  useEffect(() => {
    if (!apiKey || started) {
      return;
    }
    started = true;
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

  return null;
}
