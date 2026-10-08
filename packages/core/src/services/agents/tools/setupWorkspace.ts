/**
 * SETTING A WORKSPACE UP, BY CHAT — the workspace lead's two tools.
 *
 * `setup_options` reads where the workspace stands (the same four steps the
 * sidebar's Getting started checklist counts, `services/workspace/gettingStarted.ts`)
 * and what this installation offers: apps, plugins, systems to connect, roles
 * in the agent catalog. `propose_setup` turns the plan the lead settled on into
 * one-click cards in the conversation — typed steps in, typed cards out, never
 * a plan parsed back out of prose.
 *
 * Every card is an offer the person decides. A setup card is emitted as a
 * `card` event, which the stream never files on its own (`stream/route.ts`):
 * nothing runs until the person presses it, and then it runs as their decision
 * through the action registry — `app.install`, `app.install_template`,
 * `plugin.enable`, `team.hire_agent`, `members.invite` — each reversible, so the card shows Undo
 * once it is done. A connection is the existing connect card
 * (`offerConnection`), not a second one.
 *
 * Each step is checked before it becomes a card with the action's own
 * `precheck`, so a card that would only fail (an app already added, a role
 * already hired, a system already connected) is never drawn; the lead reads
 * why in the tool result instead.
 *
 * "Make it yours" is a step too: `propose_brand` (and a `brand` step in a
 * plan) reads the company's logo, colours and fonts off its own site with
 * `brand_lookup`, drafts the Org's brand from them (`libs/branding/draft.ts`)
 * and shows it as a preview card — the app's sidebar and sign-in page wearing
 * it — with three choices: use it (`org.brand_apply`, the person's action,
 * with Undo), adjust it in Brand settings, or skip it.
 *
 * Granted, not default: only an agent naming them in `harness.grantTools` holds
 * them — the seeded workspace lead does (`templates/workspace/agents/`). And
 * only in a shared workspace: a personal one has nothing to set up.
 */

import type { RuntimeContext } from '../types';
import type { ActionContext } from '@/libs/actions/types';
import type { Card } from '@/libs/cards/card';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { BRAND_CARD_KIND, newCardId, readCard, SETUP_CARD_KIND } from '@/libs/cards/card';
import { offerConnection } from './offerConnection';

export const SETUP_OPTIONS_TOOL = 'setup_options';
export const PROPOSE_SETUP_TOOL = 'propose_setup';
export const PROPOSE_BRAND_TOOL = 'propose_brand';

export const SETUP_STEP_KINDS = ['app', 'template', 'plugin', 'connect', 'hire', 'invite', 'brand'] as const;
export type SetupStepKind = (typeof SETUP_STEP_KINDS)[number];

const StepSchema = z.object({
  kind: z.enum(SETUP_STEP_KINDS).describe('app: add an app · template: start from an app template · plugin: turn a plugin on · connect: connect a system · hire: hire a catalog role · invite: invite teammates by email · brand: make it yours — the company\'s logo and colours, read off its site'),
  id: z.string().min(1).max(200).optional().describe('What the step is about, as setup_options lists it: the app id, "<app>/<template>" for a template, plugin slug, connector slug or catalog role slug; for brand, the company\'s website or name. Not used for invite.'),
  answers: z.record(z.string(), z.string().max(2000)).optional().describe('template only: the template\'s interview answers by key, from what the person told you (setup_options lists each key). Leave a key out and its default is used.'),
  emails: z.array(z.string().min(3).max(200)).min(1).max(10).optional().describe('invite only: the addresses the person gave you.'),
  why: z.string().min(1).max(160).describe('One line, in the team\'s own words, on what this step does for them — "So the Friday ticket report writes itself."'),
});
export type SetupStep = z.infer<typeof StepSchema>;

export const ProposeSetupSchema = z.object({
  steps: z.array(StepSchema).min(1).max(8).describe('The plan, in the order the work would happen: an app, then the systems it reads, then the people and agents who use it.'),
});

/**
 * Truncate a catalog line for the model, at a word.
 * @param text - The line.
 * @param max - Its longest length.
 */
function clip(text: string, max = 110): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) {
    return one;
  }
  const cut = one.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}…`;
}

/**
 * The context an action's precheck runs with, for a step this agent is about
 * to offer: the workspace, and whose turn it is.
 * @param ctx - The turn.
 */
function actionContext(ctx: RuntimeContext): ActionContext {
  return {
    orgId: ctx.orgId,
    ...(ctx.userId ? { invokedBy: ctx.userId } : {}),
    proposedBy: `agent:${ctx.agentSlug ?? 'workspace-lead'}`,
  };
}

/**
 * Whether the person in this turn is an admin of the workspace's account —
 * who may connect a system or invite people, here as on their pages.
 * @param ctx - The turn.
 */
async function personIsAdmin(ctx: RuntimeContext): Promise<boolean> {
  if (!ctx.userId) {
    return false;
  }
  const { memberWorkspace } = await import('@/services/WorkspaceAccessService');
  return (await memberWorkspace(ctx.userId, ctx.orgId))?.accountRole === 'admin';
}

/**
 * Every app template this installation ships, with its interview's keys, and
 * whether one can be written into this workspace here.
 * @param orgId - The workspace.
 */
async function templatesOffered(orgId: string) {
  const [{ listAppIdsWithTemplates, safeListAppTemplates, appTemplateContents }, { templateWriteTarget }, { db }, { teamSchema }, { eq }] = await Promise.all([
    import('@/libs/workspace/appTemplates'),
    import('@/services/apps/AppTemplateService'),
    import('@/libs/DB'),
    import('@/models/Schema'),
    import('drizzle-orm'),
  ]);
  const teams = new Set((await db.select({ slug: teamSchema.slug }).from(teamSchema).where(eq(teamSchema.orgId, orgId))).map(t => t.slug));
  const templates = listAppIdsWithTemplates().flatMap(app => safeListAppTemplates(app).map((t) => {
    const contents = appTemplateContents(t);
    return {
      id: `${app}/${t.manifest.slug}`,
      name: t.manifest.name,
      description: t.manifest.description,
      installed: contents.teams.length > 0 && contents.teams.every(slug => teams.has(slug)),
      questions: t.manifest.interview.map(q => ({ key: q.key, question: q.question })),
    };
  }));
  const templateTarget = await templateWriteTarget(orgId).catch(error => ({ ok: false as const, reason: error instanceof Error ? error.message : String(error) }));
  return { templates, templateTarget };
}

/**
 * Where the workspace stands and what it could add, for the lead to plan from.
 * @param ctx - The turn.
 */
export async function setupOptions(ctx: RuntimeContext): Promise<string> {
  const [{ gettingStartedFor }, { safeListApps }, { listPlugins }, { listConnectors }, { listUnhired }] = await Promise.all([
    import('@/services/workspace/gettingStarted'),
    import('@/libs/workspace/apps'),
    import('@/libs/workspace/plugins'),
    import('@/libs/sources/registry'),
    import('@/services/CatalogService'),
  ]);
  const state = await gettingStartedFor(ctx.orgId);
  if (!state) {
    return 'This is a personal workspace: there is nothing to set up here. Shared workspaces are set up by their own lead.';
  }
  const admin = await personIsAdmin(ctx);
  const on = new Set(state.detail.plugins);
  const connected = new Set(state.detail.connected);
  const apps = safeListApps().filter(a => !a.core && !a.hidden && a.plugins.length > 0);
  const appPlugins = new Set(apps.flatMap(a => a.plugins));
  const plugins = listPlugins().filter(p => !appPlugins.has(p.manifest.slug));
  const roles = await listUnhired(ctx.orgId).catch(() => []);
  const { templates, templateTarget } = await templatesOffered(ctx.orgId);
  const said = (done: boolean) => (done ? 'done' : 'not yet');
  const steps = Object.fromEntries(state.steps.map(s => [s.id, s.done]));
  const branded = steps.brand === true;

  const lines = [
    `WHERE THIS WORKSPACE STANDS (${state.done} of ${state.total} first steps):`,
    `- Connect a system: ${said(steps.connect === true)}${connected.size > 0 ? ` (${[...connected].join(', ')})` : ''}`,
    `- Add an app or template: ${said(steps.app === true)}${on.size > 0 ? ` (${[...on].join(', ')} on)` : ''}`,
    `- Hire an agent: ${said(steps.hire === true)}${state.detail.agents.length > 0 ? ` (${state.detail.agents.join(', ')})` : ''}`,
    `- Invite someone: ${said(steps.invite === true)} (${state.detail.members} in the account, ${state.detail.invites} invited)`,
    `- Make it yours (logo and colours): ${said(branded)}`,
    '',
    'APPS (propose_setup step {kind:"app", id}):',
    ...apps.map(a => `- ${a.id} — ${a.name}: ${clip(a.description)}${a.plugins.every(p => on.has(p)) ? ' [already added]' : ''}`),
    '',
    'TEMPLATES (step {kind:"template", id:"<app>/<template>", answers:{key: value}} — answers from the interview, any left out take their default):',
    ...(templates.length > 0
      ? templates.map(t => `- ${t.id} — ${t.name}: ${clip(t.description)}${t.installed ? ' [already set up]' : ''} Questions: ${t.questions.map(q => `${q.key} ("${clip(q.question, 70)}")`).join('; ')}`)
      : ['- none: this installation ships no app templates']),
    ...(templates.length > 0 && !templateTarget.ok ? [`  (A template cannot be written into this workspace here: ${templateTarget.reason} Offer apps instead.)`] : []),
    '',
    'PLUGINS (step {kind:"plugin", id}):',
    ...plugins.map(p => `- ${p.manifest.slug} — ${p.manifest.name}: ${clip(p.manifest.description)}${p.manifest.recommend.when.length > 0 ? ` Helps when: ${clip(p.manifest.recommend.when.join('; '), 90)}` : ''}${on.has(p.manifest.slug) ? ' [on]' : ''}`),
    '',
    `SYSTEMS TO CONNECT (step {kind:"connect", id})${admin ? '' : ' — only an admin can connect one; this person is not an admin'}:`,
    ...listConnectors().map(c => `- ${c.slug} — ${c.name ?? c.slug}${connected.has(c.slug) ? ' [connected]' : ''}`),
    '',
    'CATALOG ROLES NOT YET HIRED (step {kind:"hire", id}):',
    ...(roles.length > 0 ? roles.map(r => `- ${r.slug} — ${r.name}${r.teamName ? ` (${r.teamName})` : ''}: ${clip(r.description)}`) : ['- none: every catalog role is on the team already']),
    '',
    admin
      ? 'INVITE (step {kind:"invite", emails:[…]}): only with addresses the person gave you.'
      : 'INVITE: this person is not an admin, so they cannot invite anyone; an admin can, from Members.',
    '',
    admin
      ? `BRAND (step {kind:"brand", id:"<their website or company name>"}, or propose_brand on its own): ${branded ? 'the Org has a brand already; offer it only if they ask to change it.' : 'the Org wears Vocion\'s look; offer it once you know their website.'}`
      : 'BRAND: only an Org admin can brand the Org; this person is not one.',
  ];
  return lines.join('\n');
}

/**
 * THE BRAND PREVIEW CARD for a company's site, or why there is none.
 *
 * Reads the site (`brand_lookup`), drafts the brand, checks the draft with the
 * action that would apply it, and returns one card of kind `brand`: its one
 * action applies the draft as the person's own; its `href` opens Brand
 * settings with the draft in it ("Adjust"). With no lookup configured, a link
 * card to Brand settings is drawn instead, so there is still one move.
 * @param ctx - The turn.
 * @param site - The company's website, a domain, or its name.
 */
export async function brandStep(ctx: RuntimeContext, site: string): Promise<{ card: Card; draft: { input: Record<string, unknown>; notes: string[] } } | { said: string } | { skipped: string }> {
  const [{ orgBrandApplyAction, BRAND_SETTINGS_HREF }, { lookupBrand }, { draftFromProfile, encodeDraft }, { ProviderNotConfiguredError, ToolProviderKeyUnavailableError }] = await Promise.all([
    import('@/libs/actions/org-brand-apply'),
    import('@/libs/tools/brand/firecrawlBrand'),
    import('@/libs/branding/draft'),
    import('@/libs/tools/types'),
  ]);
  const source = { agentSlug: ctx.agentSlug, tool: PROPOSE_BRAND_TOOL };
  const actx = actionContext(ctx);
  if (!(await personIsAdmin(ctx))) {
    return { skipped: 'only an Org admin can brand the Org; this person is not one — say so in one line and point them to an admin' };
  }
  let profile: Awaited<ReturnType<typeof lookupBrand>>;
  try {
    profile = await lookupBrand(site, { orgId: ctx.orgId });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError || err instanceof ToolProviderKeyUnavailableError) {
      const link = readCard({ id: newCardId(), kind: 'link', title: 'Set your logo and colours', body: 'Upload the logo and pick the accent in Brand settings.', href: BRAND_SETTINGS_HREF, hrefLabel: 'Open Brand settings', source, state: 'proposed' });
      if (link.ok) {
        ctx.emit({ type: 'card', card: link.card });
      }
      return { said: 'Brand lookup is not set up on this server (no Firecrawl key), so the brand could not be read off their site. A link to Brand settings is on screen instead: say so in one line.' };
    }
    return { skipped: `the brand lookup failed (${(err as Error).message ?? 'unknown error'}) — say so; do not describe their brand from memory` };
  }
  if (!profile) {
    return { skipped: `no site was found for "${site}" — ask for their website address` };
  }
  const { db } = await import('@/libs/DB');
  const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
  const { eq } = await import('drizzle-orm');
  const [org] = await db.select({ name: tenantAccountSchema.name }).from(projectSchema).innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, projectSchema.accountId)).where(eq(projectSchema.id, ctx.orgId)).limit(1);
  const draft = draftFromProfile(profile, org?.name ?? site);
  const refused = await orgBrandApplyAction.precheck!(actx, draft.input);
  if (refused) {
    return { skipped: refused };
  }
  let host = profile.url;
  try {
    host = new URL(profile.url).host;
  } catch { /* keep the URL */ }
  const card: Card = {
    id: newCardId(),
    kind: BRAND_CARD_KIND,
    title: `Make it yours: ${draft.input.name}`,
    body: `Read from ${host}${typeof profile.confidence === 'number' ? ` (${Math.round(profile.confidence * 100)}% sure)` : ''}.`,
    fields: draft.notes.map(note => ({ label: 'Note', value: note })),
    actions: [{ label: 'Use this brand', actionId: orgBrandApplyAction.id, input: draft.input as unknown as Record<string, unknown>, style: 'primary' }],
    href: `${BRAND_SETTINGS_HREF}?draft=${encodeDraft(draft.input)}`,
    hrefLabel: 'Adjust',
    source,
    state: 'proposed',
  };
  return { card, draft: { input: draft.input as unknown as Record<string, unknown>, notes: draft.notes } };
}

/**
 * Show the drafted brand for a site, as its own card.
 * @param ctx - The turn.
 * @param input - The site.
 * @param input.site - The company's website, a domain, or its name.
 */
export async function proposeBrand(ctx: RuntimeContext, input: { site: string }): Promise<string> {
  if (ctx.workspaceKind === 'personal') {
    return 'Refused: this is a personal workspace; the Org is branded from a shared one.';
  }
  const out = await brandStep(ctx, input.site).catch((err: unknown) => ({ skipped: (err as Error).message }));
  if ('said' in out) {
    return out.said;
  }
  if ('skipped' in out) {
    return `Not offered: ${out.skipped}.`;
  }
  const checked = readCard(out.card);
  if (!checked.ok) {
    return `Not offered: ${checked.reason}.`;
  }
  ctx.emit({ type: 'card', card: checked.card });
  const d = out.draft.input as { name: string; accent?: string | null; headingFont?: string | null; logos?: Record<string, string> };
  return [
    `Showed the brand preview for ${d.name}: accent ${d.accent ?? 'Vocion\'s own'}, ${d.logos?.wordmark ? 'their logo' : 'no logo'}${d.logos?.mark ? ' and mark' : ''}${d.headingFont ? `, headings in ${d.headingFont}` : ''}.`,
    ...(out.draft.notes.length > 0 ? [`Notes on the card: ${out.draft.notes.join(' ')}`] : []),
    'Nothing has changed yet: the person picks Use this brand, Adjust (Brand settings, with the draft) or Skip, and Use this brand can be undone. Say what the preview shows in one line BEFORE this call; the card ends the turn.',
  ].join('\n');
}

/**
 * The card for one step, or why it is not offered. A `connect` step draws the
 * connect card itself and answers with what it showed.
 * @param ctx - The turn.
 * @param step - The step.
 * @param admin - Whether this person may connect and invite.
 */
async function stepCard(ctx: RuntimeContext, step: SetupStep, admin: boolean): Promise<{ card: Card } | { said: string } | { skipped: string }> {
  const source = { agentSlug: ctx.agentSlug, tool: PROPOSE_SETUP_TOOL };
  const actx = actionContext(ctx);
  const base = { id: newCardId(), kind: SETUP_CARD_KIND, body: step.why, source, state: 'proposed' as const };
  switch (step.kind) {
    case 'connect': {
      if (!step.id) {
        return { skipped: 'a connect step names no connector' };
      }
      return { said: await offerConnection(ctx, { connector: step.id, why: step.why }) };
    }
    case 'app': {
      const [{ appInstallAction }, { safeListApps }] = await Promise.all([import('@/libs/actions/app-install'), import('@/libs/workspace/apps')]);
      const id = step.id ?? '';
      const refused = await appInstallAction.precheck!(actx, { app: id });
      if (refused) {
        return { skipped: refused };
      }
      const app = safeListApps().find(a => a.id === id)!;
      return { card: { ...base, title: `Add ${app.name}`, actions: [{ label: 'Add', actionId: appInstallAction.id, input: { app: app.id }, style: 'primary' }], href: app.entry, hrefLabel: `Open ${app.name}` } };
    }
    case 'template': {
      const [{ appTemplateInstallAction }, { loadAppTemplate }, { safeListApps }] = await Promise.all([import('@/libs/actions/app-template-install'), import('@/libs/workspace/appTemplates'), import('@/libs/workspace/apps')]);
      const [appId = '', slug = ''] = (step.id ?? '').split('/');
      const input = { app: appId, template: slug, answers: step.answers ?? {} };
      const refused = await appTemplateInstallAction.precheck!(actx, input);
      if (refused) {
        return { skipped: refused };
      }
      const template = loadAppTemplate(appId, slug);
      const app = safeListApps().find(a => a.id === appId);
      return { card: { ...base, title: `Start from ${template.manifest.name}`, actions: [{ label: 'Start', actionId: appTemplateInstallAction.id, input, style: 'primary' }], ...(app ? { href: app.entry, hrefLabel: `Open ${app.name}` } : {}) } };
    }
    case 'plugin': {
      const [{ pluginEnableAction }, { loadPlugin }, { enabledPluginsForOrg }] = await Promise.all([import('@/libs/actions/plugin-enable'), import('@/libs/workspace/plugins'), import('@/services/PluginService')]);
      const slug = step.id ?? '';
      const refused = await pluginEnableAction.precheck!(actx, { slug, enabled: true });
      if (refused) {
        return { skipped: refused };
      }
      if ((await enabledPluginsForOrg(ctx.orgId)).includes(slug)) {
        return { skipped: `${slug} is already on` };
      }
      const plugin = loadPlugin(slug);
      return { card: { ...base, title: `Turn on ${plugin.manifest.name}`, actions: [{ label: 'Turn on', actionId: pluginEnableAction.id, input: { slug, enabled: true }, style: 'primary' }] } };
    }
    case 'hire': {
      const [{ teamHireAgentAction }, { getCatalogEntry }, { builtInAgentDailyHardCents, DEFAULT_AGENT_DAILY_HARD_CENTS }] = await Promise.all([import('@/libs/actions/team-hire-agent'), import('@/services/CatalogService'), import('@/services/BudgetService')]);
      const slug = step.id ?? '';
      // Hired under the workspace's default daily allowance — the cap every
      // agent runs under when nobody set one (#272) — stated on the card.
      const dailyCentsLimit = builtInAgentDailyHardCents() ?? DEFAULT_AGENT_DAILY_HARD_CENTS;
      const input = { slug, dailyCentsLimit, reason: step.why };
      const refused = await teamHireAgentAction.precheck!(actx, input);
      if (refused) {
        return { skipped: refused };
      }
      const entry = getCatalogEntry(slug)!;
      return { card: { ...base, title: `Hire ${entry.name}`, actions: [{ label: 'Hire', actionId: teamHireAgentAction.id, input, style: 'primary' }], fields: [{ label: 'Daily cap', value: `$${(dailyCentsLimit / 100).toFixed(0)}` }], href: `/dashboard/agents/${encodeURIComponent(slug)}`, hrefLabel: `Open ${entry.name}` } };
    }
    case 'brand': {
      if (!step.id) {
        return { skipped: 'a brand step names no site — ask for their website, then offer it' };
      }
      const out = await brandStep(ctx, step.id);
      return 'card' in out ? { card: { ...out.card, body: `${step.why} ${out.card.body ?? ''}`.trim() } } : out;
    }
    case 'invite': {
      if (!admin) {
        return { skipped: 'only an admin can invite people; this person is not one — say so in one line and point them to an admin' };
      }
      const { membersInviteAction, MEMBERS_HREF } = await import('@/libs/actions/members-invite');
      const parsed = membersInviteAction.inputSchema.safeParse({ emails: step.emails ?? [] });
      if (!parsed.success) {
        return { skipped: 'an invite needs the email addresses the person gave you — ask who should join' };
      }
      const refused = await membersInviteAction.precheck!(actx, parsed.data);
      if (refused) {
        return { skipped: refused };
      }
      const emails = parsed.data.emails;
      const who = emails.length === 1 ? emails[0]! : `${emails.length} teammates`;
      return { card: { ...base, title: `Invite ${who}`, actions: [{ label: 'Invite', actionId: membersInviteAction.id, input: parsed.data, style: 'primary' }], ...(emails.length > 1 ? { fields: [{ label: 'Who', value: emails.join(', ') }] } : {}), href: MEMBERS_HREF, hrefLabel: 'Open Members' } };
    }
  }
}

/**
 * Put the plan in front of the person, one card per step.
 * @param ctx - The turn.
 * @param input - The steps.
 * @param input.steps - The plan.
 */
export async function proposeSetup(ctx: RuntimeContext, input: { steps: SetupStep[] }): Promise<string> {
  if (ctx.workspaceKind === 'personal') {
    return 'Refused: this is a personal workspace; there is nothing to set up here.';
  }
  const admin = await personIsAdmin(ctx);
  const shown: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  // Two or more systems to connect are one step: "Connect your systems", the
  // walk-through that connects and verifies them one at a time
  // (`connect_system`), in the place of the first of them in the plan.
  const connects = [...new Set(input.steps.filter(s => s.kind === 'connect' && s.id).map(s => s.id!))];
  let steps = input.steps;
  if (connects.length >= 2) {
    const first = input.steps.findIndex(s => s.kind === 'connect');
    steps = input.steps.filter((s, i) => s.kind !== 'connect' || i === first);
  }
  for (const step of steps) {
    if (connects.length >= 2 && step.kind === 'connect') {
      const { connectSystem } = await import('./connectSystems');
      shown.push(`connect:${connects.join(',')} — ${await connectSystem(ctx, { named: connects })}`);
      continue;
    }
    const key = `${step.kind}:${step.id ?? (step.emails ?? []).join(',')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    try {
      const out = await stepCard(ctx, step, admin);
      if ('card' in out) {
        const checked = readCard(out.card);
        if (!checked.ok) {
          skipped.push(`${key}: ${checked.reason}`);
          continue;
        }
        ctx.emit({ type: 'card', card: checked.card });
        shown.push(`"${checked.card.title}"`);
      } else if ('said' in out) {
        shown.push(`${key} — ${out.said}`);
      } else {
        skipped.push(`${key}: ${out.skipped}`);
      }
    } catch (err) {
      skipped.push(`${key}: ${(err as Error).message}`);
    }
  }
  const lines: string[] = [];
  lines.push(shown.length > 0 ? `Showed ${shown.length} card${shown.length === 1 ? '' : 's'}: ${shown.join('; ')}.` : 'Showed no cards.');
  if (skipped.length > 0) {
    lines.push(`Not offered: ${skipped.join('; ')}.`);
  }
  lines.push('Nothing has run: the person accepts each card, and each can be undone. Never say a step is done until its run says so.');
  return lines.join('\n');
}

/**
 * The two tools, for an agent granted them in a shared workspace.
 * @param ctx - The turn.
 */
export function setupWorkspaceTools(ctx: RuntimeContext) {
  if (ctx.workspaceKind === 'personal') {
    return [];
  }
  const grants = new Set(ctx.harnessConfig.grantTools ?? []);
  const all = [
    tool(async () => setupOptions(ctx), {
      name: SETUP_OPTIONS_TOOL,
      description: 'Where this workspace stands on its first steps (a system connected, an app or template added, an agent hired, someone invited) and what it could add: apps, app templates with their interview questions, plugins, systems to connect, catalog roles to hire, and whether this person may invite. Call it before planning a setup; read-only.',
      schema: z.object({}),
    }),
    tool(async (input: { steps: SetupStep[] }) => proposeSetup(ctx, input), {
      name: PROPOSE_SETUP_TOOL,
      description: 'Show the person a setup plan as one-click cards in this conversation: add an app, start from an app template (with the interview\'s answers you learned), turn on a plugin, connect a system, hire a catalog role, invite teammates. Each card runs only when the person accepts it, as their action, with Undo. One call with the whole plan, after setup_options and a short interview; say what the plan gets them BEFORE calling it, because the cards end the turn. Steps that are already done or cannot run are left out and named in the result.',
      schema: ProposeSetupSchema,
    }),
    tool(async (input: { site: string }) => proposeBrand(ctx, input), {
      name: PROPOSE_BRAND_TOOL,
      description: 'Make it yours: read the company\'s logo, colours and fonts off its own website (brand_lookup), draft the Org\'s brand, and show the person a preview of the app wearing it — the sidebar and the sign-in page — with three choices: Use this brand (applied as their action, with Undo), Adjust (Brand settings, with the draft) and Skip. Use it when the person asks to brand the workspace, add their logo or colours, or "make it ours". Never describe their brand from memory; the card is the answer. Say what it shows in one line BEFORE calling it, because the card ends the turn.',
      schema: z.object({ site: z.string().min(2).max(200).describe('Their website ("northwind.example"), or the company name when they gave no site') }),
    }),
  ];
  // The brand preview is a step of the same plan (`{kind:"brand"}`), so an
  // agent granted the plan holds it too — a lead seeded before it existed
  // included, whose stored grants name only the first two.
  return all.filter(t => grants.has(t.name) || (t.name === PROPOSE_BRAND_TOOL && grants.has(PROPOSE_SETUP_TOOL)));
}
