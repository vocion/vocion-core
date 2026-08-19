import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';
import { assertOwnership } from './ownership';

const agent = (slug: string) => ({ slug });
const automation = (slug: string, agent?: string) => ({ slug, agent, sourceFile: `automations/${slug}.yaml` });
const workflow = (slug: string, agent?: string) => ({ slug, agent, sourceFile: `workflows/${slug}/workflow.yaml` });

describe('assertOwnership', () => {
  it('accepts an automation whose owner agent exists', () => {
    expect(() => assertOwnership(
      [agent('revenue-lead')],
      [automation('discovery-sweep', 'revenue-lead')],
      [],
    )).not.toThrow();
  });

  it('accepts a workflow whose owner agent exists', () => {
    expect(() => assertOwnership(
      [agent('revenue-lead')],
      [],
      [workflow('discovery-followup', 'revenue-lead')],
    )).not.toThrow();
  });

  it('leaves ownerless automations/workflows untouched (opt-in)', () => {
    expect(() => assertOwnership(
      [agent('revenue-lead')],
      [automation('crm-sweep')],
      [workflow('discovery-followup')],
    )).not.toThrow();
  });

  it('rejects an automation naming an unknown owner — and says which', () => {
    expect(() => assertOwnership(
      [agent('revenue-lead')],
      [automation('discovery-sweep', 'discovery-scout')],
      [],
    )).toThrow(/automation "discovery-sweep" names owner agent "discovery-scout"/);
  });

  it('rejects a workflow naming an unknown owner', () => {
    expect(() => assertOwnership(
      [agent('revenue-lead')],
      [],
      [workflow('discovery-followup', 'nobody')],
    )).toThrow(/workflow "discovery-followup" names owner agent "nobody"/);
  });

  it('reports every dangling owner at once', () => {
    expect(() => assertOwnership(
      [agent('revenue-lead')],
      [automation('a', 'ghost-1')],
      [workflow('b', 'ghost-2')],
    )).toThrow(/ghost-1[\s\S]*ghost-2/);
  });
});

describe('loadWorkspace ownership (end-to-end)', () => {
  let dir: string;

  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const scaffold = (ownerSlug: string) => {
    dir = mkdtempSync(join(tmpdir(), 'cc-ownership-'));
    writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\n');
    mkdirSync(join(dir, 'agents'));
    writeFileSync(join(dir, 'agents', 'revenue-lead.yaml'), 'slug: revenue-lead\nname: Revenue Lead\nsystemPrompt: You lead revenue.\n');
    mkdirSync(join(dir, 'automations'));
    writeFileSync(
      join(dir, 'automations', 'discovery-sweep.yaml'),
      `slug: discovery-sweep\nname: Discovery sweep\nagent: ${ownerSlug}\nwhen:\n  schedule: "0 * * * *"\ndo:\n  job: discovery-sweep\n`,
    );
    return dir;
  };

  it('parses agent: off an automation and keeps it on the loaded resource', () => {
    const loaded = loadWorkspace(scaffold('revenue-lead'));
    const sweep = loaded.automations.find(a => a.slug === 'discovery-sweep');

    expect(sweep?.agent).toBe('revenue-lead');
  });

  it('fails the whole load when the owner agent does not exist', () => {
    expect(() => loadWorkspace(scaffold('discovery-scout')))
      .toThrow(/names owner agent "discovery-scout"/);
  });
});
