import { describe, expect, it } from 'vitest';
import { slackThreadUrl } from './slackLink';

describe('a Slack thread\'s address', () => {
  it('opens the thread itself when the team is known, else the channel; nothing for another surface', () => {
    expect(slackThreadUrl('slack:C42:1700000000.000100', 'T7')).toBe('https://app.slack.com/client/T7/C42/thread/C42-1700000000.000100');
    expect(slackThreadUrl('slack:C42:1700000000.000100', null)).toBe('https://slack.com/app_redirect?channel=C42');
    expect(slackThreadUrl('web:page', 'T7')).toBeNull();
  });
});
