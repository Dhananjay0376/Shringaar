/**
 * Generated placeholder artwork.
 *
 * Demo products have no real photography, and a broken image icon would misrepresent the layout.
 * These SVGs are deliberately abstract — a warm ground with a faint motif — so they read as
 * "placeholder", never as a real product photo. A connected backend replaces them with uploaded
 * files from storage.
 *
 * Kept in `lib` rather than in a feature because both the seller dashboard and the shared
 * storefront component use it. It depends on nothing but a label.
 */

/* Six grounds. Each is a warm neutral so it reads as "placeholder", never as a photograph of real
   stock. The stops were deepened a step: at tile size the ground sat only ~12% off the white card
   behind it, which is close enough that the tile boundary does most of the work of saying "there is
   an image here". It now sits ~23% off, and the accent has more contrast to draw with. */
const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ['#EFE7D8', '#DCCBA6', '#B08B45'],
  ['#EDE6DC', '#D9C6AC', '#A67F44'],
  ['#F0E6DA', '#E0C4A4', '#B07544'],
  ['#EAE7DA', '#CFC7AA', '#8E7B3C'],
  ['#F0E3DE', '#DCC0B4', '#B0756A'],
  ['#E6E8E0', '#C7CDBB', '#6F7F63'],
]

/** Motif index → a simple ring, arc or drop, drawn as a faint outline. */
function motif(index: number): string {
  const common = 'fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round"'

  switch (index % 3) {
    case 0: // ring
      return `<circle cx="400" cy="360" r="150" ${common} opacity="0.5"/>
              <circle cx="400" cy="360" r="96" ${common} opacity="0.28"/>`
    case 1: // arc / choker
      return `<path d="M210 300a190 190 0 0 0 380 0" ${common} opacity="0.5"/>
              <circle cx="400" cy="500" r="34" fill="currentColor" opacity="0.4"/>`
    default: // drop / pendant
      return `<path d="M400 180c70 96 108 158 108 214a108 108 0 0 1-216 0c0-56 38-118 108-214Z"
                ${common} opacity="0.45"/>`
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function initialsOf(label: string): string {
  const words = label.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '·'
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase()
  return `${(words[0] ?? '')[0] ?? ''}${(words[1] ?? '')[0] ?? ''}`.toUpperCase()
}

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Square product placeholder. Deterministic for a given `seed`, so it does not flicker on rerender. */
export function placeholderImageDataUrl(label: string, seed = 0): string {
  const [from, to, accent] = PALETTES[Math.abs(seed) % PALETTES.length] ?? PALETTES[0]!
  const gradientId = `g${Math.abs(seed) % 997}`
  /* The motif is picked from the seed divided by the palette count, not from the seed itself.
     Taking both from the same number correlated them: with six palettes and three motifs, seeds 0
     and 6 produced identical artwork, which a twelve-piece catalogue hits immediately. Dividing
     gives all eighteen combinations. */
  const motifIndex = Math.floor(Math.abs(seed) / PALETTES.length)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800" role="img" aria-label="${escapeXml(label)} placeholder">
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#${gradientId})"/>
  <g color="${accent}">${motif(motifIndex)}</g>
  <text x="400" y="700" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-size="46" font-weight="600" fill="${accent}" opacity="0.66"
        letter-spacing="4">${escapeXml(initialsOf(label))}</text>
</svg>`

  return toDataUrl(svg)
}

/** Square store logo placeholder, used when a store has no uploaded logo. */
export function placeholderLogoDataUrl(name: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="${escapeXml(name)} logo placeholder">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F1E3C8"/>
      <stop offset="100%" stop-color="#C9A55F"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="28" fill="url(#lg)"/>
  <text x="100" y="128" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-size="76" font-weight="600" fill="#3D2F16">${escapeXml(initialsOf(name))}</text>
</svg>`

  return toDataUrl(svg)
}
