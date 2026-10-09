/**
 * WHERE A BRAND SHOWS — one brand per region, none in the chat.
 *
 * The app chrome has three places a brand can sit, and each shows at most one:
 *
 * - **The top bar's leading mark** (next to the sidebar toggle, ~20px, goes
 *   home): the install's lead brand. On a multi-Org server (Vocion Cloud)
 *   that is Vocion's mark; on a single-Org install whose Org has a brand it
 *   is the Org's mark.
 * - **The switcher chip**: the Org's own logo whenever it has one, on any
 *   install; its letter avatar otherwise (`WorkspaceSwitcher`).
 * - **The drawer footer**, under the person: a small Vocion wordmark when
 *   Vocion leads, "Powered by Vocion" when the Org leads (unless an
 *   extension white-labels). Never both.
 *
 * The tab title and favicon follow the lead: "Vocion" on Cloud, the Org's
 * name and mark on a branded single-Org install. The Org's accent stays on
 * the primary buttons and the lead's ring wherever it has one. The chat body
 * (the empty state, the thread) shows no brand.
 *
 * Which brand leads is an install setting, `VOCION_LEAD_BRAND`: `auto` (the
 * default — Vocion on a multi-Org server, the Org on a single-Org one),
 * `vocion` or `org`. An Org with no brand never leads: Vocion does.
 *
 * Pure, for its test; the layout reads the setting and hands the result down.
 */

export type LeadBrandSetting = 'auto' | 'vocion' | 'org';

export type BrandChrome = {
  /** Whose mark the top bar leads with, and whose name and favicon the tab wears. */
  lead: 'vocion' | 'org';
  /** The drawer footer's quiet line: Vocion's wordmark, "Powered by Vocion", or nothing (white-label). */
  footer: 'vocion-wordmark' | 'powered-by' | null;
};

/**
 * The setting as the environment gives it; anything unknown is `auto`.
 * @param raw - `VOCION_LEAD_BRAND`.
 */
export function leadBrandSetting(raw: string | undefined): LeadBrandSetting {
  const v = raw?.trim().toLowerCase();
  return v === 'vocion' || v === 'org' ? v : 'auto';
}

/**
 * Which brand each region shows.
 * @param input - What the install says.
 * @param input.setting - `VOCION_LEAD_BRAND`.
 * @param input.orgsMode - `single` or `multi` (`services/OrgPolicy.ts`).
 * @param input.orgBranded - Whether the Org in view has a brand.
 * @param input.poweredBy - False only when an extension white-labels.
 */
export function brandChrome(input: { setting: LeadBrandSetting; orgsMode: 'single' | 'multi'; orgBranded: boolean; poweredBy: boolean }): BrandChrome {
  const wanted = input.setting === 'auto' ? (input.orgsMode === 'multi' ? 'vocion' : 'org') : input.setting;
  const lead = wanted === 'org' && input.orgBranded ? 'org' : 'vocion';
  return { lead, footer: lead === 'vocion' ? 'vocion-wordmark' : input.poweredBy ? 'powered-by' : null };
}
