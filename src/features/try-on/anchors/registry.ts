/**
 * Which category has a working anchor solver.
 *
 * This file exists so that "we have not built that yet" is a value the program can return, rather than
 * something the UI has to remember to check. `solverFor` returning `null` is the single source of that
 * fact, and `renderers/select.ts` consults `IMPLEMENTED_AR_CATEGORIES` for the same question at the
 * asset level — both are short lists of one, and neither pretends a stub solver exists.
 *
 * Why not stub the other four? A stub returning a plausible-looking target would put a necklace on
 * someone's chin and call it a feature. The interface is satisfied by the absence of an entry.
 */

import { earringSolver } from './earring'
import type { AnchorSolver } from './types'
import type { ArCategory } from '../types/asset'

const SOLVERS: Partial<Record<ArCategory, AnchorSolver>> = {
  earrings: earringSolver,
  /* necklace: not implemented — the neck is not in the face mesh at all; it needs a pose model.
     pendant:   not implemented — same, and a pendant needs a sternum reference.
     ring:      not implemented — the hand needs a separate Hand Landmarker model.
     bracelet:  not implemented — same. */
}

/**
 * The solver for a category, or `null` when none is implemented.
 *
 * `null` is a real answer with its own message on screen ("not available for this category yet"), not
 * an error and not an empty result. The distinction matters: an empty result would render a working
 * page with no jewellery on it, which reads as a bug in the try-on rather than as a missing feature.
 */
export function solverFor(category: ArCategory): AnchorSolver | null {
  return SOLVERS[category] ?? null
}

/** The categories with a solver. Derived from the table, so it cannot disagree with `solverFor`. */
export function implementedCategories(): ArCategory[] {
  return (Object.keys(SOLVERS) as ArCategory[]).filter((category) => solverFor(category) !== null)
}
