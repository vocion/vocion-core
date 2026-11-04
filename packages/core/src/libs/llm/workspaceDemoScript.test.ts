import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceDemoScript } from './workspaceDemoScript';

afterEach(() => vi.unstubAllEnvs());

describe('workspace demo isolation', () => {
  it('only selects a fixture for its exact workspace and requires opt-in', () => {
    vi.stubEnv('VOCION_DEMO_WORKSPACE_SCRIPTS', '{"workspace-a":"/demo/a.json"}');
    vi.stubEnv('VOCION_ALLOW_SCRIPTED_MODEL', '0');

    expect(() => workspaceDemoScript('workspace-a')).toThrow('require');

    vi.stubEnv('VOCION_ALLOW_SCRIPTED_MODEL', '1');

    expect(workspaceDemoScript('workspace-a')).toBe('/demo/a.json');
    expect(workspaceDemoScript('workspace-b')).toBeUndefined();
    expect(workspaceDemoScript('toString')).toBeUndefined();
  });

  it('fails closed on malformed configuration', () => {
    vi.stubEnv('VOCION_ALLOW_SCRIPTED_MODEL', '1');
    vi.stubEnv('VOCION_DEMO_WORKSPACE_SCRIPTS', '{"workspace-a":"relative.json"}');

    expect(() => workspaceDemoScript('workspace-a')).toThrow();
  });
});
