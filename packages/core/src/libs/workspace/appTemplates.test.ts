import type { LoadedAppTemplate } from './appTemplates';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { loadApp } from './apps';
import {
  answerInterview,
  appTemplateContents,
  editWorkspaceManifest,
  fillPlaceholders,
  fillTemplateFile,
  isWritableTemplatePath,
  listAppIdsWithTemplates,
  listAppTemplates,
  mergeTrustRules,
  placeholdersIn,
  renderAppTemplate,
  TEMPLATE_TRUST_FILE,
} from './appTemplates';
import { loadWorkspace } from './loader';

// App templates — a company function stood up in one move. The pure steps are
// tested here without a database; the install itself (write, apply, idempotent,
// tenant-scoped) is in services/apps/AppTemplateService.test.ts.

const INSTALLER = { email: 'lili.chen@northwind.example', name: 'Lili Chen' };
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('placeholders', () => {
  it('finds each key once and fills in one pass, so an answer is never filled again', () => {
    expect(placeholdersIn('{{company}} and {{ company }} for {{installer.email}}')).toEqual(['company', 'installer.email']);
    expect(fillPlaceholders('Hello {{company}}', { company: '{{installer.email}}' })).toBe('Hello {{installer.email}}');
    expect(fillPlaceholders('{{missing}} stays', {})).toBe('{{missing}} stays');
  });

  it('fills YAML value by value: an answer with a colon, quotes or a newline cannot change the file\'s shape', () => {
    const file = { path: 'teams/support.yaml', content: '# the team\nname: "{{company}} Support"\nlead: support-lead\n' };
    const out = fillTemplateFile(file, { company: 'Acme: "best"\nlead: someone-else' });
    const parsed = parseYaml(out.content) as { name: string; lead: string };

    expect(parsed.lead).toBe('support-lead');
    expect(parsed.name).toBe('Acme: "best"\nlead: someone-else Support');
    expect(out.content).toContain('# the team');
  });

  it('fills markdown as text', () => {
    expect(fillTemplateFile({ path: 'agents/a.system-prompt.md', content: 'You work for {{company}}.' }, { company: 'Northwind' }).content).toBe('You work for Northwind.');
  });
});

describe('what a template may write', () => {
  it('writes agents, teams, missions, automations, skills and trust rules — never the manifest, a source or a path out', () => {
    expect(isWritableTemplatePath('teams/support.yaml')).toBe(true);
    expect(isWritableTemplatePath('skills/triage/SKILL.md')).toBe(true);
    expect(isWritableTemplatePath(TEMPLATE_TRUST_FILE)).toBe(true);
    expect(isWritableTemplatePath('workspace.yaml')).toBe(false);
    expect(isWritableTemplatePath('sources/helpdesk.yaml')).toBe(false);
    expect(isWritableTemplatePath('teams/../workspace.yaml')).toBe(false);
    expect(isWritableTemplatePath('teams')).toBe(false);
  });
});

describe('the interview', () => {
  const manifest = {
    slug: 't',
    name: 'T',
    icon: 'layers',
    order: 1,
    description: 'd',
    includes: [],
    plugins: [],
    interview: [
      { key: 'company', question: 'What is it called?', default: '{{workspace.name}}', maxLength: 40 },
      { key: 'goal', question: 'What should it deliver?', maxLength: 30 },
    ],
  };
  const ctx = { installer: INSTALLER, workspace: { name: 'Northwind' } };

  it('fills an empty answer from its default and keeps each answer to one trimmed line', () => {
    const r = answerInterview(manifest, { company: '', goal: '  Reply\n within a day  ' }, ctx);

    expect(r).toEqual({ ok: true, values: expect.objectContaining({ 'company': 'Northwind', 'goal': 'Reply within a day', 'installer.email': INSTALLER.email, 'workspace.name': 'Northwind' }) });
  });

  it('names a question with no answer and no default, and one answered too long', () => {
    expect(answerInterview(manifest, { company: 'x'.repeat(41) }, ctx)).toEqual({ ok: false, problems: { company: 'keep it under 40 characters', goal: 'needs an answer' } });
  });
});

describe('merging trust rules', () => {
  const incoming = 'rules:\n  - action: gmail.send\n    autoApproveAbove: 0.99\n    enabled: false\n    rung: execute-with-approval\n  - action: ask.file\n    autoApproveAbove: 0.95\n    enabled: false\nrisk:\n  gmail.send: high\n';

  it('a workspace with no trust file takes the template\'s', () => {
    expect(mergeTrustRules(null, incoming)).toEqual({ content: incoming, added: ['gmail.send', 'ask.file'] });
  });

  it('never moves a bar the workspace set, adds the rest, and keeps the workspace\'s comments', () => {
    const existing = '# our bars\nrules:\n  # a person sends every email\n  - action: gmail.send\n    autoApproveAbove: 1\n    enabled: false\n';
    const merged = mergeTrustRules(existing, incoming);

    expect(merged.added).toEqual(['ask.file']);

    const parsed = parseYaml(merged.content) as { rules: Array<{ action: string; autoApproveAbove: number }>; risk: Record<string, string> };

    expect(parsed.rules.find(r => r.action === 'gmail.send')!.autoApproveAbove).toBe(1);
    expect(parsed.rules.map(r => r.action)).toEqual(['gmail.send', 'ask.file']);
    expect(parsed.risk).toEqual({ 'gmail.send': 'high' });
    expect(merged.content).toContain('# a person sends every email');
    // Twice is once.
    expect(mergeTrustRules(merged.content, incoming)).toEqual({ content: merged.content, added: [] });
  });
});

describe('editing the workspace manifest', () => {
  const manifest = 'version: 1\norgId: proj_northwind\n# the workspace\nname: Northwind\nplugins: [wiki]\n';

  it('turns plugins on, and sets the lead and the accountable person only where the workspace names none', () => {
    const edit = editWorkspaceManifest(manifest, { plugins: ['company', 'wiki', 'company'], lead: 'support-lead', accountableUser: INSTALLER.email });

    expect(edit.pluginsAdded).toEqual(['company']);
    expect(edit.leadSet).toBe('support-lead');
    expect(edit.accountableUserSet).toBe(INSTALLER.email);

    const parsed = parseYaml(edit.content) as Record<string, unknown>;

    expect(parsed.plugins).toEqual(['wiki', 'company']);
    expect(edit.content).toContain('# the workspace');
    // Twice is once: nothing more to change.
    expect(editWorkspaceManifest(edit.content, { plugins: ['company'], lead: 'other-lead', accountableUser: 'someone@contoso.example' })).toEqual({ content: edit.content, pluginsAdded: [], leadSet: null, accountableUserSet: null });
  });
});

/**
 * A fresh workspace with the template written into it the way the service
 * writes it, then loaded through the real loader (plugins and all).
 * @param template - The template.
 * @param appPlugins - The app's own plugins.
 */
function standUp(template: LoadedAppTemplate, appPlugins: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'app-template-'));
  dirs.push(dir);
  const ctx = { installer: INSTALLER, workspace: { name: 'Northwind Traders' } };
  const answers = Object.fromEntries(template.manifest.interview.map(q => [q.key, q.default ? '' : `An answer to ${q.key}: with "quotes"`]));
  const answered = answerInterview(template.manifest, answers, ctx);
  if (!answered.ok) {
    throw new Error(`interview did not answer: ${JSON.stringify(answered.problems)}`);
  }
  const manifest = editWorkspaceManifest('version: 1\norgId: proj_northwind\nname: Northwind Traders\n', { plugins: [...appPlugins, ...template.manifest.plugins], lead: template.manifest.lead, accountableUser: INSTALLER.email });
  writeFileSync(join(dir, 'workspace.yaml'), manifest.content);
  for (const file of renderAppTemplate(template, answered.values)) {
    mkdirSync(dirname(join(dir, file.path)), { recursive: true });
    writeFileSync(join(dir, file.path), file.content);
  }
  return dir;
}

describe('every shipped template', () => {
  const apps = listAppIdsWithTemplates();

  it('the Company app ships a software company, a marketing agency and a support org', () => {
    expect(apps).toContain('company');
    expect(listAppTemplates('company').map(t => t.manifest.slug).sort()).toEqual(['marketing-agency', 'software-company', 'support-org']);
  });

  for (const appId of apps) {
    const app = loadApp(appId);
    for (const template of listAppTemplates(appId)) {
      describe(`${appId}/${template.manifest.slug}`, () => {
        it('loads in a fresh workspace with its plugins, under a lead, with the installer accountable', () => {
          const dir = standUp(template, app.plugins);
          const ws = loadWorkspace(dir);
          const contents = appTemplateContents(template);

          expect(ws.enabledPlugins).toEqual(expect.arrayContaining([...app.plugins, ...template.manifest.plugins]));
          expect(contents.teams.length).toBeGreaterThan(0);

          for (const slug of contents.teams) {
            const team = ws.teams.find(t => t.slug === slug)!;

            expect(team, slug).toBeDefined();
            // A lead and specialists, a person accountable, measures to be graded on.
            expect(team.lead, `${slug} has a lead`).toBeTruthy();
            expect(team.accountableUser, `${slug} names the installer`).toBe(INSTALLER.email);
            expect(team.goal, `${slug} has a goal`).toBeTruthy();
            expect(team.measures.length, `${slug} has measures`).toBeGreaterThan(0);
            expect(ws.agents.filter(a => a.team === slug).length, `${slug} has a lead and specialists`).toBeGreaterThan(1);
          }
          if (template.manifest.lead) {
            expect(ws.agents.map(a => a.slug)).toContain(template.manifest.lead);
            expect(ws.manifest.lead).toBe(template.manifest.lead);
          }

          // Missions with schedules, and automations that keep them.
          expect(contents.missions.length).toBeGreaterThan(0);
          expect(contents.automations.length).toBeGreaterThan(0);

          for (const slug of contents.missions) {
            expect(ws.missions.find(m => m.slug === slug)?.origin, slug).toBe('workspace');
          }

          // Every agent it brings carries a spend cap.
          expect(contents.budgets.sort()).toEqual(contents.agents.slice().sort());
          // Nothing an answer wrote leaked a placeholder.
          expect(readFileSync(join(dir, `teams/${contents.teams[0]}.yaml`), 'utf8')).not.toMatch(/\{\{/);
        });

        it('starts on conservative rungs: nothing it brings runs on its own until it is earned', () => {
          const trust = template.files.find(f => f.path === TEMPLATE_TRUST_FILE);

          expect(trust, 'a template states its trust bars').toBeDefined();

          const rules = (parseYaml(trust!.content) as { rules: Array<{ action: string; enabled?: boolean; rung?: string; autoApproveAbove: number }> }).rules;

          expect(rules.length).toBeGreaterThan(0);

          for (const rule of rules) {
            expect(rule.enabled ?? false, rule.action).toBe(false);
            expect(['observe', 'recommend', 'assist', 'execute-with-approval', undefined], rule.action).toContain(rule.rung);
            expect(rule.autoApproveAbove, rule.action).toBeGreaterThanOrEqual(0.9);
          }
        });

        it('asks two or three questions, each read by a person', () => {
          expect(template.manifest.interview.length).toBeGreaterThanOrEqual(2);
          expect(template.manifest.interview.length).toBeLessThanOrEqual(3);
          expect(template.manifest.includes.length).toBeGreaterThan(0);
        });
      });
    }
  }
});
