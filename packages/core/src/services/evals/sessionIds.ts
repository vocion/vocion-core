/**
 * What a session is called, so two graders can agree they mean the same run.
 *
 * A "session" is AWS's unit of evaluation: spans are grouped by `session.id`,
 * an evaluator scores one session, and a batch job attaches each expected
 * answer to a session id. Vocion produces session ids in two places that must
 * agree, or the two paths silently measure different things:
 *
 * - **On demand.** We synthesize spans from a finished transcript and post
 *   them in the request body. The id is ours to choose.
 * - **Batch.** AWS reads spans the agent runtime actually emitted into
 *   CloudWatch, and we hand it ground truth addressed by session id. Here the
 *   id was decided before the case ran, by whatever core sent the runtime.
 *
 * So the id has to be derived from the case, not invented at scoring time,
 * and both paths have to derive it the same way. That is this module's whole
 * job. It is also what makes the two comparable: run a dataset, score it on
 * demand, run a batch job over the same window, and a disagreement is the
 * graders disagreeing rather than the two paths having looked at different
 * sessions.
 */

/**
 * The session id for one case of one dataset.
 *
 * Deliberately derived from the dataset slug and the case's position, with no
 * timestamp and no random part, so the same case always names the same
 * session. Re-running a dataset overwrites that session's spans rather than
 * accumulating a new one per run, which is the behaviour the comparison above
 * needs.
 *
 * Kept to characters AWS accepts in a session id, and short enough to stay
 * under its length limit once a long dataset slug is involved.
 * @param datasetSlug - The dataset the case belongs to.
 * @param itemIndex - The case's position in that dataset.
 */
export function evalCaseSessionId(datasetSlug: string, itemIndex: number): string {
  const slug = datasetSlug.replace(/[^\w-]/g, '-').slice(0, 80);
  return `${slug}-${itemIndex}`;
}

/**
 * The session id for one conversation turn.
 *
 * Matches the AgentCore Memory session convention already used for the same
 * conversation, so a trace and the memory it wrote carry the same id and a
 * person looking at one can find the other.
 * @param conversationId - The persisted conversation.
 * @param orgId - Whose workspace, because conversation ids are per-tenant.
 */
export function conversationSessionId(conversationId: number, orgId: string): string {
  return `vocion-conv-${conversationId}-${orgId}`.replace(/[^\w-]/g, '-').slice(0, 100);
}
