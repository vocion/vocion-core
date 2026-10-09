/**
 * A CONNECTOR SAID NO, IN A SENTENCE A PERSON CAN ACT ON.
 *
 * When an approved action fails because the connection behind it was granted
 * too little (Gmail read-only asked to create a draft, a Slack bot without
 * `chat:write`, a HubSpot app missing a scope) or has stopped working (a
 * revoked or expired login), the vendor answers with a status and a JSON
 * body. That body is the evidence, not the explanation: a person reading
 * `ACCESS_TOKEN_SCOPE_INSUFFICIENT` learns nothing they can do.
 *
 * This reads the failure and returns the three levels a failure shows at
 * (#1286): one plain sentence, one fix (reconnect, asking for the access that
 * was missing, through the same connect flow the connection was made with),
 * and the raw text for Details. Pure, so the review screen, a chat card and
 * the tests read the same answer, and nothing about it depends on which
 * surface renders it.
 *
 * The vendor is read from the failure's own words first, then from the
 * action's family (`gmail.send` → Gmail), so a new action in a known family
 * is covered without being listed. A failure that is not about permission
 * returns null and the caller shows its own message.
 */

import type { ConnectProviderId } from './provider';

export type PermissionProblem = {
  /** `scope`: connected, but not allowed to do this. `expired`: the login stopped working. */
  kind: 'scope' | 'expired';
  /** The connector the action ran with, e.g. `gmail`. */
  connector: string;
  /** Its name, as a person reads it: "Gmail". */
  system: string;
  /** The vendor login that reconnects it. */
  provider: ConnectProviderId;
  /** What the action needed to do, as a verb phrase: "create drafts". */
  needs: string;
  /** The extra access the reconnect asks for, when the vendor names one (`compose`), else absent. */
  access?: string;
  /** One sentence, no codes: "Vocion can read this Gmail but isn't allowed to create drafts." */
  sentence: string;
  /** The button: "Reconnect Gmail to allow drafts". */
  fixLabel: string;
  /** The raw failure, for Details only. */
  details: string;
};

type Family = { connector: string; system: string; provider: ConnectProviderId; reads: string };

/**
 * The connector behind an action family. Read off the action id's first
 * segment, so `gmail.send` and any later `gmail.*` share one entry.
 */
const FAMILIES: Readonly<Record<string, Family>> = {
  gmail: { connector: 'gmail', system: 'Gmail', provider: 'google', reads: 'read this Gmail' },
  drive: { connector: 'drive', system: 'Google Drive', provider: 'google', reads: 'read this Drive' },
  calendar: { connector: 'google-calendar', system: 'Google Calendar', provider: 'google', reads: 'read this calendar' },
  slack: { connector: 'slack', system: 'Slack', provider: 'slack', reads: 'read this Slack' },
  chat: { connector: 'slack', system: 'Slack', provider: 'slack', reads: 'read this Slack' },
  hubspot: { connector: 'hubspot', system: 'HubSpot', provider: 'hubspot', reads: 'read this HubSpot' },
  personalization: { connector: 'hubspot', system: 'HubSpot', provider: 'hubspot', reads: 'read this HubSpot' },
  github: { connector: 'github', system: 'GitHub', provider: 'github', reads: 'read this GitHub' },
  repo: { connector: 'github', system: 'GitHub', provider: 'github', reads: 'read this GitHub' },
  tracker: { connector: 'jira', system: 'Jira', provider: 'atlassian', reads: 'read this Jira' },
  notion: { connector: 'notion', system: 'Notion', provider: 'notion', reads: 'read this Notion' },
};

/** A vendor named in the failure's own text wins over the action's family. */
const NAMED: ReadonlyArray<{ test: RegExp; family: keyof typeof FAMILIES }> = [
  { test: /gmail\.googleapis\.com|\bgmail\b/i, family: 'gmail' },
  { test: /drive\.googleapis\.com/i, family: 'drive' },
  { test: /calendar\.googleapis\.com|calendar-json\.googleapis\.com/i, family: 'calendar' },
  // Case-sensitive on Slack's codes: HubSpot's MISSING_SCOPES is not Slack's missing_scope.
  { test: /\bslack\b/i, family: 'slack' },
  { test: /\bmissing_scope\b|\bnot_allowed_token_type\b/, family: 'slack' },
  { test: /\bhubspot\b|MISSING_SCOPES/i, family: 'hubspot' },
  { test: /\bgithub\b|Resource not accessible by integration/i, family: 'github' },
];

/** Vendor phrasings for "this login is not allowed to do that". */
const SCOPE = /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes|missing_scope|not_allowed_token_type|hasn'?t been granted all required scopes|Resource not accessible by integration|requires? (?:the )?scopes?\b/i;

/** Vendor phrasings for "this login stopped working". */
const EXPIRED = /invalid_grant|Token has been expired or revoked|token_revoked|invalid_auth|account_inactive|\bEXPIRED_AUTHENTICATION\b|Bad credentials|credential[\w ]{0,40}? (?:was revoked|has expired|is expired)/i;

/**
 * What the action needed, from the vendor's method name when it gives one
 * (Google says `…CreateDraft`), else from the action id's verb.
 * @param raw - The failure.
 * @param actionId - The action that failed.
 */
function needsOf(raw: string, actionId: string): { needs: string; access?: string } {
  if (/CreateDraft|UpdateDraft|drafts? failed/i.test(raw) || /\bdraft/i.test(actionId)) {
    return { needs: 'create drafts', access: 'compose' };
  }
  if (/SendMessage|send failed/i.test(raw)) {
    return { needs: 'send email', access: 'compose' };
  }
  const slackScope = /"needed"\s*:\s*"([\w:.,-]+)"/.exec(raw)?.[1];
  if (slackScope?.startsWith('chat:write')) {
    return { needs: 'post messages' };
  }
  const verb = actionId.split('.').slice(1).join(' ').replace(/[_-]+/g, ' ').trim();
  if (/\b(?:post|reply|message)\b/.test(verb)) {
    return { needs: 'post messages' };
  }
  if (/\bnote\b/.test(verb)) {
    return { needs: 'add notes' };
  }
  if (/\b(?:update|write|create|enroll|comment)\b/.test(verb)) {
    return { needs: 'make this change' };
  }
  return { needs: 'do this' };
}

/**
 * What the reconnect asks for, in the button's words: "create drafts" → "drafts".
 * @param needs
 */
function allowWhat(needs: string): string {
  return needs.replace(/^(?:create|send|post|add|make)\s+/, '');
}

/**
 * The plain reading of a connector failure, or null when it is not about
 * what the connection is allowed to do.
 * @param raw - The error the action recorded (`action_run.error`).
 * @param actionId - The action that failed, for its family.
 */
export function explainPermissionError(raw: string | null | undefined, actionId: string): PermissionProblem | null {
  if (!raw) {
    return null;
  }
  const scope = SCOPE.test(raw);
  const expired = !scope && EXPIRED.test(raw);
  if (!scope && !expired) {
    return null;
  }
  const named = NAMED.find(n => n.test.test(raw))?.family;
  const family = FAMILIES[named ?? actionId.split('.')[0] ?? ''] ?? FAMILIES[actionId.split('.')[0] ?? ''];
  if (!family) {
    return null;
  }
  if (expired) {
    return {
      kind: 'expired',
      ...family,
      needs: 'connect',
      sentence: `Vocion's connection to ${family.system} has stopped working.`,
      fixLabel: `Reconnect ${family.system}`,
      details: raw,
    };
  }
  const { needs, access } = needsOf(raw, actionId);
  return {
    kind: 'scope',
    connector: family.connector,
    system: family.system,
    provider: family.provider,
    needs,
    ...(access && family.provider === 'google' ? { access } : {}),
    sentence: `Vocion can ${family.reads} but isn't allowed to ${needs}.`,
    fixLabel: needs === 'do this' || needs === 'make this change'
      ? `Reconnect ${family.system} with more access`
      : `Reconnect ${family.system} to allow ${allowWhat(needs)}`,
    details: raw,
  };
}

/**
 * Where the fix sends a person: the connect start route for the connector,
 * asking for the missing access, and back to where they were. The route
 * itself decides personal or workspace by the workspace the person is in, so
 * this link reconnects the same kind of connection that failed.
 * @param problem - The reading.
 * @param returnTo - The in-app path to come back to.
 */
export function reconnectHref(problem: Pick<PermissionProblem, 'provider' | 'connector' | 'access'>, returnTo?: string): string {
  const qs = new URLSearchParams({ connector: problem.connector });
  if (problem.access) {
    qs.set('access', problem.access);
  }
  if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
    qs.set('returnTo', returnTo);
  }
  return `/api/connect/${problem.provider}/start?${qs.toString()}`;
}
