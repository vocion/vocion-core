/**
 * The server-rendered slot: nothing without a component, and each component
 * given who is looking.
 */
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

const slots = vi.hoisted(() => ({ actions: [] as Array<() => null> }));

vi.mock('@vocion/enterprise/index', () => ({
  extensions: [{ name: 'sample', get slots() {
    return { 'system.actions': slots.actions };
  } }],
}));
vi.mock('@/libs/Auth', () => ({
  clerkAuth: vi.fn(async () => ({ userId: 'user-ada', orgId: 'proj-northwind', accountId: 'acct-northwind', role: 'admin' })),
}));

const { ExtensionSlot } = await import('./ExtensionSlot');

describe('ExtensionSlot', () => {
  it('renders nothing when no extension fills the slot', async () => {
    slots.actions = [];

    expect(await ExtensionSlot({ name: 'system.actions', locale: 'en' })).toBeNull();
  });

  it('gives each component the locale, the person, their workspace, Org and role', async () => {
    const First = () => null;
    const Second = () => null;
    slots.actions = [First, Second];

    const rendered = await ExtensionSlot({ name: 'system.actions', locale: 'fr' }) as ReactElement<{ ctx: unknown }>[];

    expect(rendered.map(el => el.type)).toEqual([First, Second]);
    expect(rendered[0]!.props.ctx).toEqual({ locale: 'fr', userId: 'user-ada', orgId: 'proj-northwind', accountId: 'acct-northwind', role: 'admin' });
  });
});
