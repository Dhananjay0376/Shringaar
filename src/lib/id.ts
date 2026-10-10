/** Identifier generation. `crypto.randomUUID` is unavailable on insecure origins, hence the fallback. */

export function createId(prefix?: string): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : fallbackId()

  return prefix ? `${prefix}_${raw}` : raw
}

function fallbackId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36)}-${random}`
}

/** `createId('prod')` → `prod_9f1c…`. Prefixed ids make logs and storage paths readable. */
export const ID_PREFIXES = {
  seller: 'slr',
  store: 'str',
  product: 'prd',
  activity: 'act',
} as const
