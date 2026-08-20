import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';
import { assertDoTargets, assertOwnership } from './ownership';

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

describe('assertDoTargets', () => {
  const doAuto = (slug: string, doCfg: { workflow?: string; checkMission?: string; job?: string; prompt?: string }) =>
    ({ slug, sourceFile: `automations/${slug}.yaml`, do: doCfg });

  it('accepts a checkMission that resolves to a workspace mission', () => {
    expect(() => assertDoTargets(
      [doAuto('discovery-sweep', { checkMission: 'discovery-to-proposal', prompt: 'run the pass' })],
      [{ slug: 'discovery-to-proposal' }],
      [],
    )).not.toThrow();
  });

  it('rejects an automation whose checkMission target does not resolve', () => {
    expect(() => assertDoTargets(
      [doAuto('discovery-sweep', { checkMission: 'no-such-mission', prompt: 'run the pass' })],
      [{ slug: 'discovery-to-proposal' }],
      [],
    )).toThrow(/checks mission "no-such-mission"/);
  });

  it('rejects an automation whose workflow target does not resolve', () => {
    expect(() => assertDoTargets(
      [doAuto('reply-followup', { workflow: 'ghost_workflow' })],
      [],
      [{ slug: 'discovery_followup' }],
    )).toThrow(/runs workflow "ghost_workflow"/);
  });

  it('leaves job automations alone (validated by the server registry)', () => {
    expect(() => assertDoTargets([doAuto('sweeper', { job: 'some-job' })], [], [])).not.toThrow();
  });
});

describe('loadWorkspace do-targets (end-to-end)', () => {
  let dir: string;

  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const scaffold = (opts: { mission: boolean; prompt?: string; promptWithoutMission?: boolean }) => {
    dir = mkdtempSync(join(tmpdir(), 'cc-dotargets-'));
    writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\n');
    mkdirSync(join(dir, 'agents'));
    writeFileSync(join(dir, 'agents', 'revenue-lead.yaml'), 'slug: revenue-lead\nname: Revenue Lead\nsystemPrompt: You lead revenue.\n');
    if (opts.mission) {
      mkdirSync(join(dir, 'missions'));
      writeFileSync(
        join(dir, 'missions', 'discovery-to-proposal.yaml'),
        'slug: discovery-to-proposal\nname: Discovery to Proposal\ngoal: find discovery calls\nagent: revenue-lead\n',
      );
    }
    mkdirSync(join(dir, 'automations'));
    const doBlock = opts.promptWithoutMission
      ? `do:\n  workflow: something\n  prompt: "orders"\n`
      : `do:\n  checkMission: discovery-to-proposal\n${opts.prompt ? `  prompt: "${opts.prompt}"\n` : ''}`;
    writeFileSync(
      join(dir, 'automations', 'discovery-sweep.yaml'),
      `slug: discovery-sweep\nname: Discovery sweep\nagent: revenue-lead\nwhen:\n  schedule: "0 * * * *"\n${doBlock}`,
    );
    return dir;
  };

  it('accepts prompt: inside do: and keeps it on the loaded resource', () => {
    const loaded = loadWorkspace(scaffold({ mission: true, prompt: 'Run a detection pass.' }));
    const sweep = loaded.automations.find(a => a.slug === 'discovery-sweep');

    expect(sweep?.do).toMatchObject({ checkMission: 'discovery-to-proposal', prompt: 'Run a detection pass.' });
  });

  it('fails the load when the checkMission target is not a mission in this workspace', () => {
    expect(() => loadWorkspace(scaffold({ mission: false, prompt: 'Run a detection pass.' })))
      .toThrow(/checks mission "discovery-to-proposal"/);
  });

  it('rejects prompt: on a non-checkMission do', () => {
    expect(() => loadWorkspace(scaffold({ mission: true, promptWithoutMission: true })))
      .toThrow(/prompt requires do.checkMission/);
  });
});
