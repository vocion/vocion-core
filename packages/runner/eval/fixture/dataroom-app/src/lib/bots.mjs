// Link-preview robots and crawlers: chat apps and mail clients fetch a pasted link to draw its
// preview. A visit from one of these is not a person opening the link.
const BOT_PATTERNS = [
  /slackbot/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /discordbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /googlebot/i,
  /bingbot/i,
  /microsoft office/i,
  /outlook-safelinks/i,
  /\bbot\b/i,
  /crawler|spider|preview/i,
];

export function isBot(userAgent) {
  const ua = String(userAgent || '');
  return ua === '' ? false : BOT_PATTERNS.some(p => p.test(ua));
}
