/**
 * Who a shared artifact opens for — one model for the artifact page, the
 * preview pane and the public link (Chris, 2026-09-18: "choose whether I need
 * to be me, in the Revenue Team workspace, or anyone that can see it").
 *
 *   me         only the person who set it (the workspace still lists the title)
 *   workspace  any signed-in member of the workspace — the default, and what
 *              every artifact was before this existed
 *   anyone     anyone holding the signed link, read-only, no sign-in
 *
 * Pure, so the rule is one function that the server routes, the page and the
 * tests all call. Never a component's own if-chain.
 */

export const SHARE_AUDIENCES = ['me', 'workspace', 'anyone'] as const;
export type ShareAudience = (typeof SHARE_AUDIENCES)[number];

export type ShareViewer = {
  /** Signed-in user id, or null for an anonymous reader. */
  userId: string | null;
  /** Whether the viewer is a member of the artifact's workspace. */
  isMember: boolean;
  /** Whether the request carried a valid public token for THIS artifact. */
  hasToken: boolean;
};

export type ShareState = {
  audience: ShareAudience;
  /** The person who chose `me`; null for the other audiences. */
  ownerId: string | null;
};

/**
 * Whether a viewer may open an artifact under its share state.
 * @param share - The artifact's audience and owner.
 * @param viewer - Who is asking.
 */
export function canOpenArtifact(share: ShareState, viewer: ShareViewer): boolean {
  switch (share.audience) {
    case 'anyone':
      return viewer.hasToken || viewer.isMember;
    case 'workspace':
      return viewer.isMember;
    case 'me':
      return viewer.isMember && viewer.userId !== null && viewer.userId === share.ownerId;
    default:
      return false;
  }
}

/** The one line each audience shows in the picker. */
export const SHARE_AUDIENCE_COPY: Record<ShareAudience, { label: string; hint: (workspace: string) => string }> = {
  me: { label: 'Only me', hint: () => 'Nobody else opens it, even with the link' },
  workspace: { label: 'This workspace', hint: w => `Anyone signed in to ${w}` },
  anyone: { label: 'Anyone with the link', hint: () => 'Read-only, no sign-in. Switch back to revoke.' },
};
