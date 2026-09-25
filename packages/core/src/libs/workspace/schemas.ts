import type { HarnessTarget } from '@/services/agents/harnessTarget';
import { z } from 'zod';
import { agentSkillsNameError } from '@/libs/skills/name';
import { isDayZone, isRelativeDay } from '@/libs/time/relativeDay';
import { isValidTimeZone } from '@/libs/time/zone';
import { harnessTargetSchema } from '@/services/agents/harnessTarget';

export const SlugSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/, {
  message: 'slug must be lowercase, start with a letter, and contain only letters, numbers, dashes, or underscores',
});

/**
 * A slug for a SKILL.md folder — stricter than {@link SlugSchema} because the
 * folder is mounted as an Agent Skill and that specification validates the
 * name: lowercase letters, digits and SINGLE hyphens only, never leading or
 * trailing, at most 64 characters. See `libs/skills/name.ts`.
 */
export const AgentSkillSlugSchema = SlugSchema.superRefine((slug, ctx) => {
  const problem = agentSkillsNameError(slug);
  if (problem) {
    ctx.addIssue({
      code: 'custom',
      message: `skill folder slugs must follow the Agent Skills specification — ${problem}. Rename the folder and every reference to it.`,
    });
  }
});

const FewShotExampleSchema = z.object({
  input: z.string(),
  output: z.string(),
  label: z.string().optional(),
});

/**
 * Base-pack activation allowlist (workspace.yaml `use:`). Activation is
 * AGENT-rooted: naming an agent transitively pulls in the skills it
 * declares in `skills:` and the playbooks those skills attach — you
 * never hand-list an agent's own skills. `skills` remains for a skill
 * no activated agent mounts; `playbooks` for standalone context. `use:
 * all` takes every default the pack ships. Omitting `use` while
 * `extends` is set means `use: none` — explicit opt-in, no surprise
 * agents.
 */
const ActivationSelectorSchema = z.object({
  agents: z.array(SlugSchema).default([]),
  skills: z.array(z.string()).default([]),
  playbooks: z.array(z.string()).default([]),
}).partial();

export const WorkspaceManifestSchema = z.object({
  version: z.literal(1).describe('manifest format version'),
  orgId: z.string().min(1).describe('Clerk organization id'),
  name: z.string().min(1),
  description: z.string().optional(),
  /**
   * Workspace lead agent (F1) — the agent that runs the whole workspace
   * and consults the team leads. Must name an agent in this workspace;
   * applied to `project.leadAgentSlug`. Omit = no workspace lead.
   */
  lead: SlugSchema.optional(),
  /**
   * Workspace-default accountable human (F1) — an email, resolved to a
   * user id at apply and stored on `project.accountableUserId`. Teams
   * without their own `accountableUser` inherit this at read time.
   */
  accountableUser: z.string().email().optional(),
  /**
   * The workspace's top-line goal — one sentence. The team report reads
   * every team's spend share and KPI progress against it. Applied to
   * `project.goal`. Omit for none.
   */
  goal: z.string().min(1).optional(),
  /**
   * The workspace's mailbox (email as a chat surface). `enabled: true` gives
   * the workspace `<slug>@<VOCION_MAIL_DOMAIN>` unless `address` names one on
   * that domain; mail to it is answered by the workspace lead and threads
   * into a conversation. Applied to `project.mailboxAddress/mailboxEnabled`.
   */
  mailbox: z.object({
    enabled: z.boolean().default(true),
    address: z.string().email().optional(),
  }).optional(),
  defaults: z.object({
    model: z.string().optional(),
    temperature: z.string().optional(),
    /**
     * IANA time zone the workspace lives in (`America/Los_Angeles`). The day
     * boundary for missions, briefings and every run no browser is behind; a
     * person's own turns carry their browser's zone and win over it.
     */
    timezone: z.string().refine(v => isValidTimeZone(v), { message: 'timezone must be an IANA zone such as America/Los_Angeles' }).optional(),
    /**
     * Which vendor produces this workspace's embeddings, and which model.
     * Omitted keys fall back to `VOCION_EMBEDDING_PROVIDER` /
     * `VOCION_EMBEDDING_MODEL`, then to OpenAI.
     *
     * Set here — at the workspace — and deliberately not on an agent. A query
     * vector is only comparable to vectors produced by the same model, so an
     * agent embedding its queries on a different provider from the one that
     * ingested the documents would quietly return worse search results with no
     * error to point at. `harness.modelProvider` covers the per-agent case for
     * chat models, where no such coupling exists.
     *
     * Changing this on a workspace that already holds chunks means re-embedding
     * them; a model of a different vector width means a schema migration too.
     */
    embeddingProvider: z.enum(['openai', 'bedrock']).optional(),
    embeddingModel: z.string().optional(),
    /**
     * Which workspace skill regenerates each review-item type's card, keyed
     * by action id (`personalization.enroll: regenerate-sequence-copy`).
     * Read by core's scoped skill-turn executor; an action type with no
     * entry keeps its full-pass regenerate only.
     */
    regenerateSkills: z.record(z.string(), SlugSchema).optional(),
    /**
     * Which document playbooks are client-facing, and so cannot be exported
     * as a PDF without having been read as the sceptical buyer on their
     * current version (`services/documents/exportGate.ts`).
     *
     * Matched against `playbook` on a document artifact's spec — the tag the
     * writing skill passes to `render_document`. Omit the key and core's
     * defaults apply (`proposal`, `scope`, `partnership-update`); author an
     * EMPTY list to gate nothing, which is the only way to turn the gate off
     * and is deliberately explicit.
     */
    clientFacingPlaybooks: z.array(z.string().max(60)).max(40).optional(),
    /**
     * How eager this workspace is to improve itself, 0–10. Default 7.
     *
     * Moves the confidence bar for the class of actions that change what the
     * system knows about how to work — adopting a rule from a correction a
     * person made to an agent's work is the first of them
     * (`libs/actions/eagerness.ts`). 0 always asks. 7 puts the bar at 72%,
     * 10 at 60%; both clear a plain directive in the person's own words and
     * neither clears a rule the model had to infer, because the dial moves
     * the bar and never the confidence.
     *
     * A trust rule that names `autoApproveAbove` for a kind wins over the
     * dial for that kind — pin one action without changing the appetite.
     */
    learningEagerness: z.number().int().min(0).max(10).optional(),
    /**
     * The spend cap every agent in this workspace is held to when its own
     * YAML sets no `budget:` — the workspace's default agent cap (#272).
     *
     * `dailyCents` is a hard cap in cents per UTC day: `10000` is $100. `null`
     * means this workspace chose no default, so an agent without a budget of
     * its own runs unlimited — for a workspace that manages spend with its
     * provider's limits instead (AWS Budgets, the Anthropic Console's spend
     * limits); see `docs/guides/budgets.md` for what those do and do not catch.
     *
     * Omit the block and apply leaves whatever default is stored alone, and
     * with none stored the built-in $100 a day applies
     * (`BudgetService.DEFAULT_AGENT_DAILY_HARD_CENTS`).
     */
    agentBudget: z.object({
      dailyCents: z.number().int().min(0).nullable(),
    }).optional(),
    /**
     * The proposal budget every agent in this workspace is held to when its
     * own YAML sets no `proposals:` — how many undecided items it may hold in
     * Review at once when acting on its own schedule, and how many new ideas
     * it may file a week. See `AgentSchema.proposals`. Omit and the built-in
     * default applies (`ProposalBudgetService.DEFAULT_PROPOSAL_BUDGET`).
     */
    agentProposals: z.object({
      openMax: z.number().int().min(0).optional(),
      weeklyMax: z.number().int().min(0).optional(),
    }).optional(),
    /**
     * How strict the handoff judges are in THIS workspace: overrides every
     * gate's `judge.sampleRate` / `judge.escalateBelow` at apply time. The
     * plugin declares the gates; the workspace turns the dial.
     */
    gates: z.object({
      sampleRate: z.number().min(0).max(1).optional(),
      escalateBelow: z.number().min(0).max(1).optional(),
    }).optional(),
  }).partial().optional(),
  /**
   * Optional dashboard surfaces to switch on, by registry id (see
   * `features/navigation/surfaces.ts`). The route, page, label, icon and
   * sidebar section all live in core; this list only says which ones this
   * workspace gets. Unknown ids fail at load. Omit for none.
   */
  surfaces: z.array(z.string()).default([]),
  /**
   * Pin a versioned base pack that ships inside vocion-core, e.g.
   * `core@1.4.0` (or bare `core` to track the pack's current version).
   * OMIT → no base layer at all: the workspace loads exactly as it does
   * today, byte-for-byte. A workspace only ever moves onto a new pack
   * version by changing this pin — publishing a newer pack never reaches
   * a pinned instance.
   */
  extends: z.string().optional().describe('base pack pin, e.g. "core@1.4.0"; omit for no base layer'),
  /**
   * Activation allowlist for the pinned pack. `use: all` activates every
   * default; an {agents,skills} selector activates only what it names
   * (agents pull their skills transitively). Omitted while `extends` is
   * set = activate nothing (`use: none`).
   */
  use: z.union([z.literal('all'), ActivationSelectorSchema]).optional(),
  /**
   * Suppress a core default even under `use: all` — the escape hatch. A
   * disabled slug is omitted from the merged workspace entirely. Applies to
   * plugin-provided slugs too.
   */
  disable: ActivationSelectorSchema.optional(),
  /**
   * Plugins to turn on, by slug (`templates/plugins/<slug>/plugin.yaml`). A
   * plugin is a bundle of agents, skills, object types, missions, automations,
   * teams, pages and trust rules that composes UNDER the workspace the way the
   * base pack does — always fully active, overridable by slug with
   * `extends: core`, suppressible with `disable:`. Dependencies (`depends:`)
   * are pulled in automatically. Omit for none.
   */
  plugins: z.array(SlugSchema).default([]),
});
export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;

/**
 * `plugin.yaml` — the identity of a workspace plugin shipped inside
 * vocion-core at `packages/core/templates/plugins/<slug>/`. A plugin is the
 * abstract rung of the ladder made installable: the same directory shape as
 * a workspace (agents/, skills/, objects/, missions/, automations/, teams/,
 * pages/, trust.yaml), turned on with one line in workspace.yaml.
 *
 * `recommend.when` is what the chat reads to suggest a plugin that is off:
 * short phrases naming the conversation patterns it serves. `connectors` are
 * the connector slugs it works better with, so the same suggestion can say
 * which system to connect.
 */
export const PluginManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'plugin version must be semver x.y.z'),
  description: z.string().min(1).describe('one line: what turning it on gives a person'),
  /** Other plugins this one needs; turned on with it, ordered before it. */
  depends: z.array(SlugSchema).default([]),
  /** Core-registered surfaces (`features/navigation/surfaces.ts`) this plugin switches on. */
  surfaces: z.array(z.string()).default([]),
  /**
   * Where the plugin's rows sit in the sidebar — its pages, the core routes it
   * owns (`DashboardRoute.plugin`) and its surfaces, all together. Default
   * `Workspace`: beside Chat and Review, pinned by default. Name a section only
   * when the plugin is part of a named app — `GTM` puts its rows under that
   * heading with the app's other surfaces. A page's own `nav.section` still
   * wins for that page when it names one.
   */
  nav: z.object({
    section: z.string().min(1).default('Workspace'),
    order: z.number().default(0),
  }).default({ section: 'Workspace', order: 0 }),
  recommend: z.object({
    when: z.array(z.string().min(1)).default([]),
    connectors: z.array(z.string().min(1)).default([]),
  }).default({ when: [], connectors: [] }),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * Team manifest (F1) — workspace/<org>/teams/<slug>.yaml. The team's
 * slug comes from the FILENAME (no `slug:` field), so a team cannot
 * disagree with its own path. Teams are flat by construction: there is
 * no parent field here and no parent column in the `team` table.
 */
/**
 * One team KPI. `source` is `counts.<key>`: the sum of that key in
 * `worker_run.counts` across the team's agents, over `window` (default
 * all time). Progress is computed at read time — nothing is stored.
 */
export const TeamKpiSchema = z.object({
  key: SlugSchema.describe('stable id, e.g. prs_merged'),
  label: z.string().min(1).describe('what a person reads, e.g. "Merged PRs"'),
  target: z.number().positive().describe('the number that counts as done'),
  baseline: z.number().min(0).optional().describe('where the reading stood when the contract was set; progress is measured from here'),
  unit: z.string().optional().describe('suffix shown after the reading, e.g. "PRs"'),
  source: z.string().regex(/^counts\.[\w-]+$/, 'source must be counts.<key>').describe('which worker_run.counts key is summed'),
  window: z.enum(['24h', '7d', 'all']).default('all'),
}).refine(k => k.baseline === undefined || k.baseline < k.target, 'baseline must be below target');
/** @deprecated `kpis:` is an alias for one release — author `measures:` (see `TeamMeasureSchema`). */
export type TeamKpiManifest = z.infer<typeof TeamKpiSchema>;

/* ------------------------------------------------------------------ */
/* Measures — the outcome/measurement model (docs/specs/team-report-v2) */
/* ------------------------------------------------------------------ */

/** The four things a workforce is judged on. Autonomy is layered over these, never one of them. */
export const MEASURE_DIMENSIONS = ['outcome', 'quality', 'velocity', 'economics'] as const;
export type MeasureDimension = typeof MEASURE_DIMENSIONS[number];

/** How far back a reading reaches. A measure reads its own window regardless of the page's. */
export const MEASURE_WINDOWS = ['24h', '7d', '30d', 'quarter'] as const;
export type MeasureWindow = typeof MEASURE_WINDOWS[number];

/**
 * Where a reading comes from, strongest first. The chip on the report names
 * it; `agent-reported` is visibly the weakest because the worker that did
 * the work is the one saying how much of it there was.
 */
export const PROVENANCE_KINDS = ['verified', 'observed', 'human-confirmed', 'agent-reported'] as const;
export type ProvenanceKind = typeof PROVENANCE_KINDS[number];

const ActionIdList = z.array(z.string().min(1)).min(1).describe('registered action ids, e.g. gmail.send');
const CountsKey = z.string().regex(/^[\w-]+$/, 'counts key must be a plain key, e.g. pitches').describe('a worker_run.counts key');

/**
 * The connectors a `verified` measure may read through. Closed on purpose: an
 * unknown connector has to be a validation error, because the alternative is
 * a measure that parses, reads nothing and shows a zero nobody asked a system
 * of record for.
 */
export const VERIFIED_CONNECTORS = ['hubspot', 'web-analytics'] as const;
export type VerifiedConnector = typeof VERIFIED_CONNECTORS[number];

/**
 * `verified` through HubSpot — read from the synced mirror
 * (`CrmRecordsService`), so the reading carries the mirror's own freshness.
 * `filter` keys mirror `CrmFilter`; `aggregate` is `count` or `sum(amount)`.
 */
export const HubspotVerifiedSourceSchema = z.object({
  kind: z.literal('verified'),
  connector: z.literal('hubspot'),
  query: z.object({
    object: z.enum(['deals', 'contacts', 'companies']),
    filter: z.object({
      dealStages: z.array(z.string().min(1)).optional(),
      pipelines: z.array(z.string().min(1)).optional(),
      dealStatus: z.enum(['open', 'closed']).optional(),
      lifecycleStages: z.array(z.string().min(1)).optional(),
      industries: z.array(z.string().min(1)).optional(),
      ownerIds: z.array(z.string().min(1)).optional(),
    }).default({}),
    aggregate: z.string().regex(/^(count|sum\(amount\))$/, 'aggregate must be count or sum(amount)').default('count'),
  }),
});

/** What a web-analytics measure can count. */
export const WEB_ANALYTICS_METRICS = ['sessions', 'users', 'conversions', 'signups'] as const;
export type WebAnalyticsMetric = typeof WEB_ANALYTICS_METRICS[number];

/**
 * `verified` through web analytics — a report the analytics provider runs
 * over the measure's own window. Today the provider is GA4, read through the
 * Analytics Data API (`properties/<id>:runReport`) with a service account the
 * workspace supplies; the property id is workspace configuration and is
 * deliberately NOT part of the measure, so a team file names what it measures
 * and never an account id.
 *
 * Deliberately narrow. The filter keys are the three predicates GA4 can apply
 * to a session or an event server-side — where the visit landed, which channel
 * brought it, which event fired. There is no pages-per-session predicate
 * because the Data API has no session-level engagement filter; asking for one
 * would mean either silently filtering the wrong thing or filtering nothing,
 * and a `verified` reading that quietly measures something else is worse than
 * one that was never authored.
 */
export const WebAnalyticsVerifiedSourceSchema = z.object({
  kind: z.literal('verified'),
  connector: z.literal('web-analytics'),
  query: z.object({
    metric: z.enum(WEB_ANALYTICS_METRICS),
    filter: z.object({
      /** Sessions whose landing page starts here, e.g. `/docs`. */
      pathPrefix: z.string().min(1).startsWith('/', 'pathPrefix must start with /').optional(),
      /** A GA4 default channel group, e.g. `Organic Search`. Matched exactly. */
      channel: z.string().min(1).optional(),
      /** A GA4 event name. Required by the `signups` metric, which is a count of one named event. */
      event: z.string().regex(/^[a-z_]\w*$/i, 'event must be a GA4 event name, e.g. sign_up').optional(),
    }).default({}),
  }),
}).refine(
  s => s.query.metric !== 'signups' || s.query.filter.event !== undefined,
  'a signups measure must name the GA4 event that records a signup, e.g. filter.event: sign_up',
);

/**
 * `verified` — a query against a system of record through a connector,
 * discriminated on which connector. Adding one means adding a member here; an
 * unknown connector is "No matching discriminator" at parse time rather than a
 * source that reads nothing and shows a zero.
 */
export const VerifiedMeasureSourceSchema = z.discriminatedUnion('connector', [
  HubspotVerifiedSourceSchema,
  WebAnalyticsVerifiedSourceSchema,
]);

/**
 * Rows Vocion keeps that an `observed` measure may count, beyond the actions
 * and runs it already counts. Closed, and each one names a table rather than a
 * concept, because the honesty of `observed` rests on there being a row.
 *
 * `workspace-members` — `account_membership` rows created in the window for
 * the account that owns this workspace: the people who joined. A scorecard
 * calls this "signups"; the row kind does not, because what Vocion can prove
 * is that an account gained a member, and the measure's own `label` is where
 * the workspace's word for that belongs.
 */
export const OBSERVED_ROW_KINDS = ['workspace-members', 'artifacts', 'data-rooms', 'data-room-sources'] as const;
export type ObservedRowKind = typeof OBSERVED_ROW_KINDS[number];

/**
 * Narrows `rows: artifacts` — the artifact table is every kind of output, and
 * a measure is about one of them: the wiki's pages (`folder: wiki`), the
 * proposals rendered (`kind: document, playbook: proposal`), the ones that
 * render-verified clean (`verified: true`). All optional, all ANDed.
 */
export const ObservedRowsWhereSchema = z.object({
  kind: z.string().min(1).optional(),
  folder: z.string().min(1).optional(),
  playbook: z.string().min(1).optional(),
  verified: z.boolean().optional(),
}).partial();

/**
 * `observed` — Vocion saw it happen in our own tables: `action_run` rows that
 * reached `done` for the named action ids, `worker_run`s that completed
 * carrying the named `counts` key, or `rows` of one of the kinds Vocion keeps
 * itself. Exactly one of the three must be set.
 */
export const ObservedMeasureSourceSchema = z.object({
  kind: z.literal('observed'),
  actions: ActionIdList.optional(),
  counts: CountsKey.optional(),
  rows: z.enum(OBSERVED_ROW_KINDS).optional(),
  /** Only with `rows: artifacts`. */
  where: ObservedRowsWhereSchema.optional(),
}).refine(
  s => [s.actions, s.counts, s.rows].filter(v => v !== undefined).length === 1,
  'observed source names exactly one of actions, a counts key or rows',
).refine(
  s => s.where === undefined || s.rows === 'artifacts',
  '`where` narrows `rows: artifacts` only',
);

/**
 * `human-confirmed` — a person approved it: `action_run` decisions of
 * approve / edit for the named action ids, or asks of the named kinds decided
 * with anything but a reject. One of the two must be set.
 */
export const HumanConfirmedMeasureSourceSchema = z.object({
  kind: z.literal('human-confirmed'),
  actions: ActionIdList.optional(),
  askKinds: z.array(z.enum(['approval', 'input', 'ruling', 'credential', 'merge', 'recommendation', 'gate'])).min(1).optional(),
}).refine(s => Boolean(s.actions) || Boolean(s.askKinds), 'human-confirmed source names actions or askKinds');

/** `agent-reported` — the sum of a `worker_run.counts` key. The worker grades itself; the chip says so. */
export const AgentReportedMeasureSourceSchema = z.object({
  kind: z.literal('agent-reported'),
  counts: CountsKey,
});

/**
 * Nested discriminated unions: `kind` picks the provenance arm, and inside
 * `verified`, `connector` picks the system of record. Both levels stay closed
 * — an unknown `kind` or an unknown `connector` is a parse failure, never a
 * source that silently reads nothing.
 */
export const MeasureSourceSchema = z.discriminatedUnion('kind', [
  VerifiedMeasureSourceSchema,
  ObservedMeasureSourceSchema,
  HumanConfirmedMeasureSourceSchema,
  AgentReportedMeasureSourceSchema,
]);
export type MeasureSource = z.infer<typeof MeasureSourceSchema>;

/**
 * One measure a team is graded on. Vocion DERIVES attainment, trend, cost per
 * outcome and the rest from readings of these; nothing derived is authored.
 */
export const TeamMeasureSchema = z.object({
  key: SlugSchema.describe('stable id, e.g. qualified_referrals'),
  label: z.string().min(1).describe('what a person reads, e.g. "Qualified referrals"'),
  dimension: z.enum(MEASURE_DIMENSIONS).default('outcome'),
  target: z.number().positive().describe('the reading that counts as on target, in the window'),
  baseline: z.number().min(0).optional().describe('where the reading stood when the contract was set'),
  unit: z.string().optional().describe('suffix after the reading, e.g. "referrals", "%", "min"'),
  window: z.enum(MEASURE_WINDOWS).default('7d'),
  /** `higher` — more is better (a count). `lower` — less is better (a turnaround time, a cost). */
  direction: z.enum(['higher', 'lower']).default('higher'),
  source: MeasureSourceSchema,
  /**
   * Opt this measure into the workspace goal-progress figure. Heterogeneous
   * units are never summed; only measures that declare a weight are combined,
   * and only as weight × attainment (spec §3).
   */
  contributesTo: z.literal('workspace-goal').optional(),
  weight: z.number().positive().optional().describe('the measure\'s share of the workspace goal, with contributesTo'),
})
  .refine(m => m.baseline === undefined || (m.direction === 'higher' ? m.baseline < m.target : m.baseline > m.target), 'baseline must be on the far side of target from the direction of improvement')
  .refine(m => m.contributesTo === undefined || m.weight !== undefined, 'a measure that contributesTo the workspace goal needs a weight');
export type TeamMeasureManifest = z.infer<typeof TeamMeasureSchema>;
/** The authored shape of one measure, before defaults apply. */
export type TeamMeasureInput = z.input<typeof TeamMeasureSchema>;

/**
 * A legacy `kpis:` entry as a measure. A KPI could only ever read what the
 * worker said, so it maps to `agent-reported`; its `all` window has no
 * equivalent (a measure is always judged in a window) and becomes `quarter`,
 * the longest one.
 * @param kpi - A parsed legacy KPI.
 */
export function kpiToMeasure(kpi: TeamKpiManifest): TeamMeasureManifest {
  return {
    key: kpi.key,
    label: kpi.label,
    dimension: 'outcome',
    target: kpi.target,
    ...(kpi.baseline === undefined ? {} : { baseline: kpi.baseline }),
    ...(kpi.unit === undefined ? {} : { unit: kpi.unit }),
    window: kpi.window === 'all' ? 'quarter' : kpi.window,
    direction: 'higher',
    source: { kind: 'agent-reported', counts: kpi.source.replace(/^counts\./, '') },
  };
}

const TeamManifestBaseSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** The team's mission — one sentence, shown under its name on the team report. (`goal:` in the file.) */
  goal: z.string().min(1).optional(),
  /** The measures the team is graded on. Keys unique per team. */
  measures: z.array(TeamMeasureSchema).default([]),
  /**
   * @deprecated Alias for one release: each entry is read as an
   * `agent-reported` measure and folded into `measures` on parse.
   */
  kpis: z.array(TeamKpiSchema).default([]),
  /**
   * Slug of the agent leading this team. Optional — a team may exist
   * before its lead is chosen (rendered "no lead yet") — but when set
   * it must name an agent in this workspace.
   */
  lead: SlugSchema.optional(),
  /**
   * The accountable human for this team — an email, resolved to a user
   * id at apply. Omit to inherit the workspace-level default
   * (`accountableUser:` in workspace.yaml); inheritance is resolved at
   * read time and is NOT baked in on export.
   */
  accountableUser: z.string().email().optional(),
});

export const TeamManifestSchema = TeamManifestBaseSchema
  .transform(({ kpis, ...team }) => ({ ...team, measures: [...team.measures, ...kpis.map(kpiToMeasure)] }))
  .refine(t => new Set(t.measures.map(m => m.key)).size === t.measures.length, 'measure keys must be unique within a team');
export type TeamManifest = z.infer<typeof TeamManifestSchema>;
/** The authored shape — what a teams/<slug>.yaml file may contain before defaults apply. */
export type TeamManifestInput = z.input<typeof TeamManifestBaseSchema>;

/**
 * `pack.yaml` — the identity of a base pack shipped inside vocion-core at
 * `packages/core/templates/<name>/`. The version is what a workspace pins
 * via `extends: core@<version>` and what folds into `workspace_sha`, so a
 * pinned instance is insulated from later pack publishes.
 */
export const PackManifestSchema = z.object({
  name: z.literal('core').describe('pack identity — only "core" today'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'pack version must be semver x.y.z'),
  description: z.string().optional(),
});
export type PackManifest = z.infer<typeof PackManifestSchema>;

/**
 * Collapse a parsed harness block's two spellings of the same field into one.
 *
 * `runsOn` is the field; `provider` is what it used to be called. Authors may
 * have written either, and a workspace kept in a parent project may not be
 * updated for a long time — so both are read here, `runsOn` wins if somehow
 * both are present, and only `runsOn` survives into the stored row. Callers
 * downstream therefore never have to know the old name existed.
 *
 * Both keys are dropped entirely when neither was authored. That absence is
 * load-bearing: `defaultHarnessTargetFor` derives a target from the agent's
 * model vendor, and it can only do that while "unset" is still visible.
 * @param harness - The parsed harness block, before normalisation.
 */
function normalizeHarnessBlock<T extends { runsOn?: HarnessTarget; provider?: HarnessTarget }>(
  harness: T,
): Omit<T, 'provider'> {
  const { provider, ...rest } = harness;
  const target = harness.runsOn ?? provider;
  if (!target) {
    const withoutRunsOn = { ...rest };
    delete withoutRunsOn.runsOn;
    return withoutRunsOn;
  }
  return { ...rest, runsOn: target };
}

export const AgentManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  active: z.boolean().default(true),
  /**
   * This agent's spend caps, in cents. A turn is refused once the period's
   * spend reaches the cap, and a turn that crosses it partway is stopped at
   * its next model call (#272). `dailyCents: 5000` is $50 per UTC day;
   * `monthlyCents` is per UTC calendar month. Either may be left out.
   *
   * An agent with no daily cap of its own is held to the workspace's default
   * agent cap (`defaults.agentBudget` in workspace.yaml) and, failing that, to
   * the built-in $100 a day. So leaving this out is not "unlimited".
   *
   * Omit the block and apply leaves the agent's stored caps alone — a cap set
   * when the agent was hired, or by an admin, survives. Write it and the YAML
   * owns those caps: the next apply puts them back to what is written here.
   * See `docs/guides/budgets.md`.
   */
  budget: z.object({
    dailyCents: z.number().int().min(0).optional(),
    monthlyCents: z.number().int().min(0).optional(),
  }).optional(),
  /**
   * THE PROPOSAL BUDGET — no runaway queues (Chris, 2026-09-24: "700 items
   * need attention is uselessly overwhelming").
   *
   * When this agent acts on its own schedule (a mission check, an automation,
   * anything with no person in the conversation) it may hold at most
   * `openMax` undecided items in Review — pending action runs and open asks
   * it filed — and file at most `weeklyMax` new candidate records (ideas) in
   * a rolling week. Past either, filing is refused with the list of its own
   * open items and the instruction to withdraw one first
   * (`withdraw_proposal`), so a better idea retires an older one instead of
   * stacking on it. A proposal made inside a person's own chat turn never
   * counts: the person asked. Omit for the workspace default
   * (`defaults.agentProposals`), then the built-in one.
   */
  proposals: z.object({
    openMax: z.number().int().min(0).optional(),
    weeklyMax: z.number().int().min(0).optional(),
  }).optional(),
  /**
   * Slug of the primary agent this specialist reports to. Omit for
   * primary agents. One level deep: the referenced agent must itself
   * have no `parent`. Source of truth for the agent hierarchy.
   */
  parent: SlugSchema.optional(),
  /**
   * DEPRECATED — derived from `parent` ('specialist' when parent is
   * set, 'lead' otherwise). If authored, it must match the derived
   * value; workspace:check errors on a mismatch.
   */
  role: z.enum(['lead', 'specialist']).optional(),
  /** The work mode this agent primarily runs. */
  agentType: z.enum(['mission', 'workflow', 'operational']).optional(),
  /**
   * The team this agent belongs to (F1) — a slug matching a file in the
   * workspace's teams/ dir. Validated whenever the workspace defines
   * teams; workspaces without a teams/ dir keep the old behavior
   * (free-text display label, deprecated) byte-for-byte.
   */
  team: z.string().optional(),
  model: z.string().optional(),
  temperature: z.union([z.string(), z.number()]).optional(),
  systemPromptFile: z.string().optional().describe('path to markdown system prompt, relative to agent file'),
  systemPrompt: z.string().optional().describe('inline system prompt — prefer systemPromptFile for long prompts'),
  skills: z.array(z.string()).default([]).describe('skill slugs this agent can invoke'),
  /**
   * What this agent reaches for, named by connector CATEGORY and never by
   * vendor — `crm`, not `salesforce`. Same-category connectors are peers,
   * so an agent can never quietly prefer one vendor's ledger over another's,
   * and the catalog can say "needs a ledger" without naming a product.
   *
   * `degradesTo` is what it does with none of them connected. Every agent
   * has an answer; a missing connector picks a tier, it does not fail. There
   * is deliberately no permission field here — whether an agent may write is
   * a property of the installation, not of the definition, and an agent's
   * write ceiling is the union of its skills' own write paths.
   */
  requires: z.object({
    connectors: z.array(SlugSchema).default([]),
    optional: z.array(SlugSchema).default([]),
    degradesTo: z.enum(['files', 'none']).default('files'),
  }).default({ connectors: [], optional: [], degradesTo: 'files' }),
  connectorSources: z.array(z.string()).default([]).describe('source slugs (matching knowledge_source.slug) this agent can search'),
  objectTypes: z.array(z.string()).default([]).describe('business object type slugs'),
  documentSetIds: z.array(z.number()).default([]),
  searchConfig: z.object({
    recencyDecay: z.number().optional(),
    sourceWeights: z.record(z.string(), z.number()).optional(),
    maxResults: z.number().optional(),
    minRelevance: z.number().optional(),
  }).partial().default({}),
  fewShotExamples: z.array(FewShotExampleSchema).default([]),
  approvalPolicy: z.record(z.string(), z.unknown()).default({}),
  langfuseProjectId: z.string().optional(),
  /**
   * Sub-agent definitions (v0.2). Each entry compiles into a deepagents
   * `SubAgent` the parent dispatches via the `task` tool. `systemPrompt`
   * may be inlined here, or supplied via `systemPromptFile` (relative
   * path). At least one of the two is required per entry.
   */
  subagents: z.array(z.object({
    name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    description: z.string(),
    systemPrompt: z.string().optional(),
    systemPromptFile: z.string().optional(),
    tools: z.array(z.string()).optional(),
    model: z.string().optional(),
  }).refine(
    s => !!(s.systemPrompt || s.systemPromptFile),
    { message: 'subagent must have either systemPrompt or systemPromptFile' },
  )).default([]),
  /**
   * Playbooks attached to this agent by name — context that should
   * always be present for it, independent of any skill. A named slug
   * must resolve to a playbook the workspace or its base pack ships.
   */
  playbooks: z.array(z.string()).default([]),
  /** Names of `learning_step` rows this agent owns. (Wired in Phase 5.) */
  learningSteps: z.array(z.string()).default([]),
  /** Empty-state suggestions shown in the chat UI. */
  suggestions: z.array(z.object({
    label: z.string(),
    prompt: z.string(),
  })).default([]),
  /**
   * The face this agent wears when it answers on a chat surface — the name
   * and avatar a Slack reply is posted under. A channel binding's own
   * persona still wins; this is the agent everywhere else. Presentation
   * only: it changes no identity and no authorisation, and must never imply
   * a human. `iconUrl` must be a public https URL — Slack fetches it itself.
   */
  persona: z.object({
    displayName: z.string().min(1).optional(),
    iconUrl: z.string().url().optional(),
  }).optional(),
  /** CSS color name for the agent's chat header / sidebar. */
  accent: z.string().optional(),
  /** Short tagline shown above the chat title. */
  eyebrow: z.string().optional(),
  /**
   * What this agent answers for — short topics, intents or example asks
   * (`handles: [wiki, standing rules, research, plans]`). When a message
   * names no agent, the router matches it against these first, then the
   * description and suggestions, and defaults to the workspace lead
   * (`services/agents/router.ts`). Empty: reached by name or delegation only.
   */
  handles: z.array(z.string().min(1)).default([]),
  /**
   * How much this agent volunteers — `low` | `normal` | `high`, default
   * `normal`. Three effects, each real: it breaks a routing tie; `high` ends
   * a turn that produced a standing fact, decision or plan with one offer to
   * carry it forward, `low` never volunteers; and `low` sits out debriefs —
   * the automations that fire on completed work (`worker_run.completed`,
   * `mission_run.completed`, `conversation.ended`, `pr.merged`,
   * `automation_run.completed`).
   */
  initiative: z.enum(['low', 'normal', 'high']).default('normal'),
  /**
   * Harness config (v0.3) — per-agent knobs for the reusable agent
   * harness. `provider` selects where the agent loop executes:
   * `local` (in-process deepagents loop, the default), `agentcore`
   * (the AWS AgentCore managed harness — provisioned by
   * workspace:apply, invoked via InvokeHarness; skills execute
   * client-side in vocion-core as inline functions), or `runtime`
   * (the BYOA artifact — packages/agent-runtime: our deepagents loop
   * hosted out-of-process, localhost in dev / AgentCore Runtime when
   * deployed; tools execute in core via the claim-verified tool
   * endpoint).
   *
   * `agentcore` and `runtime` are BOTH AWS Bedrock AgentCore — it is a
   * product family, and these are two services inside it. The difference
   * is who owns the loop: on `agentcore` AWS does, and the agent is pure
   * configuration with `search_knowledge` as its only tool; on `runtime`
   * we do, and the agent keeps the full tool registry, subagents,
   * playbooks and approval gates, because those are deepagents features
   * our loop implements. Neither routes inference — a Bedrock call is a
   * direct Converse call in all three cases. `interrupts` lists skill/tool slugs that pause for
   * human approval (via the hitl_gate flow) before executing;
   * `maxTokens` caps the model's output tokens; `maxSteps` stops a turn
   * after that many steps; `excludeTools`
   * withholds built-in tools by name (e.g. `propose_action` for agents
   * that should have no CRM-write surface at all); `model` overrides the
   * model id; `modelProvider` overrides which vendor serves it.
   *
   * `runsOn` and `modelProvider` are different axes and are easy to
   * confuse. `runsOn` is *which machinery runs the turn*; `modelProvider` is
   * whose model answers*. `bedrock` belongs to the second and has never been
   * a value of the first.
   *
   * Three values, named for whose loop you get rather than whose cloud it
   * sits in — see `services/agents/harnessTarget.ts`:
   *
   *   - `in-process` — our deepagents loop, in this process. No AgentCore.
   *   - `agentcore-container` — the SAME loop, in our container, hosted on
   *     AWS AgentCore Runtime. Tools call back to core.
   *   - `aws-managed-harness` — AWS owns the loop. The agent becomes pure
   *     configuration with one tool and no subagents, playbooks or gates.
   *
   * The old spellings (`local`, `runtime`, `agentcore`) are still accepted
   * and normalised on parse, because parent projects hold workspace files
   * this repo cannot see. `provider:` is likewise still read as an alias for
   * `runsOn:`.
   *
   * One default links the two axes: an agent that names `modelProvider:
   * bedrock` and no `runsOn` gets `agentcore-container`, since choosing AWS
   * as the vendor is almost always choosing AWS as the place to run.
   * `runsOn: in-process` next to it opts back out, and that combination
   * works — the in-process loop reaches Bedrock on the org's own stored key.
   *
   * `runsOn` is deliberately NOT defaulted here. The default has to stay
   * absent in the stored row for `defaultHarnessTargetFor` (AgentService) to
   * tell "the author wanted the in-process loop" apart from "the author said
   * nothing" — writing one for both would make the Bedrock default
   * unreachable for every agent that came through workspace YAML.
   */
  harness: z.object({
    runsOn: harnessTargetSchema.optional(),
    /** Pre-rename spelling of `runsOn`. Read, normalised, and not re-emitted. */
    provider: harnessTargetSchema.optional(),
    interrupts: z.array(z.string()).default([]),
    maxTokens: z.number().int().positive().optional(),
    /**
     * Stop one turn after this many steps. A step is a LangGraph graph step:
     * one model call plus the tools it asked for is about two. The
     * AWS-managed harness counts tool rounds instead and gets half.
     *
     * Optional rather than defaulted: an agent that says nothing keeps each
     * provider's own backstop (deepagents' 10,000 steps, AgentCore's 12
     * rounds). Set it to stop a loop sooner — see
     * `services/agents/stepLimit.ts`.
     */
    maxSteps: z.number().int().positive().optional(),
    excludeTools: z.array(z.string()).default([]),
    /**
     * Granted-only tools this agent receives. Some built-ins (the discovery
     * lane: classify_call, match_meetings, …) exist only for agents that name
     * them here — the inverse of excludeTools, for tools too powerful to be
     * default-on.
     */
    grantTools: z.array(z.string()).default([]),
    model: z.string().optional(),
    modelProvider: z.enum(['anthropic', 'openai', 'bedrock']).optional(),
    /**
     * Ask the vendor to cache this agent's prompt prefix, or forbid it.
     *
     * On by default for Anthropic and Bedrock, so an author writes this only
     * to say `false` — an agent whose system prompt or mounted files must not
     * sit in a vendor's cache for the five minutes the TTL lasts. Setting it
     * here beats the caller, because the person who wrote the agent is the one
     * who knows what its prompt carries.
     *
     * Optional rather than defaulted so the stored row keeps saying nothing
     * when the author said nothing: `VOCION_PROMPT_CACHE=0` and the process
     * default both have to stay reachable, and a written-in `true` would make
     * the kill switch look like it had been overruled per agent. See
     * `libs/llm/promptCache.ts` for what caching buys and what silently will
     * not cache.
     */
    promptCache: z.boolean().optional(),
    /**
     * Structural guarantee for A2UI action cards: when true and a turn ends
     * with ZERO recommend_action calls, the runtime runs a small follow-up
     * pass over the finished answer that emits the cards the agent's rules
     * require. Exists because prompt compliance alone proved unreliable —
     * long tool outputs (e.g. the daily brief) anchor the model into prose
     * mode and it stops calling the tool (observed 3→0 card regression).
     */
    recommendActionBackstop: z.boolean().optional(),
    /**
     * Action kinds this agent earns trust for on its OWN ledger. A proposal
     * of a listed kind keys the autonomy ladder on `<kind>.<agent-slug>`
     * (`wiki.write_page.wiki-researcher`) instead of the shared kind, so a
     * trust rule, the rung and the alignment evidence can be this agent's
     * alone while every other agent keeps the kind's rule. Honoured by the
     * actions that carry a `by` field — `wiki.write_page` today; the tool
     * fills it from the agent, never from the model. Optional rather than
     * defaulted so agents applied before this exist stay unchanged.
     */
    ownLedger: z.array(z.string().min(1)).optional(),
  }).partial().transform(normalizeHarnessBlock).default({}),
}).refine(
  v => !!(v.systemPromptFile || v.systemPrompt),
  { message: 'agent must have either systemPromptFile or inline systemPrompt' },
);
export type AgentManifest = z.infer<typeof AgentManifestSchema>;

/* ----------------------------------------------------------------
 * Workflow manifest
 * ---------------------------------------------------------------- */

const InterpolatableStringSchema = z.string().describe(
  'supports {{input.x}}, {{steps.name.output.y}}, {{trigger.y}}',
);

/**
 * Step types — workflows are DETERMINISTIC: same structure every run.
 * Open-ended agent work belongs in missions, never in a workflow step.
 *   - `skill`   — invoke a skill (typed LLM call) with interpolated input
 *   - `sync`    — refresh named sources so downstream steps read live data
 *   - `approve` — HITL pause; workflow resumes after runtime_approve
 *   - `ask`     — HITL input; pause until a human supplies text
 *   - `action`  — connector-backed action (v1 = registered stubs only)
 */
const ApproveStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('approve'),
  prompt: z.string().describe('what is being approved — shown in the review queue'),
  /** Optional — reference to prior step whose output is being reviewed. */
  reviews: z.string().optional(),
});

/**
 * Human input as a step. Pauses the run in Review until a human supplies
 * text (e.g. "paste the call transcript"); the run then resumes with that
 * text as the step's output, interpolable downstream via
 * `{{steps.<name>.output}}`. Deterministic: the question is fixed at
 * authoring time — only the data comes from the human.
 */
const AskStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('ask'),
  prompt: z.string().describe('what to ask the human — shown in the review queue'),
  /**
   * Optional interpolable template (e.g. `{{input.transcript}}`). When it
   * resolves to a non-empty string the step completes with that value and the
   * run never pauses — an ask that already has its answer doesn't ask. Lets one
   * workflow serve both an automated caller that supplies the data and a human
   * starting it by hand, without forking the definition.
   */
  default: z.string().optional(),
  /** Optional — persist this step's output into named variable (defaults to step name). */
  outputAs: z.string().optional(),
});

const ActionStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('action'),
  action: z.string().describe('registered action id, e.g. `gmail.send_email`'),
  input: z.record(z.string(), z.unknown()).default({}),
});

const SyncStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('sync'),
  /**
   * Source slugs to incrementally sync before downstream steps read. Gives a
   * scheduled workflow LIVE data (last-hours email, fresh CRM state) instead
   * of index-freshness. Per-source failures degrade gracefully — the step
   * records them and the workflow continues on the existing index.
   */
  sources: z.array(z.string()).min(1),
});

const WorkflowStepSchema = z.discriminatedUnion('type', [ApproveStepSchema, AskStepSchema, ActionStepSchema, SyncStepSchema]);

const ManualTriggerSchema = z.object({
  type: z.literal('manual').default('manual'),
});
const EventTriggerSchema = z.object({
  type: z.literal('event'),
  /** e.g. `object.created`, `skill.completed`, `external.zoom.meeting_ended` */
  event: z.string(),
  filter: z.record(z.string(), z.unknown()).optional(),
});
const ScheduleTriggerSchema = z.object({
  type: z.literal('schedule'),
  /** Standard 5-field cron, UTC — e.g. `0 12 * * 1-5` (weekdays 12:00 UTC). */
  cron: z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/, 'cron must have 5 space-separated fields'),
  /** Optional fixed input passed to every scheduled run. */
  input: z.record(z.string(), z.unknown()).optional(),
});

const WorkflowTriggerSchema = z.discriminatedUnion('type', [ManualTriggerSchema, EventTriggerSchema, ScheduleTriggerSchema]);

/* ----------------------------------------------------------------
 * Automation manifest — the WHEN of the system
 * ---------------------------------------------------------------- */

/**
 * An automation binds a trigger to a piece of work:
 *   when: {schedule: '<cron UTC>'} | {event: '<type>', filter?}
 *   do:   {workflow: '<slug>', input?} | {checkMission: '<slug>'}
 *
 * Missions and workflows contain NO trigger logic — missions are pure
 * goals, workflows are pure procedures. Automations are the only place
 * time and events live.
 */
/**
 * Trust ladder rules — workspace/<org>/trust.yaml. A pending proposal whose
 * confidence >= autoApproveAbove on an ENABLED rule executes without review
 * (audited). Keep rules few and thresholds high; disable to revert.
 */
export const TrustManifestSchema = z.object({
  rules: z.array(z.object({
    action: z.string().describe('registered action id, e.g. hubspot.update'),
    autoApproveAbove: z.number().min(0).max(1),
    enabled: z.boolean().default(false),
    /**
     * Where this action kind stands on the autonomy ladder. Optional and
     * additive: omitted, an enabled rule reads as `execute-within-bounds` and
     * a disabled one as `execute-with-approval`. Authoring a rung ABOVE
     * `execute-with-approval` on a disabled rule is refused at apply — the
     * rung and the rule would disagree about what runs.
     */
    rung: z.enum(['observe', 'recommend', 'assist', 'execute-with-approval', 'execute-within-bounds', 'autonomous']).optional(),
    /** Risk tier override for this action; sets how much evidence the next rung takes. */
    risk: z.enum(['low', 'medium', 'high']).optional(),
  })).default([]),
  /**
   * Risk tier overrides for action kinds that have no rule yet — a workspace
   * that considers `hubspot.update` high-risk says so here, and the ladder
   * asks for high-tier evidence before it will ever promote it.
   */
  risk: z.record(z.string(), z.enum(['low', 'medium', 'high'])).optional(),
});
export type TrustManifest = z.infer<typeof TrustManifestSchema>;

/**
 * Voice rules — workspace/<org>/voice.yaml.
 *
 * The workspace's own banned constructions, versioned in the same repo as the
 * playbooks that describe the voice. Core ships a conservative platform floor
 * (`libs/writing/voiceRules.ts`); this file is where the sharp edges live,
 * because what counts as a tell is a property of the person signing the note,
 * not of the platform.
 *
 * Applied onto `project.voice_rules` and enforced by `lintCopy` at every seam
 * that produces outbound copy — so a banned phrase is a validation failure,
 * not a hope.
 */
export const VoiceManifestSchema = z.object({
  /** Constructions that must never appear in outbound copy. */
  never: z.array(z.object({
    /** The literal phrase, or a regex source when `match: regex`. */
    pattern: z.string().min(1),
    /** How `pattern` is read. Phrases are case-insensitive and word-boundary aware. */
    match: z.enum(['phrase', 'regex']).default('phrase'),
    /** Why. Handed to the model on the corrective retry and shown to reviewers. */
    reason: z.string().min(1),
    /** Optional stable handle, for referring to this rule in review. */
    id: SlugSchema.optional(),
  })).default([]),
  /** Softer steers. Reported, never blocking. */
  prefer: z.array(z.object({
    pattern: z.string().min(1),
    match: z.enum(['phrase', 'regex']).default('phrase'),
    /** What to write instead. */
    use: z.string().min(1),
    reason: z.string().optional(),
  })).default([]),
  /** Platform-default rule ids this workspace deliberately permits. */
  allow: z.array(z.string().min(1)).default([]),
  maxWordsPerSend: z.number().int().positive().optional(),
  maxAsksPerSend: z.number().int().min(0).optional(),
  noExclamation: z.boolean().optional(),
  noEmoji: z.boolean().optional(),
  noEmDash: z.boolean().optional(),
  /**
   * The playbook slug that describes this voice in prose. Composed into the
   * rewrite prompt so a reviewer's "Add change" gets the workspace's voice
   * instead of a generic house style. Core never hardcodes a slug.
   */
  playbook: SlugSchema.optional(),
  /**
   * The learnings step that reviewer edit-diffs land in as proposed rules.
   * Unset means edit-diffs are not mined — a voice rule must never be filed
   * into an unrelated step, so this is opt-in and named.
   */
  learningStep: SlugSchema.optional(),
});
export type VoiceManifest = z.infer<typeof VoiceManifestSchema>;

/**
 * Operating intent, authored at workspace/<org>/operating-intent.yaml.
 *
 * The highest-leverage thing a person does is not approving individual work.
 * It is saying what they want: what we are trying to achieve now, what beats
 * what, what the factory may not do without asking, what it may spend, and
 * which classes of action may proceed unattended.
 *
 * Workspace-as-code rather than a settings screen, for the same reason the
 * playbooks are: it is versioned, it is diffable, a change to it is a commit
 * with a reason on it, and the agents read the same file a person edits. A
 * priority nobody can point at is not a priority.
 *
 * Applied onto `project.operating_intent` and composed into the system prompt
 * of every agent in a workspace that states one
 * (`services/agents/harness.ts`, `operatingIntentPromptNote`). A workspace
 * that has authored nothing gets no section at all, because a section saying
 * there are no constraints is a claim nobody made.
 */
export const OperatingIntentManifestSchema = z.object({
  /**
   * What we are trying to achieve now, most important first. One line each,
   * stated as an outcome a person could later say yes or no to.
   */
  outcomes: z.array(z.object({
    /** The outcome, in one line. */
    statement: z.string().min(1),
    /** Why it matters now, when that is not obvious from the statement. */
    because: z.string().optional(),
    /** When it is meant to be true by, as a plain date or a phrase like "this quarter". */
    by: z.string().optional(),
  })).default([]),
  /**
   * What beats what. Ordered, most important first: the list IS the ranking,
   * so an agent choosing between two candidates reads down it rather than
   * comparing two integers.
   */
  priorities: z.array(z.object({
    /** The thing that is being ranked, in the workspace's own words. */
    statement: z.string().min(1),
    /** What it beats, when the comparison is the point ("reliability over a second product"). */
    over: z.string().optional(),
  })).default([]),
  /**
   * What the factory may NOT do without asking. Each is a refusal, not a
   * preference: an agent that finds itself about to do one of these raises an
   * ask and stops.
   */
  constraints: z.array(z.object({
    /** The thing that must not happen unattended. */
    statement: z.string().min(1),
    /** Why, so the ask that quotes it can explain itself. */
    because: z.string().optional(),
  })).default([]),
  /**
   * Spend allowed without asking, per window. ADVISORY as of this version:
   * it is composed into the prompts of the agents that choose work, and it is
   * not enforced by the run budget. `services/autonomy` owns the enforced
   * caps, and a figure here that disagrees with those caps does not override
   * them.
   */
  budget: z.object({
    /** The ceiling, in cents, for the window below. */
    limitCents: z.number().int().min(0),
    /** The window the ceiling applies to. */
    window: z.enum(['day', 'week', 'month']),
    /** What the ceiling covers and what it does not, in one line. */
    note: z.string().optional(),
  }).optional(),
  /**
   * Which classes of action may proceed unattended. Names action classes in
   * the workspace's own words rather than registered action ids: the trust
   * ladder (`trust.yaml`) is what actually gates an action, and this is the
   * stated intent the ladder is supposed to express. Where the two disagree,
   * the ladder wins and the disagreement is worth fixing.
   */
  autonomy: z.array(z.object({
    /** The class of action, e.g. "routine releases", "answering a question". */
    actionClass: z.string().min(1),
    /** `unattended` proceeds; `ask` raises a decision; `never` does not happen. */
    policy: z.enum(['unattended', 'ask', 'never']),
    /** Why this class sits where it does. */
    because: z.string().optional(),
  })).default([]),
  /**
   * Product judgment the agents cannot derive from records: taste, standing
   * calls, things that were tried and did not work, what "good" means here.
   * Free prose, one note each.
   */
  productJudgment: z.array(z.string().min(1)).default([]),
  /** When this was last reviewed by a person, so a stale intent reads as stale. */
  reviewedAt: z.string().optional(),
});
export type OperatingIntentManifest = z.infer<typeof OperatingIntentManifestSchema>;

export const AutomationManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'disabled']).default('active'),
  /**
   * Owning agent slug. For `checkMission` the owner is implied by the
   * mission's own `agent`, so this is optional; for `job`/`workflow`
   * automations, which carry no mission, set it so the schedule rolls up to a
   * visible agent instead of running ownerless. Validated to exist.
   */
  agent: SlugSchema.optional(),
  when: z.object({
    /** 5-field cron, UTC. */
    schedule: z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/, 'schedule must be a 5-field cron').optional(),
    /** Event type, e.g. `prospect.reply`. */
    /** One event type, or several — the automation fires on any of them. */
    event: z.union([z.string(), z.array(z.string().min(1)).min(1)]).optional(),
    /** Payload filter for event-whens: every key must equal the payload's value. */
    filter: z.record(z.string(), z.unknown()).optional(),
    /**
     * Ceiling on event fires in a rolling ten-minute window (default 6).
     * Beyond it the fires are held and coalesced into one run after the
     * window. Event-whens only — a schedule fires on its cron.
     */
    maxFiresPer10m: z.number().int().min(1).max(1000).optional(),
  }).refine(w => !!w.schedule !== !!w.event, { message: 'when must have exactly one of schedule | event' }).refine(w => w.maxFiresPer10m === undefined || !!w.event, { message: 'when.maxFiresPer10m applies to event-whens only — a schedule fires on its cron' }),
  do: z.object({
    workflow: z.string().optional(),
    checkMission: z.string().optional(),
    /** Built-in server job (deterministic, not an agent). */
    job: z.string().optional(),
    /**
     * Execution prompt for `checkMission` fires — WHAT to do on this cadence.
     * The mission stays the standing context (charter, working notes); the
     * automation carries the marching orders. Falls back to the generic
     * scheduled-check brief when omitted.
     */
    prompt: z.string().optional(),
    /** Fixed input passed to the workflow run / job. */
    input: z.record(z.string(), z.unknown()).optional(),
  }).refine(
    d => [d.workflow, d.checkMission, d.job].filter(Boolean).length === 1,
    { message: 'do must have exactly one of workflow | checkMission | job' },
  ).refine(
    d => !d.prompt || !!d.checkMission,
    { message: 'do.prompt requires do.checkMission — only mission checks carry an execution prompt' },
  ),
});
export type AutomationManifest = z.infer<typeof AutomationManifestSchema>;

export const WorkflowManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['active', 'disabled', 'draft']).default('active'),
  version: z.number().int().positive().default(1),
  /** Owning agent slug — the agent this procedure belongs to. Validated to exist. */
  agent: SlugSchema.optional(),
  trigger: WorkflowTriggerSchema,
  steps: z.array(WorkflowStepSchema).min(1),
  /** Optional input JSON Schema for manual triggers. */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type WorkflowManifest = z.infer<typeof WorkflowManifestSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

/** Mission templates — open-ended team work starting points. */
export const MissionManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['active', 'disabled', 'draft']).default('active'),
  version: z.number().int().positive().default(1),
  goal: z.string(),
  /**
   * The single agent that owns this mission. If it's a lead
   *  (via agent.parent_agent_slug reverse-lookup), that lead's specialists
   *  are the team the runtime can hand off to.
   */
  agent: z.string(),
  autonomyPolicy: z.object({ level: z.number().int().min(1).max(5).default(1) }).default({ level: 1 }),
  successCriteria: z.array(z.string()).default([]),
  desiredArtifacts: z.array(z.string()).default([]),
  /**
   * A mission is a STANDING responsibility, not a one-off. When `schedule`
   * is set (5-field cron, UTC), the team's lead checks the charter on that
   * cadence: review current state, do only what's needed now — via
   * workflows, skills, tools, or open-ended agent work — and report.
   * Each check is one mission run (mode: check, no planner).
   */
  schedule: z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/, 'schedule must be a 5-field cron').optional(),
});
export type MissionManifest = z.infer<typeof MissionManifestSchema>;

// Re-export InterpolatableStringSchema for step authors who want to type inputs explicitly.
export { InterpolatableStringSchema };

/**
 * A metadata key as it may be inlined into a `metadata ->> 'key'` expression:
 * a rollup's link fields reach the database as literals, so the grammar is
 * what makes that safe rather than a convention.
 */
const MetaKeySchema = z.string().regex(/^[a-z_]\w*$/i, {
  message: 'a metadata key is letters, digits and underscores',
});

/**
 * Which of a parent's children one rollup counts. `field` is either `status`
 * (the object's own column, which is where a task's `accepted`, `rejected`
 * and `abandoned` live) or a metadata key. `in` lists the values that
 * qualify. Omitted, every child counts, which is what the cost rollups want.
 *
 * This is what lets one type carry two figures over the same children: a
 * request's `actualCents` is every task it took, and its `reworkCents` is
 * only the tasks that were thrown away.
 */
export const RollupWhereSchema = z.object({
  field: MetaKeySchema,
  in: z.array(z.string()).min(1),
});

/**
 * One figure this type carries that is COMPUTED from another type's rows:
 * the sum of a child field, the earliest of a child date, or the count of
 * children, rather than typed.
 *
 * The link runs one of three ways: `by` names the child's field that holds
 * this record's id (`engineering_task.requestId` → `request`), `ids` names
 * this record's field that lists child ids (`release.taskIds`), and `inList`
 * names the child's field that LISTS this record's id (`release.requestIds`
 * → `request`, which is how a request learns when it shipped). Core
 * recomputes every rollup that reaches a child when that child is written,
 * and stamps `rollupsUpdatedAt` beside the figures; a page reads them like
 * any other metadata. Nothing here reaches the database schema; the
 * declaration is read from the type file at the moment it is needed, the way
 * pages are.
 */
export const RollupSchema = z.object({
  /** The metadata key written on THIS type. */
  field: MetaKeySchema,
  from: z.object({
    /** The child object type. */
    type: SlugSchema,
    /** The child's metadata key holding this record's id. */
    by: MetaKeySchema.optional(),
    /** This record's metadata key listing child ids. */
    ids: MetaKeySchema.optional(),
    /** The child's metadata key whose list of ids contains this record's. */
    inList: MetaKeySchema.optional(),
    /**
     * With `by`: THIS record's metadata key the child's `by` value names,
     * instead of this record's id. A request names its product by slug
     * (`product: send`), not by row id, so the product's rollups over its
     * requests join `by: product` to `match: slug` (2026-09-24).
     */
    match: MetaKeySchema.optional(),
  })
    .refine(l => [l.by, l.ids, l.inList].filter(v => v !== undefined).length === 1, { message: 'a rollup link names exactly one of `by` (the child points here), `ids` (this record lists its children) or `inList` (the child lists this record)' })
    .refine(l => l.match === undefined || l.by !== undefined, { message: '`match` only makes sense with `by`: the child names this record by the value under `match`' }),
  /** The child's metadata key to sum. Omitted with no `min`/`max`, the rollup is a count of children. */
  sum: MetaKeySchema.optional(),
  /** The child's date key whose EARLIEST value is written, as an ISO string. */
  min: MetaKeySchema.optional(),
  /** The child's date key whose LATEST value is written, as an ISO string. */
  max: MetaKeySchema.optional(),
  /** Which children count; see {@link RollupWhereSchema}. */
  where: RollupWhereSchema.optional(),
}).refine(r => [r.sum, r.min, r.max].filter(v => v !== undefined).length <= 1, { message: 'a rollup is a sum, a min, a max or a count of children, not two of them' });
export type Rollup = z.infer<typeof RollupSchema>;

/**
 * One thing a record must satisfy to cross a gate. Grown on 2026-09-25 to
 * express the two gates that were TypeScript until then (backlog 011): a
 * requirement can apply only `if` another field has one of some values, can
 * demand that `allItems` of a list carry a field equal to a value, can pass
 * when `anyOf` several alternatives pass, and can say something different for
 * each bad value (`valueMessages`) and for a missing one (`missingMessage`).
 * Messages may carry `{to}`, `{value}`, `{days}`, `{unmet}`, `{total}` and
 * `{first}`.
 */
export type GateRequirementManifest = {
  field: string;
  present?: boolean;
  minItems?: number;
  oneOf?: string[];
  maxAgeDays?: number;
  allItems?: { field: string; equals: string | number | boolean; label?: string };
  anyOf?: GateRequirementManifest[];
  if?: { field: string; oneOf: string[] };
  valueMessages?: Record<string, string>;
  missingMessage?: string;
  message?: string;
};
const GateRequirementSchema: z.ZodType<GateRequirementManifest> = z.lazy(() => z.object({
  field: z.string().min(1),
  present: z.boolean().optional(),
  minItems: z.number().int().min(0).optional(),
  oneOf: z.array(z.string()).min(1).optional(),
  maxAgeDays: z.number().min(0).optional(),
  allItems: z.object({ field: z.string().min(1), equals: z.union([z.string(), z.number(), z.boolean()]), label: z.string().min(1).optional() }).optional(),
  anyOf: z.array(GateRequirementSchema).min(2).optional(),
  if: z.object({ field: z.string().min(1), oneOf: z.array(z.string()).min(1) }).optional(),
  valueMessages: z.record(z.string(), z.string()).optional(),
  missingMessage: z.string().optional(),
  message: z.string().optional(),
}).refine(r => r.present || r.minItems !== undefined || r.oneOf || r.maxAgeDays !== undefined || r.allItems || r.anyOf, { message: 'a requirement needs present, minItems, oneOf, maxAgeDays, allItems or anyOf' }));

/**
 * The judgement half of a gate: after the deterministic checks pass, one
 * model call reads the record against the seat's rubric (a skill) and, when
 * named, the reference cases (an eval dataset), and says pass, return, or
 * escalate to a person. The workspace steers the numbers (`defaults.gates`).
 */
export const GateJudgeSchema = z.object({
  rubric: z.string().min(1).describe('skill slug — the seat\'s one-page rubric'),
  cases: z.string().min(1).optional().describe('eval dataset slug — the reference cases the judge is calibrated on'),
  /** Below this confidence in its own verdict, the judge escalates to a person instead of deciding. */
  escalateBelow: z.number().min(0).max(1).default(0.6),
  /** How often the judge runs at all; 1 = every crossing. Autonomy earned lowers it. */
  sampleRate: z.number().min(0).max(1).default(1),
  /** Field values that always go to a person whatever the judge says (e.g. riskClass: [schema, billing]). */
  alwaysEscalate: z.record(z.string(), z.array(z.string())).optional(),
});

export const HandoffGateSchema = z.object({
  name: z.string().min(1),
  when: z.object({ field: z.string().min(1), becomes: z.array(z.string().min(1)).min(1) }),
  producedBy: z.string().min(1).describe('the agent slug whose work this is — where a failure is returned'),
  require: z.array(GateRequirementSchema).min(1),
  judge: GateJudgeSchema.optional(),
});

export const ObjectTypeManifestSchema = z.object({
  slug: SlugSchema,
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for metadata shape'),
  sourceRelevance: z.record(z.string(), z.number()).optional(),
  classificationPromptFile: z.string().optional(),
  classificationPrompt: z.string().optional(),
  fewShotExamples: z.array(FewShotExampleSchema).default([]),
  /** Figures computed from another type's rows — see {@link RollupSchema}. */
  rollups: z.array(RollupSchema).optional(),
  /**
   * HANDOFF GATES: what must be on a record before it may cross a transition,
   * and which seat the record goes back to when it is not
   * (`libs/gates/handoffGate.ts`). Declared here by the plugin, steered by
   * the workspace, enforced where the record is written — never a prompt.
   */
  gates: z.array(HandoffGateSchema).optional(),
});
export type ObjectTypeManifest = z.infer<typeof ObjectTypeManifestSchema>;

/**
 * Playbook frontmatter schema (v0.2).
 *
 * A Playbook is a markdown + YAML procedural guide that the agent
 * reads on demand from its virtual filesystem at
 * `/playbooks/<slug>/SKILL.md`. The file's YAML frontmatter must
 * validate against this schema. The body is the agent-facing playbook
 * content — sections, rules, examples, anti-patterns — written as if
 * for a smart human collaborator.
 *
 * Naming note: the on-disk filename is `SKILL.md` (rather than
 * `playbook.md`) because deepagents's `createSkillsMiddleware` looks
 * for that exact name when lazy-loading on `task` activation. The
 * external concept is "Playbook"; the internal deepagents filename
 * is `SKILL.md`.
 */
/**
 * LearningStep authoring schema (v0.2). Each
 * `workspace/<org>/learnings/<name>.yaml` declares one named step
 * (`global`, `meeting_triage`, ...). Steps are whitelisted via this
 * authoring path so the rule store doesn't drift into a junk drawer.
 */
/**
 * Eval dataset authoring schema (v0.2). Each
 * `workspace/<org>/evals/<slug>.yaml` declares one dataset.
 */
/**
 * Whether a dot path names one value rather than every item of a list. A
 * `where` filter needs a single answer per call, so `*` is refused there.
 * @param path - A dot path from the manifest.
 */
function readsOneValue(path: string): boolean {
  return !path.split('.').includes('*');
}

/**
 * How many `*` segments a dot path has.
 * @param path - A dot path from the manifest, or nothing.
 */
function countEveryItem(path: string | undefined): number {
  return path ? path.split('.').filter(segment => segment === '*').length : 0;
}

/**
 * One `where` filter on a `toolCalledWith` or `toolReturned` check. `present: false` exists so
 * a rule can step around the one legitimate exception to it — a series
 * refresh, which is the only event proposal carrying a `recurrence`, keeps
 * its first `startDate` even when that day has passed.
 */
const ToolCallFilterSchema = z.object({
  path: z.string().refine(readsOneValue, { message: 'a where path reads one value; a * segment only belongs in path' }),
  equals: z.unknown().optional(),
  present: z.boolean().optional(),
}).refine(
  filter => filter.equals !== undefined || filter.present !== undefined,
  { message: 'a where filter needs equals or present — otherwise it matches every call' },
);

/**
 * The condition a `toolCalledWith` or `toolReturned` check carries. The two
 * differ only in what `path` and `timezoneFrom` read — the call's arguments
 * or what the tool handed back — so they share one shape and one set of
 * refusals.
 * @param checkName - The check's key, for the refusal message.
 * @param readsFrom - What `path` reads, for the field descriptions.
 */
function toolConditionSchema(checkName: 'toolCalledWith' | 'toolReturned', readsFrom: string) {
  return z.object({
    tool: z.string(),
    where: z.union([ToolCallFilterSchema, z.array(ToolCallFilterSchema).min(1)]).optional().describe('only the calls whose arguments match this filter, or every filter in a list — one tool often files several kinds of thing'),
    noCalls: z.enum(['fail', 'pass']).optional().describe('what no matching call means; fail by default'),
    path: z.string().optional().describe(`dot path into ${readsFrom}; a * segment means every item of a list`),
    equals: z.unknown().optional(),
    contains: z.string().optional(),
    present: z.boolean().optional(),
    subsetOf: z.array(z.string()).optional().describe('every element at the path must be one of these'),
    onOrAfter: z.string().refine(isRelativeDay, { message: 'onOrAfter must be today, yesterday, tomorrow, last/next week|month|year, "N days|weeks|months|years ago", "in N days|weeks|months|years", or YYYY-MM-DD' }).optional().describe('the date at the path must fall on or after this day, resolved when the check runs'),
    onOrBefore: z.string().refine(isRelativeDay, { message: 'onOrBefore must be today, yesterday, tomorrow, last/next week|month|year, "N days|weeks|months|years ago", "in N days|weeks|months|years", or YYYY-MM-DD' }).optional().describe('the date at the path must fall on or before this day, resolved when the check runs'),
    timezone: z.string().refine(isDayZone, { message: 'timezone must be utc, local, workspace, or an IANA zone like America/New_York' }).optional().describe('which zone "today" is in for onOrAfter and onOrBefore; utc by default'),
    timezoneFrom: z.string().min(1).optional().describe(`dot path into ${readsFrom} naming the zone; a * means the same item path is on; timezone applies when it names none`),
    calls: z.enum(['every', 'some']).optional().describe('how many of the tool\'s calls must match; every by default'),
  }).refine(
    condition => condition.equals !== undefined
      || condition.contains !== undefined
      || condition.present !== undefined
      || condition.subsetOf !== undefined
      || condition.onOrAfter !== undefined
      || condition.onOrBefore !== undefined,
    { message: `${checkName} needs one of equals, contains, present, subsetOf, onOrAfter or onOrBefore — otherwise it asserts nothing` },
  ).refine(
    // Each `*` in timezoneFrom is the item the matching `*` in path is on, so
    // it cannot have more of them than path does — there would be no item to
    // stand for.
    condition => countEveryItem(condition.timezoneFrom) <= countEveryItem(condition.path),
    { message: 'timezoneFrom has more * segments than path; each * in timezoneFrom stands for the item the matching * in path is on' },
  );
}

/**
 * One deterministic check we run ourselves.
 *
 * A closed list, deliberately. Arbitrary code in a manifest would need a
 * sandbox and a timeout and would be a way out of the app; this covers what
 * people mean by "check it actually did the thing", and the escape hatch for
 * anything beyond it is an AgentCore `codeBased` evaluator — a Lambda the
 * customer owns and deploys.
 */
const EvalCheckSchema = z.union([
  z.object({ toolCalled: z.string() }),
  z.object({ toolNotCalled: z.string() }),
  z.object({
    /**
     * What a tool call's arguments had to look like. The tool name and the
     * answer text were all a check could read before this, which left the
     * envelope shape, the dedup key and the suggested decision — all of them
     * arguments — measurable by nothing we have.
     */
    toolCalledWith: toolConditionSchema('toolCalledWith', 'the call\'s arguments, e.g. action_input.dedupOn'),
  }),
  z.object({
    /**
     * What the tool handed back had to look like. Arguments say what the
     * agent asked for; only the return says whether it got what it needed —
     * a lookup that returns records without their ids leaves the agent
     * unable to write anything back to them.
     */
    toolReturned: toolConditionSchema('toolReturned', 'the tool\'s return value, parsed as JSON, e.g. *.id'),
  }),
  z.object({
    /** How many times the tool was allowed to be called. */
    toolCallCount: z.object({
      tool: z.string(),
      exactly: z.number().int().nonnegative().optional(),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    }).refine(
      condition => condition.exactly !== undefined || condition.min !== undefined || condition.max !== undefined,
      { message: 'toolCallCount needs one of exactly, min or max — otherwise it asserts nothing' },
    ),
  }),
  z.object({ outputMatches: z.string().describe('regular expression the answer must match') }),
  z.object({ outputContains: z.string() }),
  z.object({ outputNotContains: z.string() }),
  z.object({ latencyUnderMs: z.number().int().positive() }),
  z.object({ turnsUnder: z.number().int().positive() }),
]);

/** A rating scale for a custom judge. Mirrors AgentCore's `RatingScale` union. */
const RatingScaleSchema = z.union([
  z.object({
    categorical: z.array(z.object({
      label: z.string(),
      value: z.number(),
      description: z.string().optional(),
    })).min(1),
  }),
  z.object({
    numerical: z.array(z.object({
      value: z.number(),
      description: z.string().optional(),
    })).min(1),
  }),
]);

/**
 * Who grades this dataset, and with what.
 *
 * Three shapes, because the providers genuinely differ:
 *
 * - `provider: vocion` — our own judge and the `checks` on each case. Nothing
 *   else to configure.
 * - `provider: agentcore` with `builtin` — AWS's own evaluators, named by id.
 *   `TrajectoryInOrderMatch` and friends cost no tokens; the rest are judges
 *   and do.
 * - `provider: agentcore` with `instructions` — a custom judge we create in
 *   the customer's AWS account, so AgentCore stays the single place those run.
 *
 * `lambdaArn` is accepted and stored but nothing in this repo deploys it: a
 * `codeBased` evaluator is a Lambda the customer builds themselves, and we
 * only reference it. See `docs/guides/agentcore-evals.md`.
 */
const EvalEvaluatorManifestSchema = z.object({
  provider: z.string().describe('vocion | agentcore'),
  slug: SlugSchema.optional().describe('name for a custom evaluator; omit for built-ins'),
  builtin: z.array(z.string()).optional().describe('AWS evaluator ids, e.g. Builtin.ToolSelectionAccuracy'),
  level: z.enum(['TOOL_CALL', 'TRACE', 'SESSION']).optional(),
  instructions: z.string().optional().describe('grading prompt for a custom judge'),
  ratingScale: RatingScaleSchema.optional(),
  model: z.string().optional().describe('which model judges; the provider default when omitted'),
  lambdaArn: z.string().optional().describe('an existing Lambda the customer deployed; referenced, never created'),
});

export const EvalDatasetManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  agentSlug: z.string().describe('which agent slug this dataset evaluates'),
  version: z.number().int().positive().default(1),
  /**
   * Which grader scores this dataset — one, not several.
   *
   * `vocion` is our own judge and the default, so every dataset authored
   * before this field existed keeps behaving the same way. `agentcore` sends
   * the transcript to AWS. To compare the two, copy the dataset and point the
   * copy at the other grader: then the comparison is something someone set up
   * on purpose, with its own history, rather than two disagreeing numbers on
   * one page.
   */
  provider: z.enum(['vocion', 'agentcore']).default('vocion'),
  /**
   * The pass rate this dataset has to reach for `eval:run` to exit 0.
   *
   * A single number for the whole dataset, not a bar every case has to clear,
   * because a dataset spread across a dozen live sources will lose a case to
   * one of them redesigning a page, and a gate that fails the build for that
   * teaches people to ignore the gate. Omitted, the runner's own floor
   * applies, so every dataset written before this field keeps its behaviour.
   */
  passThreshold: z.number().min(0).max(1).optional().describe('pass rate the run must reach, 0 to 1'),
  /**
   * The evaluators this dataset's grader should use. Each one names its own
   * provider, which must be the dataset's — a dataset scored by Vocion cannot
   * carry an AgentCore evaluator, because nothing would ever run it.
   */
  evaluators: z.array(EvalEvaluatorManifestSchema).optional(),
  items: z.array(z.object({
    // A case with nothing to say has nothing to measure: the agent is never
    // called, and a grader that keeps its own copy of the dataset refuses the
    // whole file. Refusing it here names the file and the case instead.
    input: z.string().trim().min(1, 'an eval case needs an input to send the agent').describe('the user message to send to the agent'),
    expectedOutput: z.string().optional().describe('substantive-equivalence guidance, not literal match'),
    rubric: z.string().optional().describe('per-case rubric the judge uses'),
    tags: z.array(z.string()).optional(),
    /**
     * The tools this case should call, in order. Ground truth for AgentCore's
     * trajectory evaluators, which are the only scoring it does without a
     * model call.
     */
    expectedTrajectory: z.array(z.string()).optional(),
    /**
     * Facts the answer must state. Read by a judge model, not string-matched —
     * these make the judge's task well defined, they do not replace it. For a
     * real string comparison use `checks`.
     */
    assertions: z.array(z.string()).optional(),
    /** Deterministic checks run in this process. No model, no AWS account. */
    checks: z.array(EvalCheckSchema).optional(),
  })).min(1),
}).superRefine((dataset, ctx) => {
  // An evaluator whose provider is not the dataset's would never run: nothing
  // asks that grader for a score. Better to refuse the file than to apply it
  // and leave someone waiting for a number that cannot arrive.
  for (const evaluator of dataset.evaluators ?? []) {
    if (evaluator.provider !== dataset.provider) {
      ctx.addIssue({
        code: 'custom',
        path: ['evaluators'],
        message: `evaluator "${evaluator.slug ?? evaluator.builtin?.join(', ') ?? 'unnamed'}" is for ${evaluator.provider}, but this dataset is graded by ${dataset.provider}`,
      });
    }
  }

  // `checks` used to be refused on anything but a Vocion dataset, because
  // only the Vocion grader ran them. They now run over the transcript
  // whichever grader scores the case — the transcript is ours either way —
  // so a dataset can send its cases to AWS and still assert the things a
  // model should never be asked to judge, like whether the dedup key had the
  // right three fields in it.
});
export type EvalDatasetManifest = z.infer<typeof EvalDatasetManifestSchema>;
export type EvalEvaluatorManifest = z.infer<typeof EvalEvaluatorManifestSchema>;

export const LearningStepManifestSchema = z.object({
  name: SlugSchema,
  title: z.string(),
  description: z.string(),
  /** Long-form intro shown above the rule list. Markdown allowed. */
  preamble: z.string().optional(),
  /** Which agent slugs own / read this step. */
  agents: z.array(z.string()).default([]),
  /**
   * SEED rules shipped with the workspace. Applied once each (keyed on
   * `workspace:<id>` in the store entry's meta.source); later edits to a
   * seeded rule's text are applied as updates. Rules people add at runtime
   * live only in the DB and are never touched by apply.
   */
  rules: z.array(z.object({ id: SlugSchema, text: z.string().min(1) })).default([]),
  /**
   * Scope this namespace narrower than the workspace: `kind: agent` +
   * `ref: revenue-lead` makes it that agent's own bucket
   * (agents/revenue-lead/<name>), mounted for that agent alone. Omitted =
   * workspace scope, mounted by the agents that name this step.
   */
  scope: z.object({
    kind: z.enum(['agent', 'user', 'object', 'workflow', 'mission']),
    ref: z.string().min(1),
  }).optional(),
});
export type LearningStepManifest = z.infer<typeof LearningStepManifestSchema>;

export const PlaybookManifestSchema = z.object({
  /**
   * The folder slug, and — because deepagents mounts this folder as an Agent
   * Skill — the name that specification validates. Stricter than `SlugSchema`
   * on purpose: underscores, doubled hyphens and trailing hyphens are legal
   * Vocion slugs and illegal skill names, and a workspace that ships one makes
   * the runtime log a spec warning on every single turn. Failing here, once,
   * at `workspace:check`, is the whole point (CLAUDE.md — fail loudly at apply
   * time rather than warn at runtime).
   */
  slug: AgentSkillSlugSchema,
  name: z.string().describe('Human-readable name for catalog UI. Mounted as `title`; the mounted `name` is the slug, per the Agent Skills spec — see libs/skills/name.ts.'),
  description: z.string().describe('One-line summary the agent reads to decide when to activate this skill or playbook.'),
  /**
   * Playbook slugs this skill attaches (skill folders only). A playbook
   * named here travels wherever the skill is switched on. Each slug must
   * resolve to a playbook the workspace or its base pack ships.
   */
  playbooks: z.array(z.string()).default([]),
  version: z.number().int().positive().default(1),
  /**
   * Sibling resource files (e.g. `REFERENCE.html`, `COMPONENTS.md`,
   * `examples/*.json`) that the playbook references. Listed here so
   * the catalog row is aware of them; the runtime mount helper picks
   * them up from the same folder regardless.
   */
  resources: z.array(z.string()).default([]),
  /**
   * Optional license string (e.g. `proprietary`, `Apache-2.0`,
   * `client:metacto`). Surfaced in the catalog so partners can
   * filter / audit by license.
   */
  license: z.string().optional(),
});
export type PlaybookManifest = z.infer<typeof PlaybookManifestSchema>;

export const SourceManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string().describe('Human-readable name shown in the Sources page.'),
  description: z.string().optional().describe('One-line summary for the catalog UI.'),
  /**
   * Connector kind — must match a registered connector in
   * `libs/sources/registry`. Built-ins: `web`, `local-files`. Authored
   * sources can use a *labelled* kind (e.g. `zendesk`) that routes
   * through a built-in connector at the registry level when no live
   * implementation is wired yet — see the support-reply demo's
   * `sources/zendesk.yaml` for the Stripe-style test-mode pattern.
   */
  kind: z.string().describe('Connector kind. Maps to a SourceConnector slug.'),
  /** Resolved per-connector config (validated against the connector\'s configSchema at apply time). */
  config: z.record(z.string(), z.unknown()).default({}),
  /**
   * Sync schedule (cron expression) for Temporal scheduled syncs. When
   * omitted, the source only syncs on manual trigger via /dashboard/connectors.
   */
  schedule: z.string().optional().describe('Cron expression for scheduled sync. Manual-only when omitted.'),
  /**
   * Cron for a periodic FULL sync that tombstones records deleted upstream
   * (invisible to incremental syncs). Omitted = the connector's
   * `defaultReconcileCron` applies; `false` disables the reconcile pass.
   */
  reconcileSchedule: z.union([
    z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/, 'reconcileSchedule must be a 5-field cron'),
    z.literal(false),
  ]).optional().describe('Cron for periodic full-sync reconcile. Connector default when omitted; false disables.'),
  /**
   * Per-connection ACL. Omitted = org-wide. `restricted` limits retrieval
   * (chat + search) to the listed member emails; enforced as an
   * intersection at query time. Scheduled team runs keep access.
   */
  access: z.object({
    visibility: z.enum(['org', 'restricted']).default('org'),
    users: z.array(z.string().email()).default([]),
  }).optional(),
  /**
   * A document processor to run over every document this source ingests, and
   * the settings it runs with. The slug names an entry in
   * `libs/processors/registry`; the config is validated against that
   * processor's own schema when the workspace is applied, so a bad setting
   * fails this source's apply instead of every document of every run.
   *
   * `.strict()` so a mistyped key here is reported rather than dropped: the
   * enclosing object silently strips what it does not know, which for a rule
   * the operator believes is in force is the worst way to be wrong.
   */
  processor: z.object({
    slug: z.string().min(1).describe('Processor slug. Maps to a registered DocumentProcessor.'),
    config: z.record(z.string(), z.unknown()).default({}),
  }).strict().optional(),
  enabled: z.boolean().default(true),
});
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
