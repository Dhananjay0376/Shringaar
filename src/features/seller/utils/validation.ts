/**
 * Form validation for the seller forms.
 *
 * Rules live here rather than inside components so the add-product and edit-product screens apply
 * exactly the same checks. Messages name the fix ("Enter a price greater than 0") instead of
 * reporting that something is wrong — see design.md §7.
 *
 * These are UX checks. The database re-validates everything; a client check is never a security
 * boundary.
 */

import { isReservedSlug, SLUG_PATTERN } from '@/lib/catalog'
import { normaliseWhatsApp } from '@/lib/catalog'
import type { ProductInput, StoreInput } from '../types/seller'

export type FieldErrors<T extends string> = Partial<Record<T, string>>

export const LIMITS = {
  productName: { min: 2, max: 90 },
  productDescription: { min: 10, max: 2000 },
  storeName: { min: 2, max: 60 },
  storeDescription: { max: 600 },
  slug: { min: 2, max: 48 },
  priceMax: 10_000_000,
  whatsappMinDigits: 8,
} as const

export function isValidEmail(value: string): boolean {
  // Deliberately permissive. Over-strict email regexes reject valid addresses; the real check is a
  // confirmation mail.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function lengthBetween(
  value: string,
  label: string,
  min: number,
  max: number,
): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return `${label} is required.`
  if (trimmed.length < min) return `Use at least ${min} characters for the ${label.toLowerCase()}.`
  if (trimmed.length > max) return `${label} can be at most ${max} characters.`
  return undefined
}

/* ── Product ─────────────────────────────────────────────────────────────── */

export type ProductField = keyof ProductInput | 'image' | 'tryOnAsset'

export function validateProduct(input: ProductInput): FieldErrors<ProductField> {
  const errors: FieldErrors<ProductField> = {}

  const nameError = lengthBetween(
    input.name,
    'Product name',
    LIMITS.productName.min,
    LIMITS.productName.max,
  )
  if (nameError) errors.name = nameError

  const descriptionError = lengthBetween(
    input.description,
    'Description',
    LIMITS.productDescription.min,
    LIMITS.productDescription.max,
  )
  if (descriptionError) errors.description = descriptionError

  if (!Number.isFinite(input.price)) {
    errors.price = 'Enter a price.'
  } else if (input.price <= 0) {
    errors.price = 'Enter a price greater than 0.'
  } else if (input.price > LIMITS.priceMax) {
    errors.price = `Price must be under ${LIMITS.priceMax.toLocaleString('en-US')}.`
  }

  if (!input.category) errors.category = 'Choose a category.'

  // A product without an image would render as a blank tile on the storefront, so publishing
  // requires one. A draft may be saved without it while the photography is being arranged.
  if (input.status === 'published' && !input.image) {
    errors.image = 'Add a product image before publishing. Save as a draft instead if it is not ready.'
  }

  if (input.externalProductUrl && !isValidHttpUrl(input.externalProductUrl)) {
    errors.externalProductUrl = 'Enter a full URL starting with http:// or https://.'
  }

  // A try-on asset that is declared but not stored is deliberately NOT an error. Recording "this
  // product needs a .glb" is useful on its own, and a browser cannot upload to file storage — the
  // form surfaces that as a warning naming what is missing, rather than blocking the save.
  if (input.whatsappNumber && normaliseWhatsApp(input.whatsappNumber).length < LIMITS.whatsappMinDigits) {
    errors.whatsappNumber = 'Enter a full number including the country code.'
  }

  return errors
}

/** True when nothing in the form is blocking a save. */
export function hasErrors(errors: FieldErrors<string>): boolean {
  return Object.keys(errors).length > 0
}

/* ── Store ───────────────────────────────────────────────────────────────── */

export type StoreField = keyof StoreInput

export function validateStore(input: StoreInput): FieldErrors<StoreField> {
  const errors: FieldErrors<StoreField> = {}

  const nameError = lengthBetween(input.name, 'Store name', LIMITS.storeName.min, LIMITS.storeName.max)
  if (nameError) errors.name = nameError

  const slug = input.slug.trim()

  if (!slug) {
    errors.slug = 'A store URL is required.'
  } else if (!SLUG_PATTERN.test(slug)) {
    errors.slug = 'Use lowercase letters, numbers and single hyphens only.'
  } else if (slug.length < LIMITS.slug.min) {
    errors.slug = 'Use at least 2 characters.'
  } else if (slug.length > LIMITS.slug.max) {
    errors.slug = `Keep the URL under ${LIMITS.slug.max} characters.`
  } else if (isReservedSlug(slug)) {
    errors.slug = 'That address is reserved. Choose another.'
  }

  if (input.description.trim().length > LIMITS.storeDescription.max) {
    errors.description = `Keep the description under ${LIMITS.storeDescription.max} characters.`
  }

  if (input.contactEmail && !isValidEmail(input.contactEmail)) {
    errors.contactEmail = 'Enter a valid email address.'
  }

  if (input.whatsappNumber && normaliseWhatsApp(input.whatsappNumber).length < LIMITS.whatsappMinDigits) {
    errors.whatsappNumber = 'Enter a full number including the country code.'
  }

  if (input.contactPhone && normaliseWhatsApp(input.contactPhone).length < LIMITS.whatsappMinDigits) {
    errors.contactPhone = 'Enter a full number including the country code.'
  }

  return errors
}

/** Looks up the message for a field, so components never index the map directly. */
export function errorFor<E extends string>(
  errors: FieldErrors<E>,
  field: E,
): string | undefined {
  return errors[field]
}
