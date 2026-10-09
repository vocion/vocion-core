/**
 * ACTION GATES — a second reader on what an agent is about to publish.
 *
 * A plugin declares a gate on the actions that publish outside the workspace
 * (`plugin.yaml` `actionGates:`, `ActionGateSchema`): before an agent's
 * proposal of one is queued or run, a CRITIC reads what it would publish
 * against the workspace's voice and its facts, and returns TYPED findings —
 * each a severity, the rule it breaks, the words quoted, why, and the fix.
 * Code routes on those fields, never on the critic's prose:
 *
 *  - pass:     nothing serious — the proposal goes on to the trust ladder as
 *              it would have, with any minor findings on its record.
 *  - return:   serious findings, and the work has not been returned yet —
 *              it goes back to the agent that wrote it, with the findings,
 *              to revise once. Nothing is queued; the return is on the
 *              ledger as a run the gate closed, so it can be counted.
 *  - escalate: serious findings on a draft already returned (or a critic
 *              that could not read it) — a person decides, with the
 *              findings on the card, whatever the trust ladder says.
 *  - advise:   the person's own word. A check informs and never stops a
 *              person (CLAUDE.md, "Accelerate, never block"): the action
 *              runs as they asked and the findings travel with it as advice.
 *
 * `critic.vendor: different` is the point of the red-team plugin: the model
 * that reads is from a different vendor than the model that wrote, so the
 * two do not share one family's blind spots. The author's vendor is read off
 * its agent's harness; the critic is the first vendor this workspace can
 * reach (its own key first, the server's second — `buildChatModelForOrg`)
 * that is not the author's, and the call is charged to the workspace like any
 * other (`chargeModelCall`). With no other vendor reachable the gate says so
 * on the run and a person reads it — it never quietly passes.
 *
 * The workspace's voice rules (`voice.yaml` over the platform floor) are
 * checked twice: deterministically, by the rule set the workspace authored
 * (`lintCopy` — a blocking rule is a serious finding), and by the critic for
 * what a pattern cannot say. Its facts are the wiki passages that bear on the
 * words (`wikiContextFor`). Core names no action, no vendor preference and no
 * rubric here; the plugin declares them.
 *
 * Everything with a side effect is injectable (`ActionGateDeps`), so the
 * routing is tested without a model or a database.
 */

import type { LangChainProvider } from '@/libs/llm/langchain';
import type { ActionGateManifest } from '@/libs/workspace/schemas';
import type { VoiceRules } from '@/libs/writing/voiceRules';
import { z } from 'zod';

/** How much a finding matters. Serious is what a person would not let go out. */
export type FindingSeverity = 'serious' | 'minor';
/** Which rule the finding is against. */
export type FindingRule = 'voice' | 'fact' | 'claim' | 'other';

export type GateFinding = {
  severity: FindingSeverity;
  rule: FindingRule;
  /** The words, quoted from what would be published. */
  quote: string;
  why: string;
  fix: string;
  /** Who found it: the workspace's authored voice rules, or the critic model. */
  source: 'voice-rules' | 'critic';
};

export type GateVerdict = 'pass' | 'return' | 'escalate' | 'advise';

/** The model family a model comes from — not where it is hosted. */
export type ModelVendor = 'anthropic' | 'openai' | 'amazon' | 'meta' | 'mistral' | 'cohere' | 'unknown';

/** A model the gate can call: how to build it, and whose it is. */
export type CriticChoice = { provider: LangChainProvider; vendor: ModelVendor; model: string };

/** What one gate decided about one proposal — stored on the run, shown on its card. */
export type GateRecord = {
  gate: string;
  label: string;
  plugin: string;
  verdict: GateVerdict;
  findings: GateFinding[];
  author: ModelVendor;
  /** The critic that read it, or null when none could. */
  critic: { vendor: ModelVendor; model: string } | null;
  /** Why the critic did not read it, when it did not. */
  note?: string;
  /** How many times this subject had been returned before this reading. */
  priorReturns: number;
  at: string;
};

/** A gate as a workspace has it on: the manifest and the plugin that declared it. */
export type DeclaredGate = ActionGateManifest & { plugin: string };

/* ------------------------------------------------------------------ */
/* Which gates apply                                                    */
/* ------------------------------------------------------------------ */

/**
 * The gates these plugins declare, in plugin load order.
 * @param plugins - Loaded plugin manifests (`slug` + `actionGates`).
 */
export function declaredActionGates(plugins: ReadonlyArray<{ slug: string; actionGates?: readonly ActionGateManifest[] }>): DeclaredGate[] {
  return plugins.flatMap(p => (p.actionGates ?? []).map(g => ({ ...g, plugin: p.slug })));
}

/**
 * The declared gates that read this action — by its id or any id it was
 * registered under before.
 * @param gates - Declared gates.
 * @param actionIds - The action's id and its aliases.
 */
export function gatesForAction(gates: readonly DeclaredGate[], actionIds: readonly string[]): DeclaredGate[] {
  return gates.filter(g => g.actions.some(a => actionIds.includes(a)));
}

/* ------------------------------------------------------------------ */
/* Vendors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Whose model this is. A provider hosts; a vendor makes: Claude on Bedrock is
 * Anthropic's, Titan on Bedrock is Amazon's. A Bedrock id with no family
 * segment is read as Anthropic's, because every Bedrock default in core is a
 * Claude profile (`libs/llm/langchain.ts`).
 * @param provider - The provider the model is built on, when known.
 * @param model - The model id, when known.
 */
export function vendorOfModel(provider: LangChainProvider | undefined | null, model: string | undefined | null): ModelVendor {
  const id = (model ?? '').toLowerCase();
  if (provider === 'openai' || provider === 'azure-openai') {
    return 'openai';
  }
  if (provider === 'mistral') {
    return 'mistral';
  }
  if (provider === 'anthropic') {
    return 'anthropic';
  }
  if (provider === 'bedrock' || /^(?:us|eu|apac|global)\./.test(id) || /^(?:anthropic|amazon|meta|mistral|cohere)\./.test(id)) {
    for (const family of ['anthropic', 'amazon', 'meta', 'mistral', 'cohere'] as const) {
      if (id.includes(`${family}.`)) {
        return family;
      }
    }
    return !id || id.includes('claude') ? 'anthropic' : 'unknown';
  }
  if (id.startsWith('claude-')) {
    return 'anthropic';
  }
  if (id.startsWith('gpt-') || /^o\d/.test(id)) {
    return 'openai';
  }
  return 'unknown';
}

/**
 * The first critic, in the order given, from a different vendor than the
 * author. An author whose vendor is unknown is never matched by accident:
 * any known vendor is different from it.
 * @param author - The author's vendor.
 * @param candidates - Models this workspace can reach, in preference order.
 */
export function pickCritic(author: ModelVendor, candidates: readonly CriticChoice[]): CriticChoice | null {
  return candidates.find(c => c.vendor !== 'unknown' && c.vendor !== author) ?? null;
}

/* ------------------------------------------------------------------ */
/* Findings                                                             */
/* ------------------------------------------------------------------ */

const CritiqueSchema = z.object({
  findings: z.array(z.object({
    severity: z.enum(['serious', 'minor']),
    rule: z.enum(['voice', 'fact', 'claim', 'other']).catch('other'),
    quote: z.string().default(''),
    why: z.string().default(''),
    fix: z.string().default(''),
  })).default([]),
});

/**
 * Read the critic's answer: one JSON object of typed findings. Anything that
 * does not parse is `null` — "could not read it" — never an empty pass.
 * @param raw - The model's output.
 */
export function parseCritique(raw: string): GateFinding[] | null {
  const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = CritiqueSchema.safeParse(JSON.parse(stripped.slice(start, end + 1)));
    if (!parsed.success) {
      return null;
    }
    return parsed.data.findings.map(f => ({
      severity: f.severity,
      rule: f.rule,
      quote: f.quote.slice(0, 400),
      why: f.why.slice(0, 500),
      fix: f.fix.slice(0, 500),
      source: 'critic' as const,
    }));
  } catch {
    return null;
  }
}

/**
 * The workspace's authored voice rules as findings: a blocking rule is
 * serious, a `prefer` steer is minor. Pure; the rules are the workspace's own.
 * @param violations - `lintCopy(text, rules).violations`.
 */
export function voiceFindings(violations: ReadonlyArray<{ span: string; reason: string; blocking: boolean; kind: string }>): GateFinding[] {
  return violations.map(v => ({
    severity: v.blocking ? 'serious' : 'minor',
    rule: 'voice',
    quote: v.span,
    why: v.reason,
    fix: v.kind === 'prefer' ? v.reason : 'Rewrite this line without it.',
    source: 'voice-rules',
  }));
}

/**
 * ROUTE ON THE TYPED FINDINGS. The one decision, pure.
 * @param input - What the gate knows.
 * @param input.findings - Everything found.
 * @param input.onPersonsWord - The person asked for this themselves.
 * @param input.criticRan - The critic read it (false: none reachable, or its answer unreadable).
 * @param input.priorReturns - Times this subject was returned before.
 * @param input.returns - Times the gate returns before a person decides.
 */
export function routeFindings(input: { findings: readonly GateFinding[]; onPersonsWord: boolean; criticRan: boolean; priorReturns: number; returns: number }): GateVerdict {
  const serious = input.findings.some(f => f.severity === 'serious');
  // The person's own word runs. They hear what the gate found only when it
  // is serious; a reading that did not happen is on the run, not in their way.
  if (input.onPersonsWord) {
    return serious ? 'advise' : 'pass';
  }
  if (serious) {
    return input.priorReturns < input.returns ? 'return' : 'escalate';
  }
  // Nothing serious found — but a reading that never happened is not a pass.
  return input.criticRan ? 'pass' : 'escalate';
}

/**
 * One finding, as a line a person or an agent reads.
 * @param f - The finding.
 * @param i - Its position, from 0.
 */
export function findingLine(f: GateFinding, i: number): string {
  return `${i + 1}. [${f.severity}, ${f.rule}] "${f.quote}" — ${f.why}${f.fix ? ` Fix: ${f.fix}` : ''}`;
}

/**
 * Who read it, in words.
 * @param record - The gate's record.
 */
export function readerLine(record: Pick<GateRecord, 'label' | 'critic' | 'author'>): string {
  return record.critic
    ? `${record.label} (${record.critic.model}, a ${record.critic.vendor} model — the draft was written on ${record.author})`
    : record.label;
}

/* ------------------------------------------------------------------ */
/* The critic's instruction                                             */
/* ------------------------------------------------------------------ */

/**
 * The critic's instruction: the rubric, the workspace's voice, its facts, and
 * the one JSON shape to answer in.
 * @param input - What it reads against.
 * @param input.label - The gate's label.
 * @param input.rubric - The plugin's rubric skill, as markdown, when it has one.
 * @param input.voice - The workspace's voice rules, as lines.
 * @param input.facts - Wiki passages that bear on the words.
 */
export function critiqueSystem(input: { label: string; rubric: string | null; voice: string; facts: ReadonlyArray<{ title: string; slug: string; excerpt: string }> }): string {
  const facts = input.facts.map(f => `- ${f.title} (wiki:${f.slug}): ${f.excerpt.slice(0, 600)}`).join('\n');
  return [
    `You are the ${input.label}: the last reader before words are published outside this company under its name. A model from another vendor wrote them; you read them cold. You judge the words, not the writer, and you never rewrite them — you say what is wrong and how to fix it.`,
    input.rubric ? `THE RUBRIC:\n${input.rubric.trim().slice(0, 5000)}` : '',
    `THE WORKSPACE'S VOICE RULES:\n${input.voice || '(none authored beyond the platform floor)'}`,
    facts ? `THE WORKSPACE'S FACTS that bear on this (its wiki):\n${facts}` : 'THE WORKSPACE\'S FACTS: none of its wiki bears on this. A specific claim you cannot check against anything here is a finding.',
    'Answer with ONE JSON object and nothing else: {"findings":[{"severity":"serious"|"minor","rule":"voice"|"fact"|"claim"|"other","quote":"the exact words","why":"one sentence","fix":"one sentence"}]}. Serious: a fact the workspace contradicts, a claim nothing here supports, a promise the company did not make, a name or number that is wrong, or a breach of a voice rule. Minor: everything a good editor would mention but would let go out. No findings: {"findings":[]}.',
  ].filter(Boolean).join('\n\n');
}

/**
 * The workspace's voice rules as short lines for the critic.
 * @param rules - The merged rule set.
 */
export function voiceRulesText(rules: VoiceRules): string {
  const lines = [
    ...rules.never.map(r => `- never "${String(r.pattern)}": ${r.reason}`),
    ...(rules.prefer ?? []).map(r => `- prefer "${r.use}" over "${String(r.pattern)}"${r.reason ? `: ${r.reason}` : ''}`),
    rules.maxWordsPerSend ? `- at most ${rules.maxWordsPerSend} words` : null,
    rules.maxAsksPerSend !== undefined ? `- at most ${rules.maxAsksPerSend} asks` : null,
    rules.noExclamation ? '- no exclamation marks' : null,
    rules.noEmoji ? '- no emoji' : null,
    rules.noEmDash ? '- no em dashes' : null,
  ].filter((l): l is string => l !== null);
  return lines.slice(0, 80).join('\n');
}

/* ------------------------------------------------------------------ */
/* Running the gates                                                    */
/* ------------------------------------------------------------------ */

export type ActionGateDeps = {
  /** The author's vendor. */
  author: () => Promise<ModelVendor>;
  /** Models this workspace can reach, in preference order. */
  candidates: () => Promise<CriticChoice[]>;
  /** What would be published, as text. */
  text: () => Promise<string>;
  /** The workspace's voice: the rule set and its lines for the critic. */
  voice: () => Promise<{ rules: VoiceRules | null; text: string }>;
  /** Lint text against the rule set (`lintCopy`). */
  lint: (text: string, rules: VoiceRules) => GateFinding[];
  /** Wiki passages that bear on the text. */
  facts: (text: string) => Promise<Array<{ title: string; slug: string; excerpt: string }>>;
  /** The rubric skill, as markdown. */
  rubric: (slug: string) => Promise<string | null>;
  /** One critic call: returns the raw answer (and charges it). */
  critique: (choice: CriticChoice, system: string, human: string) => Promise<string>;
  /** Times this subject was returned by this gate before. */
  priorReturns: (gate: DeclaredGate) => Promise<number>;
  now?: () => Date;
};

/**
 * Run every gate that reads this action, in order. Never throws: a gate whose
 * reading fails says so in its record (and is routed as a reading that did
 * not happen).
 * @param input - The proposal.
 * @param input.gates - The gates that read this action.
 * @param input.actionLabel - The action, in words.
 * @param input.onPersonsWord - The person asked for it themselves.
 * @param deps - The side effects.
 */
export async function runActionGates(input: { gates: readonly DeclaredGate[]; actionLabel: string; onPersonsWord: boolean }, deps: ActionGateDeps): Promise<GateRecord[]> {
  if (input.gates.length === 0) {
    return [];
  }
  const now = (deps.now ?? (() => new Date()))();
  const [author, text, voice] = await Promise.all([
    deps.author().catch(() => 'unknown' as const),
    deps.text().catch(() => ''),
    deps.voice().catch(() => ({ rules: null, text: '' })),
  ]);
  const records: GateRecord[] = [];
  for (const gate of input.gates) {
    const findings: GateFinding[] = voice.rules && text ? deps.lint(text, voice.rules) : [];
    let critic: GateRecord['critic'] = null;
    let note: string | undefined;
    let criticRan = false;
    try {
      const choice = gate.critic.vendor === 'different' ? pickCritic(author, await deps.candidates()) : null;
      if (!choice) {
        note = `no model from a vendor other than ${author} is reachable in this workspace — connect one on Connections`;
      } else if (!text.trim()) {
        note = 'there were no words to read';
      } else {
        critic = { vendor: choice.vendor, model: choice.model };
        const [rubric, facts] = await Promise.all([
          gate.critic.rubric ? deps.rubric(gate.critic.rubric).catch(() => null) : Promise.resolve(null),
          deps.facts(text).catch(() => []),
        ]);
        const raw = await deps.critique(choice, critiqueSystem({ label: gate.label, rubric, voice: voice.text, facts }), `WHAT WOULD BE PUBLISHED (${input.actionLabel}):\n${text.slice(0, 9000)}`);
        const read = parseCritique(raw);
        if (read) {
          findings.push(...read);
          criticRan = true;
        } else {
          note = `the ${choice.vendor} critic's answer could not be read`;
        }
      }
    } catch (error) {
      note = `the critic could not run: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`;
    }
    const priorReturns = input.onPersonsWord ? 0 : await deps.priorReturns(gate).catch(() => 0);
    records.push({
      gate: gate.name,
      label: gate.label,
      plugin: gate.plugin,
      verdict: routeFindings({ findings, onPersonsWord: input.onPersonsWord, criticRan, priorReturns, returns: gate.returns }),
      findings,
      author,
      critic,
      ...(note ? { note } : {}),
      priorReturns,
      at: now.toISOString(),
    });
  }
  return records;
}

/** What the proposal does next, from every gate's record. */
export type GateOutcome = {
  records: GateRecord[];
  /** A gate returned the work to its author: the message the author reads. */
  returned: { record: GateRecord; message: string } | null;
  /** A person must decide, whatever the trust ladder says: why. */
  hold: string | null;
  /** Lines the person hears with their own action. */
  advice: string[];
};

/**
 * Fold the records into one next step. A return wins (the work goes back);
 * then a hold; advice is only ever advice.
 * @param records - Every gate's record.
 */
export function gateOutcome(records: readonly GateRecord[]): GateOutcome {
  const returned = records.find(r => r.verdict === 'return');
  if (returned) {
    const serious = returned.findings.filter(f => f.severity === 'serious');
    return {
      records: [...records],
      returned: {
        record: returned,
        message: `${readerLine(returned)} read this before it goes out and sent it back to you to revise once. Fix these, then propose it again; if they still stand on the next draft, a person decides:\n${serious.map(findingLine).join('\n')}`,
      },
      hold: null,
      advice: [],
    };
  }
  const held = records.find(r => r.verdict === 'escalate');
  const advised = records.filter(r => r.verdict === 'advise');
  return {
    records: [...records],
    returned: null,
    hold: held
      ? (held.findings.some(f => f.severity === 'serious')
          ? `${held.label}: serious findings still stand after a revision, so a person decides`
          : `${held.label} could not read it (${held.note ?? 'no reading'}), so a person decides`)
      : null,
    advice: advised.map(r => `${readerLine(r)} read it first: ${r.findings.filter(f => f.severity === 'serious').map((f, i) => findingLine(f, i)).join(' ')} It went out as the person asked — tell them in one line only if it changes anything.`),
  };
}

/**
 * Every string a value holds, as `path: text` lines — the payload's words when
 * an action draws no card.
 * @param value - Any JSON value.
 * @param path - Where it sits.
 */
function stringLeaves(value: unknown, path = ''): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [`${path || 'value'}: ${value}`] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => stringLeaves(v, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => stringLeaves(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/**
 * What would be published, as text: the action's own review card when it
 * draws one (the one definition of how a proposal reads — its headline,
 * summary and the words of each content item), else every string in its
 * input. An action whose words live on a record reads them in its card, so
 * the critic reads what a person would.
 * @param card - The action's review card for this input, or null.
 * @param input - The parsed input.
 */
export function publishableText(card: { title?: string; headline?: string; summary?: string; nextAction?: string; recommendation?: { headline: string; detail?: string }; content?: ReadonlyArray<Record<string, unknown>>; fields?: ReadonlyArray<{ label: string; value: string }> } | null, input: Record<string, unknown>): string {
  if (!card) {
    return stringLeaves(input).join('\n');
  }
  const content = (card.content ?? []).flatMap(item => ['label', 'subject', 'body', 'summary', 'caption']
    .map(k => item[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== ''));
  return [
    card.headline ?? card.title,
    card.summary,
    card.recommendation ? [card.recommendation.headline, card.recommendation.detail].filter(Boolean).join(' — ') : undefined,
    ...content,
    ...(card.fields ?? []).map(f => `${f.label}: ${f.value}`),
  ].filter((v): v is string => typeof v === 'string' && v.trim() !== '').join('\n');
}

/**
 * A run's gate records as rows on its review card, so a person deciding it
 * reads what the gate found where they decide — one row per gate, one per
 * serious finding. Pure; reads the stored envelope (`proposal.gates`).
 * @param proposal - The run's stored proposal envelope.
 */
export function gateCardFields(proposal: Record<string, unknown> | null | undefined): Array<{ label: string; value: string }> {
  const records = Array.isArray(proposal?.gates) ? (proposal!.gates as GateRecord[]) : [];
  return records.flatMap((r) => {
    const serious = (r.findings ?? []).filter(f => f.severity === 'serious');
    const minor = (r.findings ?? []).length - serious.length;
    const head = r.critic
      ? `${serious.length === 0 ? 'Nothing serious' : `${serious.length} serious`}${minor > 0 ? `, ${minor} minor` : ''} — read by ${r.critic.model} (${r.critic.vendor}); written on ${r.author}${r.priorReturns > 0 ? `; returned ${r.priorReturns}× before` : ''}`
      : `Not read: ${r.note ?? 'no critic could read it'}`;
    return [{ label: r.label, value: head }, ...serious.map((f, i) => ({ label: `${r.label} · ${i + 1}`, value: `"${f.quote}" — ${f.why}${f.fix ? ` Fix: ${f.fix}` : ''}` }))];
  });
}
