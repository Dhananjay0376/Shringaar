import type { HTMLAttributes, ReactNode } from 'react'

/**
 * Card shell. Structure comes from a hairline border rather than a shadow (design.md D5), so cards
 * stay legible in screenshots and do not compete with product photography.
 */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes the default hairline shadow — used for cards nested inside other cards. */
  flush?: boolean
}

export function Card({ flush, className, children, ...rest }: CardProps) {
  return (
    <div className={['card', flush ? 'card--flush' : '', className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  )
}

export interface CardHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  id?: string
}

export function CardHeader({ title, subtitle, actions, id }: CardHeaderProps) {
  return (
    <div className="card__header">
      <div>
        <h2 className="card__title" id={id}>
          {title}
        </h2>
        {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="card__actions">{actions}</div> : null}
    </div>
  )
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes padding — for tables and lists that manage their own spacing. */
  flush?: boolean
}

export function CardBody({ flush, className, children, ...rest }: CardBodyProps) {
  return (
    <div
      className={['card__body', flush ? 'card__body--flush' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['card__footer', className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  )
}
