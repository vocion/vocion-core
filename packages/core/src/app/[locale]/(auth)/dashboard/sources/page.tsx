import { redirect } from 'next/navigation';

/**
 * "Sources" is now "Connectors" — the word everyone outside the codebase was
 * already using. Only the front end moved: `source_install`,
 * `knowledge_source` and `SourceConnector` are unchanged.
 *
 * This page stays so existing links and bookmarks keep working.
 */
export default function SourcesPage() {
  redirect('/dashboard/connectors');
}
