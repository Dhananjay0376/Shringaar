import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/components/ui/Icon'

/**
 * Empty state.
 *
 * A new seller's first screen is always an empty one, so this is onboarding rather than a dead end:
 * every empty state names what is missing and offers the action that fills it — see design.md D16.
 */

export interface EmptyStateProps {
  icon?: IconName
  title: string
  description: ReactNode
  /** The primary next step. Strongly encouraged: an empty state without an action is a wall. */
  action?: ReactNode
  secondaryAction?: ReactNode
  compact?: boolean
}

export function EmptyState({
  icon = 'package',
  title,
  description,
  action,
  secondaryAction,
  compact,
}: EmptyStateProps) {
  return (
    <div className={['empty', compact ? 'empty--compact' : ''].filter(Boolean).join(' ')}>
      <span className="empty__icon">
        <Icon name={icon} size={22} />
      </span>
      <h3 className="empty__title">{title}</h3>
      <p className="empty__desc">{description}</p>
      {action || secondaryAction ? (
        <div className="empty__actions">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}
