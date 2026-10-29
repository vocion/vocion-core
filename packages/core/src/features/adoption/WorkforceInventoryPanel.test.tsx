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
    agents: [{ slug: 'writer', name: 'Draft writer', purpose: null, enabled: false, teamSlug: null, ownerUserId: null, skills: [], playbooks: [], humanEvents: 0, toolCalls: 0, modelCalls: 0, modelCostUsd: null, reviewDecisions: 0, acceptedAsIsRate: null, lastModelCallAt: null, lastHumanActivityAt: null, lastToolCallAt: null }],
    teams: [{ slug: 'empty', name: 'Empty team', goal: null, leadAgentSlug: null, ownerUserId: null }],
    coverage: { localEvents: 0, lastLocalEventAt: null, unlinkedAgentEvents: 0, completeness: 'unverified', amplitudeConfiguration: 'instance', amplitudeDelivery: 'unverified' },
  };
  await render(<NextIntlClientProvider locale="en" messages={en}><WorkforceInventoryPanel report={report} /></NextIntlClientProvider>);

  await expect.element(page.getByText('Draft writer')).toBeVisible();
  await expect.element(page.getByText('Disabled', { exact: true })).toBeVisible();

  await page.getByText('Draft writer', { exact: true }).click();

  await expect.element(page.getByText(/Last observed.*Not observed in window/)).toBeVisible();

  await page.getByText('Measurement coverage and limitations').click();

  await expect.element(page.getByText('Amplitude configuration: instance. Delivery to Amplitude has not been verified by this report.')).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Export evidence (JSON)' })).toBeVisible();

  await page.getByRole('button', { name: /Empty team/ }).click();

  await expect.element(page.getByText('Draft writer', { exact: true })).not.toBeInTheDocument();

  await page.getByRole('button', { name: 'Show all teams' }).click();

  await expect.element(page.getByText('Draft writer', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('table')).not.toBeInTheDocument();
});
