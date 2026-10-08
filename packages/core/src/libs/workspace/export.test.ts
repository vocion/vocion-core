import { describe, expect, it } from 'vitest';
/**
 * Rows as workspace files, kind by kind: each the inverse of what the applier
 * writes, so a file written here applies back to the row it came from — and
 * nothing that opens anything, or that is true only of this host, goes out.
 * The whole round trip, through the real applier, is
 * `services/workspace/WorkspaceTransfer.test.ts`.
 */
import { parse as parseYaml } from 'yaml';
import { agentFiles, automationFile, evalDatasetFile, learningStepFile, manifestSettingsFromProject, objectTypeFiles, sourceFile, trustFile } from './export';

const NOW = new Date('2026-10-07T12:00:00Z');

function yamlOf(files: Array<{ path: string; content: string }>, path: string): Record<string, unknown> {
  const file = files.find(f => f.path === path);

  expect(file, path).toBeDefined();

  return parseYaml(file!.content) as Record<string, unknown>;
}

describe('agentFiles', () => {
  const row = {
    id: 1,
    orgId: 'proj_kestrel',
    projectId: 'proj_kestrel',
    slug: 'scout',
    name: 'Scout',
    description: null,
    systemPrompt: 'You scout accounts for Kestrel Capital.',
    model: 'claude-sonnet-4-6',
    temperature: '0.3',
    voice: null,
    voiceOverride: { length: 'short' },
    skillSlugs: ['write-brief'],
    playbookSlugs: [],
    connectorSources: [],
    objectTypeSlugs: [],
    documentSetIds: [],
    approvalPolicy: { requireReview: true, proposals: { openMax: 3 } },
    harnessConfig: {},
    harnessArn: 'arn:aws:bedrock-agentcore:us-west-2:000000000000:harness/fixture',
    searchConfig: {},
    fewShotExamples: [],
    subagents: [],
    learningSteps: [],
    suggestions: [],
    persona: null,
    accent: null,
    eyebrow: null,
    handles: [],
    initiative: 'normal' as const,
    langfuseProjectId: null,
    icon: null,
    active: 'true',
    role: 'lead',
    agentType: null,
    team: null,
    teamSlug: 'research',
    parentAgentSlug: null,
    updatedAt: NOW,
    createdAt: NOW,
  };

  it('writes the prompt beside the manifest, and the proposal budget back under proposals', () => {
    const files = agentFiles(row as never, [{ slug: 'research', leadAgentSlug: 'scout' }]);
    const manifest = yamlOf(files, 'agents/scout.yaml');

    expect(files.find(f => f.path === 'agents/scout.system-prompt.md')?.content).toBe('You scout accounts for Kestrel Capital.\n');
    expect(manifest).toMatchObject({ slug: 'scout', systemPromptFile: 'scout.system-prompt.md', approvalPolicy: { requireReview: true }, proposals: { openMax: 3 } });
    // The lead of one team is put on it by the apply; writing it would make the next apply a change.
    expect(manifest.team).toBeUndefined();
    // A person's voice, a harness ARN, the defaults: none of it is authoring.
    expect(JSON.stringify(manifest)).not.toMatch(/voiceOverride|harnessArn|arn:aws|initiative/);
  });

  it('names the team when the agent is not the one that leads it', () => {
    expect(yamlOf(agentFiles(row as never, [{ slug: 'research', leadAgentSlug: 'analyst' }]), 'agents/scout.yaml').team).toBe('research');
  });
});

describe('sourceFile', () => {
  it('writes a connector\'s settings and its name, never its credential or where it was declared', () => {
    const file = sourceFile({
      id: 4,
      orgId: 'proj_kestrel',
      projectId: 'proj_kestrel',
      slug: 'deal-notes',
      kind: 'plugin',
      configJson: { _connector: 'notion', _manifestDir: '/srv/workspaces/kestrel', _name: 'Deal notes', _processor: { slug: 'candidate-extractor', config: { agent: 'scout' } }, databaseId: 'db_fixture' },
      accessPolicy: { visibility: 'restricted', users: ['partner@kestrel.example'] },
      apiTokenId: 77,
      enabled: 'false',
    } as never);

    expect(file.path).toBe('sources/deal-notes.yaml');
    expect(parseYaml(file.content)).toEqual({
      slug: 'deal-notes',
      name: 'Deal notes',
      kind: 'notion',
      config: { databaseId: 'db_fixture' },
      access: { visibility: 'restricted', users: ['partner@kestrel.example'] },
      processor: { slug: 'candidate-extractor', config: { agent: 'scout' } },
      enabled: false,
    });
  });
});

describe('objectTypeFiles', () => {
  it('lifts the type code and the gates the applier folded into the stored schema back out', () => {
    const files = objectTypeFiles({
      id: 2,
      orgId: 'proj_kestrel',
      slug: 'deal_memo',
      label: 'Deal memo',
      description: null,
      icon: null,
      schema: { 'type': 'object', 'x-code': 'DM', 'x-gates': [{ to: 'approved', requires: ['owner'] }] },
      sourceRelevance: null,
      classificationPrompt: 'A memo on one deal.',
      fewShotExamples: null,
    } as never);
    const manifest = yamlOf(files, 'objects/deal-memo/type.yaml');

    expect(manifest).toEqual({ slug: 'deal_memo', label: 'Deal memo', code: 'DM', schema: { type: 'object' }, classificationPromptFile: 'classification-prompt.md', gates: [{ to: 'approved', requires: ['owner'] }] });
    expect(files.find(f => f.path === 'objects/deal-memo/classification-prompt.md')?.content).toBe('A memo on one deal.\n');
  });
});

describe('automationFile', () => {
  it('lifts a run\'s words out of the do-config, and leaves a person\'s pause behind', () => {
    const file = automationFile({ id: 3, orgId: 'o', projectId: 'o', slug: 'morning-brief', name: 'Morning brief', description: null, status: 'active', whenConfig: { schedule: '0 13 * * 1-5' }, doConfig: { checkMission: 'brief', label: 'Brief', doing: 'Briefing' }, ownerAgentSlug: 'scout', pausedAt: NOW, pausedBy: 'u1', pausedNote: 'holiday', updatedAt: NOW, createdAt: NOW } as never);

    expect(parseYaml(file.content)).toEqual({ slug: 'morning-brief', name: 'Morning brief', label: 'Brief', doing: 'Briefing', status: 'active', agent: 'scout', when: { schedule: '0 13 * * 1-5' }, do: { checkMission: 'brief' } });
  });
});

describe('evalDatasetFile', () => {
  it('writes built-in evaluators as one list, custom ones as themselves, and leaves retired ones out', () => {
    const base = { id: 1, orgId: 'o', datasetSlug: 'briefs', remoteId: null, remoteArn: null, syncedAt: null, syncError: null, createdAt: NOW, updatedAt: NOW };
    const file = evalDatasetFile({ id: 1, orgId: 'o', projectId: 'o', slug: 'briefs', name: 'Briefs', agentSlug: 'scout', provider: 'agentcore', passThreshold: 0.8, description: null, items: [{ input: 'Brief Contoso' }], version: 2, updatedAt: NOW, createdAt: NOW } as never, [
      { ...base, provider: 'agentcore', slug: 'Builtin.Helpfulness', level: 'TRACE', config: {}, retiredAt: null },
      { ...base, provider: 'agentcore', slug: 'Builtin.Correctness', level: 'TRACE', config: {}, retiredAt: null },
      { ...base, provider: 'agentcore', slug: 'cites-sources', level: null, config: { instructions: 'Does it cite?' }, retiredAt: null },
      { ...base, provider: 'agentcore', slug: 'Builtin.Faithfulness', level: 'TRACE', config: {}, retiredAt: NOW },
    ] as never);

    expect(parseYaml(file.content).evaluators).toEqual([
      { provider: 'agentcore', level: 'TRACE', builtin: ['Builtin.Helpfulness', 'Builtin.Correctness'] },
      { provider: 'agentcore', slug: 'cites-sources', instructions: 'Does it cite?' },
    ]);
  });
});

describe('learningStepFile', () => {
  it('carries the rules the workspace seeded, by their authored ids', () => {
    const file = learningStepFile({ id: 1, orgId: 'o', name: 'brief_rules', scopeKind: 'workspace', scopeRef: null, path: 'workspace/brief_rules', title: 'Brief rules', description: 'How briefs go wrong.', preamble: null, agentSlugs: ['scout'], updatedAt: NOW, createdAt: NOW } as never, [{ id: 'numbers-first', text: 'Numbers first.' }, { id: 'cite', text: 'Cite the filing.' }]);

    expect(parseYaml(file.content)).toEqual({ name: 'brief_rules', title: 'Brief rules', description: 'How briefs go wrong.', agents: ['scout'], rules: [{ id: 'cite', text: 'Cite the filing.' }, { id: 'numbers-first', text: 'Numbers first.' }] });
  });
});

describe('trustFile', () => {
  const defaults = (_action: string, enabled: boolean) => ({ rung: enabled ? 'execute-within-bounds' : 'execute-with-approval', risk: 'medium' });

  it('writes a rule\'s rung and risk only where they are not what an apply would give it', () => {
    const file = trustFile({
      rules: [{ actionId: 'gmail.send', threshold: 0.99, enabled: 'false' }, { actionId: 'hubspot.update', threshold: 0.9, enabled: 'true' }],
      policies: [
        { actionId: 'gmail.send', rung: 'execute-with-approval', riskTier: 'high', source: 'trust.yaml' },
        { actionId: 'hubspot.update', rung: 'execute-within-bounds', riskTier: 'medium', source: 'app' },
        { actionId: 'slack.post', rung: 'execute-with-approval', riskTier: 'low', source: 'trust.yaml' },
      ],
    }, defaults);

    expect(parseYaml(file!.content)).toEqual({
      rules: [
        { action: 'gmail.send', autoApproveAbove: 0.99, enabled: false, risk: 'high' },
        { action: 'hubspot.update', autoApproveAbove: 0.9, enabled: true },
      ],
      risk: { 'slack.post': 'low' },
    });
  });

  it('is nothing when there are no rules', () => {
    expect(trustFile({ rules: [], policies: [] }, defaults)).toBeNull();
  });
});

describe('manifestSettingsFromProject', () => {
  it('writes the settings the project row holds, leaving out what the plugins turn on by themselves', () => {
    const settings = manifestSettingsFromProject({
      leadAgentSlug: 'scout',
      accountableUserId: 'u_owner',
      goal: 'Every account briefed.',
      enabledSurfaces: ['wiki', 'rooms'],
      enabledPlugins: ['wiki'],
      enabledDurable: [],
      embeddingConfig: { provider: 'bedrock' },
      regenerateSkills: null,
      clientFacingPlaybooks: [],
      learningEagerness: 0,
      timeZone: 'America/Chicago',
      mailboxEnabled: true,
      mailboxAddress: 'kestrel@mail.vocion.example',
    }, { ownerEmails: new Map([['u_owner', 'owner@kestrel.example']]), pluginSurfaces: new Set(['wiki']) });

    expect(settings).toEqual({
      lead: 'scout',
      goal: 'Every account briefed.',
      accountableUser: 'owner@kestrel.example',
      mailbox: { enabled: true },
      defaults: { timezone: 'America/Chicago', embeddingProvider: 'bedrock', learningEagerness: 0, clientFacingPlaybooks: [] },
      surfaces: ['rooms'],
      plugins: ['wiki'],
    });
  });
});
