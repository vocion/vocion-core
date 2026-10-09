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
 * | `signInProviders` | `libs/identity/signInProviders.ts`: more "Continue with …" ways in, under core's invite-only rules |
 * | `branding.whiteLabel` | `services/branding/OrgBrandService.ts`: drops the "Powered by Vocion" mark from sign-in and the sidebar |
 *
 * Client-side pieces (a component in the sidebar) cannot come from this list,
 * because it imports server code. They come from `@vocion/enterprise/client`
 * through `libs/clientExtensions.ts`; their types are here. The one client
 * seam today is `nav.workspacePicker.org`: an Org's group header inside the
 * one workspace picker (`features/dashboard/nav/WorkspaceSwitcher.tsx`).
 */

import type { ComponentType, ReactNode } from 'react';
import type { WorkspaceDirectory } from '@/features/dashboard/nav/useWorkspaceDirectory';
import type { SwitcherAccount, WorkspaceSwitcherTargetPath } from '@/features/dashboard/nav/workspaceSwitch';
import type { SignInProviderDescriptor } from '@/libs/identity/signInProviders';
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
    /**
     * @deprecated Ignored. The one workspace picker lists every Org's
     * workspaces, grouped by Org; kept so an extension built before that
     * still compiles.
     */
    scopeWorkspaceSwitcher?: boolean;
  };
  /**
   * More sign-in providers, after core's Google and Microsoft. Each is offered
   * only when its own `configured` says so, and every sign-in through one goes
   * through core's invite-only rules, which read only the address its
   * `trustedEmail` vouches for.
   */
  signInProviders?: SignInProviderDescriptor[];
  /**
   * An Org's brand (`services/branding`). Core always keeps a small "Powered
   * by Vocion" mark on sign-in and in the sidebar under an Org's own logo;
   * `whiteLabel` returning true removes it. Not in core.
   */
  branding?: {
    whiteLabel?: () => boolean;
  };
};

/** What a component in the retired `nav.aboveWorkspaceSwitcher` slot received. */
export type NavSlotProps = {
  /** What the sidebar loaded for its switcher; null while loading. */
  directory: WorkspaceDirectory | null;
  /** The page a switch to a workspace lands on, as the workspace switcher computes it. */
  targetPath: WorkspaceSwitcherTargetPath;
  /** Whether the sidebar is collapsed to its icon rail. */
  collapsed: boolean;
};

/** What an Org's group header inside the one workspace picker receives. */
export type PickerOrgProps = {
  /** The Org this header heads. */
  org: SwitcherAccount;
  /** Whether it is the Org this session is in. */
  current: boolean;
  /** Closes the picker: call it before navigating, or when the pick changes nothing. */
  close: () => void;
  /** What the sidebar loaded for the picker. */
  directory: WorkspaceDirectory;
  /** The page a switch to a workspace lands on, as the picker computes it. */
  targetPath: WorkspaceSwitcherTargetPath;
};

/** Each client-side place an extension can add to, and what its components receive. */
export type NavSlotPropsByName = {
  /**
   * An Org's group header inside the one workspace picker, which lists every
   * Org's workspaces under its Org on a multi-Org deployment. The first
   * extension's component draws it; without one, the header is the Org's name.
   * A header that is a control carries `role="option"`, so the picker's arrow
   * keys reach it.
   */
  'nav.workspacePicker.org': PickerOrgProps;
  /**
   * @deprecated No longer rendered. A second switcher above the workspace
   * picker read as two switchers (founder, 2026-10-08); the Org belongs
   * inside the picker, as `nav.workspacePicker.org`. Kept so an extension
   * built before that still compiles.
   */
  'nav.aboveWorkspaceSwitcher': NavSlotProps;
};

/** The client-side places an extension can add to. */
export type NavSlotName = keyof NavSlotPropsByName;

/** The client half of an extension, exported by `@vocion/enterprise/client`. */
export type VocionClientExtension = {
  name: string;
  navSlots?: { [K in NavSlotName]?: ComponentType<NavSlotPropsByName[K]>[] };
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

/** Every sign-in provider extensions add, in extension order. */
export function extensionSignInProviders(): SignInProviderDescriptor[] {
  return extensions().flatMap(e => e.signInProviders ?? []);
}

/** Whether an extension white-labels the app (no "Powered by Vocion" mark). A hook that throws white-labels nothing. */
export function extensionWhiteLabel(): boolean {
  return extensions().some((e) => {
    try {
      return e.branding?.whiteLabel?.() === true;
    } catch {
      return false;
    }
  });
}
