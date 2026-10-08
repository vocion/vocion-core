/**
 * Extensions: code built into this app from outside this repository.
 *
 * Core runs complete on its own. A deployment can build in a package named
 * `@vocion/enterprise` (see `libs/enterpriseCheckout.ts` and
 * `docs/guides/extensions.md` for how it gets there). When that package is
 * present, the `extensions` list its `index.ts` exports
 * (`@vocion/enterprise/index`) is what {@link extensions} returns. When it is
 * absent, the alias resolves to an empty stub (`libs/enterprise-none/`) and
 * every seam below does nothing. An installation without it builds, runs and
 * tests exactly as it would if this file did not exist.
 *
 * Every seam is neutral: core knows that "an extension" exists, never what it
 * does. Each one is listed here with the place that reads it:
 *
 * | Seam | Read by |
 * |---|---|
 * | `budgetGuards` | `BudgetService.preflightCheck`, after core's own caps pass |
 * | `chargeObservers` | `BudgetService.chargeUsage`, after the charge commits; never throws |
 * | `router` | `routers/index.ts` serves it at `ext.<name>` on `/rpc` |
 * | `pages` | `/dashboard/ext/<page>/...` |
 * | `slots` | `<ExtensionSlot>`: `system.actions` (System page title bar), `spend.stats` (spend page figures) |
 * | `orgs.multiOrg` | `services/OrgPolicy.ts`: lifts the single-Org rule |
 * | `orgs.scopeWorkspaceSwitcher` | `projects.list`: the workspace switcher lists the current Org's workspaces only |
 *
 * Client-side pieces (a component in the sidebar) cannot come from this list,
 * because it imports server code. They come from `@vocion/enterprise/client`
 * through `libs/clientExtensions.ts`; their types are here.
 */

import type { ComponentType, ReactNode } from 'react';
import type { WorkspaceDirectory } from '@/features/dashboard/nav/useWorkspaceDirectory';
import type { WorkspaceSwitcherTargetPath } from '@/features/dashboard/nav/workspaceSwitch';
import { extensions as built } from '@vocion/enterprise/index';

/** What a budget guard is asked about: the same call `preflightCheck` is. */
export type BudgetGuardInput = { orgId: string; agentSlug?: string; feature?: string };

/** A guard's refusal. `message` is shown to the person as it is written. */
export type BudgetGuardRefusal = {
  /** Names the refusing cap; it becomes `BudgetCheck.agentSlug`. */
  source: string;
  reason: 'hard_tokens_exceeded' | 'hard_cents_exceeded';
  limit: number;
  current: number;
  /** The sentence the person reads, saying whose cap it is and who can change it. */
  message: string;
};

/**
 * One more cap, checked after core's own caps have passed. Null lets the call
 * through. A guard that throws refuses nothing: it is logged and skipped,
 * because a broken extension must not stop every agent on the installation.
 */
export type BudgetGuard = (input: BudgetGuardInput) => Promise<BudgetGuardRefusal | null>;

/** A charge core has just recorded. */
export type ChargeEvent = { orgId: string; agentSlug?: string; feature?: string; tokens: number; microCents: number; at: Date };

/** Told about every charge after it commits. Errors are logged, never thrown. */
export type ChargeObserver = (event: ChargeEvent) => Promise<void>;

/** Who is looking at a page an extension slot renders into. */
export type ExtensionSlotContext = {
  locale: string;
  userId: string | null;
  /** The workspace (`project.id`), as everywhere in code. */
  orgId: string | null;
  /** The Org (`tenant_account.id`). */
  accountId: string | null;
  /** The person's role in that Org. */
  role: 'admin' | 'member' | null;
};

/** What an extension page receives: the path under `/dashboard/ext/<page>/` and the query. */
export type ExtensionPageProps = { path: string[]; searchParams: Record<string, string | string[] | undefined> };

/** The server-rendered places an extension can add to. */
export type ExtensionSlotName = 'system.actions' | 'spend.stats';

/** A component rendered into a slot. May be async (a server component). */
export type ExtensionSlotComponent = (props: { ctx: ExtensionSlotContext }) => ReactNode | Promise<ReactNode>;

export type VocionExtension = {
  /** Unique, URL-safe. Its router is served at `ext.<name>`. */
  name: string;
  budgetGuards?: BudgetGuard[];
  chargeObservers?: ChargeObserver[];
  /** oRPC procedures, served at `ext.<name>` on `/rpc`. */
  router?: Record<string, unknown>;
  /** Pages, by the first path segment under `/dashboard/ext/`. */
  pages?: Record<string, (props: ExtensionPageProps) => ReactNode | Promise<ReactNode>>;
  slots?: Partial<Record<ExtensionSlotName, ExtensionSlotComponent[]>>;
  /** Org policy (`services/OrgPolicy.ts`). */
  orgs?: {
    /** True lifts the single-Org rule: several Orgs on the server, a person in several. */
    multiOrg?: () => boolean;
    /** True makes the workspace switcher list only the current Org's workspaces. */
    scopeWorkspaceSwitcher?: boolean;
  };
};

/** What a component in the sidebar's nav slot receives. */
export type NavSlotProps = {
  /** What the sidebar loaded for its switcher; null while loading. */
  directory: WorkspaceDirectory | null;
  /** The page a switch to a workspace lands on, as the workspace switcher computes it. */
  targetPath: WorkspaceSwitcherTargetPath;
  /** Whether the sidebar is collapsed to its icon rail. */
  collapsed: boolean;
};

/** The client-side places an extension can add to. */
export type NavSlotName = 'nav.aboveWorkspaceSwitcher';

/** The client half of an extension, exported by `@vocion/enterprise/client`. */
export type VocionClientExtension = {
  name: string;
  navSlots?: Partial<Record<NavSlotName, ComponentType<NavSlotProps>[]>>;
};

/** Every extension built into this app, in the order the package lists them. Empty without one. */
export function extensions(): readonly VocionExtension[] {
  return built;
}

/** Every budget guard, in extension order. */
export function budgetGuards(): BudgetGuard[] {
  return extensions().flatMap(e => e.budgetGuards ?? []);
}

/** Every charge observer, in extension order. */
export function chargeObservers(): ChargeObserver[] {
  return extensions().flatMap(e => e.chargeObservers ?? []);
}

/** Each extension's router by name, as `/rpc` serves them under `ext`. */
export function extensionRouters(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(extensions().filter(e => e.router).map(e => [e.name, e.router!]));
}

/**
 * The page an extension serves at `/dashboard/ext/<name>`, or null.
 * @param name - The first path segment under `/dashboard/ext/`.
 */
export function extensionPage(name: string): NonNullable<VocionExtension['pages']>[string] | null {
  for (const e of extensions()) {
    const page = e.pages && Object.hasOwn(e.pages, name) ? e.pages[name] : undefined;
    if (page) {
      return page;
    }
  }
  return null;
}

/**
 * The components extensions put in one slot, in extension order.
 * @param name - The slot.
 */
export function slotComponents(name: ExtensionSlotName): ExtensionSlotComponent[] {
  return extensions().flatMap(e => e.slots?.[name] ?? []);
}

/** Whether an extension lifts the single-Org rule. A hook that throws lifts nothing. */
export function extensionAllowsMultiOrg(): boolean {
  return extensions().some((e) => {
    try {
      return e.orgs?.multiOrg?.() === true;
    } catch {
      return false;
    }
  });
}

/** Whether an extension asks the workspace switcher to list only the current Org's workspaces. */
export function extensionScopesSwitcherToOrg(): boolean {
  return extensions().some(e => e.orgs?.scopeWorkspaceSwitcher === true);
}
