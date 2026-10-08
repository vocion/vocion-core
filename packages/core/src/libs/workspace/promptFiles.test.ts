/**
 * A prompt file is a file inside the workspace folder. Not only operators
 * write workspaces any more — an import is an admin's upload — so a prompt
 * file that reached outside the folder would read whatever this process can
 * read into an agent's prompt, where an admin reads it back. The loader
 * refuses it by path, by real path through a link, and the schema refuses an
 * absolute one; the refusal names the field, never the place it reached.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadWorkspace, WorkspaceValidationError } from './loader';

const ROOT = mkdtempSync(join(tmpdir(), 'vocion-prompt-files-'));

/** A secret beside the workspace, where a prompt file must not reach. */
const OUTSIDE = join(ROOT, 'outside.md');
writeFileSync(OUTSIDE, 'NORTHWIND_SECRET=do-not-read\n');

/**
 * A one-agent workspace, plus whatever files a case adds.
 * @param files - Path inside the workspace → content.
 */
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(ROOT, 'ws-'));
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: proj_northwind\nname: Northwind\n');
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

function refusal(dir: string): string {
  try {
    loadWorkspace(dir);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceValidationError);

    return (error as Error).message;
  }
  throw new Error('the workspace loaded');
}

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('prompt files', () => {
  it('reads a prompt file beside the agent, or in a folder under the workspace', () => {
    const dir = workspace({
      'agents/scout.yaml': 'slug: scout\nname: Scout\nsystemPromptFile: scout.system-prompt.md\nsubagents:\n  - name: helper\n    description: Helps.\n    systemPromptFile: ../prompts/helper.md\n',
      'agents/scout.system-prompt.md': 'You scout Northwind accounts.\n',
      'prompts/helper.md': 'You help the scout.\n',
    });
    const loaded = loadWorkspace(dir);

    expect(loaded.agents[0]!.resolvedSystemPrompt).toBe('You scout Northwind accounts.');
    expect(loaded.agents[0]!.resolvedSubagents[0]!.systemPrompt).toBe('You help the scout.');
  });

  it('refuses one that climbs out of the workspace folder, for an agent, a subagent and an object type', () => {
    const cases = {
      'agents/scout.yaml': 'slug: scout\nname: Scout\nsystemPromptFile: ../../outside.md\n',
      'agents/lead.yaml': 'slug: lead\nname: Lead\nsystemPrompt: Hi.\nsubagents:\n  - name: helper\n    description: Helps.\n    systemPromptFile: ../../outside.md\n',
      'objects/account/type.yaml': 'slug: account\nlabel: Account\nclassificationPromptFile: ../../../outside.md\n',
    };
    for (const [rel, body] of Object.entries(cases)) {
      const message = refusal(workspace({ [rel]: body }));

      expect(message).toMatch(/PromptFile: must name a file inside the workspace folder/);
      expect(message).not.toContain('do-not-read');
      expect(message).not.toContain(OUTSIDE);
    }
  });

  it('refuses an absolute path before reading anything', () => {
    const message = refusal(workspace({ 'agents/scout.yaml': `slug: scout\nname: Scout\nsystemPromptFile: ${OUTSIDE}\n` }));

    expect(message).toContain('systemPromptFile: must be a path relative to this file');
    expect(message).not.toContain('do-not-read');
  });

  it('refuses a link inside the folder that points out of it', () => {
    const dir = workspace({ 'agents/scout.yaml': 'slug: scout\nname: Scout\nsystemPromptFile: scout.system-prompt.md\n' });
    symlinkSync(OUTSIDE, join(dir, 'agents', 'scout.system-prompt.md'));

    const message = refusal(dir);

    expect(message).toMatch(/systemPromptFile: must name a file inside the workspace folder/);
    expect(message).not.toContain('do-not-read');
  });
});
