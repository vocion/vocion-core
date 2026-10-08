/**
 * Registry of built-in source connectors. Plugin-loaded connectors
 * register themselves here on boot via `registerConnector()`.
 *
 * The registry is the single point of truth the UI + SourceSyncService
 * read. The Sources page picker iterates `listConnectors()` to render
 * tiles; the sync runner looks up the matching connector by slug.
 */

import type { SourceConnector } from './types';
import { apolloConnector } from './apollo';
import { billConnector } from './bill';
import { boxConnector } from './box';
import { confluenceConnector } from './confluence';
import { driveConnector } from './drive';
import { dropboxConnector } from './dropbox';
import { elevenLabsConnector } from './elevenlabs';
import { fileImportConnector } from './fileImport';
import { freshdeskConnector } from './freshdesk';
import { ga4Connector } from './ga4';
import { githubConnector } from './github';
import { gitlabConnector } from './gitlab';
import { gmailConnector } from './gmail';
import { googleAdsConnector } from './googleAds';
import { googleCalendarConnector } from './googleCalendar';
import { granolaConnector } from './granola';
import { gustoConnector } from './gusto';
import { hubspotConnector } from './hubspot';
import { intercomConnector } from './intercom';
import { jiraConnector } from './jira';
import { linearConnector } from './linear';
import { localFilesConnector } from './localFiles';
import { netsuiteConnector } from './netsuite';
import { notionConnector } from './notion';
import { pagerdutyConnector } from './pagerduty';
import { posthogConnector } from './posthog';
import { quickbooksConnector } from './quickbooks';
import { rampConnector } from './ramp';
import { restConnector } from './rest';
import { ripplingConnector } from './rippling';
import { s3Connector } from './s3';
import { sentryConnector } from './sentry';
import { slackConnector } from './slack';
import { slateConnector } from './slate';
import { strapiConnector } from './strapi';
import { stripeConnector } from './stripe';
import { webConnector } from './web';
import { workdayConnector } from './workday';
import { xeroConnector } from './xero';
import { zendeskConnector } from './zendesk';
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

// Built-ins, in the order they shipped. The picker sorts its tiles A–Z, so
// this order is not what an operator sees — append new connectors at the end.
registerConnector(webConnector);
registerConnector(localFilesConnector);
registerConnector(fileImportConnector);
registerConnector(hubspotConnector);
registerConnector(strapiConnector);
registerConnector(jiraConnector);
registerConnector(googleAdsConnector);
registerConnector(ga4Connector);
registerConnector(gmailConnector);
registerConnector(googleCalendarConnector);
registerConnector(granolaConnector);
registerConnector(slackConnector);
registerConnector(driveConnector);
registerConnector(zoomConnector);
registerConnector(s3Connector);
registerConnector(apolloConnector);
registerConnector(notionConnector);
registerConnector(posthogConnector);
registerConnector(githubConnector);
registerConnector(restConnector);
registerConnector(sentryConnector);
registerConnector(slateConnector);
registerConnector(elevenLabsConnector);
registerConnector(quickbooksConnector);
// The finance and people families (`services/finance`, `services/people`).
registerConnector(stripeConnector);
registerConnector(xeroConnector);
registerConnector(netsuiteConnector);
registerConnector(rampConnector);
registerConnector(billConnector);
registerConnector(gustoConnector);
registerConnector(ripplingConnector);
registerConnector(workdayConnector);
// Prebuilt connectors: help desks, engineering, docs and file storage.
registerConnector(zendeskConnector);
registerConnector(intercomConnector);
registerConnector(freshdeskConnector);
registerConnector(linearConnector);
registerConnector(gitlabConnector);
registerConnector(pagerdutyConnector);
registerConnector(confluenceConnector);
registerConnector(dropboxConnector);
registerConnector(boxConnector);
