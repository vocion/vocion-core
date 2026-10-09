import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Pin this page", said to the agent: the pin runs as the person, on what
 * they are looking at, and lands as a Done line with Undo. The action itself
 * (`libs/actions/nav-pin.ts`) puts back exactly what it changed.
 */

const proposeAction = vi.fn();
vi.mock('@/services/ActionService', () => ({ proposeAction }));
const pinObject = vi.fn();
const unpinKey = vi.fn();
const resolvePins = vi.fn(async () => []);
vi.mock('@/services/pins/PinService', () => ({
  pinObject,
  unpinKey,
  resolvePins,
  targetForPath: async (_org: string, path: string) => {
    const { pinTargetFromPath } = await import('@/libs/pins/pinTarget');
    return pinTargetFromPath(path);
  },
}));
vi.mock('@/services/chat/conversationChannel', () => ({
  personBehind: async (_org: string, who: string | null) => (who === 'usr-pat' ? { userId: 'usr-pat', name: 'Pat', email: 'pat@northwind.example' } : null),
}));

const { pinToSidebarTool } = await import('./pinToSidebar');
const { navPinAction } = await import('@/libs/actions/nav-pin');

const emit = vi.fn();
const ctx = (path: string | null, extra: Record<string, unknown> = {}) => ({ orgId: 'org-northwind', userId: 'usr-pat', agentSlug: 'assistant', conversationId: 77, pageContext: path ? { path, title: '' } : null, emit, ...extra }) as never;

beforeEach(() => {
  proposeAction.mockReset();
  emit.mockReset();
  pinObject.mockReset();
  unpinKey.mockReset();
  proposeAction.mockResolvedValue({ runId: 501, status: 'done', result: { title: 'Larkfield diligence', href: '/dashboard/rooms/12', line: 'Pinned "Larkfield diligence" to Pat\'s sidebar.', changed: true } });
});

describe('pin_to_sidebar', () => {
  it('pins the page the person is on, as the person, with a Done line and Undo', async () => {
    const out = await pinToSidebarTool(ctx('/w/northwind/dashboard/rooms/12')).invoke({});

    expect(proposeAction).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'nav.pin',
      input: { kind: 'room', id: '12' },
      principal: expect.objectContaining({ kind: 'user', id: 'usr-pat' }),
      invokedBy: 'usr-pat',
    }));
    expect(emit).toHaveBeenCalledWith({ type: 'receipt', receipt: { runId: 501, actionId: 'nav.pin', label: 'Pinned Larkfield diligence to your sidebar', undoable: true, href: '/dashboard/rooms/12' } });
    expect(out).toMatch(/^Pinned "Larkfield diligence"/);
  });

  it('on the chat page, "pin this chat" pins the thread the turn is in', async () => {
    await pinToSidebarTool(ctx('/dashboard/chat')).invoke({});

    expect(proposeAction).toHaveBeenCalledWith(expect.objectContaining({ input: { kind: 'conversation', id: '77' } }));
  });

  it('a named target wins over the page, and unpin is the same tool', async () => {
    await pinToSidebarTool(ctx('/dashboard/rooms/12')).invoke({ kind: 'artifact', id: '9', unpin: true });

    expect(proposeAction).toHaveBeenCalledWith(expect.objectContaining({ input: { kind: 'artifact', id: '9', unpin: true } }));
  });

  it('says so, and pins nothing, when the page is about nothing pinnable', async () => {
    const out = await pinToSidebarTool(ctx('/dashboard/inbox')).invoke({});

    expect(out).toMatch(/^Not pinned/);
    expect(proposeAction).not.toHaveBeenCalled();
  });
});

describe('nav.pin', () => {
  const actx = { orgId: 'org-northwind', invokedBy: 'usr-pat' } as never;

  it('pins for the person behind the turn, and Undo unpins what it pinned', async () => {
    pinObject.mockResolvedValue({ pin: { key: 'pin:room:12', kind: 'room', id: '12', title: 'Larkfield diligence', href: '/dashboard/rooms/12' }, pins: ['pin:room:12'], changed: true });

    const result = await navPinAction.execute(actx, { kind: 'room', id: '12' });

    expect(pinObject).toHaveBeenCalledWith({ orgId: 'org-northwind', userId: 'usr-pat' }, { kind: 'room', id: '12' });
    expect(result).toMatchObject({ changed: true, title: 'Larkfield diligence', userId: 'usr-pat' });

    await navPinAction.undo!(actx, { kind: 'room', id: '12' }, result as never);

    expect(unpinKey).toHaveBeenCalledWith({ orgId: 'org-northwind', userId: 'usr-pat' }, 'pin:room:12');
  });

  it('leaves a pin that was already there alone on Undo', async () => {
    pinObject.mockResolvedValue({ pin: null, pins: ['pin:room:12'], changed: false });
    const result = await navPinAction.execute(actx, { kind: 'room', id: '12' });

    await navPinAction.undo!(actx, { kind: 'room', id: '12' }, result as never);

    expect(unpinKey).not.toHaveBeenCalled();
  });

  it('refuses a turn with no person behind it', async () => {
    expect(await navPinAction.precheck!({ orgId: 'org-northwind', invokedBy: 'agent:assistant' } as never, { kind: 'room', id: '12' })).toMatch(/belongs to a person/);
  });
});
