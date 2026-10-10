/**
 * Display formatting. Every function here is pure and takes primitives, so both the seller
 * dashboard and the public storefront can use them without a shared domain dependency.
 */

import { CURRENCIES, type CurrencyKey } from './catalog'

/** Money is stored as a number plus a currency code and formatted only at render time. */
export function formatCurrency(amount: number, currency: string): string {
  const meta = CURRENCIES[currency as CurrencyKey]

  if (!meta) {
    // Unknown currency code: show the number with the code rather than guessing a symbol.
    return `${amount.toFixed(2)} ${currency}`
  }

  try {
    return new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${meta.symbol}${amount.toFixed(2)}`
  }
}

/** Compact form for stat tiles: 1_284 → "1.3K". Keeps big numbers from breaking the layout. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1000) return String(value)

  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatPercent(value: number, digits = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** "3 days ago". Used in the activity feed and product metadata. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  const seconds = Math.round((now.getTime() - date.getTime()) / 1000)
  if (seconds < 0) return 'Just now'
  if (seconds < 45) return 'Just now'
  if (seconds < 90) return '1 min ago'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`

  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`

  const months = Math.round(days / 30)
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`

  const years = Math.round(months / 12)
  return `${years} ${years === 1 ? 'year' : 'years'} ago`
}

/** Day label for chart axes: "12 Oct". */
export function formatDayShort(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date)
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

/** Two-letter initials for the avatar, from a display name or an email local part. */
export function formatInitials(input: string): string {
  const source = input.includes('@') ? (input.split('@')[0] ?? input) : input
  const words = source
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter(Boolean)

  if (words.length === 0) return '?'
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase()

  return `${(words[0] ?? '')[0] ?? ''}${(words[1] ?? '')[0] ?? ''}`.toUpperCase()
}
