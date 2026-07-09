/**
 * Registry of built-in source connectors. Plugin-loaded connectors
 * register themselves here on boot via `registerConnector()`.
 *
 * The registry is the single point of truth the UI + SourceSyncService
 * read. The Sources page picker iterates `listConnectors()` to render
 * tiles; the sync runner looks up the matching connector by slug.
 */

import type { SourceConnector } from './types';
import { driveConnector } from './drive';
import { fileImportConnector } from './fileImport';
import { ga4Connector } from './ga4';
import { gmailConnector } from './gmail';
import { googleAdsConnector } from './googleAds';
import { googleCalendarConnector } from './googleCalendar';
import { hubspotConnector } from './hubspot';
import { localFilesConnector } from './localFiles';
import { slackConnector } from './slack';
import { webConnector } from './web';
import { zoomConnector } from './zoom';

const registry = new Map<string, SourceConnector>();

export function registerConnector(connector: SourceConnector): void {
  registry.set(connector.slug, connector);
}

export function getConnector(slug: string): SourceConnector | undefined {
  return registry.get(slug);
}

export function listConnectors(): SourceConnector[] {
  return Array.from(registry.values());
}

// Built-ins. Order matters for the picker tile layout.
registerConnector(webConnector);
registerConnector(localFilesConnector);
registerConnector(fileImportConnector);
registerConnector(hubspotConnector);
registerConnector(googleAdsConnector);
registerConnector(ga4Connector);
registerConnector(gmailConnector);
registerConnector(googleCalendarConnector);
registerConnector(slackConnector);
registerConnector(driveConnector);
registerConnector(zoomConnector);
