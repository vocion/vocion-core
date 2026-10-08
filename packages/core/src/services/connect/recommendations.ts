/**
 * "CONNECT YOUR SYSTEMS" — which systems to offer, in what order, and why.
 *
 * The plan is ranked from evidence, each piece typed and shown to the person
 * beside the step it put there (principle 10):
 *
 *   named   the person named it (the agent read their words; nothing here does)
 *   app     an app this workspace added declares it (`setup.connectors`
 *           "needs" it; `recommend.connectors` "reads" it)
 *   mail    the person's mail domain's MX records point at a platform that
 *           declares those hosts (`CredentialPlatform.discovery`)
 *   org     other shared workspaces of the same Org already read it
 *
 * Everything comes from the registries: the connectors are `listConnectors()`
 * narrowed to those a credential platform claims, how each connects is the
 * platform's `howToConnect`, and the mail evidence is the platform's own
 * `discovery`. No vendor is named in this file, so the seven connector
 * families landing beside it appear here the day their descriptors do.
 *
 * Tenant scoping: every read is keyed on the one workspace, and the Org
 * evidence reads only the workspace's own Org (`project.account_id`), only its
 * shared workspaces (never a person's own), and only connector slugs and a
 * count — never a source's name, account or settings.
 */

import type { MxResolver } from '@/libs/connect/mailHost';
import type { ConnectCandidate, ConnectEvidence, ConnectMethod, ConnectPlan, ConnectPlanInput, ConnectUnlock } from '@/libs/connect/systemsPlan';
import type { ConfigField } from '@/libs/sources/configFields';
import type { AppOffer } from '@/services/AppCatalogService';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { exchangeMatches, mailDomainOf, mailExchangesFor } from '@/libs/connect/mailHost';
import { connectOptionFor } from '@/libs/connect/registry';
import { connectStartHref } from '@/libs/connect/returnTo';
import { db } from '@/libs/DB';
import { discoverablePlatforms, howToConnectFor, platformForConnectorSlug } from '@/libs/platforms/registry';
import { configFieldsFor } from '@/libs/sources/configFields';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { getConnector, listConnectors } from '@/libs/sources/registry';
import { knowledgeSourceSchema, projectSchema, userSchema } from '@/models/Schema';

/** Where a login started from the flow lands: a small page that hands the outcome back to the flow and closes. */
export const CONNECT_POPUP_RETURN = '/dashboard/connect/done';

/** How much each kind of evidence weighs. Named beats everything; an app's need beats a hint. */
export const EVIDENCE_WEIGHT = { named: 100, appNeeded: 60, appReads: 25, mail: 40, org: 15, orgEach: 5 } as const;

/** The score at which a system is recommended (preselected). */
const RECOMMEND_AT = 35;

/** The longest list the question offers. */
const QUESTION_OPTIONS = 8;

export type RecommendationDeps = {
  /** The MX lookup; DNS by default. */
  resolveMx?: MxResolver;
};

/**
 * Every connector a person can connect from the flow: one a credential
 * platform claims (so it has a login or a key), in the registry's order.
 */
export function connectableConnectors(): Array<{ slug: string; name: string }> {
  return listConnectors()
    .filter(c => platformForConnectorSlug(c.slug) !== null)
    .map(c => ({ slug: c.slug, name: c.name ?? c.slug }));
}

/**
 * The connectors this workspace reads with a live login or key.
 * @param orgId - The workspace.
 */
async function connectedHere(orgId: string): Promise<Set<string>> {
  const { connectedConnectors } = await import('@/services/workspace/gettingStarted');
  return new Set(await connectedConnectors(orgId));
}

/**
 * How many OTHER shared workspaces of this workspace's Org read each
 * connector. Only the same Org, only shared workspaces, only slugs.
 * @param orgId - The workspace.
 */
export async function orgPeerConnectors(orgId: string): Promise<Map<string, number>> {
  const [self] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  if (!self) {
    return new Map();
  }
  const peers = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(and(eq(projectSchema.accountId, self.accountId), ne(projectSchema.id, orgId), eq(projectSchema.kind, 'shared')));
  if (peers.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ orgId: knowledgeSourceSchema.orgId, slug: knowledgeSourceSchema.slug, kind: knowledgeSourceSchema.kind, config: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(inArray(knowledgeSourceSchema.orgId, peers.map(p => p.id)));
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const connector = connectorOfSource({ slug: row.slug, kind: row.kind, config: (row.config ?? {}) as Record<string, unknown> });
    if (!seen.has(connector)) {
      seen.set(connector, new Set());
    }
    seen.get(connector)!.add(row.orgId);
  }
  return new Map([...seen].map(([connector, workspaces]) => [connector, workspaces.size]));
}

/**
 * The connectors a person's mail host recommends, from their address's MX
 * records and the platforms that declare those hosts.
 * @param email - The person's address.
 * @param resolve - The MX lookup.
 */
export async function mailEvidence(email: string | null | undefined, resolve?: MxResolver): Promise<{ domain: string; connectors: string[] } | null> {
  const domain = mailDomainOf(email);
  const platforms = discoverablePlatforms();
  if (!domain || platforms.length === 0) {
    return null;
  }
  const exchanges = await mailExchangesFor(domain, resolve ? { resolve } : {});
  const hit = platforms.find(p => exchanges.some(x => exchangeMatches(x, p.discovery!.mailHosts)));
  return hit ? { domain, connectors: [...hit.discovery!.connectors] } : null;
}

/**
 * The apps that read each connector, with the features (plugins) that name it.
 * @param offers - The Apps catalogue as this workspace sees it.
 */
async function appsReading(offers: AppOffer[]): Promise<Map<string, ConnectUnlock[]>> {
  const { listPlugins } = await import('@/libs/workspace/plugins');
  const plugins = listPlugins();
  const reads = new Map(plugins.map(p => [p.manifest.slug, new Set([...(p.manifest.setup?.connectors ?? []), ...p.manifest.recommend.connectors])]));
  const out = new Map<string, ConnectUnlock[]>();
  for (const app of offers) {
    for (const c of app.connectors) {
      const features = app.features.filter(f => reads.get(f.slug)?.has(c.slug)).map(f => f.name);
      const list = out.get(c.slug) ?? [];
      list.push({ app: app.id, appName: app.name, href: `/dashboard/apps/${app.id}`, added: app.added, features });
      out.set(c.slug, list);
    }
  }
  return out;
}

/**
 * The inline fields a credential is typed into, from the platform registry.
 * @param slug - The connector.
 */
function keyFields(slug: string) {
  const platform = platformForConnectorSlug(slug)!;
  return platform.fields.map(f => ({ name: f.name, label: f.label, secret: f.secret, optional: f.optional === true, hint: f.shapeHint }));
}

/**
 * The settings a source needs that the flow asks for inline: the required,
 * non-advanced fields the connector declares, or only the ones named after a login.
 * @param slug - The connector.
 * @param only - Config keys to keep, when the login names the settings it still needs.
 */
function askFields(slug: string, only?: readonly string[]): ConfigField[] {
  const fields = configFieldsFor(slug);
  return only ? fields.filter(f => only.includes(f.key)) : fields.filter(f => f.required === true && f.advanced !== true);
}

/**
 * How this connector is connected from the flow: a login in a popup when one
 * is declared and has an app to run on, a key typed inline when its settings
 * can be asked inline, and otherwise its full form on the Connectors page.
 * @param orgId - The workspace.
 * @param slug - The connector.
 */
async function methodFor(orgId: string, slug: string): Promise<ConnectMethod> {
  const how = howToConnectFor(slug);
  const option = how?.login ? await connectOptionFor(orgId, slug) : null;
  if (how?.login && option?.configured) {
    return {
      kind: 'login',
      startHref: connectStartHref({ provider: how.login.provider, connector: slug, returnTo: CONNECT_POPUP_RETURN }),
      providerLabel: option.label,
      settingsAfterLogin: askFields(slug, how.login.settingsAfterLogin.map(s => s.key)),
    };
  }
  const connector = getConnector(slug)!;
  const fields = askFields(slug);
  // A connector with a hand-written form (no declared fields) whose settings
  // have no defaults cannot be asked inline; its own form can.
  if (configFieldsFor(slug).length === 0 && !connector.configSchema.safeParse({}).success) {
    return { kind: 'page', href: `/dashboard/connectors?add=${encodeURIComponent(slug)}&paste=1` };
  }
  return {
    kind: 'key',
    credentialLabel: how?.paste?.credential ?? 'API key',
    credentialFields: keyFields(slug),
    configFields: fields,
    getItAt: how?.paste?.getItAt ? { url: how.paste.getItAt.url, steps: [...how.paste.getItAt.steps] } : null,
  };
}

/**
 * Score a connector from its evidence.
 * @param evidence - What put it on the list.
 */
export function scoreOf(evidence: ConnectEvidence[]): number {
  let score = 0;
  for (const e of evidence) {
    if (e.kind === 'named') {
      score += EVIDENCE_WEIGHT.named;
    } else if (e.kind === 'app') {
      score += e.needed ? EVIDENCE_WEIGHT.appNeeded : EVIDENCE_WEIGHT.appReads;
    } else if (e.kind === 'mail') {
      score += EVIDENCE_WEIGHT.mail;
    } else {
      score += EVIDENCE_WEIGHT.org + EVIDENCE_WEIGHT.orgEach * Math.max(0, e.workspaces - 1);
    }
  }
  return score;
}

/**
 * The ranked plan for one workspace and the person in it.
 * @param ctx - Who is asking, where.
 * @param ctx.orgId - The workspace.
 * @param ctx.userId - The person.
 * @param input - Everything, one app's systems, or what the person named.
 * @param deps - Injectable lookups.
 */
export async function recommendConnections(ctx: { orgId: string; userId: string | undefined }, input: ConnectPlanInput = {}, deps: RecommendationDeps = {}): Promise<ConnectPlan> {
  const { adminCheck } = await import('./createSourceOnLogin');
  const refused = await adminCheck(ctx.orgId, ctx.userId);
  const all = connectableConnectors();
  const known = new Set(all.map(c => c.slug));
  const { listAppOffers } = await import('@/services/AppCatalogService');
  const [connected, peers, offers, user] = await Promise.all([
    connectedHere(ctx.orgId),
    orgPeerConnectors(ctx.orgId),
    listAppOffers(ctx.orgId).catch(() => [] as AppOffer[]),
    ctx.userId ? db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, ctx.userId)).limit(1).then(r => r[0] ?? null) : Promise.resolve(null),
  ]);
  const [apps, mail] = await Promise.all([appsReading(offers), mailEvidence(user?.email, deps.resolveMx)]);
  const named = new Set((input.named ?? []).filter(slug => known.has(slug)));
  const appScope = input.app ? offers.find(a => a.id === input.app) ?? null : null;
  const inScope = (slug: string) => !appScope || appScope.connectors.some(c => c.slug === slug) || named.has(slug);
  // An app counts as evidence once it is added (or is the app the plan is for);
  // one only on offer is not the workspace's yet. "Needs" is its own declaration.
  const counted = offers.filter(a => a.added || a.id === appScope?.id);

  const evidenceFor = (slug: string): ConnectEvidence[] => {
    const out: ConnectEvidence[] = [];
    if (named.has(slug)) {
      out.push({ kind: 'named' });
    }
    for (const app of counted) {
      const c = app.connectors.find(x => x.slug === slug);
      if (c) {
        out.push({ kind: 'app', app: app.id, appName: app.name, needed: c.needed });
      }
    }
    if (mail?.connectors.includes(slug)) {
      out.push({ kind: 'mail', domain: mail.domain });
    }
    const n = peers.get(slug) ?? 0;
    if (n > 0) {
      out.push({ kind: 'org', workspaces: n });
    }
    return out;
  };

  const candidates: ConnectCandidate[] = [];
  for (const { slug, name } of all) {
    if (connected.has(slug) || !inScope(slug)) {
      continue;
    }
    const evidence = evidenceFor(slug);
    const score = scoreOf(evidence);
    candidates.push({
      connector: slug,
      name,
      score,
      recommended: score >= RECOMMEND_AT || (appScope !== null && evidence.some(e => e.kind === 'app')),
      evidence,
      method: await methodFor(ctx.orgId, slug),
      unlocks: apps.get(slug) ?? [],
    });
  }
  // Highest score first; ties keep the registry's order, so the list is stable.
  candidates.sort((a, b) => b.score - a.score);

  // One question at most: only when the person named nothing and no app
  // scoped the plan, so "which of these do you use?" is the only way to know.
  const needsQuestion = named.size === 0 && !appScope && candidates.length > 0;
  const question = needsQuestion
    ? { question: 'Which of these do you use?', options: candidates.slice(0, Math.max(QUESTION_OPTIONS, candidates.filter(c => c.recommended).length)).map(c => c.connector) }
    : null;
  // Without a question, the walk is what the evidence put forward.
  const walked = needsQuestion ? candidates : candidates.filter(c => c.recommended || named.has(c.connector) || appScope !== null);

  return {
    candidates: walked,
    connected: all.filter(c => connected.has(c.slug) && inScope(c.slug)).map(c => ({ connector: c.slug, name: c.name })),
    question,
    scope: appScope ? { app: appScope.id, appName: appScope.name } : null,
    refused,
  };
}
