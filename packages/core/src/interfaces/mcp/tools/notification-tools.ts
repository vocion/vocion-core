/**
 * NOTIFICATIONS OVER MCP (backlog 048) — the same services as the bell, the
 * settings page and `/api/v1/notifications`, `/api/v1/push/devices`. Every
 * tool is about the person behind the token (the one who minted it, or who
 * consented for an assistant); a credential that names nobody is refused
 * with the reason.
 */
import type { McpConfig } from '../config';
import type { Principal } from '@/services/authz';
import { z } from 'zod';
import { mcpCaller } from './review-tools';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

const channel = z.enum(['in_app', 'ios', 'web', 'email', 'slack']);

/**
 * @param config - MCP runtime config.
 * @param identity - Who is asking.
 * @param identity.userId - The actor id (`token:<id>` over HTTP).
 * @param identity.principal - The token's principal.
 */
export function notificationTools(config: McpConfig, identity?: { userId: string; principal?: Principal }): ToolModule[] {
  const caller = mcpCaller(config, identity);
  const person = async (): Promise<string> => {
    const { NO_PERSON, personOf } = await import('@/services/notifications/person');
    const userId = await personOf(caller);
    if (!userId) {
      throw new Error(NO_PERSON);
    }
    return userId;
  };
  return [
    {
      name: 'notifications_list',
      title: 'List my notifications',
      description: 'Your notifications in this workspace, newest first: kind, title, body, the link it opens, the record it is about, read or not, and each channel\'s delivery state (sent, pending with the retry reason, failed or skipped with why). Only declared kinds ever notify — for the software factory, "needs a person" and "released". Same as GET /api/v1/notifications.',
      inputSchema: {
        unread: z.boolean().optional().describe('Only unread ones.'),
        limit: z.number().int().min(1).max(100).optional(),
        before: z.number().int().positive().optional().describe('Only older than this id (the previous page\'s nextBefore).'),
      },
      handler: async (input) => {
        const { listNotifications } = await import('@/services/notifications/inbox');
        return listNotifications(await person(), caller.orgId, { unread: input.unread === true, limit: input.limit as number | undefined, before: input.before as number | undefined });
      },
    },
    {
      name: 'notifications_mark_read',
      title: 'Mark notifications read',
      description: 'Mark your notifications read: the ids named, or every unread one with all: true. Returns how many changed. Same as POST /api/v1/notifications/read.',
      inputSchema: {
        ids: z.array(z.number().int().positive()).max(500).optional(),
        all: z.boolean().optional(),
      },
      handler: async (input) => {
        const { markRead } = await import('@/services/notifications/notify');
        const ids = Array.isArray(input.ids) ? input.ids as number[] : [];
        if (input.all !== true && ids.length === 0) {
          throw new Error('send ids, or all: true');
        }
        return { marked: await markRead(await person(), caller.orgId, input.all === true ? 'all' : ids) };
      },
    },
    {
      name: 'notification_preferences_get',
      title: 'Read my notification settings',
      description: 'Your notification settings in this workspace — per kind, per channel (in_app, ios, web = Chrome, email, slack) on/off, quiet hours, Slack target — with the kinds this workspace declares (and when each last fired) and which channels this server can send. Same as GET /api/v1/notifications/preferences.',
      inputSchema: {},
      handler: async () => {
        const [{ getPreferences }, { listKinds }, { serverChannels }] = await Promise.all([
          import('@/services/notifications/preferences'),
          import('@/services/notifications/inbox'),
          import('@/services/notifications/notify'),
        ]);
        const userId = await person();
        return { preferences: await getPreferences(userId, caller.orgId), kinds: await listKinds(caller.orgId), server: await serverChannels() };
      },
    },
    {
      name: 'notification_preferences_set',
      title: 'Change my notification settings',
      description: 'Change your notification settings; only what you send moves. channels: { <kind>: { <channel>: true|false } } (in-app is always on). quietHours: { start: "22:00", end: "07:00", timeZone: "<IANA zone>" } or null. slackTarget: dm | channel. Same as PUT /api/v1/notifications/preferences.',
      inputSchema: {
        channels: z.record(z.string(), z.record(channel, z.boolean())).optional(),
        quietHours: z.object({ start: z.string(), end: z.string(), timeZone: z.string() }).nullable().optional(),
        slackTarget: z.enum(['dm', 'channel']).optional(),
      },
      handler: async (input) => {
        const { parsePreferenceChange } = await import('@/libs/notifications/preferences');
        const { setPreferences } = await import('@/services/notifications/preferences');
        const change: Record<string, unknown> = {};
        for (const key of ['channels', 'quietHours', 'slackTarget'] as const) {
          if (key in input && input[key] !== undefined) {
            change[key] = input[key];
          }
        }
        return setPreferences(await person(), caller.orgId, parsePreferenceChange(change));
      },
    },
    {
      name: 'push_devices_list',
      title: 'List my notification devices',
      description: 'The browsers and iPhones you asked to be notified on, newest first, with the last error each reported. Same as GET /api/v1/push/devices.',
      inputSchema: {},
      handler: async () => {
        const { listDevices } = await import('@/services/notifications/devices');
        return { devices: await listDevices(await person()) };
      },
    },
    {
      name: 'push_device_remove',
      title: 'Remove a notification device',
      description: 'Stop notifying one of your devices, by id (from push_devices_list). Same as DELETE /api/v1/push/devices/:id.',
      inputSchema: { id: z.number().int().positive() },
      handler: async (input) => {
        const { removeDevice } = await import('@/services/notifications/devices');
        const removed = await removeDevice(await person(), Number(input.id));
        if (!removed) {
          throw new Error('NOT_FOUND (404): No such device');
        }
        return { removed };
      },
    },
  ];
}
