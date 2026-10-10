import type { ReactNode } from 'react'
import { IconButton } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useDismissable } from '../hooks/useDismissable'

/**
 * Overflow menu for a record row or card.
 *
 * Keyboard behaviour lives in `useDismissable` (Escape closes and returns focus to the trigger), so
 * the menu behaves the same wherever it is used. `href` items open in a new tab — a seller
 * previewing their public page should not lose the dashboard they were working in.
 */

export interface RowMenuItem {
  label: string
  icon?: IconName
  onSelect?: () => void
  href?: string
  danger?: boolean
  /** Renders a divider above this item. */
  separated?: boolean
}

export interface RowMenuProps {
  label: string
  items: RowMenuItem[]
  /** Renders the trigger as a bordered button rather than a bare icon. */
  bordered?: boolean
  children?: ReactNode
}

export function RowMenu({ label, items, bordered }: RowMenuProps) {
  const { open, toggle, close, ref, triggerRef } = useDismissable<HTMLDivElement>()

  return (
    <div className="row-menu" ref={ref}>
      <IconButton
        icon="moreVertical"
        label={label}
        bordered={bordered}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          triggerRef.current = event.currentTarget
          toggle()
        }}
      />

      {open ? (
        <div className="row-menu__list" role="menu">
          {items.map((item) => {
            const className = ['menu__item', item.danger ? 'menu__item--danger' : '']
              .filter(Boolean)
              .join(' ')

            const content = (
              <>
                {item.icon ? <Icon name={item.icon} size={15} /> : null}
                <span>{item.label}</span>
              </>
            )

            return (
              <div key={item.label}>
                {item.separated ? <div className="menu__sep" /> : null}
                {item.href ? (
                  <a
                    className={className}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    role="menuitem"
                    onClick={() => close()}
                  >
                    {content}
                  </a>
                ) : (
                  <button
                    type="button"
                    className={className}
                    role="menuitem"
                    onClick={() => {
                      close()
                      item.onSelect?.()
                    }}
                  >
                    {content}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
