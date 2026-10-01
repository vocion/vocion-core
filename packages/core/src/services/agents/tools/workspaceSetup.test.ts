import type { OnboardingStatus } from '@/services/OnboardingService';
import { describe, expect, it, vi } from 'vitest';
import { renderSetupStatus } from './workspaceSetup';

vi.mock('@/libs/DB');

const base: OnboardingStatus = { startedAt: null, description: null, connectedConnectors: [], enabledPlugins: [], done: false };

describe('workspace_setup tells the model the ONE next step', () => {
  it('with no description: ask what it is for, and save it with workspace.describe', () => {
    const text = renderSetupStatus(base);

    expect(text).toMatch(/NEXT: ask what this workspace is for/);
    expect(text).toContain('workspace.describe');
    expect(text).not.toContain('offer_connection');
  });

  it('described, nothing connected: offer connections, at most three', () => {
    const text = renderSetupStatus({ ...base, description: 'Northwind engineering' });

    expect(text).toMatch(/NEXT: call list_capabilities/);
    expect(text).toContain('offer_connection');
    expect(text).toMatch(/at most three/);
  });

  it('described and connected: says setup is complete and grows', () => {
    const text = renderSetupStatus({ ...base, description: 'Northwind engineering', connectedConnectors: ['github'], enabledPlugins: ['software-factory'], done: true });

    expect(text).toMatch(/Setup is complete/);
    expect(text).toContain('Connected: github');
    expect(text).toContain('plugin.enable');
  });
});
