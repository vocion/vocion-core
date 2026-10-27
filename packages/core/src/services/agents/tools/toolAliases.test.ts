import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

/**
 * Data rooms became Projects (2026-10-27). The old tool names, and the old
 * `room_id` argument, keep working for one release: a stored prompt, skill,
 * grant or exclusion that names one reaches the new tool.
 */

vi.mock('@/libs/DB');

const { canonicalToolArgs, canonicalToolCall, canonicalToolName, canonicalToolNames, TOOL_ALIASES } = await import('./toolAliases');
const { projectTools } = await import('./projects');

const ctx = { orgId: 'org_aliases', userId: 'u1', harnessConfig: {}, emit: () => {} } as unknown as RuntimeContext;

describe('old project tool names', () => {
  it('every old name points at a project tool that exists, and every project tool says what it was', () => {
    const tools = new Map<string, { description: string }>(projectTools(ctx).map(t => [t.name, t]));

    expect([...tools.keys()]).toEqual(['list_projects', 'read_project', 'create_project', 'update_project', 'file_to_project', 'unfile_from_project', 'add_open_item']);

    for (const [old, now] of Object.entries(TOOL_ALIASES)) {
      expect(tools.has(now), `${old} → ${now}`).toBe(true);
      expect(tools.get(now)!.description).toContain(`Formerly ${old}`);
    }
  });

  it('reads an old name as the new one, and leaves every other name alone', () => {
    expect(canonicalToolName('read_data_room')).toBe('read_project');
    expect(canonicalToolName('file_to_data_room')).toBe('file_to_project');
    expect(canonicalToolName('render_document')).toBe('render_document');
    expect(canonicalToolNames(['list_data_rooms', 'search_knowledge'])).toEqual(['list_projects', 'search_knowledge']);
    expect(canonicalToolNames(undefined)).toEqual([]);
  });

  it('moves room_id to project_id, never over a project_id already given', () => {
    expect(canonicalToolArgs('read_project', { room_id: 4 })).toEqual({ project_id: 4 });
    expect(canonicalToolArgs('render_document', { room_id: 4, title: 'x' })).toEqual({ project_id: 4, title: 'x' });
    expect(canonicalToolArgs('file_to_project', { room_id: 4, project_id: 9 })).toEqual({ project_id: 9 });
    expect(canonicalToolArgs('extract_records', { room: 'Expo badges' })).toEqual({ project: 'Expo badges' });

    const untouched = { project_id: 4 };

    expect(canonicalToolArgs('read_project', untouched)).toBe(untouched);
    expect(canonicalToolArgs('search_knowledge', { room_id: 4 })).toEqual({ room_id: 4 });
  });

  it('renames a call only when the loop has no tool by that name', () => {
    const call = { name: 'update_data_room', args: { room_id: 3, status: 'Signed.' }, id: 'c1' };

    expect(canonicalToolCall(call, false)).toEqual({ name: 'update_project', args: { project_id: 3, status: 'Signed.' }, id: 'c1' });
    expect(canonicalToolCall(call, true).name).toBe('update_data_room');

    const current = { name: 'read_project', args: { project_id: 3 } };

    expect(canonicalToolCall(current, true)).toBe(current);
  });
});
