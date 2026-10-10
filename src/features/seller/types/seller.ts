/**
 * The seller domain contract — re-exported from its new home in `lib/`.
 *
 * The contract itself now lives at `@/lib/seller`, because three features need it and a feature
 * importing another feature's types is the coupling arch.md §9 rule 1 exists to prevent. This file
 * stays so the ~37 modules that already import `../types/seller` or
 * `@/features/seller/types/seller` keep working without an edit.
 *
 * `export *` and not `export type *`: the module also exports the runtime values `ServiceError`,
 * `NotImplementedInDemoError` and `isServiceError`, which the service adapters and the upload
 * fields import as values. A type-only re-export would drop them.
 *
 * New code should import from `@/lib/seller` directly.
 */

export * from '@/lib/seller'
