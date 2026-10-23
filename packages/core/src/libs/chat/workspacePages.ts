/**
 * Pages that hold the whole workspace's work rather than one record or one
 * seat's: the router gives a first turn there to the lead, and the tools that
 * work the page stay loaded while the person is on it. A leaf module: the
 * router and the tool registry both read it.
 */

/**
 * The name of a workspace-wide page a path is, or null: the Review queue's
 * list (`/dashboard/inbox`, under any `/w/<slug>` and locale prefix, any
 * query). A decision's own page (`/dashboard/inbox/<id>`) is a record, not
 * the queue. Pure.
 * @param path - The page path.
 */
export function workspaceWidePage(path: string | null | undefined): 'Review queue' | null {
  if (!path) {
    return null;
  }
  const bare = path.split(/[?#]/)[0]!.replace(/\/+$/, '');
  return /(?:^|\/)dashboard\/inbox$/.test(bare) ? 'Review queue' : null;
}
