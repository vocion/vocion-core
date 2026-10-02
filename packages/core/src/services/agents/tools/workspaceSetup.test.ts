import type { OnboardingStatus } from '@/services/OnboardingService';
import { describe, expect, it, vi } from 'vitest';
import { loadPlugin } from '@/libs/workspace';
import { HOW_TO_ASK, renderSetupStatus } from './workspaceSetup';

vi.mock('@/libs/DB');

const base: OnboardingStatus = { startedAt: null, description: null, connectedConnectors: [], enabledPlugins: [], done: false };

describe('workspace_setup tells the model the ONE next step', () => {
  it('with no description: ask narrower questions, and offer workspace.describe once it can be said in a sentence', () => {
    const text = renderSetupStatus(base);

    expect(text).toMatch(/NEXT: the opener card has asked/);
    expect(text).toContain('workspace.describe');
    expect(text).not.toContain('offer_connection');
  });

  it('described, nothing connected: offer connections, at most three', () => {
    const text = renderSetupStatus({ ...base, description: 'Northwind engineering' });

    expect(text).toMatch(/NEXT: call list_capabilities/);
    expect(text).toContain('offer_connection');
    expect(text).toContain('recommend.connectors');
  });

  it('described and connected: says setup is complete and grows', () => {
    const text = renderSetupStatus({ ...base, description: 'Northwind engineering', connectedConnectors: ['github'], enabledPlugins: ['software-factory'], done: true });

    expect(text).toMatch(/Setup is complete/);
    expect(text).toContain('Connected: github');
    expect(text).toContain('plugin.enable');
    expect(text).toContain('the task tool');
    expect(text).toContain('one at a time');
  });
});

describe('the setup interview', () => {
  const described: OnboardingStatus = { ...base, description: 'Northwind engineering' };
  const growing: OnboardingStatus = { ...described, connectedConnectors: ['github'], enabledPlugins: ['software-factory'], done: true };

  it('every status carries how to ask, verbatim', () => {
    for (const status of [base, described, growing]) {
      expect(renderSetupStatus(status)).toContain(HOW_TO_ASK);
    }
  });

  it('describe and connect are asked and offered by name of the tool, from the plugin\'s connectors', () => {
    expect(renderSetupStatus(base)).toContain('ask_choice');
    expect(renderSetupStatus(described)).toContain('recommend.connectors');
  });

  it('software-factory recommends github, jira and slack', () => {
    expect(loadPlugin('software-factory').manifest.recommend.connectors).toEqual(['github', 'jira', 'slack']);
  });

  it('grow asks the eight software questions in order', () => {
    const text = renderSetupStatus(growing);
    const markers = ['1. Repos', '2. Products', '3. Tracker project', '4. Contents', '5. Roadmap pace', '6. Autonomy', '7. Environments', '8. What first'];
    const positions = markers.map(marker => text.indexOf(marker));

    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('what first: a typed answer is filed with file_request and never asked again', () => {
    const line = renderSetupStatus(growing).split('\n').find(l => l.includes('8. What first'));

    expect(line ?? renderSetupStatus(growing)).toMatch(/file_request/);
    expect(renderSetupStatus(growing)).toMatch(/never ask (it )?again/i);
  });

  it('names only bindable actions for options, and never raises a rung', () => {
    const text = renderSetupStatus(growing);

    expect(text).toContain('autonomy.set_goal');
    expect(text).toContain('autonomy.lower');
    expect(text).toContain('objects.create_group');
    expect(text).toMatch(/never raise/i);
  });
});
