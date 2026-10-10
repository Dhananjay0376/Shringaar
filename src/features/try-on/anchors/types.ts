/**
 * What a category-specific placement solver has to be.
 *
 * The interface exists so `registry.ts` can answer "can this category run yet?" with a number or a
 * `null`, and so the answer has somewhere to live other than a comment. It is deliberately narrow:
 * `solve` takes the face-local frame the core already built and returns finished targets, in canvas
 * pixels, ready to draw. A solver that had to do its own projection or its own smoothing would be a
 * second place for the coordinate transform to be wrong.
 */

import type { Calibration } from '../core/calibration'
import type { FaceFrame } from '../core/framing'
import type { CategoryKey, TryOnAnchor } from '@/lib/catalog'
import type { PlacementTarget } from '../types/frame'

export interface AnchorSolver {
  /** The catalogue category this solver serves. */
  readonly category: CategoryKey
  /** The try-on anchor it needs. A product declaring a conflicting anchor is refused, not guessed at. */
  readonly requiredAnchor: TryOnAnchor
  /** Everything the solver can derive from a face, as drawable targets. Empty means "not this frame". */
  solve(frame: FaceFrame, calibration: Calibration): PlacementTarget[]
}
