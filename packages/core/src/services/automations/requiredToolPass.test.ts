import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

// The tool: refuses until the review has looked, then records.
const invoked: Array<Record<string, unknown>> = [];
// 'late': the first refusal lists nothing, the second lists the screenshots.
const refusals = { late: false, third: false };
const verdictTool = {
  name: 'record_verdict',
  invoke: vi.fn(async (args: Record<string, unknown>) => {
    invoked.push(args);
    // 'third': shots listed on the first try, then a citation refusal on the second.
    if (refusals.third && invoked.length === 2) {
      return 'Not recorded: "Search" is marked proven on "the list narrows", which is a description, not evidence.';
    }
    if (refusals.third && invoked.length === 3) {
      return 'Verdict recorded on task #177: changes, 1 of 2 criteria proven.';
    }
    if (invoked.length === 1 && refusals.late) {
      return 'Not recorded: "Search" is marked proven on "Run 379 screenshot", which cannot be opened.';
    }
    return invoked.length === (refusals.late ? 2 : 1)
      ? 'Not recorded: task #177 has 2 screenshots and this review opened none of them. Open them:\n- Empty state · desktop · after: https://agents.example/dashboard/artifacts/949\n- Chips · phone · after: https://agents.example/dashboard/artifacts/950'
      : 'Verdict recorded on task #177: changes, 1 of 2 criteria proven.';
  }),
};
// The context each pass built its belt from.
const ctxs: Array<{ userId?: string }> = [];
vi.mock('@/services/agents/tools/registry', () => ({ buildDomainTools: (ctx: { userId?: string }) => {
  ctxs.push(ctx);
  return [verdictTool];
} }));
vi.mock('@/services/agents/tools/fetchImage', () => ({ artifactImageUrl: async (_org: string, link: string) => `https://store.example/${link.split('/').pop()}.png` }));
vi.mock('@/libs/tools/image/remote', () => ({ fetchImage: async () => ({ dataUri: 'data:image/png;base64,AAAA', contentType: 'image/png', width: 10, height: 10 }) }));
vi.mock('@/services/agents/toolCallRecord', () => ({ persistToolCall: async () => {} }));
// The model: always calls the tool; records what it was shown.
const seen: unknown[][] = [];
vi.mock('@/libs/llm', () => ({
  buildChatModelForOrg: async () => ({
    bindTools: () => ({
      invoke: async (messages: unknown[]) => {
        seen.push([...messages]);
        return { tool_calls: [{ name: 'record_verdict', id: `c${seen.length}`, args: { pr_url: 'https://github.com/acme/app/pull/71', value: 'changes' } }] };
      },
    }),
  }),
}));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { forceRequiredTool, listedShots } = await import('./requiredToolPass');

describe('listedShots', () => {
  it('reads the screenshots a refusal hands over, and nothing else', () => {
    const refusal = 'Not recorded: task #177 has 2 screenshots and this review opened none of them. Open them:\n- Empty state · desktop · after: https://agents.example/dashboard/artifacts/949\n- Chips · phone · after: https://agents.example/dashboard/artifacts/950\nsee https://example.com/other';

    expect(listedShots(refusal)).toEqual([
      { title: 'Empty state · desktop · after', link: 'https://agents.example/dashboard/artifacts/949' },
      { title: 'Chips · phone · after', link: 'https://agents.example/dashboard/artifacts/950' },
    ]);
    expect(listedShots('Not recorded: an approve cannot carry 1 criteria')).toEqual([]);
    // As tool_call.output stores it: JSON-quoted, newlines escaped.
    expect(listedShots(JSON.stringify(refusal))).toEqual(listedShots(refusal));

    // Fifteen screenshots are fifteen, not twelve (review 5750 lost the URL-state pair).
    const fifteen = Array.from({ length: 15 }, (_, i) => `- Shot ${i}: https://agents.example/dashboard/artifacts/${1000 + i}`).join('\n');

    expect(listedShots(fifteen)).toHaveLength(15);
  });
});

describe('forceRequiredTool', () => {
  beforeAll(async () => {
    await db.insert(agentSchema).values({ orgId: 'org_pass', slug: 'change-reviewer', name: 'QA', systemPrompt: 'Review.' });
  });

  it('opens the screenshots its own refusal lists and lands the verdict on the second try (review 5715)', async () => {
    const res = await forceRequiredTool({ orgId: 'org_pass', agentSlug: 'change-reviewer', toolName: 'record_verdict', missionRunId: 999_001, report: 'changes: the empty state is not shown.' });

    expect(res).toEqual({ called: true, answer: 'Verdict recorded on task #177: changes, 1 of 2 criteria proven.' });
    expect(invoked).toHaveLength(2);

    // The second try was taken looking: both pictures were in front of it.
    const images = JSON.stringify(seen[1]).match(/data:image\/png/g) ?? [];

    expect(images).toHaveLength(2);
  });

  it('screenshots listed by its LAST try still earn one more try, never a fourth (review 5718)', async () => {
    invoked.length = 0;
    seen.length = 0;
    refusals.late = true;
    const res = await forceRequiredTool({ orgId: 'org_pass', agentSlug: 'change-reviewer', toolName: 'record_verdict', missionRunId: 999_002, report: 'changes.' });
    refusals.late = false;

    expect(res.called).toBe(true);
    expect(invoked).toHaveLength(3);
  });

  it('screenshots opened after the FIRST try still leave a try to fix the next refusal (review 5737)', async () => {
    invoked.length = 0;
    seen.length = 0;
    refusals.third = true;
    const res = await forceRequiredTool({ orgId: 'org_pass', agentSlug: 'change-reviewer', toolName: 'record_verdict', missionRunId: 999_003, report: 'changes.' });
    refusals.third = false;

    expect(res.called).toBe(true);
    expect(invoked).toHaveLength(3);
  });

  it('acts for whoever the run acted for, so a factory step is not charged the weekly idea cap (#130, #224)', async () => {
    invoked.length = 0;
    ctxs.length = 0;
    const { isFactoryStep } = await import('@/services/proposals/ProposalBudgetService');
    await forceRequiredTool({ orgId: 'org_pass', agentSlug: 'change-reviewer', toolName: 'record_verdict', missionRunId: 999_004, report: 'changes.', invokedBy: 'factory:product-manager' });

    expect(ctxs[0]?.userId).toBe('factory:product-manager');
    expect(isFactoryStep(ctxs[0]!)).toBe(true);

    ctxs.length = 0;
    invoked.length = 0;
    await forceRequiredTool({ orgId: 'org_pass', agentSlug: 'change-reviewer', toolName: 'record_verdict', missionRunId: 999_005, report: 'changes.' });

    expect(ctxs[0]?.userId).toBeUndefined();
  });
});
