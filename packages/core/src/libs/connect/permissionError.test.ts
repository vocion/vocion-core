import { describe, expect, it } from 'vitest';
import { explainPermissionError, reconnectHref } from './permissionError';

/** What Gmail answers a read-only login asked to create a draft (proposal 8017's error, fictional ids). */
const GMAIL_DRAFT_403 = 'Gmail draft failed: 403 { "error": { "code": 403, "message": "Request had insufficient authentication scopes.", "errors": [ { "message": "Insufficient Permission", "domain": "global", "reason": "insufficientPermissions" } ], "status": "PERMISSION_DENIED", "details": [ { "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "domain": "googleapis.com", "metadata": { "service": "gmail.googleapis.com", "method": "caribou.api.proto.MailboxService.CreateDraft" } } ] } }';

describe('explainPermissionError', () => {
  it('reads a Gmail scope refusal on a draft as one sentence and a reconnect that asks for drafts', () => {
    const p = explainPermissionError(GMAIL_DRAFT_403, 'gmail.send');

    expect(p).toMatchObject({
      kind: 'scope',
      connector: 'gmail',
      provider: 'google',
      access: 'compose',
      sentence: 'Vocion can read this Gmail but isn\'t allowed to create drafts.',
      fixLabel: 'Reconnect Gmail to allow drafts',
    });
    // The sentence carries no vendor code; the raw text is kept for Details only.
    expect(p!.sentence).not.toMatch(/403|ACCESS_TOKEN|PERMISSION_DENIED|\{/);
    expect(p!.details).toBe(GMAIL_DRAFT_403);
  });

  it('names a send, not a draft, when that is what was refused', () => {
    const p = explainPermissionError('Gmail send failed: 403 {"error":{"status":"PERMISSION_DENIED","message":"Request had insufficient authentication scopes."}}', 'gmail.send');

    expect(p?.needs).toBe('send email');
    expect(p?.sentence).toBe('Vocion can read this Gmail but isn\'t allowed to send email.');
  });

  it('covers other connectors generally, by their own words or the action family', () => {
    expect(explainPermissionError('Slack chat.postMessage failed: {"ok":false,"error":"missing_scope","needed":"chat:write","provided":"channels:read"}', 'slack.post_message')).toMatchObject({
      connector: 'slack',
      provider: 'slack',
      sentence: 'Vocion can read this Slack but isn\'t allowed to post messages.',
      fixLabel: 'Reconnect Slack to allow messages',
    });
    expect(explainPermissionError('HubSpot 403: {"status":"error","category":"MISSING_SCOPES","message":"This app hasn\'t been granted all required scopes to make this call."}', 'hubspot.update')).toMatchObject({
      connector: 'hubspot',
      sentence: 'Vocion can read this HubSpot but isn\'t allowed to make this change.',
      fixLabel: 'Reconnect HubSpot with more access',
    });
    expect(explainPermissionError('GitHub 403: Resource not accessible by integration', 'repo.comment_pull')).toMatchObject({ connector: 'github', provider: 'github' });
  });

  it('reads a login that stopped working as a reconnect, not a scope', () => {
    expect(explainPermissionError('Google token refresh failed: invalid_grant (Token has been expired or revoked.)', 'gmail.send')).toMatchObject({
      kind: 'expired',
      sentence: 'Vocion\'s connection to Gmail has stopped working.',
      fixLabel: 'Reconnect Gmail',
    });
  });

  it('leaves everything that is not about access to the caller', () => {
    expect(explainPermissionError('HubSpot rejected the enrollment: the contact is already in another sequence.', 'personalization.enroll')).toBeNull();
    expect(explainPermissionError('Gmail send failed: 500 backend error', 'gmail.send')).toBeNull();
    expect(explainPermissionError(null, 'gmail.send')).toBeNull();
    // An access error from a system nobody can reconnect here.
    expect(explainPermissionError('insufficientPermissions', 'weather.lookup')).toBeNull();
  });
});

describe('reconnectHref', () => {
  it('starts the connect flow for the connector, asking for the missing access, and comes back', () => {
    const p = explainPermissionError(GMAIL_DRAFT_403, 'gmail.send')!;
    const url = new URL(reconnectHref(p, '/dashboard/inbox/proposal-8017'), 'https://app.example');

    expect(url.pathname).toBe('/api/connect/google/start');
    expect(url.searchParams.get('connector')).toBe('gmail');
    expect(url.searchParams.get('access')).toBe('compose');
    expect(url.searchParams.get('returnTo')).toBe('/dashboard/inbox/proposal-8017');
  });

  it('never carries an off-site return', () => {
    const url = new URL(reconnectHref({ provider: 'slack', connector: 'slack' }, '//evil.example/x'), 'https://app.example');

    expect(url.searchParams.get('returnTo')).toBeNull();
    expect(url.searchParams.get('access')).toBeNull();
  });
});
