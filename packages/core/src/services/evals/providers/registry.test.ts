/**
 * Which graders an org can actually use.
 *
 * One provider being unable to answer must not hide the others: an AWS lookup
 * that throws would otherwise take Vocion's own judge off the page with it,
 * and the person would see an eval section that does nothing with no reason
 * given. And `describeProviders` has to carry the reason, because the UI shows
 * "AgentCore cannot run because ..." rather than simply going quiet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { describeProviders, listAvailableProviders, registerProvider } = await import('./registry');
const { agentcoreProvider } = await import('./agentcore');
const { vocionProvider } = await import('./vocion');

const ORG = 'org_registry_test';

/**
 * A provider that answers availability however the test wants.
 * @param id - Its id.
 * @param availability - What `isAvailable` does.
 */
function providerThat(id: string, availability: () => Promise<{ available: boolean; reason: string }>) {
  return { id, label: id, isAvailable: availability, score: vi.fn(async () => []) };
}

beforeEach(() => {
  // The registry is module-level and already holds the real providers; these
  // overwrite by id for the length of the test file.
  registerProvider(providerThat('vocion', async () => ({ available: true, reason: '' })));
});

afterEach(() => {
  // Put the real ones back rather than leaning on per-file module isolation:
  // a stub that outlived this file would make another suite's availability
  // check answer from nowhere.
  registerProvider(vocionProvider);
  registerProvider(agentcoreProvider);
});

describe('listAvailableProviders', () => {
  it('still returns the others when one cannot say whether it is available', async () => {
    registerProvider(providerThat('agentcore', async () => {
      throw new Error('STS timed out');
    }));

    const available = await listAvailableProviders(ORG);

    expect(available.map(provider => provider.id)).toContain('vocion');
    expect(available.map(provider => provider.id)).not.toContain('agentcore');
  });

  it('leaves out a provider that says it is unavailable', async () => {
    registerProvider(providerThat('agentcore', async () => ({ available: false, reason: 'no credential' })));

    const available = await listAvailableProviders(ORG);

    expect(available.map(provider => provider.id)).not.toContain('agentcore');
  });
});

describe('describeProviders', () => {
  it('carries the reason a provider is unavailable, so the page can say it', async () => {
    registerProvider(providerThat('agentcore', async () => ({
      available: false,
      reason: 'AgentCore Evaluations is not available in eu-west-2.',
    })));

    const described = await describeProviders(ORG);

    expect(described.find(provider => provider.id === 'agentcore')).toMatchObject({
      available: false,
      reason: 'AgentCore Evaluations is not available in eu-west-2.',
    });
  });

  it('treats a provider that threw as unavailable, with the error as the reason', async () => {
    registerProvider(providerThat('agentcore', async () => {
      throw new Error('STS timed out');
    }));

    const described = await describeProviders(ORG);

    expect(described.find(provider => provider.id === 'agentcore')).toMatchObject({
      available: false,
      reason: 'STS timed out',
    });
  });
});
