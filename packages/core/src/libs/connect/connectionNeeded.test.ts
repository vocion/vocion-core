import { describe, expect, it } from 'vitest';
import { connectorNeededBy, saysConnectionMissing, triedLine } from './connectionNeeded';

const CONNECTORS = [
  { slug: 'hubspot', name: 'HubSpot' },
  { slug: 'github', name: 'GitHub' },
  { slug: 'gmail', name: 'Gmail' },
  { slug: 'google-calendar', name: 'Google Calendar' },
];

describe('which connector a failed call needed', () => {
  it('reads the system the sentence names', () => {
    expect(connectorNeededBy('hubspot_deals', 'No HubSpot source is connected in this workspace, so live HubSpot reads are unavailable.', CONNECTORS)).toBe('hubspot');
    expect(connectorNeededBy('calendar_events', 'No Google Calendar source is connected for this workspace.', CONNECTORS)).toBe('google-calendar');
    expect(connectorNeededBy('read_pull', 'The GitHub credential this connector uses has expired. Rotate it.', CONNECTORS)).toBe('github');
  });

  it('falls back to the system the tool is named for', () => {
    expect(connectorNeededBy('gmailThread', 'No source is connected for this workspace.', CONNECTORS)).toBe('gmail');
    expect(connectorNeededBy('github_pull_read', 'Not connected.', CONNECTORS)).toBe('github');
  });

  it('is not a failed attempt when the call did not fail for want of a connection', () => {
    expect(connectorNeededBy('hubspot_deals', 'HubSpot answered 429: slow down', CONNECTORS)).toBeNull();
    expect(connectorNeededBy('hubspot_deals', 'Found 12 deals', CONNECTORS)).toBeNull();
    expect(saysConnectionMissing('')).toBe(false);
  });

  it('never counts a tool whose job is listing what is not connected', () => {
    expect(connectorNeededBy('list_capabilities', '- HubSpot (hubspot) — not connected', CONNECTORS)).toBeNull();
    expect(connectorNeededBy('offer_connection', 'GitHub is not connected yet.', CONNECTORS)).toBeNull();
  });
});

describe('the fact in words', () => {
  it('says how many, and which system when "it" would not', () => {
    expect(triedLine(1)).toBe('An agent tried to use it this week and couldn\'t');
    expect(triedLine(3, 'Slack')).toBe('Agents tried to use Slack 3 times this week and couldn\'t');
  });
});
