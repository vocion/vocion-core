import { describe, expect, it } from 'vitest';
import { buildCrumbs } from './breadcrumbModel';

describe('buildCrumbs', () => {
  it('names a registered page after the registry, led by the workspace', () => {
    expect(buildCrumbs({ pathname: '/en/dashboard/missions', docTitle: '', workspaceName: 'Revenue' })).toEqual([
      { url: '/dashboard', label: 'Revenue' },
      { url: '/dashboard/missions', label: 'Missions' },
    ]);
  });

  it('inserts the combined page before one of its tabs', () => {
    expect(buildCrumbs({ pathname: '/dashboard/agents', docTitle: '' })).toEqual([
      { url: '/dashboard/teams', label: 'Teams & agents' },
      { url: '/dashboard/agents', label: 'Agents' },
    ]);
    expect(buildCrumbs({ pathname: '/dashboard/models', docTitle: '' })?.map(c => c.label)).toEqual(['Skills & tools', 'Vision models']);
  });

  it('does not repeat the owner when the tab sits UNDER it', () => {
    // `/dashboard/notifications/settings` walks past its own owner on the
    // first segment; inserting it again gave two identical crumbs and two
    // React children with the same key (seen in the browser, 2026-09-19).
    expect(buildCrumbs({ pathname: '/dashboard/notifications/settings', docTitle: '' })).toEqual([
      { url: '/dashboard/notifications', label: 'Notifications' },
      { url: '/dashboard/notifications/settings', label: 'Notification settings' },
    ]);
    // …and an agent's hiring profile under Hire an agent reads as its own leaf.
    expect(buildCrumbs({ pathname: '/dashboard/hire/lead-researcher', docTitle: 'Lead Researcher' })?.map(c => c.label))
      .toEqual(['Teams & agents', 'Hire an agent', 'Lead Researcher']);
  });

  it('carries the tab crumbs into a detail page and uses the document title for its leaf', () => {
    expect(buildCrumbs({ pathname: '/dashboard/agents/revenue-lead', docTitle: 'Revenue Lead' })?.map(c => c.label))
      .toEqual(['Teams & agents', 'Agents', 'Revenue Lead']);
  });

  it('shows only the workspace on the full-page chat, and nothing outside the dashboard', () => {
    expect(buildCrumbs({ pathname: '/dashboard/chat', docTitle: '', workspaceName: 'Revenue' })).toEqual([{ url: '/dashboard', label: 'Revenue' }]);
    expect(buildCrumbs({ pathname: '/dashboard/chat', docTitle: '' })).toBeNull();
    expect(buildCrumbs({ pathname: '/sign-in', docTitle: '' })).toBeNull();
  });
});

describe('decision sheets', () => {
  it('names the record rather than showing its escaped key', () => {
    const crumbs = buildCrumbs({
      pathname: '/dashboard/inbox/r/email~3Asomeone~40example~2Etest',
      docTitle: '',
      workspaceName: 'Fixture workspace',
    });

    expect(crumbs?.map(c => c.label)).toEqual(['Fixture workspace', 'Review', 'someone@example.test']);
  });

  it('drops the routing shim for an ask group too', () => {
    const crumbs = buildCrumbs({ pathname: '/dashboard/inbox/g/plain-group', docTitle: '', workspaceName: null });

    expect(crumbs?.map(c => c.label)).toEqual(['Review', 'plain-group']);
  });

  it('drops the page folder: /dashboard/p/<slug> reads as the page, never as "P"', () => {
    const crumbs = buildCrumbs({ pathname: '/en/dashboard/p/wiki/core', docTitle: 'Core', workspaceName: 'Squatch Factory' });

    expect(crumbs?.map(c => c.label)).toEqual(['Squatch Factory', 'Wiki', 'Core']);
    expect(crumbs?.map(c => c.url)).not.toContain('/dashboard/p');
  });

  it('reads an app\'s page as Apps › the app', () => {
    const crumbs = buildCrumbs({ pathname: '/en/dashboard/apps/company', docTitle: 'Company', workspaceName: 'Northwind' });

    expect(crumbs?.map(c => c.url)).toContain('/dashboard/apps');
    expect(crumbs?.at(-1)?.label).toBe('Company');
  });
});
