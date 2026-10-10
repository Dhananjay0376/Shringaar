import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

/**
 * Demo-mode disclosure.
 *
 * Shown once per session at the top of the Overview page, and dismissible — a banner that cannot be
 * dismissed becomes wallpaper. The persistent "Demo data" chip in the header is what guarantees the
 * state is never actually hidden; this banner is what explains it the first time.
 *
 * The wording is deliberately precise: "saved in this browser only" is true because the mock adapter
 * writes to `localStorage`. It must never say "saved" unqualified, which would read as a database
 * write. See arch.md §5.
 */

export interface DemoModeBannerProps {
  onDismiss: () => void
  /**
   * True on screens showing the seeded demonstration catalogue (Overview), false where the seller
   * is looking at their own uploads (Home). Without this the banner tells a seller who has just
   * photographed their own stock that their products are "sample data", which is simply wrong.
   */
  seeded?: boolean
}

export function DemoModeBanner({ onDismiss, seeded = false }: DemoModeBannerProps) {
  return (
    <div className="banner banner--demo" role="note">
      <span className="banner__icon">
        <Icon name="info" size={17} />
      </span>

      <div className="banner__body">
        <div className="banner__title">Demo mode — no backend is connected</div>
        <p>
          {seeded
            ? 'The products below are sample data, and the analytics on this dashboard are generated numbers, not real traffic. '
            : 'The products and counts below are read from the demo store in this browser, not from a live shop. '}
          {/* Neither branch says "your uploads": Home serves both the seller who just created a
              store and the one who signed in to the seeded catalogue, and it cannot tell them
              apart from here. */}
          Anything you create, edit or delete is saved in <strong>this browser only</strong>; nothing
          is written to a database, and no files are uploaded to storage.
        </p>
      </div>

      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}
