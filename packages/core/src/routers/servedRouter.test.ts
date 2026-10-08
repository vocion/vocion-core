/**
 * `/rpc` serves core's router plus each extension's at `ext.<name>`; core's
 * own typed router is left as it was.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@vocion/enterprise/index', () => ({
  extensions: [{ name: 'sample', router: { hello: { marker: 'sample-hello' } } }, { name: 'no-router' }],
}));
vi.mock('@/libs/DB');
vi.mock('next-auth', () => ({ default: () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }) }));

const { router, servedRouter } = await import('./index');

describe('the router /rpc serves', () => {
  it('mounts each extension\'s router at ext.<name> beside core\'s procedures', () => {
    const served = servedRouter();

    expect(served.ext).toEqual({ sample: { hello: { marker: 'sample-hello' } } });
    expect(served.projects).toBe(router.projects);
    expect('ext' in router).toBe(false);
  });
});
