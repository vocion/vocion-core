/**
 * A release is called by a short name, written once from what it shipped
 * (2026-10-01, release #280). The model is injected; every name is invented.
 */
import { describe, expect, it } from 'vitest';
import { nameRelease } from './releaseName';

function model(args: unknown) {
  const asked: string[] = [];
  return {
    asked,
    m: { bindTools: () => ({ invoke: async (messages: Array<{ content: string }>) => {
      asked.push(String(messages[1]!.content));
      return { tool_calls: [{ name: 'name_release', args }] };
    } }) } as never,
  };
}

describe('the release name', () => {
  it('reads what shipped and returns the typed name', async () => {
    const j = model({ name: 'Last-opened line on the document page' });

    expect(await nameRelease({ orgId: 'org_release_name', features: [{ title: 'On the Harbor document page, add a line under the title that says when it was last opened', outcome: null }] }, j.m)).toBe('Last-opened line on the document page');
    expect(j.asked[0]).toContain('- On the Harbor document page, add a line');
  });

  it('nothing shipped, or a reply outside the shape, names nothing', async () => {
    expect(await nameRelease({ orgId: 'org_release_name', features: [] }, model({ name: 'x y' }).m)).toBeNull();
    expect(await nameRelease({ orgId: 'org_release_name', features: [{ title: 'A thing', outcome: null }] }, model({ name: 'x'.repeat(200) }).m)).toBeNull();
  });
});
