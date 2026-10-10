/**
 * The renderer contract.
 *
 * Deliberately small: a renderer is handed the frame's finished targets and draws them. It does no
 * solving, no smoothing and no tracking — those happen upstream and are testable without a canvas.
 * Stage 2 has exactly one implementation (`canvas2d.ts`); `three.ts` arrives in Stage 4 behind the
 * same interface, which is the whole reason it is an interface and not just "the canvas code".
 *
 * `draw` takes the box rather than reading it off the canvas because a renderer must not have to
 * guess whether the caller already scaled the context. It sets the transform itself, once, and every
 * coordinate that follows is CSS px — the same space `PlacementTarget` is solved in. That removes the
 * one bug class this layer could otherwise invent: a caller and a renderer disagreeing about whether
 * the device-pixel ratio has been applied. It got that wrong once already, in the overlay.
 */

import type { PlacementTarget } from '../types/frame'

/** The canvas box, in CSS px, plus the backing-store scale. */
export interface RendererFrame {
  readonly width: number
  readonly height: number
  readonly pixelRatio: number
}

/** An image ready to draw: the pixels, and their intrinsic size. */
export interface DrawableAsset {
  readonly source: CanvasImageSource
  /** Intrinsic width in px, > 0. Used to derive the drawn height from the target's drawn width. */
  readonly width: number
  readonly height: number
}

export interface TryOnRenderer {
  /** Which implementation this is. Reported in diagnostics; `chooseRenderer` decides it. */
  readonly kind: 'canvas2d' | 'three'
  /**
   * Draws one frame. Clears first, always, so a renderer owns everything on its canvas and a call
   * with an empty target list is a clear. Not incremental — callers pass the whole frame.
   */
  draw(targets: readonly PlacementTarget[], frame: RendererFrame): void
}
