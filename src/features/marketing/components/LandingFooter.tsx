import { Link } from 'react-router-dom'
import { paths } from '@/routes/paths'

/**
 * The landing footer.
 *
 * The oversized ghost wordmark is the reference's closing move: the brand as a texture rather than
 * a headline. It is marked `aria-hidden` and is not a heading — a screen reader announcing the
 * company name a second time at the bottom of the page is noise, not structure.
 *
 * The link columns are deliberately sparse. Everything here has to point at a route that exists;
 * a footer full of dead marketing pages is the fastest way to make a working product look
 * unfinished.
 */

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'How it works', href: '#how' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    title: 'For sellers',
    links: [
      { label: 'Create your store', to: paths.marketing.getStarted },
      { label: 'Sign in', to: paths.marketing.signIn },
    ],
  },
]

export function LandingFooter() {
  return (
    <footer className="mk-foot">
      <div className="mk-foot__grid">
        <div className="mk-foot__brand">
          <Link className="mk-logo" to={paths.root}>
            <span className="mk-logo__mark" aria-hidden="true">
              श
            </span>
            Shringaar
          </Link>
          <p>
            A storefront and augmented-reality try-on for local jewellery sellers. Photograph a
            piece, price it, and let customers see it on before they message you.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div className="mk-foot__col" key={column.title}>
            <p>{column.title}</p>
            <ul>
              {column.links.map((link) =>
                'to' in link ? (
                  <li key={link.label}>
                    <Link to={link.to}>{link.label}</Link>
                  </li>
                ) : (
                  <li key={link.label}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}

        <div className="mk-foot__col">
          <p>Support</p>
          <ul>
            <li>
              <a href="https://wa.me/919820000000" rel="noreferrer noopener" target="_blank">
                WhatsApp us
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="mk-wordmark" aria-hidden="true">
        Shringaar<span>.</span>
      </div>

      <div className="mk-foot__bottom">
        <span>© {new Date().getFullYear()} Shringaar. A demonstration build.</span>
        <div className="mk-foot__soc">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <Link to={paths.marketing.signIn}>Sign in</Link>
        </div>
      </div>
    </footer>
  )
}
