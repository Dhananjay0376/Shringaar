import type { ReactNode } from 'react'

/**
 * Page header.
 *
 * Every seller screen opens the same way — title, one line of context, actions on the right — so it
 * lives in one component rather than in seven. The subtitle is where each screen states what the page
 * actually shows, which is also where the demo/live distinction gets spelled out in words rather
 * than only in a chip.
 */

export interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  /** Primary and secondary actions, in priority order. */
  actions?: ReactNode
  /** Rendered above the title row — banners, warnings, demo notices. */
  banner?: ReactNode
}

export function PageHeader({ title, subtitle, actions, banner }: PageHeaderProps) {
  return (
    <>
      {banner}
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </>
  )
}
