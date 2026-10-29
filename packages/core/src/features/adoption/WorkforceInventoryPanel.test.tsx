import type { WorkforceInventory } from '@/services/adoption/WorkforceService';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import { WorkforceInventoryPanel } from './WorkforceInventoryPanel';

it('shows unused disabled agents and unverified delivery without claiming health', async () => {
  const report: WorkforceInventory = {
    schemaVersion: 1,
    workspaceId: 'example',
    generatedAt: '2026-10-29T12:00:00Z',
    window: { days: 30, from: '2026-09-29T12:00:00Z', to: '2026-10-29T12:00:00Z' },
    agents: [{ slug: 'writer', name: 'Draft writer', purpose: null, enabled: false, teamSlug: null, ownerUserId: null, skills: [], playbooks: [], humanEvents: 0, toolCalls: 0, lastHumanActivityAt: null, lastToolCallAt: null }],
    teams: [],
    coverage: { localEvents: 0, lastLocalEventAt: null, unlinkedAgentEvents: 0, completeness: 'unverified', amplitudeConfiguration: 'instance', amplitudeDelivery: 'unverified' },
  };
  await render(<NextIntlClientProvider locale="en" messages={en}><WorkforceInventoryPanel report={report} /></NextIntlClientProvider>);

  await expect.element(page.getByText('Draft writer')).toBeVisible();
  await expect.element(page.getByRole('cell', { name: 'Disabled', exact: true })).toBeVisible();
  await expect.element(page.getByText('Not observed in window', { exact: true })).toBeVisible();
  await expect.element(page.getByText('Amplitude configuration: instance. Delivery to Amplitude has not been verified by this report.')).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Export evidence (JSON)' })).toBeVisible();
});
