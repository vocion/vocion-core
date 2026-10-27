import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

/**
 * Projects are a core workspace noun (2026-10-27): their tools are on in every
 * workspace, whatever plugins it has. They were gated on the `data-rooms`
 * plugin while projects were "data rooms".
 */

vi.mock('@/libs/DB');

const { buildDomainTools } = await import('./registry');

const ctx = (enabledPlugins: string[] | undefined): RuntimeContext => ({
  orgId: 'org_projects_core',
  userId: 'u1',
  agentSlug: 'assistant',
  connectorSources: [],
  objectTypeSlugs: [],
  searchConfig: {},
  harnessConfig: {},
  citationSeq: { current: 0 },
  emit: () => {},
  ...(enabledPlugins ? { enabledPlugins } : {}),
} as unknown as RuntimeContext);

describe('the project tools', () => {
  it('are there with no plugin on, with the plugin on, and with no plugin list at all', () => {
    for (const plugins of [[], ['data-rooms'], ['software-factory'], undefined]) {
      const names = buildDomainTools(ctx(plugins)).map(t => t.name);

      expect(names, String(plugins)).toEqual(expect.arrayContaining(['list_projects', 'read_project', 'create_project', 'update_project', 'file_to_project', 'unfile_from_project', 'add_open_item']));
      expect(names.some(n => n.endsWith('_data_room') || n.endsWith('_data_rooms'))).toBe(false);
    }
  });
});
