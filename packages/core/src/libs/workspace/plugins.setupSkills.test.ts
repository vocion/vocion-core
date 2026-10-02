/**
 * `recommend.setupSkills` (#1028): the skills a plugin's setup needs on the
 * workspace lead. The rule someone could get wrong: a manifest that names a
 * skill the plugin does not ship is refused when it loads, so a typo is found
 * by `workspace:check` and never by a lead reading a procedure that is not there.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let scratchRoot = '';

vi.mock('@/libs/repo-root', () => ({
  fromRepoRoot: (...segments: string[]) => join(scratchRoot, ...segments),
  getRepoRoot: () => scratchRoot,
}));

const { loadPlugin, PLUGINS_REL } = await import('./plugins');

function writePlugin(setupSkills: string[], shippedSkills: string[]) {
  const dir = join(scratchRoot, PLUGINS_REL, 'demo');
  mkdirSync(dir, { recursive: true });
  const list = setupSkills.length > 0 ? `\n  setupSkills: [${setupSkills.join(', ')}]` : '';
  writeFileSync(join(dir, 'plugin.yaml'), `slug: demo\nname: Demo\nversion: 1.0.0\ndescription: A demonstration plugin for the setup skills rule.\nrecommend:\n  when: []${list}\n`);
  for (const skill of shippedSkills) {
    mkdirSync(join(dir, 'skills', skill), { recursive: true });
    writeFileSync(join(dir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: x\n---\nBody.\n`);
  }
}

beforeEach(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), 'setup-skills-'));
});

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe('recommend.setupSkills', () => {
  it('loads when every named skill is one the plugin ships', () => {
    writePlugin(['first-skill'], ['first-skill', 'other-skill']);

    expect(loadPlugin('demo').manifest.recommend.setupSkills).toEqual(['first-skill']);
  });

  it('defaults to none', () => {
    writePlugin([], []);

    expect(loadPlugin('demo').manifest.recommend.setupSkills).toEqual([]);
  });

  it('refuses a manifest that names a setup skill it does not ship', () => {
    writePlugin(['first-skill', 'ghost-skill'], ['first-skill']);

    expect(() => loadPlugin('demo')).toThrow(/ghost-skill/);
  });
});
