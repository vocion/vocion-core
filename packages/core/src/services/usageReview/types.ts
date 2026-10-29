/**
 * The shapes the usage review hands across the extension seam
 * (`libs/extensions.ts`, `usageReview`). Types only, so the seam's file
 * imports nothing that runs.
 */

import type { ReadMode, ReadModeWhy } from './privacy';

/** One workspace's day, as the operator roll-up carries it. */
export type RollupWorkspace = {
  orgId: string;
  workspaceName: string;
  accountId: string | null;
  orgName: string | null;
  /** How the Org was read. Content-level lines below are present only for `content`. */
  mode: ReadMode;
  why: ReadModeWhy;
  /** The workspace's own report, absolute. */
  href: string;
  threads: number | null;
  outcomeRate: number | null;
  reaskRate: number | null;
  approvals: number | null;
  /** Friction themes with how many threads showed each — labels from code, never a person's words. */
  themes: Array<{ label: string; count: number }>;
  /** Content mode only: the threads most worth a look, each with its link and what would have been better. */
  worthALook: Array<{ thread: string; href: string | null; outcome: string; better: string }>;
  /** Content mode only: connectors, skills and tools people needed. */
  missing: Array<{ kind: string; name: string; why: string }>;
  /** Content mode only: turns whose effort level did not fit. */
  effort: Array<{ thread: string; ranAt: string; needed: string }>;
};

/** The day across every workspace, for the people who operate the deployment. */
export type OperatorRollup = {
  asOf: string;
  workspaces: RollupWorkspace[];
  /** Capability requests people approved in the window — content-mode Orgs only. */
  requests: CapabilityRequest[];
};

/** A connector, skill or tool a person approved asking for. */
export type CapabilityRequest = {
  orgId: string;
  capability: 'connector' | 'skill' | 'tool';
  name: string;
  need: string;
  evidence: Array<{ label: string; value: string; href?: string }>;
  decidedBy: string | null;
};
