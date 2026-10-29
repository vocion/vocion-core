import { publishTargetsOf } from '@/libs/publish/targets';

/** What a GitHub target looks like, shown when the project has none yet. */
export const PUBLISH_TARGET_EXAMPLE = '[{"id": "site", "kind": "github", "label": "Website", "config": {"repo": "example-org/northwind-site", "baseBranch": "main", "path": "src/content/blog/{slug}.mdx"}}]';

/**
 * Why a publish-targets edit cannot be saved, one line per problem, read with
 * publishing's own schema (`publishTargetsOf`), so the editor says what the
 * server would refuse before it is sent. Empty when it holds.
 * @param json - The editor's text.
 */
export function publishTargetProblems(json: string): string[] {
  let parsed: unknown;
  try {
    parsed = json.trim() ? JSON.parse(json) : [];
  } catch (e) {
    return [`Not JSON: ${(e as Error).message}. Publish targets are a list, e.g. ${PUBLISH_TARGET_EXAMPLE}`];
  }
  return publishTargetsOf(parsed).problems;
}
