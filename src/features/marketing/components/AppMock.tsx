import { placeholderImageDataUrl } from '@/lib/placeholder'
import { Icon } from '@/components/ui/Icon'

/**
 * Miniatures of the three surfaces the landing page is promising: the storefront a seller gets, the
 * phone a customer opens it on, and the tag hanging off a piece in the shop.
 *
 * These are drawn, not screenshotted, and they use the app's own generated placeholder artwork
 * rather than stock photography — a mock that looked like a photograph of real stock would read as a
 * broken image the moment a seller recognised it as not-theirs. They are marked `aria-hidden` and
 * carry no text a screen reader needs: everything they say is already in the card's heading and
 * body, and announcing a decorative price twice is noise.
 *
 * Sizes are in the CSS, not here, so the three of them can be tuned together.
 */

interface Miniature {
  name: string
  price: string
  seed: number
}

/* Illustrative contents. Kept generic and obviously illustrative — a name, a price, a category —
   rather than plausible-looking real listings, which would read as someone else's shop. */
const GRID_PIECES: Miniature[] = [
  { name: 'Jhumka', price: '₹2,450', seed: 0 },
  { name: 'Nose ring', price: '₹780', seed: 1 },
  { name: 'Choker', price: '₹5,400', seed: 2 },
]

/** A 13×13 QR-shaped block. Decorative only — it is not a scannable code and is never presented as
 *  one, which is why the grid is aria-hidden and the caption says what it is for, not what it is. */
const QR_ROWS = [
  '#####.#.#####',
  '#...#.#.#...#',
  '#.#.##.##.#.#',
  '#...#.#.#...#',
  '#####.#.#####',
  '.#.#.#.#.#.#.',
  '#.#.#.#.#.#.#',
  '.#.#.#.#.#.#.',
  '#####.#.#.#.#',
  '#...##.#.#.#.',
  '#.#.#.#.#.#.#',
  '#...##.#.#.#.',
  '#####.#.#.#.#',
]

export function StorefrontMock() {
  return (
    <div className="mk-m mk-m--store" aria-hidden="true">
      <div className="mk-m__bar">
        <span className="mk-m__dot" />
        <span className="mk-m__name">Meena Jewels</span>
        <span className="mk-m__url">/s/meena-jewels</span>
      </div>

      <div className="mk-m__grid">
        {GRID_PIECES.map((piece) => (
          <div className="mk-m__tile" key={piece.name}>
            <img src={placeholderImageDataUrl(piece.name, piece.seed)} alt="" />
            <b>{piece.name}</b>
            <span>{piece.price}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PhoneMock() {
  return (
    <div className="mk-m mk-m--phone" aria-hidden="true">
      <div className="mk-m__screen">
        <img
          className="mk-m__shot"
          src={placeholderImageDataUrl('Jhumka', 0)}
          alt=""
        />

        <div className="mk-m__body">
          <b className="mk-m__title">Traditional jhumka</b>
          <span className="mk-m__price">₹2,450</span>

          <div className="mk-m__acts">
            <span className="mk-m__btn">
              <Icon name="sparkle" size={9} />
              Try on
            </span>
            <span className="mk-m__btn mk-m__btn--alt">
              <Icon name="whatsapp" size={9} />
              Message
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function TagMock() {
  return (
    <div className="mk-m mk-m--tag" aria-hidden="true">
      <span className="mk-m__hole" />

      <div className="mk-m__qr">
        {QR_ROWS.flatMap((row, y) =>
          [...row].map((cell, x) => (
            <i className={cell === '#' ? 'on' : undefined} key={`${x}-${y}`} />
          )),
        )}
      </div>

      <div className="mk-m__cap">
        <b>Traditional jhumka</b>
        <br />
        Scan for price &amp; WhatsApp
      </div>
    </div>
  )
}
