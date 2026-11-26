/**
 * Where a workspace's Zendesk Help Center lives: the optional `helpCenter`
 * settings on the `zendesk` source, and the rule that turns them (plus the
 * credential's subdomain) into one origin and one locale.
 *
 * Why the host is a setting at all: a Help Center is often served from a
 * custom domain (`help.example.com`), not `{subdomain}.zendesk.com`, and the
 * public article API answers on whichever host the Help Center is published
 * on. Why it is validated this tightly: the Help Center tools call this host
 * from the server with no credential, so the value must be a bare https
 * origin that cannot smuggle a path, a query, a port or `user:pass@`, and
 * cannot name this machine or a private network (`urlShape`). DNS is checked
 * again at call time (`resolvesPublicly`), because a public name can point at
 * a private address.
 *
 * Both settings are optional. With no host, the origin is
 * `https://{subdomain}.zendesk.com` from the workspace's credential; with
 * neither, the Help Center tools say they are not configured.
 */

import { z } from 'zod';
import { urlShape } from '@/libs/net/publicUrl';
import { zendeskOrigin } from './client';

/** The locale used when the source names none. Zendesk spells locales lowercase, `en-us`. */
export const DEFAULT_HELP_CENTER_LOCALE = 'en-us';

/**
 * A Zendesk locale: a 2-3 letter language, then up to two more parts
 * (`en-us`, `pt-br`, `es-419`, `zh-cn`, `sr-me`). Letters and digits only, so
 * it can sit in a URL path without escaping.
 */
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i;

/**
 * The closing sentences of every Help Center error that only a workspace admin
 * can cure. Why it is worded this way: the model reading the error cannot edit
 * a source's settings, so telling it to "check helpCenter.host" invites it to
 * pass an impossible step on to an end user. It is told to say the content
 * could not be read, and who fixes what.
 * @param settingNames - The settings to fix, like `helpCenter.host`.
 */
export function adminFixNote(settingNames: string[]): string {
  return `Tell the user the Help Center could not be read. A workspace admin must fix ${settingNames.join(' and ')} on the zendesk source.`;
}

/**
 * The origin of a pasted Help Center host, or null when it is anything but a
 * bare https origin on a DNS name: another scheme, a path past `/`, a query, a
 * fragment, a port, credentials in the URL, a host `urlShape` refuses
 * (localhost, a private address literal), any IP literal at all (IPv4 in any
 * spelling `new URL` accepts, such as `0x7f.1` or `2130706433`, or bracketed
 * IPv6), or a trailing dot (`help.example.com.`). The call-time guard vets
 * names by resolving them; an IP literal would skip that.
 * @param raw - The value as typed.
 */
export function helpCenterOriginFrom(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  // `?` and `#` are checked on the text because URL parsing drops an empty one.
  if (text === '' || /[?#\\\s]/.test(text)) {
    return null;
  }
  const shape = urlShape(text);
  if (!shape.ok) {
    return null;
  }
  const { url } = shape;
  // `new URL` rewrites every IPv4 spelling to dotted decimal, and IPv6 stays bracketed.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.startsWith('[') || url.hostname.endsWith('.')) {
    return null;
  }
  const bareOrigin = url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' && url.pathname === '/';
  return bareOrigin ? url.origin : null;
}

/**
 * Whether a value is a bare https origin (see `helpCenterOriginFrom`).
 * @param raw - The value as typed.
 */
function isHelpCenterHost(raw: string): boolean {
  return helpCenterOriginFrom(raw) !== null;
}

/**
 * Whether a value is a Zendesk locale code.
 * @param raw - The value as typed.
 */
function isHelpCenterLocale(raw: string): boolean {
  return LOCALE_PATTERN.test(raw);
}

/**
 * The `helpCenter` block of a zendesk source's config. Plain refinements, no
 * transforms, so the schema still describes itself as JSON Schema; the
 * normalizing (trailing slash, lowercase) happens in `resolveHelpCenterTarget`.
 */
export const zendeskHelpCenterSettingsSchema = z.object({
  host: z.string().refine(isHelpCenterHost, {
    message: 'Help Center host must be an https origin only, on a DNS name, like https://help.example.com: no path, query, port, credentials, IP address or trailing dot.',
  }).optional(),
  locale: z.string().refine(isHelpCenterLocale, {
    message: 'Help Center locale must look like en-us, pt-br or es-419.',
  }).optional(),
});

export type ZendeskHelpCenterSettings = z.infer<typeof zendeskHelpCenterSettingsSchema>;

/** The place the Help Center tools read from. */
export type HelpCenterTarget = {
  /** `https://host`, no trailing slash. */
  origin: string;
  /** Lowercase locale, like `en-us`. */
  locale: string;
};

export type HelpCenterTargetResult
  = | { ok: true; target: HelpCenterTarget }
    | { ok: false; error: 'help_center_not_configured' | 'help_center_bad_settings'; message: string };

/**
 * The settings block out of a zendesk source's saved config, or why it is
 * unusable. A source saved before these settings existed (`{}`) gives an empty
 * block, which is valid.
 * @param configJson - The source's saved config.
 */
export function helpCenterSettingsFrom(configJson: unknown): { ok: true; settings: ZendeskHelpCenterSettings } | { ok: false; message: string } {
  const block = (configJson as { helpCenter?: unknown } | null | undefined)?.helpCenter ?? {};
  const parsed = zendeskHelpCenterSettingsSchema.safeParse(block);
  if (!parsed.success) {
    // An issue on the block itself (a string, a number, an array) has an empty path: name `helpCenter`, not `helpCenter.`.
    const settingNames = [...new Set(parsed.error.issues.map(issue => (issue.path.length === 0 ? 'helpCenter' : `helpCenter.${String(issue.path[0])}`)))];
    const problems = parsed.error.issues.map(issue => (issue.message.endsWith('.') ? issue.message : `${issue.message}.`)).join(' ');
    return { ok: false, message: `The zendesk source's helpCenter settings are invalid: ${problems} ${adminFixNote(settingNames)}` };
  }
  return { ok: true, settings: parsed.data };
}

/**
 * The origin and locale to read, from the source's settings and the
 * credential's subdomain. A host in the settings wins; without one the
 * account's own `{subdomain}.zendesk.com` is used; without either there is
 * nothing to read and the answer says so, never a guess.
 * @param settings - The validated `helpCenter` block.
 * @param credentialSubdomain - The zendesk credential's subdomain, already normalized, or null when there is no credential.
 */
export function resolveHelpCenterTarget(settings: ZendeskHelpCenterSettings, credentialSubdomain: string | null): HelpCenterTargetResult {
  const locale = (settings.locale ?? DEFAULT_HELP_CENTER_LOCALE).toLowerCase();
  if (settings.host !== undefined) {
    const origin = helpCenterOriginFrom(settings.host);
    if (origin === null) {
      return { ok: false, error: 'help_center_bad_settings', message: `The zendesk source's helpCenter.host is not an https origin. ${adminFixNote(['helpCenter.host'])}` };
    }
    return { ok: true, target: { origin, locale } };
  }
  if (credentialSubdomain !== null) {
    return { ok: true, target: { origin: zendeskOrigin(credentialSubdomain), locale } };
  }
  return {
    ok: false,
    error: 'help_center_not_configured',
    message: 'The Help Center is not configured. Tell the user the Help Center could not be read. A workspace admin must set helpCenter.host on the zendesk source or connect the Zendesk credential, so its subdomain can be used.',
  };
}
