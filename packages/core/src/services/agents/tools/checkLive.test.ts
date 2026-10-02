import { describe, expect, it, vi } from 'vitest';
import { callMeets } from '@/services/automations/toolRequirement';

const out: { value: Record<string, unknown> } = { value: {} };
vi.mock('@/services/factory/liveCheck', () => ({ runLiveCheck: async () => out.value }));

const { checkLiveTools } = await import('./checkLive');

const ctx = { orgId: 'org_check_live_tool', agentSlug: 'change-reviewer', missionRunId: 7, harnessConfig: { grantTools: ['check_live'] } } as any;
const flow = { name: 'library', path: '/library', steps: [{ shoot: 'Library' }], line: 1 };

describe('check_live answers a refusal so the run counts it as not done', () => {
  it('opens "Not recorded" with the unaccounted lines when the flows leave a line out (Walk 7: release #363)', async () => {
    const refused = 'An acceptance line is neither cited by a check flow nor named in not_observable:\nrequest #132: line 2 (The list shows the date.)';
    out.value = { ok: false, refused, releaseId: 363, explore: false, verdict: { state: 'not_seen', line: refused } };
    const [tool] = checkLiveTools(ctx);
    const answer = await tool!.invoke({ release_id: 363, flows: [flow] });

    expect(answer).toMatch(/^Not recorded: nothing ran and nothing was written on release #363\. An acceptance line is neither cited/);
    expect(answer).toContain('request #132: line 2');
    // The required-tool pass reads it as not done, so the agent gets another try in the same run.
    expect(callMeets({ tool: 'check_live', action: null }, { tool: 'check_live', input: { release_id: 363, flows: [flow] }, output: answer, error: null })).toBe(false);
  });

  it('answers a recorded check as before, which meets the requirement', async () => {
    out.value = { ok: true, releaseId: 363, explore: false, attempt: 1, verdict: { state: 'seen', line: 'Seen live' } };
    const [tool] = checkLiveTools(ctx);
    const answer = await tool!.invoke({ release_id: 363, flows: [flow] });

    expect(JSON.parse(String(answer))).toMatchObject({ ok: true, next: expect.stringContaining('Written on the release') });
    expect(callMeets({ tool: 'check_live', action: null }, { tool: 'check_live', input: { release_id: 363, flows: [flow] }, output: answer, error: null })).toBe(true);
  });
});

describe('check_live says what to change when a visitor flow hit sign-in (Walk 10, release #386)', () => {
  it('names the flow that ran signed out and the two ways through, on the retry', async () => {
    out.value = { ok: false, releaseId: 386, explore: false, attempt: 1, verdict: { state: 'partial', line: 'Partly seen live', why: { kind: 'visitor_sent_to_sign_in', flow: 'visitor view', path: '/', detail: 'x' } } };
    const [tool] = checkLiveTools(ctx);
    const answer = JSON.parse(String(await tool!.invoke({ release_id: 386, flows: [flow] })));

    expect(answer.next).toMatch(/^Attempt 1 of 2\. "visitor view" ran signed out \(signed_in: false\) and its page needs sign-in: run it signed in, or open a page a visitor can open/);
  });

  it('adds nothing for any other reason', async () => {
    out.value = { ok: false, releaseId: 386, explore: false, attempt: 1, verdict: { state: 'partial', line: 'Partly seen live', why: { kind: 'sign_in_failed', detail: 'x' } } };
    const [tool] = checkLiveTools(ctx);
    const answer = JSON.parse(String(await tool!.invoke({ release_id: 386, flows: [flow] })));

    expect(answer.next).toMatch(/^Attempt 1 of 2\. Read what each page showed/);
  });
});
