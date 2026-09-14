/**
 * `{{env.NAME}}` substitution in workspace files.
 *
 * The bug this prevents is quiet: a playbook that named a per-box API
 * URL as a literal token was served to the agent unchanged, the model
 * read `{{VEERIO_API_URL}}` as a real address, guessed three plausible
 * hostnames, and fell back to remembered sources. Nothing errored. So
 * every unresolvable token here must raise, never pass through.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  allowlistedTemplateVariableNames,
  readWorkspaceTextFile,
  substituteEnvTokens,
  WorkspaceTemplateError,
} from './template-vars';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.WORKSPACE_TEMPLATE_VARS;
  delete process.env.VEERIO_API_URL;
  delete process.env.PORTAL_HOST;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('allowlistedTemplateVariableNames', () => {
  it('is empty when the allowlist is unset, so nothing substitutes by default', () => {
    expect(allowlistedTemplateVariableNames()).toEqual([]);
  });

  it('splits on commas and trims the spaces people leave in .env files', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = ' VEERIO_API_URL , PORTAL_HOST ,';

    expect(allowlistedTemplateVariableNames()).toEqual(['VEERIO_API_URL', 'PORTAL_HOST']);
  });
});

describe('substituteEnvTokens', () => {
  it('replaces an allowlisted token with the value from the environment', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
    process.env.VEERIO_API_URL = 'https://api-dev.veerio.app';

    const out = substituteEnvTokens(
      'GET {{env.VEERIO_API_URL}}/api/sources/ingestion',
      'playbooks/ingest-sources/SKILL.md',
    );

    expect(out).toBe('GET https://api-dev.veerio.app/api/sources/ingestion');
  });

  it('replaces every occurrence, not only the first', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
    process.env.VEERIO_API_URL = 'https://api.veerio.app';

    const out = substituteEnvTokens('{{env.VEERIO_API_URL}} and {{env.VEERIO_API_URL}}', 'f.md');

    expect(out).toBe('https://api.veerio.app and https://api.veerio.app');
  });

  it('tolerates spaces inside the braces, so a near-miss still resolves', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'PORTAL_HOST';
    process.env.PORTAL_HOST = 'portal.example.com';

    expect(substituteEnvTokens('{{ env.PORTAL_HOST }}', 'f.md')).toBe('portal.example.com');
  });

  it('rejects a token that is not on the allowlist, naming the file and the token', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'PORTAL_HOST';
    process.env.DATABASE_URL = 'postgres://secret@host/db';

    const substitute = () => substituteEnvTokens('{{env.DATABASE_URL}}', 'playbooks/leak/SKILL.md');

    expect(substitute).toThrow(WorkspaceTemplateError);
    expect(substitute).toThrow(/playbooks\/leak\/SKILL\.md/);
    expect(substitute).toThrow(/DATABASE_URL/);
    expect(substitute).toThrow(/not allowlisted/);
  });

  it('rejects every token when the allowlist is unset, rather than substituting nothing quietly', () => {
    process.env.VEERIO_API_URL = 'https://api.veerio.app';

    expect(() => substituteEnvTokens('{{env.VEERIO_API_URL}}', 'f.md')).toThrow(/not allowlisted/);
  });

  it('rejects an allowlisted variable that has no value in this environment', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';

    const substitute = () => substituteEnvTokens('{{env.VEERIO_API_URL}}', 'missions/ingest.yaml');

    expect(substitute).toThrow(WorkspaceTemplateError);
    expect(substitute).toThrow(/missions\/ingest\.yaml/);
    expect(substitute).toThrow(/has no value/);
  });

  it('treats a blank value as unset — an empty URL fails later and further away', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
    process.env.VEERIO_API_URL = '   ';

    expect(() => substituteEnvTokens('{{env.VEERIO_API_URL}}', 'f.md')).toThrow(/has no value/);
  });

  it('rejects a value with a line break, which would splice new lines into a YAML file', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
    process.env.VEERIO_API_URL = 'https://api.veerio.app\nextraKey: injected';

    const substitute = () => substituteEnvTokens('base: {{env.VEERIO_API_URL}}', 'missions/ingest.yaml');

    expect(substitute).toThrow(WorkspaceTemplateError);
    expect(substitute).toThrow(/line break/);
  });

  it('rejects a value with a carriage return too', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'PORTAL_HOST';
    process.env.PORTAL_HOST = 'portal.example.com\r';

    expect(() => substituteEnvTokens('{{env.PORTAL_HOST}}', 'f.yaml')).toThrow(/line break/);
  });

  it('leaves Handlebars-like text that is not an env token completely alone', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
    process.env.VEERIO_API_URL = 'https://api.veerio.app';

    const authored = 'Render {{customer.name}}, {{#each items}}, {{env.lowercase}} and {{ENV.SHOUTED}}.';

    expect(substituteEnvTokens(authored, 'skills/templating/SKILL.md')).toBe(authored);
  });

  it('returns text with no braces at all untouched', () => {
    expect(substituteEnvTokens('plain body', 'f.md')).toBe('plain body');
  });
});

describe('readWorkspaceTextFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vocion-template-vars-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('substitutes while reading a file off disk', () => {
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
    process.env.VEERIO_API_URL = 'https://api-dev.veerio.app';
    const file = join(root, 'SKILL.md');
    writeFileSync(file, 'Fetch {{env.VEERIO_API_URL}}/api/sources\n');

    expect(readWorkspaceTextFile(file)).toBe('Fetch https://api-dev.veerio.app/api/sources\n');
  });

  it('names the real file path when a token cannot be resolved', () => {
    const file = join(root, 'mission.yaml');
    writeFileSync(file, 'goal: call {{env.VEERIO_API_URL}}\n');

    expect(() => readWorkspaceTextFile(file)).toThrow(file);
  });
});
