/**
 * Real-world data this repository must never contain again.
 *
 * Two kinds of rule live here, because two different things leaked:
 *
 * - `BANNED_NAMES` — specific identities, matched by hash. Exact, and the only
 *   thing that can catch a name nobody would otherwise recognise.
 * - `REAL_DATA_SHAPES` — patterns, matched by regex. A recording URL, a
 *   provider org id, a phone number and a street address are not names; hashing
 *   the ones we removed would not stop someone pasting a *different* real one
 *   next week. A shape rule does.
 *
 * This repo is PUBLIC. Until 2026-09 its tests, Storybook stories, seed
 * scripts and docs used real customers, real prospects, real contacts, real
 * venues, real domains and live CRM/Zoom/Clerk identifiers as fixture data.
 * They were replaced with the fixture cast below; this list is what stops them
 * coming back — `realDataGuard.test.ts` scans every tracked file (contents *and*
 * path) on every unit-test run and fails with the file and line.
 *
 * ## Why the entries are hashes
 *
 * Writing the names here in plain text would re-introduce exactly what we
 * removed: a grep for any of them would hit this file. Each entry is therefore
 * the truncated SHA-256 of the *normalised* term — lowercased, with every run
 * of non-alphanumerics collapsed to a single space. The scanner normalises each
 * line the same way, so a one-word banned name trips whether it is written
 * `Name`, `NAME`, `ops@name.com`, `sheet-name-1440.png` or `name_hub`: all of
 * them reduce to the same token.
 *
 * ## Adding an entry
 *
 * Never paste the name into this file. Hash it:
 *
 * ```sh
 * node -e 'const{createHash}=require("node:crypto");
 *   const n=s=>s.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
 *   const t=process.argv[1];const w=n(t).split(" ");
 *   console.log({hash:createHash("sha256").update(n(t)).digest("hex").slice(0,16),
 *     head:createHash("sha256").update(w[0]).digest("hex").slice(0,16),
 *     words:w.length});' "The Name"
 * ```
 *
 * Then add `{ id, hash, head, words, why }` below. `id` is a non-identifying
 * label; `why` says what category of thing it was and what fixture replaced it,
 * so a future reader can tell a scrubbed name from a coincidence without
 * knowing the name.
 *
 * ## The fixture cast
 *
 * Reuse these rather than inventing a new name, and keep each one's role fixed
 * — the same company must not be a customer in one test and an agency in
 * another:
 *
 * | fixture | role |
 * |---|---|
 * | `Northwind` | customer with a live retainer deal in the revenue pipeline |
 * | `Kestrel Capital` (contact `Dana Reyes`) | investor / referral source / sponsor account |
 * | `Radley Manufacturing` | manufacturing client whose photo kits go through vision QC |
 * | `Larkfield Systems` | the fictional client tenant that runs its own parent deployment |
 * | `Bellwater Hall` | event venue; the primary web-crawl source |
 * | `Ashby Library`, `Mill Creek Library`, `The Corvina`, `The Marlow` | other event sources |
 * | `Contoso Supply` (contact `Jamie Smith`) | MSP prospect in the personalization queue |
 * | `Tideline Gaming Marketing` (contact `Rowan Pike`) | agency prospect, the Detail-archetype worked example |
 * | `Acme` / `Acme Retail` | generic prospect |
 * | `Meridian Dental`, `Atlas Field Services`, `Summit Facilities`, `Corvus Media`, `Beacon Health`, `Harbor & Finch`, `Cobalt` | pipeline accounts in demo turns and briefing fixtures |
 *
 * Email addresses belong at `.example` (`ops@northwind.example`), never at a
 * registrable domain. Ids keep their shape but not their value.
 *
 * ## What is deliberately NOT here
 *
 * `Metacto` — the company that owns Vocion. It is the licensor, the AWS profile,
 * the tenant in the deployment docs and the seller in every discovery fixture,
 * and all of that is legitimate. The rule it does have cannot be expressed as a
 * string match: **Metacto must never appear as a *customer* in a fixture.** It
 * is the seller side of `Acme <> Metacto intro`, never the account being sold to.
 */

import { createHash } from 'node:crypto';

export type BannedName = {
  /** Non-identifying label used in failure output and when discussing the entry. */
  id: string;
  /** Truncated SHA-256 of the normalised term. */
  hash: string;
  /** Truncated SHA-256 of the term's first word — the scanner's prefilter. */
  head: string;
  /** How many words the normalised term has. */
  words: number;
  /** Why it is banned, and what replaced it. Never names it. */
  why: string;
};

/**
 * The longest banned term, in words. The scanner never builds an n-gram longer
 * than this.
 */
export const MAX_BANNED_WORDS = 4;

export const BANNED_NAMES: readonly BannedName[] = [
  // ── Named by the paired workforce repo as unpublishable ──────────────────
  { id: 'customer-marketing-agency', hash: 'e85805b173f346f5', head: 'e85805b173f346f5', words: 1, why: 'Real customer (digital marketing agency). Was the worked example in chat/inbox tests, Storybook stories and the Needs-you guide. Replaced by `Northwind`.' },
  { id: 'customer-equipment-manufacturer', hash: '45d4caaa25004c8b', head: '45d4caaa25004c8b', words: 1, why: 'Real customer (vehicle-equipment manufacturer) whose labelled photo kits the vision tooling was built against. Replaced by `Radley`.' },
  { id: 'customer-retail-hiring', hash: '69761478cb5e125d', head: '908aec4512d80ff4', words: 3, why: 'Real customer (retail chain) used as the reference workspace-pages demo. Replaced by an unnamed hiring-screen demo.' },
  { id: 'customer-workforce-a', hash: '335f7f00e966527e', head: '335f7f00e966527e', words: 1, why: 'Real customer on the workforce repo\'s unpublishable list. Never appeared here; banned pre-emptively.' },
  { id: 'customer-workforce-b', hash: '9da1613599e57b50', head: '9da1613599e57b50', words: 1, why: 'Real customer on the workforce repo\'s unpublishable list. Never appeared here; banned pre-emptively.' },
  { id: 'customer-workforce-c', hash: 'b9ec7f646b183a20', head: '21c584f66fecc917', words: 2, why: 'Real customer on the workforce repo\'s unpublishable list. Never appeared here; banned pre-emptively.' },

  // ── Named in a 2026-09-19 proposal-quality session ───────────────────────
  // Both reached this repo as PROSE, not as fixtures: a real prospect named in
  // two source comments describing where the red team came from, and a real
  // past client named as a reference inside a live proposal that was quoted in
  // working notes. Comments and docs are exactly as public as tests.
  { id: 'prospect-precast-manufacturer', hash: '45e60041ea6a8592', head: '45e60041ea6a8592', words: 1, why: 'Real prospect (precast manufacturer) whose proposal the document red team was built against. Named in two source comments. Refer to it as "a real client proposal"; use `Northwind` in any example.' },
  { id: 'client-named-as-reference', hash: '402f1554aacf309b', head: '402f1554aacf309b', words: 1, why: 'Real past client cited as a reference inside that proposal. Never a fixture; banned so a quote from the document cannot carry it in. Use `Radley Manufacturing`.' },

  // ── The client that ran its own parent deployment ────────────────────────
  { id: 'client-parent-deployment', hash: '44c4030414152e69', head: '44c4030414152e69', words: 1, why: 'Real client. Its name was the second parent-project example in the deployment docs, its GitHub org, its AWS profile, its live API hostnames, an env-var prefix, ~30 ticket ids and dozens of test slugs. Replaced by `Larkfield`.' },

  // ── Third parties whose public data that client crawled ──────────────────
  { id: 'venue-primary', hash: '64d0b8c9584d8b21', head: 'e5ff8d2b6809d810', words: 2, why: 'Real music venue used as the web-extraction fixture, with its real street address and phone number. Replaced by `Bellwater Hall`.' },
  { id: 'venue-primary-domain', hash: '5db659df81b67458', head: '5db659df81b67458', words: 1, why: 'The same venue\'s live domain. Replaced by `bellwaterhall.example`.' },
  { id: 'venue-primary-street', hash: 'd6c77a5fdae0796c', head: 'd6c77a5fdae0796c', words: 1, why: 'Street name from that venue\'s real postal address, carried verbatim in an HTML fixture.' },
  { id: 'venue-arts-centre', hash: '382dd7e80c76f59c', head: '382dd7e80c76f59c', words: 1, why: 'Real performing-arts centre used as the candidate-dedup venue across unit and E2E fixtures. Replaced by `The Corvina`.' },
  { id: 'venue-other', hash: 'e7db08c27ffe5456', head: 'e7db08c27ffe5456', words: 1, why: 'Real venue brand used as a processor-config default. Replaced by `The Marlow`.' },
  { id: 'library-a', hash: '4fd20876d90b7398', head: 'e5a726a3cf969c02', words: 2, why: 'Real public library named in crawler comments describing live shadow runs. Replaced by `Ashby Library`.' },
  { id: 'library-b', hash: 'ec33b54560f1722b', head: 'ec33b54560f1722b', words: 1, why: 'Real public library, same crawler comments. Replaced by `Mill Creek Library`.' },
  { id: 'show-title', hash: 'b210f4754b13366b', head: 'fa690b82061edfd2', words: 2, why: 'Real touring show (third-party IP) scraped into the extraction fixtures. Replaced by a fictional show.' },
  { id: 'performer-a', hash: 'b7b5f526c3451738', head: 'f506fc296dddaaa6', words: 2, why: 'Real performer billed on the scraped venue listing. Replaced by a fictional act.' },
  { id: 'performer-b', hash: '0c8dc5e3f0dff718', head: 'c6b438b0c071b087', words: 2, why: 'Real performer billed on the scraped venue listing. Replaced by a fictional act.' },
  { id: 'ticketing-vendor', hash: '9eff239d00ddb4b8', head: '9eff239d00ddb4b8', words: 1, why: 'Real ticketing vendor whose CDN and checkout URLs were copied into the HTML fixture. Replaced by `tickethub.example`.' },

  // ── Prospects and contacts from the live CRM ─────────────────────────────
  { id: 'prospect-gaming-agency', hash: '8e6387a976718d61', head: '622128caf9c860ed', words: 2, why: 'Real agency used as the personalization lead brief across stories, tests and the Detail archetype doc. Replaced by `Tideline Gaming Marketing`.' },
  { id: 'prospect-gaming-agency-domain', hash: '0981b63631c99a73', head: '622128caf9c860ed', words: 2, why: 'That agency\'s live domain, cited as a research source. Replaced by `tideline.example`.' },
  { id: 'prospect-gaming-agency-ceo', hash: '4d4b292a62ac796e', head: '4d4b292a62ac796e', words: 1, why: 'That agency\'s real CEO, used as the lead\'s name in ~10 files including a chat test that asks "who is …?". Replaced by `Rowan Pike`.' },
  { id: 'prospect-msp', hash: 'c2703bac16f8bfb4', head: 'c2703bac16f8bfb4', words: 1, why: 'Real managed-service provider used as the personalization-queue prospect. Replaced by `Contoso Supply`.' },
  { id: 'prospect-msp-domain', hash: '02086c4c8d17aa85', head: '02086c4c8d17aa85', words: 1, why: 'That MSP\'s live domain, cited as a research source and used in an email address. Replaced by `contoso.example`.' },
  { id: 'prospect-events-company', hash: '72a45b523754aba4', head: '254bb97b57f12e16', words: 4, why: 'Real company in a HubSpot contact fixture. Replaced by `Contoso Supply`.' },
  { id: 'prospect-events-company-domain', hash: '6baba7c020af6f07', head: '6baba7c020af6f07', words: 1, why: 'That company\'s live domain, used in a contact email. Replaced by `contoso.example`.' },
  { id: 'prospect-health-domain', hash: '57d0698af9f801e4', head: '57d0698af9f801e4', words: 1, why: 'Registrable domain used for a fixture account\'s email. The account name is a fixture and stays; the domain moved to `northbeam.example`.' },
  { id: 'prospect-construction-domain', hash: '3fd0ad560ab74814', head: '3fd0ad560ab74814', words: 1, why: 'Real construction firm\'s live domain, cited as research in the personalization seed. Replaced by `halstead.example`.' },
  { id: 'prospect-construction-contact', hash: '68ce0b17349b9a89', head: '68ce0b17349b9a89', words: 1, why: 'Surname of the contact paired with that construction firm. Replaced by `Sam Parry`.' },
  { id: 'prospect-automation-agency', hash: '969e6e4f614d31e4', head: '969e6e4f614d31e4', words: 1, why: 'Real automation agency used as the review-queue MQL subject, including in shipped component docs. Replaced by `Vantage Automation`.' },
  { id: 'prospect-automation-contact', hash: '27cd78ca4ceffbc2', head: '304528b7f627f4d5', words: 2, why: 'The contact paired with that agency. Replaced by `Dev Okonkwo`.' },
  { id: 'prospect-robotics', hash: '85a8c901bb2f279c', head: '85a8c901bb2f279c', words: 1, why: 'Real company used as the de-spacing example in a SHIPPED HubSpot tool description sent to the model. Replaced by `SunFleet`.' },
  { id: 'prospect-robotics-spaced', hash: '2b31e5e5f07de1b1', head: '9c1431eeb94d267d', words: 2, why: 'The spaced spelling of the same company — the whole point of that fixture. Replaced by `Sun Fleet`.' },
  { id: 'prospect-robotics-city', hash: 'b873ddbc36f616e7', head: 'b873ddbc36f616e7', words: 1, why: 'That company\'s real headquarters city, carried in the same fixture.' },
  { id: 'prospect-retail-wildcard', hash: 'ad5fd1ef5d6ed87f', head: 'ad5fd1ef5d6ed87f', words: 1, why: 'Real company used as the prefix-wildcard search example. Replaced by `TrailFix`.' },
  { id: 'prospect-pe-firm', hash: '9e237eb243eb63e6', head: 'a90fd9a9a1e66597', words: 2, why: 'Real investment firm used as the overdue-follow-up account. Replaced by `Kestrel Capital`. (Only the two-word form is banned: the first word alone is a legitimate UI noun.)' },
  { id: 'prospect-research-firm', hash: 'a07ce972a6f7c382', head: 'a07ce972a6f7c382', words: 1, why: 'Real market-research firm paired with a real contact in the synthesis fixtures. Replaced by `Rookwood Research`.' },
  { id: 'prospect-acquisition-counterparty', hash: 'b57e9659b5eae711', head: 'b57e9659b5eae711', words: 1, why: 'Surname on a real acquisition-prep note (data room, board timeline) used as an artifact-card fixture. Replaced by `Halford`.' },

  // ── Individual people ────────────────────────────────────────────────────
  { id: 'contact-pe-firm', hash: '82e792ed8a7add24', head: '484ae24edd22ea09', words: 2, why: 'Real contact at the investment firm above. Replaced by `Dana Reyes`.' },
  { id: 'contact-research-firm', hash: 'd2b6d7cc5ab18629', head: 'd2b6d7cc5ab18629', words: 1, why: 'Surname of a real contact used as the top overdue follow-up in chat fixtures and a shipped prompt example. Replaced by `Nadia Brandt`.' },
  { id: 'contact-followup-a', hash: 'f1c45b88340d12a2', head: 'f1c45b88340d12a2', words: 1, why: 'Surname of a real contact named in a dev proof script and, as an email address, in a SHIPPED system prompt. Replaced by `Erin Blakely`.' },
  { id: 'contact-followup-a-domain', hash: '9ac59d6328ef4c1e', head: '9ac59d6328ef4c1e', words: 1, why: 'The email domain paired with that contact in the shipped prompt. Replaced by `northwind.example`.' },
  { id: 'contact-followup-b', hash: '97fcae7e06108e1e', head: '97fcae7e06108e1e', words: 1, why: 'Surname of the second real contact in the same scripts. Replaced by `Kyle Marsh`.' },
  { id: 'contact-eval-target', hash: '3f17e0ac7230d1a6', head: '4f31fa50e5bd5ff4', words: 2, why: 'Real person asserted as expected output in the eval script — the eval passed only if the model named them. Replaced by `Mara Okafor`.' },
  { id: 'contact-crm-record', hash: '4853d09094b71728', head: '4853d09094b71728', words: 1, why: 'Real prospect attached to a live 12-digit HubSpot contact id and a verbatim meeting title. Replaced by `Riley Nakamura`, which the sibling seed script already used for the same case.' },
  { id: 'contact-name-collision', hash: '9a37b970c9d62e5d', head: 'cb8958f351eb2f24', words: 2, why: 'Real person whose name was the word-boundary collision case in a matching test. Replaced by an invented collision pair.' },
  { id: 'contact-bulk-email', hash: '2dfd5edbe62197f3', head: '2dfd5edbe62197f3', words: 1, why: 'Real person\'s work email local-part, used to test case-insensitive dedup keys. Replaced by a `.example` address.' },
  { id: 'subject-line-company-a', hash: '27227a6d826e3cdb', head: '27227a6d826e3cdb', words: 1, why: 'Real company named in an email-subject fixture. Replaced by a fixture account.' },
  { id: 'subject-line-company-b', hash: 'f98a0b11f3239588', head: 'f98a0b11f3239588', words: 1, why: 'Real company named in the same email-subject fixture. Replaced by a fixture account.' },
  { id: 'eval-podcast', hash: 'd2369defa3c79a81', head: 'd2369defa3c79a81', words: 1, why: 'Real show title asserted as expected eval output alongside a real person. Replaced by a fictional title.' },

  // ── Internal case-study references ───────────────────────────────────────
  { id: 'case-study-account', hash: 'd6e38d16687da86a', head: 'd6e38d16687da86a', words: 1, why: 'Real customer named in the requirements as the per-instance-data example and as an internal case study. Rewritten as "a customer Account row".' },
  { id: 'case-study-owner', hash: '8e06b82b57272541', head: '8e06b82b57272541', words: 1, why: 'Real account owner named beside that customer, with a dangling link to a purged internal case study. Rewritten as "key-account management".' },
  { id: 'internal-project-name', hash: '1e306fa96bacf97f', head: 'd5e4f7f12f0e5315', words: 3, why: 'Internal client project name used as a CLI example for token issuing. Replaced by `revenue-ops-hub`.' },

  // ── Live identifiers, not names ──────────────────────────────────────────
  { id: 'clerk-org-id', hash: '14066dd49da41372', head: '14066dd49da41372', words: 1, why: 'Production Clerk organisation id, hardcoded as the default org in two scripts. It identifies a live tenant.' },
  { id: 'zoom-host', hash: '64a1a5d0c4e3026c', head: '64a1a5d0c4e3026c', words: 1, why: 'Zoom account subdomain from a real cloud-recording playback URL that carried its own access token. The whole URL is gone.' },
  { id: 'zoom-meeting-id-a', hash: '1db62b18933528a5', head: '1db62b18933528a5', words: 1, why: 'Real Zoom meeting id from a recorded discovery call, used in the seed script.' },
  { id: 'zoom-meeting-id-b', hash: '47c2050e2eff82fe', head: '47c2050e2eff82fe', words: 1, why: 'Real Zoom meeting id, same seed script.' },
  { id: 'zoom-meeting-id-c', hash: 'f654a0e3b6bba115', head: 'f654a0e3b6bba115', words: 1, why: 'Real Zoom meeting id, same seed script.' },
  { id: 'hubspot-contact-id', hash: 'eebb9ddfe0b79dcd', head: 'eebb9ddfe0b79dcd', words: 1, why: 'Live HubSpot contact id attached to a real prospect in a detection test.' },
  { id: 'hubspot-deal-id', hash: '3d132aefc37a6c48', head: '3d132aefc37a6c48', words: 1, why: 'Live HubSpot deal id, with its real amount and stage, in two card stories.' },
  { id: 'hubspot-portal-id', hash: '7b7049c7858c02bb', head: '7b7049c7858c02bb', words: 1, why: 'Live HubSpot portal id in the getting-started guide — the sibling doc used an obviously synthetic one, which is how it was spotted.' },

  // ── Self-test ────────────────────────────────────────────────────────────
  { id: 'scan-sentinel', hash: '065a404beee2edce', head: '065a404beee2edce', words: 1, why: 'Not a real name. Exists so `realDataGuard.test.ts` can prove the scanner still detects a banned term; the test writes it to a temp file outside the repo.' },
];

/**
 * A class of real-world value, recognised by its shape rather than its content.
 *
 * `allow` is what a legitimate fixture of that shape looks like. Keep it tight:
 * every allowed form is a form somebody can hide a real value in. The rule is
 * "obviously synthetic on sight" — `.example`, a `555` exchange, a literal
 * `fixture`/`seed`/`example` token — not "looks fine to me".
 */
export type RealDataShape = {
  /** Non-identifying label used in failure output. */
  id: string;
  /** What trips the rule. Must be global-flag-free; the scanner adds flags. */
  pattern: RegExp;
  /** Forms that are obviously synthetic, and so are not a finding. */
  allow: RegExp[];
  /** Why this shape is dangerous, and what a fixture of it should look like. */
  why: string;
};

export const REAL_DATA_SHAPES: readonly RealDataShape[] = [
  {
    id: 'meeting-recording-url',
    pattern: /\b[\w.-]*zoom\.[a-z]+\/rec\/(?:share|play)\/\S+/i,
    allow: [/zoom\.example\//i, /\/rec\/(?:share|play)\/(?:seed|fixture|example)[\w-]*['"\s)]?$/i],
    why: 'A Zoom cloud-recording share/play URL carries its own access token in the path — the recording plays for anyone holding the link. One real one was committed here and had to be revoked, not merely replaced. Fixtures use `zoom.example` and a readable slug.',
  },
  {
    id: 'provider-org-id',
    pattern: /\borg_[A-Za-z0-9]{20,}\b/,
    allow: [/\borg_[A-Za-z0-9]*(?:Example|Fixture|example|fixture|Test|test)[A-Za-z0-9]*\b/],
    why: 'An opaque identity-provider organisation id (Clerk and friends) names a live tenant. Two scripts defaulted to a production one. A fixture id says so in the middle of it.',
  },
  {
    id: 'north-american-phone',
    pattern: /(?:\+1[ .-]?)?\(?\b[2-9]\d{2}\)?[ .-]\d{3}[ .-]\d{4}\b/,
    allow: [/\b\d{3}[ .-]?555[ .-]\d{4}\b/, /\(\d{3}\)\s?555[ .-]\d{4}/],
    why: 'A dialable phone number. One real venue\'s switchboard was copied into an HTML fixture with its address. Fixtures use the reserved `555` exchange, which cannot be dialled.',
  },
  {
    id: 'street-address',
    pattern: /\b\d{1,5}\s+[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*)*\s+(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Pkwy|Parkway|Hwy|Highway)\b\.?/,
    allow: [/\b\d{1,5}\s+(?:Example|Fixture|Test|Main|Mill|Market|Oak|Elm)\s/],
    why: 'A postal street address. A real venue\'s was carried verbatim in a scraped HTML fixture, alongside its phone number. Fixtures use a plainly invented street.',
  },
];

/**
 * Lowercase, collapse every run of non-alphanumerics to one space, trim.
 * @param text - Raw file content, a single line, or a repo-relative path.
 */
export function normalizeForScan(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The hash form used by every entry above.
 * @param normalized - Output of `normalizeForScan`, or one word from it.
 */
export function hashTerm(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
