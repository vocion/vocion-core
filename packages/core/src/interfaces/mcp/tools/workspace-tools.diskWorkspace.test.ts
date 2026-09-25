/**
 * The disk-backed workspace tools belong to stdio, not to HTTP.
 *
 * `contextPath` is a property of the PROCESS. One HTTP process serves every
 * org, and production pins `WORKSPACE_PATH=/workspace/metacto-revenue` on the
 * app container, so offering these tools over HTTP handed a token scoped to any
 * org the revenue workspace's prompts, skills and its org id. `diskWorkspace`
 * is the switch; these cases pin which tools it governs.
 */

import type { McpConfig } from '../config';
import { describe, expect, it } from 'vitest';
import { workspaceTools } from './workspace-tools';

const configWith = (diskWorkspace: boolean): McpConfig => ({
  orgId: 'proj-northwind',
  contextPath: '/workspace/some-other-org',
  diskWorkspace,
  autoCommit: false,
  autoApply: false,
  serverName: 'vocion',
  serverVersion: '0.1.0',
});

const namesFor = (diskWorkspace: boolean) => workspaceTools(configWith(diskWorkspace)).map(t => t.name);

/** Every tool that reads or writes the workspace checkout. */
const DISK_BACKED = [
  'workspace_list',
  'workspace_get',
  'workspace_write_skill',
  'workspace_write_playbook',
  'workspace_write_mission',
  'workspace_write_agent',
  'workspace_write_object_type',
  'workspace_delete',
  'workspace_apply',
  'workspace_diff',
];

/** Pure database reads scoped by `config.orgId`, which IS the caller's. */
const ORG_SCOPED = ['workspace_version_history', 'workspace_pause', 'workspace_resume'];

describe('workspaceTools disk gating', () => {
  it('offers the disk-backed tools when the context path is the caller\'s', () => {
    const names = namesFor(true);

    for (const name of DISK_BACKED) {
      expect(names).toContain(name);
    }
  });

  it('omits every disk-backed tool when it is not', () => {
    const names = namesFor(false);

    for (const name of DISK_BACKED) {
      expect(names).not.toContain(name);
    }
  });

  it('keeps the org-scoped tools either way', () => {
    for (const disk of [true, false]) {
      const names = namesFor(disk);
      for (const name of ORG_SCOPED) {
        expect(names).toContain(name);
      }
    }
  });

  it('leaves no tool that would read the checkout when gated off', () => {
    // Absent, not merely guarded: a caller cannot invoke what is not listed,
    // and nothing has to remember to re-check the flag inside a handler.
    expect(namesFor(false).filter(n => DISK_BACKED.includes(n))).toEqual([]);
  });
});
