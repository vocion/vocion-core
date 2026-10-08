import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * `app.install_template` — starting from a Company template on a setup card,
 * through the real install (#1240) and back out again. The person who decided
 * is named accountable; the template's lead takes over from the seeded one;
 * Undo removes what the install created, puts `workspace.yaml` back and
 * applies, so the template's agents retire and the seeded lead returns.
 */

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('@/routers/AuthGuards', () => ({ guardAuth: vi.fn(), guardRole: vi.fn(), loadProject: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, teamSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { appTemplateInstallAction } = await import('./app-template-install');
const { ensureWorkspaceLead } = await import('@/services/workspace/workspaceLead');
const { WORKSPACE_LEAD_SLUG } = await import('@/libs/workspace/workspaceLead');
const { invalidateCurrentContextShaCache } = await import('@/libs/workspace/current-version');

const ORG = 'proj-tpl-support';
const DANA = { id: 'usr-tpl-dana', email: 'dana@northwind.example', name: 'Dana Okafor' };
const MANIFEST = `version: 1\n# Northwind Support's workspace\norgId: ${ORG}\nname: Northwind Support\n`;
let dir = '';
let prevPath: string | undefined;

async function active(slug: string): Promise<string | null | undefined> {
  const [row] = await db.select({ active: agentSchema.active }).from(agentSchema).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, slug)));
  return row?.active;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpl-action-'));
  writeFileSync(join(dir, 'workspace.yaml'), MANIFEST);
  prevPath = process.env.WORKSPACE_PATH;
  process.env.WORKSPACE_PATH = dir;
  invalidateCurrentContextShaCache();
  await db.insert(userSchema).values(DANA);
  await db.insert(tenantAccountSchema).values({ id: 'acct-tpl', name: 'Northwind', slug: 'northwind-tpl' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-tpl', slug: 'support', name: 'Northwind Support' });
  await ensureWorkspaceLead(ORG);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevPath === undefined) {
    delete process.env.WORKSPACE_PATH;
  } else {
    process.env.WORKSPACE_PATH = prevPath;
  }
});

describe('app.install_template', () => {
  it('refuses a template this installation does not ship, before a card is drawn', async () => {
    expect(await appTemplateInstallAction.precheck!({ orgId: ORG }, { app: 'company', template: 'no-such-template', answers: {} })).toContain('no template "company/no-such-template"');
  });

  it('stands the template up as the person\'s, with defaults for what was not asked, and Undo takes it back', async () => {
    const input = { app: 'company', template: 'support-org', answers: { product: 'Our scheduling app for field-service teams' } };

    expect(await appTemplateInstallAction.precheck!({ orgId: ORG }, input)).toBeUndefined();

    const result = await appTemplateInstallAction.execute({ orgId: ORG, reviewedBy: DANA.id }, input);

    expect(result).toMatchObject({ installed: true, app: 'company', template: 'support-org', priorManifest: MANIFEST });
    expect((result.created as string[]).length).toBeGreaterThan(0);

    const teams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG));

    expect(teams.length).toBeGreaterThan(0);
    expect(teams.every(t => t.accountableUserId === DANA.id)).toBe(true);
    // The template names its own lead, so the seeded one steps back.
    expect(await active(WORKSPACE_LEAD_SLUG)).toBe('false');
    expect(await appTemplateInstallAction.precheck!({ orgId: ORG }, input)).toContain('already set up');

    const undone = await appTemplateInstallAction.undo!({ orgId: ORG, invokedBy: DANA.id }, input, result);

    expect(undone).toMatchObject({ undone: true });
    expect(readFileSync(join(dir, 'workspace.yaml'), 'utf8')).toBe(MANIFEST);

    for (const rel of result.created as string[]) {
      expect(existsSync(join(dir, rel)), rel).toBe(false);
    }

    const agents = await db.select({ slug: agentSchema.slug, active: agentSchema.active }).from(agentSchema).where(eq(agentSchema.orgId, ORG));

    expect(agents.filter(a => a.active === 'true').map(a => a.slug)).toEqual([WORKSPACE_LEAD_SLUG]);
  });
});
