import { Icon, type IconName } from '@/components/ui/Icon'
import { formatRelativeTime } from '@/lib/format'
import type { ActivityEvent, ActivityType } from '../types/seller'

/**
 * Recent activity feed.
 *
 * Reads as a plain sentence log — "Published 'Meera Ring'" — because the seller's question is
 * "what changed?", not "what is the event type?". The type only drives the icon.
 */

const ICONS: Record<ActivityType, { icon: IconName; tone: '' | 'gold' | 'green' }> = {
  product_created: { icon: 'plusCircle', tone: 'gold' },
  product_updated: { icon: 'pencil', tone: '' },
  product_published: { icon: 'check', tone: 'green' },
  product_unpublished: { icon: 'arrowDown', tone: '' },
  product_deleted: { icon: 'trash', tone: '' },
  store_updated: { icon: 'store', tone: '' },
  asset_uploaded: { icon: 'sparkle', tone: 'gold' },
}

export interface ActivityFeedProps {
  events: ActivityEvent[]
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  if (events.length === 0) {
    return (
      <p className="text-muted text-sm" style={{ padding: 'var(--sp-5)' }}>
        Nothing has happened yet. Adding or publishing a product will show up here.
      </p>
    )
  }

  return (
    <ul className="activity">
      {events.map((event) => {
        const { icon, tone } = ICONS[event.type]

        return (
          <li className="activity__item" key={event.id}>
            <span
              className={['activity__icon', tone ? `activity__icon--${tone}` : '']
                .filter(Boolean)
                .join(' ')}
              aria-hidden="true"
            >
              <Icon name={icon} size={14} />
            </span>

            <div className="activity__body">
              <p className="activity__text">{event.message}</p>
              <p className="activity__time">{formatRelativeTime(event.at)}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
