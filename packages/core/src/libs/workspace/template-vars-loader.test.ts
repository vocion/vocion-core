import { createHash } from 'node:crypto';
/**
 * `{{env.NAME}}` substitution through the real `workspace apply` load
 * path.
 *
 * The point of covering the loader as well as the substitution helper
 * is the `contentSha`: `workspace apply` stores a hash of the playbook
 * body, and the agent is later served the body read off disk. If only
 * one of those two paths substituted, the stored hash would describe a
 * file nobody ever sees, and every apply would look like a change.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';

const ORIGINAL_ENV = { ...process.env };
const createdDirs: string[] = [];

/**
 * A minimal valid workspace on disk, plus whatever files the test needs.
 * @param files - relative path to file body, written under the workspace.
 */
function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vocion-template-loader-'));
  createdDirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\n');
  for (const [relativePath, body] of Object.entries(files)) {
    mkdirSync(join(dir, relativePath, '..'), { recursive: true });
    writeFileSync(join(dir, relativePath), body);
  }
  return dir;
}

const INGESTOR_AGENT = 'slug: ingestor\nname: Ingestor\nsystemPrompt: Ingest sources.\n';

beforeEach(() => {
  process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
  process.env.VEERIO_API_URL = 'https://api-dev.veerio.app';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

describe('loadWorkspace — {{env.NAME}} in a playbook body', () => {
  const playbookFile = 'playbooks/ingest-sources/SKILL.md';
  const playbookText = [
    '---',
    'slug: ingest-sources',
    'name: Ingest sources',
    'description: Pull the source list before ingesting.',
    '---',
    '',
    'Fetch {{env.VEERIO_API_URL}}/api/sources/ingestion first.',
    '',
  ].join('\n');

  it('serves the resolved URL, with no token left in the body', () => {
    const workspace = loadWorkspace(makeWorkspace({ [playbookFile]: playbookText }));
    const playbook = workspace.playbooks.find(p => p.slug === 'ingest-sources');

    expect(playbook?.body).toBe('Fetch https://api-dev.veerio.app/api/sources/ingestion first.');
    expect(playbook?.body).not.toContain('{{');
  });

  it('hashes the substituted body, so the stored contentSha matches what the agent reads', () => {
    const workspace = loadWorkspace(makeWorkspace({ [playbookFile]: playbookText }));
    const playbook = workspace.playbooks.find(p => p.slug === 'ingest-sources');
    const expected = createHash('sha256')
      .update('Fetch https://api-dev.veerio.app/api/sources/ingestion first.', 'utf8')
      .digest('hex');

    expect(playbook?.contentSha).toBe(expected);
  });

  it('fails the whole load, naming the file, when the variable leaves the environment', () => {
    delete process.env.VEERIO_API_URL;
    const dir = makeWorkspace({ [playbookFile]: playbookText });

    expect(() => loadWorkspace(dir)).toThrow(/VEERIO_API_URL/);
    expect(() => loadWorkspace(dir)).toThrow(/SKILL\.md/);
  });

  it('fails when the variable is set but not allowlisted', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'SOMETHING_ELSE';
    const dir = makeWorkspace({ [playbookFile]: playbookText });

    expect(() => loadWorkspace(dir)).toThrow(/not allowlisted/);
  });
});

describe('loadWorkspace — {{env.NAME}} in a mission yaml', () => {
  const missionText = [
    'slug: ingest-daily',
    'name: Ingest daily',
    'agent: ingestor',
    'goal: Read the source list from {{env.VEERIO_API_URL}}/api/sources/ingestion daily.',
    '',
  ].join('\n');

  it('substitutes inside a YAML value', () => {
    const workspace = loadWorkspace(makeWorkspace({
      'agents/ingestor.yaml': INGESTOR_AGENT,
      'missions/ingest-daily.yaml': missionText,
    }));
    const mission = workspace.missions.find(m => m.slug === 'ingest-daily');

    expect(mission?.goal).toBe('Read the source list from https://api-dev.veerio.app/api/sources/ingestion daily.');
  });

  it('fails the load when the mission names an unset variable', () => {
    delete process.env.VEERIO_API_URL;

    expect(() => loadWorkspace(makeWorkspace({
      'agents/ingestor.yaml': INGESTOR_AGENT,
      'missions/ingest-daily.yaml': missionText,
    }))).toThrow(/VEERIO_API_URL/);
  });
});

describe('loadWorkspace — text that only looks like a token', () => {
  it('leaves Handlebars examples in a skill exactly as authored', () => {
    const authoredBody = 'Render {{customer.name}} and {{#each items}} untouched.';
    const workspace = loadWorkspace(makeWorkspace({
      'skills/templating/SKILL.md': [
        '---',
        'slug: templating',
        'name: Templating',
        'description: How we template outbound email.',
        '---',
        '',
        authoredBody,
        '',
      ].join('\n'),
    }));
    const skill = workspace.skills.find(s => s.slug === 'templating');

    expect(skill?.body).toBe(authoredBody);
  });
});
