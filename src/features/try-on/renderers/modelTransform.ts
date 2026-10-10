/**
 * Where a 3D model goes, given the same target the flat renderer draws.
 *
 * Kept pure and separate from `three.ts` for the same reason `solveEarrings` is separate from the
 * canvas: the interesting part of 3D placement is arithmetic — a coordinate convention, a sign, an
 * aspect ratio — and arithmetic is the part that can be pinned by a test without a GPU. `three.ts`
 * then only applies what this returns.
 *
 * ### The coordinate convention, stated once
 *
 * The camera looks down −z from +z with `up = +y`, and its orthographic frustum spans the canvas box
 * centred on the origin. So world `(0, 0)` is the **centre of the box**, world `+x` is right on
 * screen, and world `+y` is **up**.
 *
 * Screen coordinates in this codebase are `+y` down, and `PlacementTarget` is written in them. That
 * mismatch is the entire reason this file exists rather than the conversion being inlined: a flip that
 * is applied in one place and not another is invisible in code review and shows up as earrings on the
 * forehead, or as a model that rotates the wrong way when the head tilts.
 *
 * ### Why the anchor is the model's own bounding box
 *
 * `PlacementTarget.x`/`y` is the point the piece hangs from — the top-centre of its drawn box. The
 * flat renderer satisfies that by drawing at `(-width/2, 0)`; here it is satisfied by normalising the
 * loaded scene so its bounding box's top-centre is the local origin. Both renderers then place the
 * same point at the same place, and a piece does not jump when it moves between them.
 *
 * Height is deliberately *not* taken from the target. An image has an intrinsic aspect ratio and the
 * flat renderer derives its height from it; a model has real geometry, and squashing it to an
 * arbitrary aspect would distort the piece. Only the width is imposed.
 */

import type { PlacementTarget } from '../types/frame'
import type { RendererFrame } from './types'

/** The model's own extents, in its own units, after it has been centred and normalised. */
export interface ModelBounds {
  /** Width of the model's bounding box in its own units. Must be > 0 for a transform to exist. */
  readonly width: number
  readonly height: number
  readonly depth: number
}

export interface ModelTransform {
  /** World position of the anchor — the model's bounding-box top-centre. */
  readonly x: number
  readonly y: number
  readonly z: number
  /** Uniform scale that makes the model's bounding box `target.width` wide. */
  readonly scale: number
  /** Rotation about z in the camera's handedness. */
  readonly rotationZ: number
  /** Horizontal foreshortening from head yaw, applied after the rotation. */
  readonly squash: number
  /** Clamped to 0..1, ready to be a material opacity. */
  readonly opacity: number
}

/**
 * The transform for one target, or `null` when there is nothing to draw.
 *
 * Returning `null` rather than a degenerate transform is deliberate: a scale of `NaN` or `0` reaching
 * a `Matrix4` produces a mesh that is silently absent, and "silently absent" is the hardest rendering
 * bug to attribute. The caller skips, which is the same outcome with a reason attached.
 */
export function modelTransformFor(
  target: PlacementTarget,
  frame: RendererFrame,
  bounds: ModelBounds,
): ModelTransform | null {
  /* Guarded here as well as by the caller's `isDrawableTarget`, for the same reason the flat renderer
     gates twice: a NaN in a matrix is not recoverable by the next frame's overwrite in every engine,
     and the failure looks like the model was never loaded. */
  if (!Number.isFinite(bounds.width) || bounds.width <= 0) return null

  const scale = target.width / bounds.width
  if (!Number.isFinite(scale) || scale <= 0) return null

  return {
    /* Screen → world. `+y` down becomes `+y` up, which is why the second term is subtracted. */
    x: target.x - frame.width / 2,
    y: frame.height / 2 - target.y,
    /* Everything sits on one plane. The target carries no depth and inventing one — pushing the piece
       "behind" the head, say — would be fabricating an occlusion this engine does not compute: there
       is no face mesh in the scene to occlude it. Flat, and honestly flat. */
    z: 0,
    scale,
    /* Negated. A positive `rotation` is clockwise on screen because screen `y` points down; in a frame
       whose `y` points up, clockwise is a negative rotation. Getting this wrong tilts the piece by
       twice the head roll, which reads as a twitch rather than as an offset. */
    rotationZ: -target.rotation,
    squash: target.squash,
    /* Clamped here rather than at the material, because an out-of-range opacity is silently clamped by
       some engines and would make the two renderers disagree about what the solver asked for. */
    opacity: Math.min(1, Math.max(0, target.opacity)),
  }
}

/**
 * The scale that normalises a loaded model to unit width.
 *
 * Model files arrive in whatever units their author used — millimetres, metres, arbitrary. Dividing by
 * the bounding box width makes every model comparable, after which `modelTransformFor`'s `scale` is a
 * plain "how many canvas pixels wide" with no unit of the author's left in it.
 */
export function normalisingScale(bounds: ModelBounds): number | null {
  if (!Number.isFinite(bounds.width) || bounds.width <= 0) return null
  return 1 / bounds.width
}
