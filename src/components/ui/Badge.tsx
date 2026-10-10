import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * Status and provenance chip.
 *
 * A badge always carries a text label. Colour alone never encodes meaning — see design.md D11 —
 * so these stay readable in greyscale and for colour-blind users.
 */

export type BadgeTone = 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'info'

export interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  icon?: IconName
  /** Adds a filled dot before the label, for status badges in dense lists. */
  dot?: boolean
  title?: string
}

export function Badge({ children, tone = 'neutral', icon, dot = false, title }: BadgeProps) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  )
}

export interface DemoBadgeProps {
  /** `chip` for headers and stat tiles, `inline` for card footers. */
  size?: 'chip' | 'inline'
  title?: string
}

export const DEMO_BADGE_TITLE =
  'These numbers are generated sample data, not real traffic. They become live measurements once analytics events are recorded by a connected backend.'

/**
 * The one component that says "this is not real data". Used on every metric surface so a seller
 * can never mistake demo numbers for their own — see arch.md §5 and design.md §7.
 */
export function DemoBadge({ size = 'chip', title = DEMO_BADGE_TITLE }: DemoBadgeProps) {
  return (
    <Badge tone="warning" icon={size === 'chip' ? 'info' : undefined} title={title}>
      Demo data
    </Badge>
  )
}
