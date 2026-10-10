# Shringaar — Design Decisions

> **Status of this document:** the design contract for the seller dashboard. Colour, type,
> spacing, motion and interaction rules live here so screens stay consistent as they are added.
>
> Related: [`arch.md`](./arch.md) · [`task.md`](./task.md)

---

## 1. The brief, read carefully

The reference point named in the brief is **Shopify's usability** — dense, task-first, obvious
navigation, data where you expect it. The reference point explicitly *rejected* is the generic
AI-generated dashboard: purple-blue gradients, glassmorphic panels, floating 3D blobs, an
everything-is-a-card grid with no hierarchy, and animation for its own sake.

Shringaar sells **jewellery**. The product is small, expensive, and usually photographed on a
neutral ground with warm light. A dashboard that competes with the products it displays is the
wrong dashboard. So: the chrome recedes, the product imagery carries the colour, and typography
does the hierarchy work instead of decoration.

**Decision — the dashboard is a gallery wall, not a billboard.** Warm, quiet, well-lit, and
generous with whitespace around the product images.

---

## 2. Decisions and their reasons

| # | Decision | Reason | Rejected alternative |
| --- | --- | --- | --- |
| D1 | Warm ivory canvas (`#F9F5EE`), not white | Pure white reads clinical and cheapens gold; the warm ground is what jewellers photograph against | `#FFFFFF` page, `#F5F5F5` grey cards |
| D2 | Charcoal ink (`#1E1A15`), never pure black | Pure black on ivory is harsh and loses the warm cast | `#000` |
| D3 | Gold **accent only** — one primary button, active nav rail, focus rings, hairline details | Gold is the brand; used everywhere it becomes a highlighter smear and stops signifying "primary" | Gold headers, gold card borders, gold backgrounds |
| D4 | Antique gold `#B08D57`, not `#FFD700` | Real jewellery metal is desaturated. Saturated yellow-gold reads as a discount banner | Bright yellow gold |
| D5 | 1px hairline borders + near-flat shadows | Structure from lines, not from depth. Cards stay legible, screenshots stay calm | Layered drop shadows, glass blur |
| D6 | Two typefaces: `Fraunces` (display, serif) + `Inter` (UI, sans) | A high-contrast serif gives the brand its jewellery-house voice; Inter keeps tabular data unobtrusive | All-serif (hurts data legibility), all-sans (brandless) |
| D7 | Serif is reserved for the wordmark, page titles and stat values | If the serif is used for body or labels, it stops reading as a display face | Serif everywhere |
| D8 | Radii: 8px controls, 12px cards, 999px pills | Small radii read precise and expensive; large radii read consumer-app | 20px+ "soft" cards |
| D9 | 4px spacing base, 8px rhythm | Predictable density across pages | Ad-hoc margins |
| D10 | No page-load animation; 120–180ms transitions only on hover/focus/press | The measure of polish is that clicking feels instant, not that things fade in | Staggered card reveals, spinners-as-decoration |
| D11 | Colour never carries meaning alone | Status is always badge *text* + colour, so it survives colour-blindness and greyscale printing | Red/green dots with no label |
| D12 | Numbers are tabular and right-aligned in tables | Prices and counts must line up to be scannable | Proportional figures |
| D13 | Charts are hand-rolled SVG, not a chart library | One chart style, one visual language, ~2 kB instead of ~200 kB | Recharts / Chart.js |
| D14 | Destructive actions require an explicit confirm dialog naming the product | Deleting a catalogue entry is irreversible and easy to mis-tap on mobile | Inline "are you sure?" text |
| D15 | Demo data is a visible, styled state — a chip in the header and a banner | Trust. A seller must never mistake demo numbers for their own traffic | Silently rendered fake metrics |
| D16 | Empty states sell the next action | A new seller's first screen is the empty one; it is the onboarding | "No products found." |
| D17 | A phone must never scroll sideways — horizontal overflow is a bug, not a limitation | A sideways-scrolling page on a phone is how a dashboard feels broken; a wide table should scroll *inside its own frame* and leave the page still | "It's a data table, it can't fit" — and stretching the page to 715px on a 390px screen |
| D18 | The browser tab names the screen it shows | A seller with three dashboard tabs open, and a customer who opens a shared storefront link, both need the tab to say where they are — and a buyer must never see a tab reading "Seller Dashboard" | One static title for the whole app |

---

## 3. Colour

All colours are CSS custom properties in `src/styles/tokens.css`. Pages never hardcode a hex value.

### 3.1 Surfaces and text

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#F9F5EE` | app background |
| `--surface` | `#FFFFFF` | cards, inputs, sidebar |
| `--surface-sunken` | `#F4EEE4` | table headers, inset panels, image wells |
| `--line` | `#E6DCCB` | default hairline border |
| `--line-strong` | `#D6C8B1` | input borders, table rules |
| `--ink` | `#1E1A15` | headings, primary text |
| `--ink-2` | `#4A423A` | body text |
| `--ink-3` | `#7A6E62` | labels, metadata, placeholders |

### 3.2 Brand gold

| Token | Value | Use |
| --- | --- | --- |
| `--gold-50` | `#FAF3E6` | nav active background, subtle tint |
| `--gold-100` | `#F1E3C8` | badge background, hover tint |
| `--gold-400` | `#C9A55F` | focus ring, chart line |
| `--gold-500` | `#B08D57` | **primary button**, active nav rail |
| `--gold-600` | `#8E6F3D` | primary button hover, gold text on light |

### 3.3 Status

| Token | Value | Meaning |
| --- | --- | --- |
| `--green-700` / `--green-50` | `#2F7D5D` / `#EAF4EE` | published, success |
| `--amber-700` / `--amber-50` | `#9A6B12` / `#FBF1DC` | draft, warning, demo |
| `--red-700` / `--red-50` | `#A83A32` / `#FAECEA` | error, destructive |
| `--slate-700` / `--slate-50` | `#5B6470` / `#EFF1F4` | neutral/informational, "not set" |

Every pairing above was chosen to clear **4.5:1** contrast for body text on its background, and
3:1 for large text and UI borders. `--ink-3` on `--surface` is the lightest permitted pairing.

### 3.4 Contrast rule

Never place text on `--gold-500` other than white, and never use `--gold-400` for text under 16px —
it is a ring and line colour, not a text colour.

---

## 4. Typography

| Role | Family | Size / weight / tracking |
| --- | --- | --- |
| Wordmark | Fraunces 600 | 20px, `-0.01em` |
| Page title | Fraunces 600 | 28px desktop / 24px mobile, `-0.01em` |
| Section title | Inter 600 | 15px |
| Stat value | Fraunces 600 | 30px, tabular |
| Body | Inter 400 | 14px / 1.55 |
| Label | Inter 500 | 13px, `--ink-2` |
| Metadata | Inter 400 | 12–13px, `--ink-3` |
| Table cell | Inter 400 | 13px |
| Numeric | Inter 400/500 | tabular, right-aligned |

The type stack degrades gracefully if Google Fonts is unreachable:
`'Fraunces', 'Iowan Old Style', Georgia, serif` and
`'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif`.

---

## 5. Layout

### 5.1 Shell

```
┌──────────────┬───────────────────────────────────────────────┐
│  sidebar     │  header   store name · demo chip · profile    │
│  248px       ├───────────────────────────────────────────────┤
│              │                                               │
│  wordmark    │   page title                                  │
│  store block │   subtitle                                    │
│              │                                               │
│  nav         │   content                                     │
│   Overview   │                                               │
│   Products   │                                               │
│   Add        │                                               │
│   Store      │                                               │
│   Analytics  │                                               │
│   Settings   │                                               │
│              │                                               │
│  ─────────   │                                               │
│  profile     │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

- Content column max-width **1120px**, centred, with 32px desktop / 16px mobile gutters.
- Sidebar is fixed on `≥1024px`; below that it becomes a slide-over drawer behind a hamburger in
  the header, closed by Escape, by the backdrop, or by navigating.
- The mobile breakpoints are **640px** (stat grid 4→2→1 col, table→card list) and **1024px**
  (drawer, two-column layouts collapse).

### 5.2 Overview grid

Stat row (4 tiles, wrapping) → primary actions row → two-column region
(`Recent products` 2fr | `Recent activity` 1fr), collapsing to one column under 1024px.
`Add Product` is the only gold-filled button on the page; everything beside it is secondary.

### 5.3 Products

A view toggle between **grid** (image-forward, good for judging the catalogue visually) and
**table** (dense, good for bulk status checking). The toolbar holds search, category filter, status
filter and the toggle, and wraps rather than shrinking below 320px.

### 5.4 Containment — the three ways this layout used to leak (D17)

Every wide element is contained by one of three rules. They are not stylistic; remove any one and the
page scrolls sideways on a phone. All three are in `src/styles/`.

| Rule | Where | What it prevents |
| --- | --- | --- |
| Grid tracks are `minmax(0, 1fr)` and grid children get `min-width: 0` | `.grid-2`, `.grid-2--even`, `.grid-3` in `app.css` | A grid child is `min-width: auto` by default, so it refuses to shrink below its content — one 697px table pushed the whole shell to 715px instead of scrolling inside `.table-wrap` |
| Scroll containers set `position: relative` | `.table-wrap` in `app.css` | `.sr-only` labels are absolutely positioned. With no positioned ancestor inside the scroller they resolve against the page, escape the scroller's clip, and add their static offset to the document width |
| Footers wrap | `.card__footer` in `app.css` | An action button plus a status line ("All changes saved.") fit on one line on a desktop and not on a phone; without `flex-wrap` the status sat outside the card |

The same layout also relies on `.spacer` (`flex: 1 1 0`) to push a trailing item to the far end of a
flex row. It is a global utility — four rows use it, and it must not be reintroduced as a
component-scoped rule.

**Verified**, not assumed: every route at 390px, 768px and 1440px — `document.documentElement`
reports no horizontal scroll at any of the 30 combinations, and the wide tables scroll within
`.table-wrap` (342px visible of 697px) exactly as intended.

---

## 6. Components

| Component | Contract |
| --- | --- |
| `Button` | `variant: primary \| secondary \| ghost \| danger \| link`, `size: sm \| md`, `loading`, `disabled`, optional leading icon |
| `Card` | `Card` + `CardHeader` / `CardBody` / `CardFooter`. Header takes `title`, `subtitle`, `actions`. Hairline border, no shadow by default |
| `Badge` | `tone: neutral \| gold \| success \| warning \| danger \| info`, optional `dot`. Always has a text label |
| `Field` | `label`, `hint`, `error`, `required`. Wires `aria-describedby` / `aria-invalid` to the control |
| `Input` / `Textarea` / `Select` | forward `ref`, accept all native props, error state via `aria-invalid` |
| `Modal` | Portal, focus trap, Escape to close, backdrop click to close, `role="dialog"` + `aria-modal` |
| `Toast` | `useToast()` → `{ success, error, info }`. Bottom-right desktop, bottom-full-width mobile |
| `StatCard` | `label`, `value`, `delta`, `icon`, `dataSource`. Renders the demo chip when `demo` |
| `ProductCard` | image well, name, price, category, status badge, actions menu |
| `EmptyState` | `icon`, `title`, `description`, `action` — the action is mandatory in practice |

**Focus is always visible.** A 2px `--gold-400` ring with a 2px offset, on every focusable element,
never removed.

---

## 7. Content and honesty rules

These are design constraints as much as engineering ones.

| Rule | Wording used in the UI |
| --- | --- |
| Demo metrics are labelled | Chip reading **"Demo data"** on every stat, chart and analytics header |
| Demo writes are described truthfully | Banner: *"Demo mode — changes are saved in this browser only. Nothing is written to a database."* |
| A photo is not a 3D model | Beside the try-on field: *"A try-on asset is separate from your product photo. Uploading a photo does not create a 3D model — a photo is used for 2D placement; a `.glb` or `.usdz` file is needed for full 3D try-on."* |
| Unfinished integrations are named | Settings rows show a **"Not connected"** badge with what is missing, rather than a dead button |
| Errors explain the fix | *"Enter a price greater than 0"*, not *"Invalid input"* |
| Destructive copy names the object | *"Delete 'Kundan Choker'? This cannot be undone."* |

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

- No dark theme in v1 — the warm ivory identity does not transpose cleanly, and a half-considered
  dark mode would be worse than none.
- No gradients, glassmorphism, neumorphism, or parallax.
- No decorative illustration or mascot.
- No animated counters on stats. Numbers are just numbers.
- No chart library, no component kit, no icon package.
