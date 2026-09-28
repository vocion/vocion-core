/**
 * HOW MUCH OF THIS FEATURE IS PROVEN — one answer, read by every surface.
 *
 * On 2026-09-28 #126 ("Uploads that survive a bad connection") read "QA
 * approved, 8 of 8 criteria proven" on its Releases row and "Acceptance · 0 of
 * 6 verified" on its own page. Both were reading real records, differently:
 *
 * - The release counted the shipped task's verdict, which grades the task's
 *   frozen contract: the request's six acceptance lines plus the two lines
 *   `deriveContract` adds from the plan's risks ("The plan's risk is handled:
 *   …"). Eight.
 * - The page counted the request's own six lines, and a line read as passed
 *   only with an `evidenceUrl`. The release pack (`linkRelease`) had paired the
 *   verdict to those lines and marked them `met`, but wrote the proof as
 *   `evidence` (prose), never `evidenceUrl`. Zero.
 *
 * Neither number was a lie on its own; together they were. This is the one
 * function that answers the question, from the records rather than from a
 * write that may be missing: which attempt's judgement counts (the attempt
 * that shipped when one shipped, else the newest judged attempt), each of the
 * work's acceptance lines against that judgement, and the plan-risk lines as
 * their own group — counted and shown, never folded into the acceptance count
 * and never dropped. The feature page (`services/factory/featureReport.ts`),
 * the release feed and page (`libs/workspace/releaseFeed.ts`) and the release
 * pack all read it. Pure, so it is argued with in a test.
 */

/** The prefix `deriveContract` (`libs/actions/factory-dispatch.ts`) puts on a plan-risk line. */
export const PLAN_RISK_PREFIX = 'The plan\'s risk is handled: ';

/** One judged line, as `record_verdict` stores it on a task (`verdict.criteria`). */
export type JudgedCriterion = { criterion: string; status: 'proven' | 'unproven' | 'unchecked'; evidence?: string };

/** A record with only what the proof reads. */
export type ProofRecord = { id: number; meta: Record<string, unknown> };

export type ProofState = 'passed' | 'failed' | 'unverified';

export type ProofCriterion = {
  statement: string;
  /** `risk` is a line the plan's risks added to the contract; `acceptance` is the work's own. */
  group: 'acceptance' | 'risk';
  state: ProofState;
  /** What proves it, as QA or a person wrote it. */
  evidence: string | null;
  /** The first link in the evidence, when it names one. */
  evidenceUrl: string | null;
  /** Where the state came from: the attempt's verdict, or a mark on the request itself. */
  from: 'verdict' | 'request' | null;
  note: string | null;
};

export type ProofAttempt = {
  taskId: number;
  /** Why this attempt is the one that counts. */
  why: 'shipped' | 'judged';
  verdict: string | null;
  at: string | null;
  by: string | null;
};

export type FeatureProof = {
  /** The attempt whose judgement is read. Null when no attempt was judged or shipped. */
  attempt: ProofAttempt | null;
  acceptance: ProofCriterion[];
  risks: ProofCriterion[];
  /** Acceptance lines passed with evidence, of all acceptance lines. */
  proven: number;
  total: number;
  /** Plan-risk lines passed with evidence, of all plan-risk lines. */
  risksHandled: number;
  risksTotal: number;
  /** Where the acceptance lines were read: the work's own contract, or the attempt's when the work carries none. */
  source: 'request' | 'task' | null;
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

/**
 * The acceptance contract on a task, as a list of statements.
 * @param meta - The task's metadata.
 */
export function contractOf(meta: Record<string, unknown>): string[] {
  const raw = Array.isArray(meta.acceptanceContract) ? meta.acceptanceContract : [];
  return raw
    .map(c => (typeof c === 'string' ? c : c && typeof c === 'object' && typeof (c as { statement?: unknown }).statement === 'string' ? (c as { statement: string }).statement : ''))
    .map(c => c.trim())
    .filter(Boolean);
}

/**
 * Is this contract line one the plan's risks added?
 * @param line - A contract statement.
 */
export function isPlanRiskLine(line: string): boolean {
  return line.trim().startsWith(PLAN_RISK_PREFIX.trim());
}

function normal(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Pair the reviewer's judgements to the contract, line by line. A judgement
 * matches a line when one's words contain the other's. Never by position: a
 * reviewer that invents as many lines as the contract has would pass it.
 * Every contract line comes back, in contract order, in the contract's own
 * words; a line no judgement named is `unchecked`.
 * @param contract - The frozen contract statements.
 * @param judged - What the reviewer sent.
 */
export function alignToContract(contract: string[], judged: JudgedCriterion[]): JudgedCriterion[] {
  const used = new Set<number>();
  const byText = contract.map((line) => {
    const n = normal(line);
    const i = judged.findIndex((j, k) => {
      if (used.has(k)) {
        return false;
      }
      const m = normal(j.criterion ?? '');
      return m.length >= 12 && (n.includes(m) || m.includes(n) || n.slice(0, 40) === m.slice(0, 40));
    });
    if (i >= 0) {
      used.add(i);
    }
    return i;
  });
  return contract.map((line, idx) => {
    const i = byText[idx]!;
    const j = i >= 0 ? judged[i] : undefined;
    return j ? { criterion: line, status: j.status, ...(j.evidence ? { evidence: j.evidence } : {}) } : { criterion: line, status: 'unchecked' as const };
  });
}

/**
 * The first link a piece of evidence names, without the punctuation a sentence puts after it.
 * @param evidence - QA's words.
 */
export function firstUrl(evidence: string | null): string | null {
  const m = evidence ? /https?:\/\/[^\s)"'<>\]]+/.exec(evidence) : null;
  return m ? m[0].replace(/[.,;:!?]+$/, '') : null;
}

function verdictOf(task: ProofRecord): { value: string | null; criteria: JudgedCriterion[]; at: string | null; by: string | null } {
  const v = obj(task.meta.verdict);
  const criteria = (Array.isArray(v.criteria) ? v.criteria : [])
    .map(obj)
    .filter(c => typeof c.criterion === 'string')
    .map((c): JudgedCriterion => ({
      criterion: String(c.criterion),
      status: c.status === 'proven' || c.status === 'unproven' ? c.status : 'unchecked',
      ...(str(c.evidence) ? { evidence: str(c.evidence)! } : {}),
    }));
  return { value: str(v.value), criteria, at: str(v.at), by: str(v.by) };
}

/**
 * The attempt whose judgement counts: the newest attempt that shipped, when
 * one shipped; else the newest attempt QA judged. A newer attempt QA never
 * judged does not erase the proof of the one that went out.
 * @param tasks - The work's attempts.
 * @param shipped - The ids of attempts a release carried.
 */
export function countedAttempt(tasks: ProofRecord[], shipped: ReadonlySet<number>): { task: ProofRecord; why: 'shipped' | 'judged' } | null {
  const newest = [...tasks].sort((a, b) => b.id - a.id);
  const out = newest.filter(t => shipped.has(t.id));
  const shippedJudged = out.find(t => verdictOf(t).value !== null) ?? out[0];
  if (shippedJudged) {
    return { task: shippedJudged, why: 'shipped' };
  }
  const judged = newest.find(t => verdictOf(t).value !== null);
  return judged ? { task: judged, why: 'judged' } : null;
}

function statementsOf(request: ProofRecord | null): Array<Record<string, unknown>> {
  const raw = Array.isArray(request?.meta.acceptance) ? request!.meta.acceptance as unknown[] : [];
  return raw
    .map(c => (typeof c === 'string' ? { statement: c } : obj(c)))
    .filter(c => str(c.statement) !== null || str(c.criterion) !== null);
}

function fromJudgement(statement: string, group: ProofCriterion['group'], j: JudgedCriterion): ProofCriterion {
  const evidence = str(j.evidence);
  const state: ProofState = j.status === 'proven' && evidence !== null ? 'passed' : j.status === 'unproven' ? 'failed' : 'unverified';
  const note = j.status === 'proven' && evidence === null
    ? 'QA marked it proven, with no evidence attached.'
    : j.status === 'unchecked' ? 'QA did not judge this line.' : null;
  return { statement, group, state, evidence, evidenceUrl: firstUrl(evidence), from: 'verdict', note };
}

function fromRequestMark(statement: string, mark: Record<string, unknown>): ProofCriterion {
  const met = typeof mark.met === 'boolean' ? mark.met : null;
  const evidenceUrl = str(mark.evidenceUrl) ?? firstUrl(str(mark.evidence));
  const evidence = str(mark.evidence) ?? evidenceUrl;
  const state: ProofState = met === false ? 'failed' : met === true && evidence !== null ? 'passed' : 'unverified';
  return {
    statement,
    group: 'acceptance',
    state,
    evidence,
    evidenceUrl,
    from: met === null ? null : 'request',
    note: met === true && evidence === null ? 'Marked met, with no evidence attached.' : str(mark.note),
  };
}

/**
 * How many of this feature's criteria are proven, by which evidence, from which attempt.
 * @param input - The records.
 * @param input.request - The request, whose `acceptance` is the work's own contract.
 * @param input.tasks - Its engineering tasks (attempts).
 * @param input.shippedTaskIds - Attempts a release carried.
 */
export function featureProof(input: { request: ProofRecord | null; tasks: ProofRecord[]; shippedTaskIds?: Iterable<number> }): FeatureProof {
  const shipped = new Set(input.shippedTaskIds ?? []);
  const counted = countedAttempt(input.tasks, shipped);
  const verdict = counted ? verdictOf(counted.task) : null;
  // The attempt's contract names the risk lines; with no attempt counted, the
  // newest attempt that carries a contract still says what they are.
  const contractTask = counted && contractOf(counted.task.meta).length > 0
    ? counted.task
    : [...input.tasks].sort((a, b) => b.id - a.id).find(t => contractOf(t.meta).length > 0) ?? null;
  const contract = contractTask ? contractOf(contractTask.meta) : [];

  const marks = statementsOf(input.request);
  const source: FeatureProof['source'] = marks.length > 0 ? 'request' : contract.some(l => !isPlanRiskLine(l)) ? 'task' : null;
  const acceptanceLines = marks.length > 0
    ? marks.map(m => str(m.statement) ?? str(m.criterion)!)
    : contract.filter(l => !isPlanRiskLine(l));
  const riskLines = contract.filter(isPlanRiskLine);

  const judged = verdict && verdict.criteria.length > 0 ? verdict.criteria : null;
  const alignedAcceptance = judged ? alignToContract(acceptanceLines, judged) : null;
  const alignedRisks = judged ? alignToContract(riskLines, judged) : null;

  const acceptance = acceptanceLines.map((statement, i) => {
    const j = alignedAcceptance?.[i];
    if (j && j.status !== 'unchecked') {
      return fromJudgement(statement, 'acceptance', j);
    }
    // No judgement names this line: a person's own mark on the request, with
    // its evidence, still counts; a verdict that skipped it says so.
    const own = fromRequestMark(statement, marks[i] ?? {});
    return own.from === null && j ? fromJudgement(statement, 'acceptance', j) : own;
  });
  const risks = riskLines.map((statement, i) => {
    const j = alignedRisks?.[i];
    return j ? fromJudgement(statement, 'risk', j) : { statement, group: 'risk' as const, state: 'unverified' as const, evidence: null, evidenceUrl: null, from: null, note: null };
  });

  return {
    attempt: counted ? { taskId: counted.task.id, why: counted.why, verdict: verdict?.value ?? null, at: verdict?.at ?? null, by: verdict?.by ?? null } : null,
    acceptance,
    risks,
    proven: acceptance.filter(c => c.state === 'passed').length,
    total: acceptance.length,
    risksHandled: risks.filter(c => c.state === 'passed').length,
    risksTotal: risks.length,
    source,
  };
}

/**
 * The attempts a release carried, by id — the ones whose proof went out.
 * @param releases - The release records naming this work.
 */
export function shippedTaskIdsOf(releases: Array<Pick<ProofRecord, 'meta'>>): number[] {
  return releases.flatMap(r => [
    ...(Array.isArray(r.meta.taskIds) ? r.meta.taskIds : []),
    ...(Array.isArray(r.meta.evidence) ? (r.meta.evidence as Array<Record<string, unknown>>).map(e => e?.taskId) : []),
  ]).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
}

/**
 * The plan-risk group in words: "2 plan risks handled", "1 of 2 plan risks
 * handled", or null when the contract carried none.
 * @param proof - The proof.
 */
export function risksLine(proof: Pick<FeatureProof, 'risksHandled' | 'risksTotal'>): string | null {
  if (proof.risksTotal === 0) {
    return null;
  }
  const noun = proof.risksTotal === 1 ? 'plan risk' : 'plan risks';
  return proof.risksHandled === proof.risksTotal ? `${proof.risksTotal} ${noun} handled` : `${proof.risksHandled} of ${proof.risksTotal} ${noun} handled`;
}

/**
 * The count as one phrase: "6 of 6 acceptance criteria proven · 2 plan risks handled".
 * @param proof - The proof.
 */
export function proofLine(proof: Pick<FeatureProof, 'proven' | 'total' | 'risksHandled' | 'risksTotal'>): string {
  const risks = risksLine(proof);
  const head = proof.total === 0 ? 'No acceptance criteria written' : `${proof.proven} of ${proof.total} acceptance ${proof.total === 1 ? 'criterion' : 'criteria'} proven`;
  return risks ? `${head} · ${risks}` : head;
}
