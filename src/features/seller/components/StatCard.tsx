import type { ReactNode } from 'react'
import { DemoBadge } from '@/components/ui/Badge'
import { Icon, type IconName } from '@/components/ui/Icon'

/**
 * Overview and analytics stat tile.
 *
 * When `isDemo` is set the tile carries a "Demo data" chip. That is not decoration: the value is
 * synthetic, and a seller must be able to tell at a glance — see arch.md §5.
 */

export interface StatCardProps {
  label: string
  value: string
  icon: IconName
  /** Percentage change against the previous period, or null when there is no baseline. */
  delta?: number | null
  /** Short context line, e.g. "across 6 published products". */
  footnote?: ReactNode
  isDemo?: boolean
}

export function StatCard({ label, value, icon, delta, footnote, isDemo }: StatCardProps) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta)
  const direction = hasDelta ? (delta >= 0 ? 'up' : 'down') : null

  return (
    <div className="stat">
      <div className="stat__top">
        <span className="stat__label">{label}</span>
        <span className="stat__icon" aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
      </div>

      <div className="stat__value tabular">{value}</div>

      <div className="stat__foot">
        {hasDelta && direction ? (
          <span className={`stat__delta stat__delta--${direction}`}>
            <Icon name={direction === 'up' ? 'arrowUp' : 'arrowDown'} size={13} />
            {`${Math.abs(delta).toFixed(1)}%`}
          </span>
        ) : null}

        {footnote ? <span>{footnote}</span> : null}
        {isDemo ? <DemoBadge size="inline" /> : null}
      </div>
    </div>
  )
}
