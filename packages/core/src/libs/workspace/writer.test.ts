import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';
import { deleteResource, writeAgent, writeMission, writeObjectType, writeSkill, writeSourceText } from './writer';

function scratchContext(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-writer-'));
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\n');
  return dir;
}

describe('writer', () => {
  // A skill folder's slug is also its Agent Skills `name` (libs/skills/name.ts),
  // so underscores are refused at apply time now — hence the hyphen here where
  // this fixture used to carry `test_skill`.
  it('writes a skill and loads it back identically', () => {
    const dir = scratchContext();
    try {
      const written = writeSkill({
        contextPath: dir,
        manifest: {
          slug: 'test-skill',
          name: 'Test Skill',
          description: 'unit test skill',
          version: 1,
        } as never,
        promptMd: '# Test\n\nDo the test thing.',
      });

      expect(written.files).toHaveLength(1);
      expect(written.files.some(f => f.endsWith('SKILL.md'))).toBe(true);

      const loaded = loadWorkspace(dir);

      expect(loaded.skills).toHaveLength(1);
      expect(loaded.skills[0]!.slug).toBe('test-skill');
      expect(loaded.skills[0]!.kind).toBe('skill');
      expect(loaded.skills[0]!.body).toBe('# Test\n\nDo the test thing.');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('writes an agent with a referenced system prompt file', () => {
    const dir = scratchContext();
    try {
      writeAgent({
        contextPath: dir,
        manifest: {
          slug: 'testbot',
          name: 'TestBot',
          active: true,
          skills: [],
          connectorSources: ['zoom'],
          objectTypes: [],
          documentSetIds: [],
          searchConfig: {},
          fewShotExamples: [],
          approvalPolicy: {},
        } as never,
        systemPromptMd: 'You are TestBot. Be concise.',
      });

      const loaded = loadWorkspace(dir);

      expect(loaded.agents).toHaveLength(1);
      expect(loaded.agents[0]!.slug).toBe('testbot');
      expect(loaded.agents[0]!.resolvedSystemPrompt).toBe('You are TestBot. Be concise.');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('writes an object type with optional classification prompt', () => {
    const dir = scratchContext();
    try {
      writeObjectType({
        contextPath: dir,
        manifest: {
          slug: 'widget',
          label: 'Widget',
          description: 'a test type',
          fewShotExamples: [],
        } as never,
        classificationPromptMd: 'A widget is anything shaped like a widget.',
      });

      const loaded = loadWorkspace(dir);

      expect(loaded.objectTypes).toHaveLength(1);
      expect(loaded.objectTypes[0]!.slug).toBe('widget');
      expect(loaded.objectTypes[0]!.resolvedClassificationPrompt).toBe('A widget is anything shaped like a widget.');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('omits classification prompt file when not provided', () => {
    const dir = scratchContext();
    try {
      writeObjectType({
        contextPath: dir,
        manifest: {
          slug: 'widget',
          label: 'Widget',
          fewShotExamples: [],
        } as never,
      });

      const yaml = readFileSync(join(dir, 'objects/widget/type.yaml'), 'utf8');

      expect(yaml).not.toContain('classificationPromptFile');
      expect(existsSync(join(dir, 'objects/widget/classification-prompt.md'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('deletes a skill directory', () => {
    const dir = scratchContext();
    try {
      writeSkill({
        contextPath: dir,
        manifest: {
          slug: 'doomed',
          name: 'Doomed',
          description: 'doomed test skill',
          version: 1,
        } as never,
        promptMd: 'bye',
      });

      expect(existsSync(join(dir, 'skills/doomed'))).toBe(true);

      const removed = deleteResource(dir, 'skill', 'doomed');

      expect(removed).toHaveLength(1);
      expect(existsSync(join(dir, 'skills/doomed'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects invalid slugs', () => {
    const dir = scratchContext();
    try {
      expect(() => writeSkill({
        contextPath: dir,
        manifest: {
          slug: 'Has-Capitals',
          name: 'Bad',
          description: 'bad slug',
          version: 1,
        } as never,
        promptMd: 'x',
      })).toThrow();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('writes a mission from its manifest and loads it back', () => {
    const dir = scratchContext();
    try {
      const written = writeMission({
        contextPath: dir,
        manifest: {
          slug: 'keep-main-releasable',
          name: 'Keep main releasable',
          goal: 'Every merge to main ships.',
          agent: 'release-lead',
        } as never,
      });

      expect(written.kind).toBe('mission');
      expect(written.files[0]).toMatch(/missions\/keep-main-releasable\.yaml$/);

      const loaded = loadWorkspace(dir);

      expect(loaded.missions).toHaveLength(1);
      expect(loaded.missions[0]!.goal).toBe('Every merge to main ships.');
      expect(loaded.missions[0]!.autonomyPolicy.level).toBe(1);
      expect(readFileSync(written.files[0]!, 'utf8')).not.toContain('successCriteria');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('writes a playbook folder when asked for one', () => {
    const dir = scratchContext();
    try {
      const written = writeSkill({
        contextPath: dir,
        manifest: { slug: 'house-style', name: 'House style', description: 'How we write.' } as never,
        promptMd: 'Short sentences.',
        kind: 'playbook',
      });

      expect(written.kind).toBe('playbook');
      expect(written.files[0]).toMatch(/playbooks\/house-style\/SKILL\.md$/);
      expect(loadWorkspace(dir).playbooks[0]!.body).toBe('Short sentences.');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('writes source text verbatim — comments and order kept — and reports what was there before', () => {
    const dir = scratchContext();
    try {
      const text = '# the charter\nslug: keep-main-releasable\nname: Keep main releasable\ngoal: Ship.\nagent: release-lead\n';
      const first = writeSourceText({ contextPath: dir, kind: 'mission', slug: 'keep-main-releasable', content: text });

      expect(first.previous).toBeNull();
      expect(first.title).toBe('Keep main releasable');
      expect(readFileSync(first.path, 'utf8')).toBe(text);

      const second = writeSourceText({ contextPath: dir, kind: 'mission', slug: 'keep-main-releasable', content: text.replace('Ship.', 'Ship daily.') });

      expect(second.previous).toBe(text);
      expect(loadWorkspace(dir).missions[0]!.goal).toBe('Ship daily.');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('refuses source text the schema refuses, before touching disk', () => {
    const dir = scratchContext();
    try {
      expect(() => writeSourceText({ contextPath: dir, kind: 'mission', slug: 'x', content: 'slug: x\nname: X\n' })).toThrow(/goal/);
      expect(existsSync(join(dir, 'missions', 'x.yaml'))).toBe(false);
      expect(() => writeSourceText({ contextPath: dir, kind: 'playbook', slug: 'p', content: 'no frontmatter' })).toThrow(/frontmatter/);
      expect(existsSync(join(dir, 'playbooks', 'p'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('deletes a mission file and a playbook folder', () => {
    const dir = scratchContext();
    try {
      writeMission({ contextPath: dir, manifest: { slug: 'm', name: 'M', goal: 'g', agent: 'a' } as never });
      writeSkill({ contextPath: dir, manifest: { slug: 'p', name: 'P', description: 'd' } as never, promptMd: 'x', kind: 'playbook' });

      expect(deleteResource(dir, 'mission', 'm')).toHaveLength(1);
      expect(deleteResource(dir, 'playbook', 'p')).toHaveLength(1);
      expect(existsSync(join(dir, 'missions', 'm.yaml'))).toBe(false);
      expect(existsSync(join(dir, 'playbooks', 'p'))).toBe(false);
      expect(deleteResource(dir, 'mission', 'm')).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
