# Shringaar — Design Decisions

> **Status of this document:** the design contract for the product. Colour, type, spacing, motion
> and interaction rules live here so screens stay consistent as they are added.
>
> Related: [`arch.md`](./arch.md) · [`task.md`](./task.md)

---

## 1. The brief, read carefully

Two reference points, doing different jobs.

**The visual language** comes from the landing page the client supplied (a "fintech landing" template).
Its theme was **read off the rendered page, not eyeballed** — the palette, the single typeface and the
small radii in `src/styles/tokens.css` are its values, and the provenance is recorded in that file's
header. What was taken is the *design system*: the dark green frame around a cream panel, one
desaturated green as the only brand colour, Inter Tight set tight, and 3–6px corners. What was **not**
taken is its content — no fintech copy, no stock photography, no dashboard-shaped marketing mockups.

**The interaction model** for the dashboard is **Shopify's usability** — dense, task-first, obvious
navigation, data where you expect it. The reference point explicitly *rejected* is the generic
AI-generated dashboard: purple-blue gradients, glassmorphic panels, floating 3D blobs, an
everything-is-a-card grid with no hierarchy, and animation for its own sake.

Shringaar sells **jewellery**. The product is small, expensive, and usually photographed on a
neutral ground with warm light. A dashboard that competes with the products it displays is the
wrong dashboard. So: the chrome recedes, the product imagery carries the colour, and typography
does the hierarchy work instead of decoration.

**Decision — the dashboard is a gallery wall, not a billboard.** Quiet, well-lit, and generous with
whitespace around the product images. The marketing pages borrow the reference's confidence — big
tight display type, dark bands, a giant watermark wordmark — because they are selling, and the
dashboard is working.

---

## 2. Decisions and their reasons

| # | Decision | Reason | Rejected alternative |
| --- | --- | --- | --- |
| D1 | Cream canvas (`#E5E4DA`), not white | The reference's paper is warm and slightly grey; it flatters gold and reads as printed stock rather than a screen | `#FFFFFF` page, `#F5F5F5` grey cards |
| D2 | Green-cast ink (`#141A16`), never pure black | Pure black on cream is harsh, and the reference's ink is deliberately warm-dark, not neutral-dark | `#000`, neutral `#1A1A1A` |
| D3 | One brand green, **accent only** — primary button, active nav rail, focus rings, marks | A single colour used everywhere stops signifying "primary". The reference spends `#2F5640` on almost nothing, which is exactly why it reads | Green headers, green borders, tinted panels |
| D4 | Brand green `#2F5640` (page frame `#2F4436`), not a saturated `#00A651` | The reference's green is desaturated and slightly grey — it reads as ink, not as a status colour | Bright emerald/forest green |
| D5 | 1px hairline borders + near-flat shadows; depth reserved for floating layers | Structure from lines, not from depth. Cards stay legible, screenshots stay calm | Layered drop shadows everywhere, glass blur |
| D6 | **One typeface:** Inter Tight, at every size | The reference has no second face. Hierarchy comes from size, weight and tracking — not from a serif/sans pairing | A display serif + UI sans (the previous theme's Fraunces/Inter split) |
| D7 | Display type is set at **weight 400** with tight negative tracking (`-0.045em`) | This is the reference's single most recognisable move and the easiest thing to lose. A 400-weight headline that is tracked tight looks expensive; the same headline at 600 looks like a default | Weight 600–700 display type at normal tracking |
| D8 | Radii: **3px** controls, **6px** cards, 12px dialogs, 18px feature band, 999px pills | Small radii read precise. The reference's corners are barely there — a 12px card would be a different design | 16–24px "soft" cards |
| D9 | 4px spacing base, 8px rhythm | Predictable density across pages | Ad-hoc margins |
| D10 | No page-load animation; 140–260ms transitions only on hover/focus/press, on `cubic-bezier(.2,.8,.2,1)` | The measure of polish is that clicking feels instant, not that things fade in | Staggered card reveals, spinners-as-decoration |
| D11 | Colour never carries meaning alone | Status is always badge *text* + colour, so it survives colour-blindness and greyscale printing | Red/green dots with no label |
| D12 | Numbers are tabular and right-aligned in tables | Prices and counts must line up to be scannable | Proportional figures |
| D13 | Charts are hand-rolled SVG, not a chart library | One chart style, one visual language, ~2 kB instead of ~200 kB | Recharts / Chart.js |
| D14 | Destructive actions require an explicit confirm dialog naming the product | Deleting a catalogue entry is irreversible and easy to mis-tap on mobile | Inline "are you sure?" text |
| D15 | Demo data is a visible, styled state — a chip in the header and a banner | Trust. A seller must never mistake demo numbers for their own traffic | Silently rendered fake metrics |
| D16 | Empty states sell the next action | A new seller's first screen is the empty one; it is the onboarding | "No products found." |
| D17 | A phone must never scroll sideways — horizontal overflow is a bug, not a limitation | A sideways-scrolling page on a phone is how a dashboard feels broken; a wide table should scroll *inside its own frame* and leave the page still | "It's a data table, it can't fit" — and stretching the page to 715px on a 390px screen |
| D18 | The browser tab names the screen it shows | A seller with three dashboard tabs open, and a customer who opens a shared storefront link, both need the tab to say where they are — and a buyer must never see a tab reading "Seller Dashboard" | One static title for the whole app |
| D19 | Headlines are **two-tone**: the second clause drops to `--ink-3` via `.mk-mute` | The reference greys the tail of every headline. It sets a reading order inside a single sentence without adding a second element | A coloured word, an underline, a whole headline at one weight |
| D20 | Metaphor badges are `✳ UPPERCASE MICRO-LABEL` pills | Small-caps micro-type is the reference's way of labelling without a heading. It carries structure at 11px where a bold label would shout | Bold 14px eyebrow text |
| D21 | Dark bands set their colours **explicitly**; there is no token-repointing `.on-night` scope | The feature band contains *light* app mockups that resolve `--ink` to its dark root value. A scope that re-pointed `--ink` for the band would turn their text cream-on-white. See `tokens.css` | An `.on-night` class that swaps `--ink`/`--line` for everything inside |
| D22 | Marketing mockups are drawn from the app's own tokens and generated placeholder art — never stock photography | A mock that looked like a photograph of real stock would read as a broken image the moment a seller recognised it as not-theirs | Unsplash images in the feature cards |

---

## 3. Colour

All colours are CSS custom properties in `src/styles/tokens.css`. Pages never hardcode a hex value.

### 3.1 Surfaces, frame and text

| Token | Value | Use |
| --- | --- | --- |
| `--frame` | `#2F4436` | the dark green border the marketing shell sits inside |
| `--canvas` | `#E5E4DA` | app background — the "paper" |
| `--surface` | `#FFFFFF` | cards, inputs, sidebar |
| `--surface-raised` | `#FBFAF7` | raised rows inside a card |
| `--surface-sunken` | `#F2EFEA` | table headers, inset panels, image wells |
| `--surface-hover` | `#EBE8E3` | row and control hover |
| `--night` | `#121D17` | dark bands (feature band, footer) |
| `--cream` | `#ECEBE1` | text and rules on a dark band |
| `--line` | `rgba(20,26,22,.12)` | default hairline border |
| `--line-strong` | `rgba(20,26,22,.20)` | input borders, table rules |
| `--line-on-dark` | `rgba(236,235,225,.12)` | hairlines on a dark band |
| `--ink` | `#141A16` | headings, primary text |
| `--ink-2` | `#3A423C` | body text |
| `--ink-3` | `#7F857B` | labels, metadata, `.mk-mute` headline tails |

Lines are alpha, not solid hex, matching the reference's `color-mix(ink 12%, transparent)` — so a
line placed over a dark band stays honest instead of needing a second token.

### 3.2 Brand green

| Token | Value | Use |
| --- | --- | --- |
| `--brand-50` | `#EAF0EB` | nav active background, subtle tint |
| `--brand-100` | `#D6E2D9` | badge background, hover tint |
| `--brand-200` | `#AFC7B6` | borders on tinted surfaces |
| `--brand-300` | `#7BA189` | muted marks |
| `--brand-400` | `#4A7A5C` | **focus ring**, chart line |
| `--brand-500` | `#2F5640` | **primary button**, active nav rail |
| `--brand-600` | `#24432F` | primary button hover |
| `--brand-accent` | `#3D8C56` | the live/positive dot and `+%` figures |

The `--brand-*` ramp replaces a gold ramp of the same shape. **The names are the contract; the values
are the theme** — if the brand turns gold again, change the values in `tokens.css` and nothing else moves.

### 3.3 Status

| Token | Value | Meaning |
| --- | --- | --- |
| `--green-700` / `--green-50` | `#2F7D5D` / `#EAF4EE` | published, success |
| `--amber-700` / `--amber-50` | `#8A5F10` / `#FBF1DC` | draft, warning, demo |
| `--red-700` / `--red-50` | `#B03A2E` / `#FAECEA` | error, destructive |
| `--slate-700` / `--slate-50` | `#6E655E` / `#F2EFEA` | neutral/informational, "not set" |

Every pairing above was chosen to clear **4.5:1** contrast for body text on its background, and
3:1 for large text and UI borders. `--ink-3` on `--surface` is the lightest permitted pairing.

### 3.4 Contrast rule

Never place text on `--brand-500` other than white or `--cream`, and never use `--brand-400` for text
under 16px — it is a ring and line colour, not a text colour. On a dark band, text is `--cream` or
`color-mix(in srgb, var(--cream) N%, transparent)`; never `--ink-3`, which is tuned for cream paper
and disappears on `--night`.

---

## 4. Typography

**One family.** The reference pairs no second face with Inter Tight — hierarchy comes from size,
weight and tracking alone.

| Role | Family / weight | Size / tracking |
| --- | --- | --- |
| Marketing display | Inter Tight 400 | `clamp()` to ~92px, `-0.055em`, `--lh-tight` |
| Page title | Inter Tight 400 | 28px desktop / 24px mobile, `--track-display` (`-0.045em`) |
| Section title | Inter Tight 400 | 17px, `--track-h2` (`-0.035em`) |
| Stat value | Inter Tight 400 | 30px, tabular |
| Body | Inter Tight 400 | 14px / 1.5 |
| Label | Inter Tight 500 | 13px, `--ink-2` |
| Micro-label | Inter Tight 500 | 11px, uppercase, `--track-micro` (`0.02em`) |
| Metadata | Inter Tight 400 | 12–13px, `--ink-3` |
| Table cell | Inter Tight 400 | 13px |
| Numeric | Inter Tight 400/500 | tabular, right-aligned |

Two settings do most of the work and are the easiest to lose:

- **Display is weight 400, not 600.** `--fw-display: 400`. Heavy display type is what makes a page
  look templated; the reference's confidence comes from restraint at large sizes.
- **Tracking is aggressively negative at display sizes** (`-0.045em` page titles, `-0.055em` hero).
  The reference also enables `font-feature-settings: "ss01","cv11"` — the alternate single-storey
  `a` and the curved `l` that give Inter Tight its voice.

**Two-tone rule (D19).** A headline whose second clause is context rather than content drops that
clause to `.mk-mute` (`--ink-3`). *"Know what sells.* **What to make next.**"* One sentence, two
weights of attention, no second element.

The type stack degrades gracefully if Google Fonts is unreachable:
`'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`.

---

## 5. Layout

### 5.1 Marketing shell

```
┌─ .mk-frame  (dark green #2F4436, ~14px) ─────────────────────────────┐
│  ┌─ .mk-panel  (cream #E5E4DA, 18px radius) ─────────────────────┐  │
│  │  .mk-nav   logo pill · links · Sign in / Start selling        │  │
│  │  ───────────────────────────────────────────────────────────  │  │
│  │  .mk-hero  ✳ eyebrow · two-tone display · lead · CTAs          │  │
│  │            stat row · .mk-traces grid + floating .mk-chip ×4   │  │
│  │                                                               │  │
│  │  ── .mk-band  (dark #121D17, 18px radius) ──────────────────  │  │
│  │     ✳ Shringar AI · .mk-fcards — 3 cards, each with a light   │  │
│  │     app mockup (.mk-m--store / --phone / --tag)               │  │
│  │                                                               │  │
│  │  .mk-cta · .mk-foot (dark, giant watermark wordmark)          │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

The frame-and-panel inset is the reference's most recognisable structural move. The feature band and
the footer are dark **and contain light panels** — which is what makes D21 (no `.on-night`) load-bearing.

### 5.2 Dashboard shell

```
┌──────────────┬───────────────────────────────────────────────┐
│  sidebar     │  header   store name · demo chip · profile    │
│  248px       ├───────────────────────────────────────────────┤
│              │                                               │
│  wordmark    │   page title                                  │
│  store block │   subtitle                                    │
│              │                                               │
│  nav         │   content                                     │
│   Home       │                                               │
│   Collection │                                               │
│  ── Manage ─ │                                               │
│   Add Product│                                               │
│   Products   │                                               │
│   My Store   │                                               │
│   Analytics  │                                               │
│   Settings   │                                               │
│  ─────────   │                                               │
│  profile     │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

Navigation is grouped: the two things a seller does most (see where they stand, look at what they
made) sit above the fold, and administration lives under a **Manage** heading.

- Content column max-width **1120px**, centred, with 32px desktop / 16px mobile gutters.
- Sidebar is fixed on `≥1024px`; below that it becomes a slide-over drawer behind a hamburger in
  the header, closed by Escape, by the backdrop, or by navigating.
- The mobile breakpoints are **640px** (stat grid 4→2→1 col, table→card list) and **1024px**
  (drawer, two-column layouts collapse).

### 5.3 Home and Collection

**Home** answers one question — *what do I do next* — so every element points at "add a product".
A store-meta header, a three-tile stat row (Products / Product QR codes / Live on your storefront),
two quick actions with **Add new product** the only primary, then either the empty state or a link
into Collection. The empty state is the onboarding for a seller who has added nothing.

**Collection** is the review surface: every uploaded piece, **grouped by category**, each with its
image, price and description, behind a category selector. This is where a seller checks their
catalogue reads well before a customer does.

### 5.4 Containment — the three ways this layout used to leak (D17)

Every wide element is contained by one of three rules. They are not stylistic; remove any one and the
page scrolls sideways on a phone. All three are in `src/styles/`.

| Rule | Where | What it prevents |
| --- | --- | --- |
| Grid tracks are `minmax(0, 1fr)` and grid children get `min-width: 0` | `.grid-2`, `.grid-2--even`, `.grid-3` in `app.css` | A grid child is `min-width: auto` by default, so it refuses to shrink below its content — one 697px table pushed the whole shell to 715px instead of scrolling inside `.table-wrap` |
| Scroll containers set `position: relative` | `.table-wrap` in `app.css` | `.sr-only` labels are absolutely positioned. With no positioned ancestor inside the scroller they resolve against the page, escape the scroller's clip, and add their static offset to the document width |
| Footers wrap | `.card__footer` in `app.css` | An action button plus a status line ("All changes saved.") fit on one line on a desktop and not on a phone; without `flex-wrap` the status sat outside the card |
| Sticky-aware clipping uses `overflow: clip`, never `overflow: hidden` | `.mk-frame` and `.mk-panel` in `marketing.css` | `.mk-panel` is the common ancestor of the sticky `.mk-nav`. `overflow: hidden` would make the panel a scroll container, so the nav would stick to the panel rather than the viewport — i.e. it would scroll away. Both are also `overflow-x: clip` so the frame can never widen the page |

The same layout also relies on `.spacer` (`flex: 1 1 0`) to push a trailing item to the far end of a
flex row. It is a global utility — several rows use it, and it must not be reintroduced as a
component-scoped rule.

**Verified**, not assumed: every route at 390px, 768px and 1440px — `document.documentElement`
reports no horizontal scroll at any of the 48 combinations, and the wide tables scroll within
`.table-wrap` exactly as intended.

---

## 6. Components

### 6.1 App UI (`components/ui`)

| Component | Contract |
| --- | --- |
| `Button` | `variant: primary \| secondary \| ghost \| danger \| link`, `size: sm \| md`, `loading`, `disabled`, optional leading icon |
| `Card` | `Card` + `CardHeader` / `CardBody` / `CardFooter`. Header takes `title`, `subtitle`, `actions`. Hairline border, no shadow by default |
| `Badge` | `tone: neutral \| brand \| success \| warning \| danger \| info`, optional `dot`. Always has a text label |
| `Field` | `label`, `hint`, `error`, `required`. Wires `aria-describedby` / `aria-invalid` to the control |
| `Input` / `Textarea` / `Select` | forward `ref`, accept all native props, error state via `aria-invalid` |
| `Modal` | Portal, focus trap, Escape to close, backdrop click to close, `role="dialog"` + `aria-modal` |
| `Toast` | `useToast()` → `{ success, error, info }`. Bottom-right desktop, bottom-full-width mobile |
| `StatCard` | `label`, `value`, `delta`, `icon`, `dataSource`. Renders the demo chip when `demo` |
| `ProductCard` | image well, name, price, category, status badge, actions menu |
| `EmptyState` | `icon`, `title`, `description`, `action` — the action is mandatory in practice |
| `Icon` | dependency-free inline SVG set. Decorative icons take `aria-hidden`; icon-only buttons carry `aria-label` |

### 6.2 Marketing (`features/marketing`)

| Component | Contract |
| --- | --- |
| `Landing` | the scrollable page: nav → hero → feature band → CTA → footer |
| `FeatureShowcase` | the dark band. Each entry is `{ title, body, Mock }`, where `Mock` is one of the AppMock miniatures |
| `AppMock` | `StorefrontMock`, `PhoneMock`, `TagMock` — drawn from `lib/placeholder` art and the app's tokens, `aria-hidden` |

**Focus is always visible.** A 2px `--brand-400` ring with a 2px offset, on every focusable element,
never removed.

---

## 7. Content and honesty rules

These are design constraints as much as engineering ones.

| Rule | Wording used in the UI |
| --- | --- |
| Demo metrics are labelled | Chip reading **"Demo data"** on every stat, chart and analytics header |
| Demo writes are described truthfully | Banner: *"Demo mode — no backend is connected."* followed by either *"The products below are sample data…"* (seeded catalogue) or *"The products and counts below are read from the demo store in this browser…"* — never the wrong one, and never the unqualified word "saved" |
| A photo is not a 3D model | Beside the try-on field: *"A try-on asset is separate from your product photo. Uploading a photo does not create a 3D model — a photo is used for 2D placement; a `.glb` or `.usdz` file is needed for full 3D try-on."* |
| Try-on says what it can actually do | On the try-on page, under **"How this works"**: *"Everything runs in your browser. No photo or video leaves your device."* · *"This places a flat image of the piece on your ears — it is not a 3D model, and it is not a fitment guide."* (the 3D variant reads *"This is the seller's 3D model of the piece, placed at an estimated position. It is not a fitment guide."*) · *"The position is estimated from face points near your ear, not from your earlobe, so a small offset is normal."* · *"Hair over your ear cannot be detected, so the piece may draw on top of it."* · *"Placement is least accurate when your head is turned far to one side."* The 3D path adds *"The model is drawn over the video with no depth test, so nothing in the picture can hide it."* |
| Try-on claims no more scope than it has | A category with no solver reads *"This product has no try-on asset, or its category does not have a try-on experience yet. Only earrings can be tried on today."* — never an empty stage. A refused asset reads its own reason rather than a generic failure. |
| A bad fit is fixable, not hidden | The fit panel is folded away by default and its closed state says *"The piece is placed from an estimate of where your ear is. If it sits slightly off, you can nudge it."* The sliders exist because the anchor is an estimate; the copy admits it rather than promising accuracy. |
| Unfinished integrations are named | Settings rows show a **"Not connected"** badge with what is missing, rather than a dead button |
| A sign-in provider is offered only when it is wired up | The **"Continue with Google"** button renders only when the service reports `capabilities.oauth`. In demo mode it is absent, not present-and-failing — a button that opens an error is a worse answer than no button. |
| A provider failure is described in the seller's terms | The provider's own `error_description` ("Unable to exchange external code for token") is never shown. Cancelling reads *"You closed the sign-in window before finishing, so nothing changed. Try again when you are ready."* — which also says the account was left alone; anything else reads *"That sign-in could not be completed. Try again, or use your email and password."* |
| Errors explain the fix | *"Enter a price greater than 0"*, not *"Invalid input"* |
| Destructive copy names the object | *"Delete 'Kundan Choker'? This cannot be undone."* |
| A fallback is not presented as input | The guided uploader falls back `description` to the piece name; Collection suppresses the description when it is that fallback rather than printing the name twice |

---

## 8. Accessibility baseline

- Semantic landmarks: `<nav>`, `<main>`, `<header>`, one `<h1>` per page.
- Icon-only buttons carry `aria-label`; decorative SVG is `aria-hidden="true"`.
- Modals trap focus and restore it to the trigger on close.
- Form errors are announced via `role="alert"` and tied to inputs with `aria-describedby`.
- The table/grid toggle, filters and search are reachable by keyboard; the drawer closes on Escape.
- Respects `prefers-reduced-motion: reduce` — all transitions collapse to 0ms.
- Status is never colour-only (see D11).

---

## 9. What this design deliberately does not do

- **No second typeface and no serif.** The theme is one family; a display serif is the previous
  theme, not this one.
- No gradients, glassmorphism, neumorphism, or parallax.
- No decorative illustration or mascot. The marketing mockups are drawn *app UI*, not artwork.
- No stock photography anywhere — including in the feature band, where a real photo would read as
  broken the moment a seller recognised it as not theirs (D22).
- No animated counters on stats. Numbers are just numbers.
- No chart library, no component kit, no icon package.
- No token-repointing dark scope. Dark bands are dark by their own rules (D21).
