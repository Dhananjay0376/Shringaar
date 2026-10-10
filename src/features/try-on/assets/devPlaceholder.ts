/**
 * A generated earring to develop against, in the same spirit as `lib/placeholder.ts`.
 *
 * There is no `public/` directory in this repo and no committed binary anywhere, so a generated SVG
 * data URL is the only kind of asset that costs nothing to add. More importantly it is *honest*: an
 * obviously fake earring cannot be mistaken for a working renderer. A photograph of a real earring
 * dropped in as a stand-in would make a broken placement look like a styling problem, and the whole
 * point of Stage 2 is to judge placement.
 *
 * So it is deliberately schematic — a flat gold drop with a dashed box around it and the words
 * DEV PLACEHOLDER inside that box. The dashes are the drawn bounds; the top-centre of the box is the
 * anchor. Seeing the box is how you tell "the asset is drawn at the right size" from "the asset is
 * drawn at the right size *and* at the right place", which are different bugs.
 *
 * The root element carries explicit `width`/`height`. That is not decoration: an SVG loaded into an
 * `Image` without them reports `naturalWidth === 0` in some engines, and a zero-width asset divides
 * badly when the drawn height is derived from the drawn width. `load.ts` refuses a zero-width asset
 * for the same reason.
 */

/** Intrinsic size of the generated earring. Ratio 120:200, a little taller than it is wide. */
export const DEV_EARRING_WIDTH = 120
export const DEV_EARRING_HEIGHT = 200

/* Literal colours, not `var(--…)`, and that is correct here: this string is serialised into an
   `Image`, which has no document, no cascade and no custom properties. The values are the closest
   flat equivalents of the brand gold the tokens carry. */
const GOLD = '#c9a227'
const GOLD_DEEP = '#8a7a4a'
const GOLD_PALE = '#f2e6c9'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${DEV_EARRING_WIDTH}" height="${DEV_EARRING_HEIGHT}" viewBox="0 0 ${DEV_EARRING_WIDTH} ${DEV_EARRING_HEIGHT}">
  <rect x="1.5" y="1.5" width="${DEV_EARRING_WIDTH - 3}" height="${DEV_EARRING_HEIGHT - 3}" fill="none" stroke="${GOLD_DEEP}" stroke-width="1" stroke-dasharray="6 6" opacity="0.9"/>
  <circle cx="60" cy="20" r="8" fill="none" stroke="${GOLD}" stroke-width="4"/>
  <path d="M60 34 C 84 34 94 62 94 90 C 94 130 78 158 60 158 C 42 158 26 130 26 90 C 26 62 36 34 60 34 Z" fill="${GOLD}" fill-opacity="0.5" stroke="${GOLD}" stroke-width="4"/>
  <circle cx="60" cy="98" r="11" fill="${GOLD_PALE}" fill-opacity="0.75"/>
  <text x="60" y="182" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" letter-spacing="1.5" fill="${GOLD_DEEP}">DEV</text>
  <text x="60" y="194" text-anchor="middle" font-family="system-ui, sans-serif" font-size="9" letter-spacing="1.5" fill="${GOLD_DEEP}" opacity="0.85">PLACEHOLDER</text>
</svg>`

/**
 * The placeholder as a data URL, ready for `loadImageAsset`.
 *
 * `encodeURIComponent` over the whole document rather than hand-escaping the few characters that
 * need it: the `#` in every colour literal alone would otherwise truncate the URL at the first one,
 * and that failure looks like "the image did not load" rather than "the URL is malformed".
 */
export function devEarringDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`
}
