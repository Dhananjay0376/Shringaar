import type { ComponentType } from 'react'
import { Icon, type IconName } from '@/components/ui/Icon'
import { PhoneMock, StorefrontMock, TagMock } from './AppMock'

/**
 * The two things the landing page has to explain, kept visually separate because they are separate
 * promises.
 *
 * `AiShowcase` is the dark band: what the product does, stated as outcomes. `SellerToolkit` is the
 * flat grid underneath: the specific controls a seller will actually operate once they are inside.
 * Merging them would let a reader mistake a screen they will use every day for a capability that is
 * still being built.
 */

/* ── What the product does ───────────────────────────────────────────────── */

interface AiFeature {
  title: string
  body: string
  /** The miniature shown above the title — a reduced drawing of the surface this card promises. */
  Mock: ComponentType
}

const AI_FEATURES: AiFeature[] = [
  {
    title: 'A storefront in one sitting',
    body: 'Photograph a piece, add a price, pick a category. Your store gets its own link the moment you name it — no designer, no developer, no monthly fee to start.',
    Mock: StorefrontMock,
  },
  {
    title: 'Customers see it on',
    body: 'Send a link and the piece opens on the customer’s own phone. Add a 3D model and they can place it live in the browser; pieces without one open as a photo overlay instead.',
    Mock: PhoneMock,
  },
  {
    title: 'Every piece has a QR code',
    body: 'Print it on a tag or a shelf card. A customer scans and lands on that one piece, with your WhatsApp number already on the screen.',
    Mock: TagMock,
  },
]

export function AiShowcase() {
  return (
    <section className="mk-band" id="features" aria-labelledby="mk-ai-title">
      <div className="mk-band__head">
        <span className="mk-eyebrow">
          <Icon name="sparkle" size={12} />
          Shringar AI
        </span>

        <h2 className="mk-h2" id="mk-ai-title">
          The shop you already run, <span className="mk-mute">now reachable</span>
        </h2>

        <p className="mk-band__sub">
          Built for sellers who work from a shop counter, a market stall or a spare room — not for
          people who want to learn a website builder.
        </p>
      </div>

      <div className="mk-fcards">
        {AI_FEATURES.map((feature) => (
          <article className="mk-fcard" key={feature.title}>
            <div className="mk-fcard__media">
              <feature.Mock />
            </div>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
      </div>

      <p className="mk-band__foot">
        Try-on quality depends on the asset behind it. A cut-out photo places reasonably; a real 3D
        model is what makes it convincing. Photographs are never converted into 3D models
        automatically.
      </p>
    </section>
  )
}

/* ── The screens the seller operates ─────────────────────────────────────── */

interface Tool {
  icon: IconName
  title: string
  body: string
}

const TOOLS: Tool[] = [
  {
    icon: 'camera',
    title: 'Add jewellery in batches',
    body: 'Work one category at a time — earrings, then nose rings, then necklaces. Keep clicking pictures until the tray is empty, then move on.',
  },
  {
    icon: 'gridView',
    title: 'Collection, grouped by type',
    body: 'Every piece you have photographed, sorted into the categories you chose, with its price and description.',
  },
  {
    icon: 'qr',
    title: 'A QR code per product',
    body: 'Scan it yourself to check the customer sees what you expect before you print a hundred tags.',
  },
  {
    icon: 'whatsapp',
    title: 'Enquiries straight to WhatsApp',
    body: 'No cart, no checkout, no payment gateway. A customer who likes a piece messages you on the number you already use.',
  },
  {
    icon: 'tag',
    title: 'Prices you can change anytime',
    body: 'Gold rates move. Edit a price and the storefront shows the new one immediately.',
  },
  {
    icon: 'chart',
    title: 'See which designs land',
    body: 'Views, try-on starts and WhatsApp taps per piece, so you know what to make more of next season.',
  },
]

export function SellerToolkit() {
  return (
    <section className="mk-tools" id="how" aria-labelledby="mk-tools-title">
      <div className="mk-tools__head">
        <span className="mk-eyebrow mk-eyebrow--plain">
          <Icon name="grid" size={12} />
          What you will use
        </span>
        <h2 className="mk-h2" id="mk-tools-title">
          Six screens, <span className="mk-mute">and that is the whole app</span>
        </h2>
      </div>

      <div className="mk-tools__grid">
        {TOOLS.map((tool) => (
          <article className="mk-tool" key={tool.title}>
            <span className="mk-tool__icon" aria-hidden="true">
              <Icon name={tool.icon} size={17} />
            </span>
            <h3>{tool.title}</h3>
            <p>{tool.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ── The three steps to a live store ─────────────────────────────────────── */

const STEPS = [
  {
    n: '01',
    title: 'Name your store',
    body: 'A name, and a WhatsApp number if you have one ready. That is enough to open — the rest can wait.',
  },
  {
    n: '02',
    title: 'Photograph your first piece',
    body: 'Take the picture here or upload one you already have. Add a price. Clear, well-lit images work best.',
  },
  {
    n: '03',
    title: 'Share the link',
    body: 'Your store has its own address and every piece has a QR code. Send both to whoever asks.',
  },
]

export function HowItWorks() {
  return (
    <section className="mk-steps" id="pricing" aria-labelledby="mk-steps-title">
      <div className="mk-steps__head">
        <span className="mk-eyebrow mk-eyebrow--plain">
          <Icon name="clock" size={12} />
          How it works
        </span>
        <h2 className="mk-h2" id="mk-steps-title">
          Open in about <span className="mk-mute">fifteen minutes</span>
        </h2>
      </div>

      <ol className="mk-steps__list">
        {STEPS.map((step) => (
          <li className="mk-stepitem" key={step.n}>
            <span className="mk-stepitem__n">{step.n}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
