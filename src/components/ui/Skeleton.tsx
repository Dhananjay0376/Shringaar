/** Loading placeholders. Shapes mirror the content they stand in for, so the layout does not jump. */

export interface SkeletonProps {
  width?: string
  height?: string
  className?: string
}

export function Skeleton({ width, height, className }: SkeletonProps) {
  return (
    <span
      className={['skeleton', className ?? ''].filter(Boolean).join(' ')}
      style={{ display: 'block', width, height }}
      aria-hidden="true"
    />
  )
}

/** Stat tile placeholder for the overview row. */
export function StatSkeleton() {
  return (
    <div className="stat" aria-hidden="true">
      <div className="stat__top">
        <Skeleton width="9ch" height="10px" />
        <Skeleton width="30px" height="30px" />
      </div>
      <Skeleton className="skeleton--stat" height="30px" />
      <div className="stat__foot">
        <Skeleton width="14ch" height="10px" />
      </div>
    </div>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="product-card" aria-hidden="true">
      <div className="product-card__media">
        <Skeleton height="100%" />
      </div>
      <div className="product-card__body">
        <Skeleton width="80%" height="14px" />
        <Skeleton width="45%" height="18px" />
        <Skeleton width="60%" height="10px" />
      </div>
    </div>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" style={{ padding: 'var(--sp-5)' }} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="row" style={{ gap: 'var(--sp-3)' }}>
          <Skeleton width="40px" height="40px" />
          <div style={{ flex: 1 }}>
            <Skeleton width="60%" height="12px" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Announced to assistive tech — a silent skeleton is invisible to a screen reader. */
export function LoadingAnnouncement({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {label}
    </span>
  )
}
