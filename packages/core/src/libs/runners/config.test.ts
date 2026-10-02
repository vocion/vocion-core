import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TARGETS, parseRunners, runnersConfig, runnerTarget } from './config';

// The installation's runner targets (backlog 052). Every id and name is invented.
const FLEET = {
  targets: [
    { name: 'aws-fargate', kind: 'aws-fargate', region: 'us-east-1', cluster: 'vocion-runners', taskDefinition: 'vocion-runner', taskDefinitionWithDb: 'vocion-runner-db', subnets: ['subnet-0aaa1111bbbb2222c'], securityGroups: ['sg-0ddd3333eeee4444f'] },
    { name: 'on-box', kind: 'on-box', claimAfterSeconds: 120 },
  ],
};

describe('the installation declares its runners once', () => {
  it('reads the targets from VOCION_RUNNERS, with the Fargate defaults filled', () => {
    const c = runnersConfig({ VOCION_RUNNERS: JSON.stringify(FLEET) });

    expect(c.source).toBe('env');
    expect(c.problem).toBeNull();
    expect(c.targets[0]).toMatchObject({ name: 'aws-fargate', assignPublicIp: true, containerName: 'runner' });
    expect(runnerTarget('on-box', { VOCION_RUNNERS: JSON.stringify(FLEET) })).toEqual({ name: 'on-box', kind: 'on-box', claimAfterSeconds: 120 });
    expect(runnerTarget('azure', { VOCION_RUNNERS: JSON.stringify(FLEET) })).toBeNull();
  });

  it('reads them from the file VOCION_RUNNERS_FILE names', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'runners-')), 'runners.json');
    writeFileSync(file, JSON.stringify(FLEET));

    expect(runnersConfig({ VOCION_RUNNERS_FILE: file }).targets.map(t => t.name)).toEqual(['aws-fargate', 'on-box']);
  });

  it('is the on-box runner alone when nothing is declared, and says why when a declaration is wrong', () => {
    expect(runnersConfig({}).targets).toEqual(DEFAULT_TARGETS);

    const bad = parseRunners(JSON.stringify({ targets: [{ name: 'Fargate!', kind: 'aws-fargate' }] }), 'env');

    expect(bad.targets).toEqual(DEFAULT_TARGETS);
    expect(bad.problem).toMatch(/do not parse/);
    expect(parseRunners('{', 'file').problem).toMatch(/are not JSON/);
    expect(parseRunners(JSON.stringify({ targets: [{ name: 'on-box', kind: 'on-box' }, { name: 'on-box', kind: 'on-box' }] }), 'env').problem).toMatch(/unique/);
  });
});
