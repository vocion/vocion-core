/**
 * Registry of built-in source connectors. Plugin-loaded connectors
 * register themselves here on boot via `registerConnector()`.
 *
 * The registry is the single point of truth the UI + SourceSyncService
 * read. The Sources page picker iterates `listConnectors()` to render
 * tiles; the sync runner looks up the matching connector by slug.
 */

import type { SourceConnector } from './types';
import { amplitudeConnector } from './amplitude';
import { apolloConnector } from './apollo';
import { attioConnector } from './attio';
import { bigqueryConnector } from './bigquery';
import { billConnector } from './bill';
import { databricksConnector } from './databricks';
import { driveConnector } from './drive';
import { elevenLabsConnector } from './elevenlabs';
import { fileImportConnector } from './fileImport';
import { firefliesConnector } from './fireflies';
import { ga4Connector } from './ga4';
import { githubConnector } from './github';
import { gmailConnector } from './gmail';
import { gongConnector } from './gong';
import { googleAdsConnector } from './googleAds';
import { googleCalendarConnector } from './googleCalendar';
import { googleMeetConnector } from './googleMeet';
import { granolaConnector } from './granola';
import { gustoConnector } from './gusto';
import { hubspotConnector } from './hubspot';
import { jiraConnector } from './jira';
import { linkedinAdsConnector } from './linkedinAds';
import { localFilesConnector } from './localFiles';
import { metaAdsConnector } from './metaAds';
import { mixpanelConnector } from './mixpanel';
import { netsuiteConnector } from './netsuite';
import { notionConnector } from './notion';
import { pipedriveConnector } from './pipedrive';
import { posthogConnector } from './posthog';
import { quickbooksConnector } from './quickbooks';
import { rampConnector } from './ramp';
import { redshiftConnector } from './redshift';
import { restConnector } from './rest';
import { ripplingConnector } from './rippling';
import { s3Connector } from './s3';
import { salesforceConnector } from './salesforce';
import { sentryConnector } from './sentry';
import { slackConnector } from './slack';
import { slateConnector } from './slate';
import { snowflakeConnector } from './snowflake';
import { strapiConnector } from './strapi';
import { stripeConnector } from './stripe';
import { webConnector } from './web';
import { workdayConnector } from './workday';
import { xeroConnector } from './xero';
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
// A business's numbers, read live (`libs/connectors/families.ts`): the
// warehouses, product analytics and ad platforms.
registerConnector(snowflakeConnector);
registerConnector(bigqueryConnector);
registerConnector(databricksConnector);
registerConnector(redshiftConnector);
registerConnector(mixpanelConnector);
registerConnector(amplitudeConnector);
registerConnector(linkedinAdsConnector);
registerConnector(metaAdsConnector);
// The CRM family (`services/crm/provider.ts`) and the meetings family
// (`services/meetings/provider.ts`).
registerConnector(salesforceConnector);
registerConnector(pipedriveConnector);
registerConnector(attioConnector);
registerConnector(gongConnector);
registerConnector(firefliesConnector);
registerConnector(googleMeetConnector);
