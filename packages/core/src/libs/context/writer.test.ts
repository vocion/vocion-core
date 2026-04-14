import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContext } from './loader';
import { deleteResource, writeAgent, writeObjectType, writeSkill } from './writer';

function scratchContext(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-writer-'));
  writeFileSync(join(dir, 'context.yaml'), 'version: 1\norgId: test_org\nname: test\n');
  return dir;
}

describe('writer', () => {
  it('writes a skill and loads it back identically', () => {
    const dir = scratchContext();
    try {
      const written = writeSkill({
        contextPath: dir,
        manifest: {
          slug: 'test_skill',
          name: 'Test Skill',
          description: 'unit test skill',
          category: 'query',
          status: 'active',
          version: 1,
          requiresApproval: false,
        } as never,
        promptMd: '# Test\n\nUse {{transcript}} as input.',
      });

      expect(written.files).toHaveLength(2);
      expect(written.files.some(f => f.endsWith('skill.yaml'))).toBe(true);
      expect(written.files.some(f => f.endsWith('prompt.md'))).toBe(true);

      const loaded = loadContext(dir);

      expect(loaded.skills).toHaveLength(1);
      expect(loaded.skills[0]!.slug).toBe('test_skill');
      expect(loaded.skills[0]!.resolvedPromptTemplate).toBe('# Test\n\nUse {{transcript}} as input.');
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
          skills: ['test_skill'],
          connectorSources: ['zoom'],
          objectTypes: [],
          documentSetIds: [],
          searchConfig: {},
          fewShotExamples: [],
          approvalPolicy: {},
        } as never,
        systemPromptMd: 'You are TestBot. Be concise.',
      });

      const loaded = loadContext(dir);

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

      const loaded = loadContext(dir);

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
          category: 'query',
          status: 'active',
          version: 1,
          requiresApproval: false,
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
          category: 'query',
          status: 'active',
          version: 1,
          requiresApproval: false,
        } as never,
        promptMd: 'x',
      })).toThrow();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
