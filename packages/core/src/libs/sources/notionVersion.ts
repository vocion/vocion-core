/**
 * The `Notion-Version` header Vocion speaks by default, pinned to the oldest
 * version whose page and database shapes the Notion connector reads. The sync
 * sends it on every request unless a source overrides it, and the "Log in
 * with Notion" token exchange sends it too, since Notion's token endpoint
 * requires the header. A leaf file, so the login can read it without
 * importing the whole connector.
 */
export const DEFAULT_NOTION_VERSION = '2022-06-28';
