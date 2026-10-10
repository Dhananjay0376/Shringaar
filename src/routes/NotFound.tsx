import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Button, btnClass } from '@/components/ui/Button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { paths } from './paths'

/**
 * Not found.
 *
 * A seller who mistypes a dashboard URL and a customer who scans a retired QR code land on the same
 * page, so it offers both ways out rather than assuming which one arrived.
 */

export function NotFound() {
  const navigate = useNavigate()

  useDocumentTitle('Page not found — Shringaar')

  return (
    <div className="auth">
      <div className="auth__card">
        <span className="empty__icon">
          <Icon name="search" size={22} />
        </span>
        <h1 className="auth__title">Page not found</h1>
        <p className="auth__desc">
          There is nothing at this address. If you scanned a QR code, the seller may have changed or
          removed that product.
        </p>

        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <Link className={btnClass({ variant: 'primary' })} to={paths.seller.dashboard}>
            Seller dashboard
          </Link>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    </div>
  )
}
