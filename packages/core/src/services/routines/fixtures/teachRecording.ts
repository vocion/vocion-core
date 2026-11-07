/**
 * A taught recording as Slate's MCP answered for it (read 2026-11-06 from the
 * Provider Enrollment demo's redacted source recording), cut to its first two
 * and a half minutes, with fixture ids, a fictional owner and example links in
 * place of the real ones. The specialist's words are as said (already redacted
 * in brackets on Slate). Used to drive teaching end to end without a token.
 */

export const FIXTURE_LINK = 'https://slate.video-host.example/v/Fx7teach0001';

export const FIXTURE_VIDEO = JSON.stringify({
  id: '01a00000-0000-7000-8000-000000000002',
  shareId: 'Fx7teach0001',
  url: FIXTURE_LINK,
  title: 'Provider enrollment, recorded by a credentialing specialist (identifying details blurred)',
  titleSource: 'user',
  summary: 'A credentialing specialist checks a provider\'s license, then opens the health plan\'s onboarding form, explaining each step.',
  kind: 'screen',
  status: 'ready',
  durationSec: 595.5,
  owner: { id: 'u-2', name: 'Marcus Hale', email: 'marcus@cedarhollow.example' },
  submitterName: null,
  visibility: 'public',
  transcript: 'ready',
  posterUrl: 'https://media.video-host.example/fixture/poster.jpg',
  downloadUrl: 'https://api.video-host.example/v1/share/Fx7teach0001/download?token=library.fixture',
  links: [],
  chapters: [
    { title: 'Checking provider license status', at: 0, atLabel: '0:00', endSec: 72.57 },
    { title: 'Navigating to provider onboarding form', at: 72.57, atLabel: '1:12', endSec: 158.78 },
  ],
  appsOnScreen: [],
  next: ['get_transcript for what was said', 'get_screenshot to look at a moment'],
}, null, 2);

export const FIXTURE_TRANSCRIPT = `"Provider enrollment, recorded by a credentialing specialist (identifying details blurred)", 9:55 long, language en-US, 18 of 69 lines

[0:02] And then, uh, the first thing that I did here is to check the provider's information.
[0:10] So I'm not gonna slide down because we'll see the.
[0:15] SSN here or I'll just hide it. So it's hidden.
[0:25] Now, uh, the first thing that I'm doing before I submit, um.
[0:31] The application first is I check the license if both are active so how I'm doing this is um actually going or doing it online.
[0:44] So if you can see the sample here [provider name], her license is um active.
[0:52] And this is the effective date and the expiration date.
[0:56] So since I confirmed that this is active.
[0:59] Um. And now, um, go ahead and.
[1:11] Do the submission. So first thing is, ah, I go [the health plan website], which is the website.
[1:20] And select providers.
[1:25] And on the provider page I select network participation and join our network.
[1:34] So from here, um, we could select here the the type of provider that we are working in uh with so since um these providers are social worker.
[1:49] I go ahead with hospital and other providers.
[1:54] So why this selection is because it says other providers and it doesn't separate the behavioral health providers.
[2:04] Um, in here we, we could not, um, do the application of the medical providers because it may be rejected since this section is only for medical providers and this is for ancillary like other stuff like DME, um, and.
[2:21] Other providers. But this is the best fit for us.
[2:27] So I click provider on boarding form. And we were routed to this page, the onboarding online form.`;

export const FIXTURE_ACTIVITY = JSON.stringify({ moments: [], note: 'Nothing was recorded about what was on screen for this recording.' }, null, 2);

/** What the analyst writes for it, in the order its prompt asks: findings first. */
export const FIXTURE_ANALYST_REPLY = `\`\`\`json
{
  "name": "Check a provider's license and open the plan's onboarding form",
  "description": "Confirms a provider's license is active, then opens the health plan's provider onboarding form.",
  "summary": "Checks the provider's license online and goes on only when it is active, then opens the plan's onboarding form under hospital and other providers.",
  "startUrl": null,
  "sites": [
    { "name": "State license lookup", "url": "https://licenses.demo.example/", "at": 31 },
    { "name": "Larkspur Health Plan provider pages", "url": "https://larkspur.demo.example/providers", "at": 71 }
  ],
  "steps": [
    { "n": 1, "text": "Open the provider's record and read their information", "why": "Everything after uses it", "at": 2 },
    { "n": 2, "text": "Look up the license online and read its status, effective and expiration dates", "why": "Only an active license goes on to the application", "at": 31 },
    { "n": 3, "text": "Open the health plan's website and select Providers", "why": null, "at": 71 },
    { "n": 4, "text": "Select Network participation, then Join our network", "why": null, "at": 85 },
    { "n": 5, "text": "Choose Hospital and other providers", "why": "Behavioral health is not listed apart, and the medical section would reject it", "at": 109 },
    { "n": 6, "text": "Click Provider onboarding form", "why": null, "at": 147 }
  ],
  "rules": [
    { "text": "Check that the license is active before submitting anything", "at": 25 },
    { "text": "Keep the SSN hidden on screen", "at": 15 }
  ],
  "judgments": [
    { "text": "Reads the license as active from its status and dates, and only then goes on", "at": 56 },
    { "text": "Chooses Hospital and other providers because social workers are not medical providers", "at": 114 }
  ],
  "escalations": [
    { "when": "the license is not active", "ask": "whether to stop the enrollment", "at": 44 }
  ],
  "questions": [
    { "question": "What if one of the two licenses is active and the other is not?", "why": "The specialist checks that both are active", "at": 31 }
  ],
  "systems": ["licenses.demo.example", "larkspur.demo.example"],
  "inputs": [{ "name": "provider_name", "description": "The provider", "example": null, "key": true }],
  "outputs": [{ "name": "license_status", "description": "The license status as read", "checks": null }],
  "preconditions": [],
  "prohibited": ["Show the SSN"],
  "postconditions": ["The onboarding form is open"],
  "writes": [],
  "reconcile": null,
  "manualMinutes": 2.5
}
\`\`\``;
