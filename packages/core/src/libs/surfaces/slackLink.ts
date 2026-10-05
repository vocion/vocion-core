/**
 * A Slack thread's address, from what Vocion keeps: the conversation's scope (`slack:<channel>:<ts>`)
 * and the team the channel belongs to. Opens the thread in Slack, in the app or the browser.
 * @param scopeRef - The conversation's scope ref.
 * @param teamId - The Slack team id, when known.
 */
export function slackThreadUrl(scopeRef: string | null | undefined, teamId: string | null | undefined): string | null {
  const m = /^slack:([^:]+):([^:]+)$/.exec(scopeRef ?? '');
  if (!m) {
    return null;
  }
  const [, channel, ts] = m;
  return teamId ? `https://app.slack.com/client/${teamId}/${channel}/thread/${channel}-${ts}` : `https://slack.com/app_redirect?channel=${channel}`;
}
