# Branding: your Org's logo and colours

An Org can wear its own brand. Once it has one, people see the Org, not
Vocion, everywhere they meet the product:

| Where | What changes |
|---|---|
| **Sidebar** | The Org's logo at the top of the nav, its square mark at the top of the app rail, and a small "Powered by Vocion" in the footer. |
| **Accent** | Links, the focus ring and the primary token take the Org's accent colour. It is layered over the app's tokens; the app tints (`--tint-*`) are left alone. |
| **Browser tab** | The title reads "Northwind · Vocion" ("Chat · Northwind" on a page), and the favicon is the Org's mark. |
| **Sign-in and invite pages** | The Org's logo, "Sign in to Northwind", the accent on the button and on the background glow, and "Powered by Vocion" under the card. |
| **Who may get in** | Under the sign-in form, the install's policy: "Anyone with a @northwind.example account can sign in with Google or Microsoft" when `VOCION_AUTO_JOIN_DOMAINS` is set, else "Need access? Ask someone at Northwind to invite you". A single-Org server knows its Org before sign-in, so this holds even before the Org has a brand. A multi-Org server knows no Org yet: its sign-in stays Vocion's, with the plain invite-only line. |
| **Outbound mail** | A header with the Org's logo over each mail, and the Org's sender name on the server's address (`Northwind Ops <reports@…>`). |
| **Headings** | Set in the Org's heading font, when it picks one the app serves. |

An Org with no brand keeps Vocion's look: the plain Vocion wordmark (never the tagline lockup) on sign-in, which still names the Org.

There are three ways to give an Org its brand: the setup chat, Brand
settings, and a `brand.yaml` the server already has.

## One brand per region

The chrome has three places a brand can sit, and each shows at most one
(`libs/branding/chrome.ts`). The chat body (the empty state and the thread)
shows none.

| Region | Vocion leads (Vocion Cloud) | The Org leads (a branded single-Org install) |
|---|---|---|
| **Top bar**, next to the sidebar toggle (~20px, goes home) | Vocion's mark | The Org's mark |
| **Switcher chip** | The Org's logo (its mark, else its wordmark); the letter avatar when it has none | Same |
| **Drawer footer**, under the person | A small Vocion wordmark | "Powered by Vocion" (none when white-labelled) |
| **Tab title and favicon** | Vocion's | "Northwind · Vocion" and the Org's mark |

The Org's accent stays on the primary buttons and the lead's ring on both.

Which brand leads is an install setting, `VOCION_LEAD_BRAND`:

- `auto` (the default) — Vocion on a multi-Org server, the Org on a
  single-Org one. Self-hosted installs therefore behave like a client's own
  install.
- `vocion` or `org` — forces one.

An Org with no brand never leads; Vocion does.

## Make it yours: from the chat

Ask the workspace's lead, in your own words: *"Brand this workspace from
northwind.example"*. It is also the last step of the **Getting started**
checklist, **Make it yours: logo and colours**, which opens the chat with the
ask written.

The lead's `propose_brand` tool:

1. Reads the company's own site with `brand_lookup` (Firecrawl's `branding`
   extractor). This gets the colours the site actually paints, its logo and
   favicon, and its fonts.
2. Drafts the brand (`libs/branding/draft.ts`):
   - **Accent:** the first of the site's primary, accent, link and secondary
     colours that can be worn readably, preferring a colour with a hue over a
     grey.
   - **Heading font:** kept only when the app serves it.
   - **Logo:** the site's logo.
   - **Mark:** the site's favicon, unless it is an `.ico`.
   - **Mail:** sent under the company's name.

   Anything the site did not give is listed on the card as a note, never
   filled in from memory.
3. Shows a **brand preview card**: the app's sidebar and sign-in page wearing
   the draft, with three choices.

| Choice | Key | What it does |
|---|---|---|
| **Use this brand** (preselected) | `1`, or `Enter` | Runs `org.brand_apply` as your own action, with **Undo**. The app wears the brand at once. |
| **Adjust** | `2` | Opens Brand settings with the draft in it, unsaved. |
| **Skip** | `3`, or `Esc` | Sets the card aside. It shows *Skipped* after a reload. |

Arrow keys move the highlighted choice. The card takes focus when it lands,
unless you are typing.

If the lookup is not configured on the server (no Firecrawl key), the lead
says so and puts a link to Brand settings on screen instead.

Only an Org admin can brand the Org. For anyone else, the lead says so in one
line and names who can.

## Brand settings

**Manage workspace › Organization › Brand** (`/dashboard/brand`, admins only).

| Field | What it is |
|---|---|
| **Company name** | How the company is written in the tab and on sign-in. |
| **Logo**, **Logo on dark** | The wordmark for the sidebar, sign-in and mail. Give a version for dark pages if yours doesn't read there. |
| **Mark**, **Mark on dark** | The square mark for the app rail and the favicon. |
| **Accent** | A hex colour, checked as you type (see below). |
| **Heading font** | Optional. Pick from the allowlist. |
| **Sender name** | The name mail from this server goes out under. Defaults to the company name. |

- The preview beside the form shows the sidebar and sign-in page, in light or
  dark, as you edit.
- **Save** offers **Undo**.
- **Reset to default** puts Vocion's own look back, with Undo too.

### Logos

- **Formats:** SVG or PNG, up to 512 KB. Any other raster (JPEG, WebP, GIF) is
  converted to PNG.
- **Where they are kept:** in the media store, per Org (`brand/<org>/…` in
  `VOCION_MEDIA_BUCKET`, or on disk without one).
- **How they are served:** at `/api/media/brand/<org>/<file>`. This route is
  public, because sign-in shows the logo before anyone signs in and mail shows
  it in a client with no session. The file name carries the content hash, so a
  URL never changes what it shows and is cached for a year.
- **SVG cleaning:** an SVG is rebuilt from an allowlist of drawing elements
  (`libs/branding/svg.ts`). It loses any script, event handler,
  `foreignObject`, link that runs code, and reference to another server. The
  route also serves it under a Content-Security-Policy that forbids scripts.

### The accent is checked

The accent is used two ways, and each must reach WCAG AA (4.5:1) on both light
and dark pages (`libs/branding/contrast.ts`):

- **As a fill**, for the sign-in button. The colour is used as you gave it.
  Its text colour is derived (white or ink, whichever reads), and is always
  at least 4.5:1.
- **As ink on the page**, for links, the focus ring and the current page's
  mark. Where your colour is too light (or too dark) for one theme, that
  theme uses the nearest shade of the same hue that reads. The page tells
  you: *"On light pages, links and focus use #A86018 (4.5:1) because #F18700
  is too light to read there."*
- **Black, white or grey:** where it does not fit, it becomes the page's own
  ink. A black brand reads white on dark pages.
- **Refused:** when the nearest readable shade is no longer the same colour,
  as with pure yellow or a pale pastel. You get the reason and a suggestion,
  and Save waits until you pick another: *"#FFFF00 has 1.0:1 contrast on light
  pages, and the nearest shade that reaches 4.5:1 (#757604) no longer reads as
  the same colour. Pick a deeper shade of it."*

### Heading fonts

The app never fetches a font from a font service at runtime. The allowlist
(`libs/branding/fonts.ts`) is:

- **Self-hosted:** Inter, Outfit, Barlow, Manrope, Space Grotesk, IBM Plex
  Sans, Fraunces and Source Serif 4. `next/font` downloads each at build time
  and serves it as a WOFF2 from `/_next/static/media`. Each is declared
  without preloading, so a face nobody picked costs nothing.
- **System stacks:** the device's own sans-serif and serif.

A font the guide names that is not on the list stays in the guide for
documents. The app draws headings in its own face.

## A brand.yaml the server already has

On a single-Org server, an Org with no brand adopts its workspace's
`brand.yaml` **once**:

- **When:** the first time a page is drawn after a deploy. Nobody has to
  open a settings page.
- **Which file:** the first `brand.yaml` among the Org's workspace folders
  (and `WORKSPACE_PATH`) that has logos or a palette.
- **What happens to it:** its logos (paths relative to the workspace folder,
  such as `brand/logo.svg`) are copied into the media store and cleaned. A
  logo that cannot be kept is left out. An accent that cannot be worn is left
  out rather than refused.

It runs once per Org, ever (`tenant_account.brand_seeded_at`, migration 0199):

- A second deploy does not run it again.
- Resetting the brand to the default is never overruled by the next deploy.
- It is race-safe: the write lands only while the Org is still unbranded and
  unseeded.
- Only the server's own Org adopts the server's file. It never runs on a
  multi-Org server, where each Org is branded by its own admins.

## One brand guide, two levels

An Org's brand **is** a brand guide: the same schema a workspace's
`brand.yaml` is read with (`BrandManifestSchema`, `libs/workspace/brandSchema.ts`),
stored on the Org (`tenant_account.brand`).

A workspace's `brand.yaml` inherits from the Org's brand, and can override it
for its documents (`inheritBrand`):

- A field the file writes wins. A field it leaves out is the Org's.
- Palette, roles, fonts and logos merge key by key. A workspace that adds one
  colour keeps the Org's others.
- `voice` and `banned` are replaced whole when the file writes any.
- With an Org brand, the file does not have to name the company.

`get_brand`, which every client-facing document reads before it is written,
returns the merged guide, with the logos inlined as data URIs.

The fields the app wears:

| Guide field | Worn as |
|---|---|
| `name` | The tab title and sign-in. |
| `logos.wordmark`, `logos.wordmarkOnDark` | The sidebar, sign-in and mail. |
| `logos.mark`, `logos.markOnDark` | The rail and the favicon. |
| `palette[roles.accent]` | The accent. |
| `fonts.heading` | Headings, when it is on the allowlist. |
| `senderName` | Mail, defaulting to `name`. |

## White-label

Core always keeps the small **"Powered by Vocion"** mark under an Org's logo
on sign-in and in the sidebar footer. Removing it is white-labelling, which is
not in core. It is the `branding.whiteLabel()` extension seam (default `false`,
`libs/extensions.ts`) that the enterprise module implements; see
[Extensions](./extensions.md).

## Where it lives

| Part | File |
|---|---|
| The guide's schema and inheritance | `libs/workspace/brandSchema.ts`, `libs/workspace/brand.ts` |
| Accent arithmetic, fonts, view and CSS, draft, SVG cleaning | `libs/branding/` |
| Reading, saving, seeding, documents, logos | `services/branding/OrgBrandService.ts` |
| Mail header and sender | `services/branding/mailBrand.ts`, `MailMessage.brand` in `libs/mail` |
| The action | `libs/actions/org-brand-apply.ts` (`org.brand_apply`) |
| The lead's tool and the plan step | `propose_brand`, `{kind:"brand"}` in `services/agents/tools/setupWorkspace.ts` |
| The card | `features/dashboard/chat/cards/BrandPreviewCard.tsx` (card kind `brand`) |
| Brand settings | `app/[locale]/(auth)/dashboard/brand`, `features/branding/BrandSettings.tsx`, `routers/Branding.ts` |
| Where it is worn | `app/[locale]/(auth)/layout.tsx` (CSS, title, favicon), `AppSidebar`, `AppRail`, the sign-in, invite and email-link pages |
| Logo files | `keepBrandAsset` / `readBrandAsset` in `libs/tools/artifacts/media.ts`, `app/api/media/brand/[accountId]/[filename]` |

## Testing it

- **Unit tests:**
  - `contrast.test.ts`: AA on every surface, adjusted and refused accents.
  - `orgBrand.test.ts`, `svg.test.ts`, `draft.test.ts`.
  - `brand.test.ts`: inheritance from the Org to the workspace.
  - `OrgBrandService.test.ts`: the seed is idempotent and runs once; saving is tenant-scoped; documents inherit.
  - `org-brand-apply.test.ts`: admins only, and Undo.
  - `media.brand.test.ts`, `mailBrand.test.ts`, `setupWorkspace.test.ts`, `gettingStarted.test.ts`.
- **UI:** `BrandPreviewCard.test.tsx` (the keyboard choices),
  `BrandSettings.test.tsx`, `SignInForm.test.tsx`.
- **Storybook:** `Branding/BrandSettings`, `Branding/Branded app` (sign-in
  and sidebar, light and dark, for the fixture company Northwind),
  `Chat/Cards/BrandPreviewCard`.

## Related

[Getting started in a new workspace](./getting-started-in-a-workspace.md) · [Email](./email.md) · [Extensions](./extensions.md) · [Workspace files](../workspace.md)
