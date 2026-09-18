import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { voiceRulesFromStored } from '@/libs/writing/loadVoiceRules';
import { lintCopy, PLATFORM_DEFAULT_VOICE_RULES } from '@/libs/writing/voiceRules';
import { loadWorkspace } from './loader';

const MANIFEST = 'version: 1\norgId: acme\nname: acme-revenue\ndescription: scratch\n';

function workspaceWith(voiceYaml: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-voice-'));
  writeFileSync(join(dir, 'workspace.yaml'), MANIFEST);
  if (voiceYaml !== null) {
    writeFileSync(join(dir, 'voice.yaml'), voiceYaml);
  }
  return dir;
}

describe('voice.yaml', () => {
  it('loads a workspace that has none', () => {
    const dir = workspaceWith(null);
    try {
      expect(loadWorkspace(dir).voice).toBeNull();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('parses the authored rules and counts the file into the sha', () => {
    const dir = workspaceWith([
      'never:',
      '  - pattern: "Quick one"',
      '    reason: "Register announcement."',
      '  - pattern: "saw you (grabbed|downloaded)"',
      '    match: regex',
      '    reason: "Names the tracked behaviour back at the reader."',
      'prefer:',
      '  - pattern: "utilize"',
      '    use: "use"',
      'allow: [leverage]',
      'maxWordsPerSend: 120',
      'maxAsksPerSend: 1',
      'noExclamation: true',
      'playbook: founder-voice',
      'learningStep: voice',
      '',
    ].join('\n'));
    try {
      const loaded = loadWorkspace(dir);

      expect(loaded.voice).not.toBeNull();
      expect(loaded.voice!.never).toHaveLength(2);
      expect(loaded.voice!.never[0]!.match).toBe('phrase');
      expect(loaded.voice!.never[1]!.match).toBe('regex');
      expect(loaded.voice!.allow).toEqual(['leverage']);
      expect(loaded.voice!.playbook).toBe('founder-voice');
      expect(loaded.voice!.learningStep).toBe('voice');
      // voice.yaml + workspace.yaml both counted
      expect(loaded.fileCount).toBe(2);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('refuses a rule with no reason — an unexplained ban is not reviewable', () => {
    const dir = workspaceWith('never:\n  - pattern: "Quick one"\n');
    try {
      expect(() => loadWorkspace(dir)).toThrow(/voice/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe('voiceRulesFromStored — the authored file becomes the runtime rules', () => {
  it('gives a workspace with nothing authored the platform floor', () => {
    expect(voiceRulesFromStored(null)).toBe(PLATFORM_DEFAULT_VOICE_RULES);
  });

  it('applies a phrase rule, a regex rule and an allow together', () => {
    const rules = voiceRulesFromStored({
      never: [
        { pattern: 'Quick one', match: 'phrase', reason: 'Register announcement.' },
        { pattern: 'saw you (grabbed|downloaded)', match: 'regex', reason: 'Names the tracked behaviour back.' },
      ],
      allow: ['leverage'],
      noExclamation: true,
    });

    expect(lintCopy('Quick one on the build.', rules).ok).toBe(false);
    expect(lintCopy('Saw you grabbed the eBook.', rules).ok).toBe(false);
    expect(lintCopy('We leverage that.', rules).ok).toBe(true);
    expect(lintCopy('Good to meet you!', rules).ok).toBe(false);
    // The floor still holds for everything not explicitly allowed.
    expect(lintCopy('Curious about the rollout.', rules).ok).toBe(false);
  });

  it('carries a prefer rule through without making it blocking', () => {
    const rules = voiceRulesFromStored({ prefer: [{ pattern: 'utilize', match: 'phrase', use: 'use' }] });
    const { ok, violations } = lintCopy('We utilize that.', rules);

    expect(ok).toBe(true);
    expect(violations.map(v => v.kind)).toEqual(['prefer']);
  });
});
