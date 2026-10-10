/**
 * Video-space → canvas-space conversion.
 *
 * The video element and the canvas are stacked in the same box, but the video's own frame is
 * whatever the camera gave us (typically 640×480, 4:3) while the box is the responsive card the
 * customer's phone produced. So a landmark's normalised `(x, y)` needs a transform before it means
 * anything in canvas pixels, and that transform has to match exactly what the browser is doing to
 * the video underneath — otherwise the earring drifts away from the ear it is meant to sit on, and
 * drifts differently at every screen size.
 *
 * The whole file is one idea: **one scale factor for both axes**. See `computeViewTransform`.
 */

import type { Vec2 } from './geometry'

export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * How the video fills its box.
 *
 * `cover` matches `object-fit: cover` — fill the box, crop the overflow. It is what the stage uses:
 * a letterboxed video wastes screen on a phone, and the crop is symmetric so the face stays centred.
 */
export type Fit = 'cover' | 'contain'

export interface ViewTransform {
  /** The single scale factor applied to both axes. */
  readonly scale: number
  /** Canvas px from the box's top-left to the drawn frame's top-left. Both are ≥ 0 under `cover`. */
  readonly offsetX: number
  readonly offsetY: number
  /** The drawn size of the whole video frame, in canvas px. */
  readonly drawWidth: number
  readonly drawHeight: number
}

const EMPTY_TRANSFORM: ViewTransform = {
  scale: 0,
  offsetX: 0,
  offsetY: 0,
  drawWidth: 0,
  drawHeight: 0,
}

/**
 * The transform from the tracked frame's normalised space to canvas pixels.
 *
 * **One `ratio`, both axes.** That is the entire point of the function. The tempting shortcut is
 * `x * box.width` and `y * box.height`, which is correct only when the video's aspect ratio happens
 * to equal the box's. When it does not — a 16:9 frame in a square card — that stretches the space,
 * and then the *same* measurement means different things horizontally and vertically: the
 * interocular distance picks up a fake horizontal stretch, so the earring is sized from a number
 * that changed when the customer rotated their phone. Using one ratio keeps the space isometric, so
 * a length is a length no matter which way it points.
 */
export function computeViewTransform(source: Size, box: Size, fit: Fit = 'cover'): ViewTransform {
  if (source.width <= 0 || source.height <= 0 || box.width <= 0 || box.height <= 0) {
    return EMPTY_TRANSFORM
  }

  const ratioX = box.width / source.width
  const ratioY = box.height / source.height
  const ratio = fit === 'cover' ? Math.max(ratioX, ratioY) : Math.min(ratioX, ratioY)

  const drawWidth = source.width * ratio
  const drawHeight = source.height * ratio

  return {
    scale: ratio,
    offsetX: (box.width - drawWidth) / 2,
    offsetY: (box.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  }
}

/**
 * A normalised point, in canvas pixels.
 *
 * `mirror` reflects about the box's vertical centre line — `x → box.width - x`. That is x only;
 * flipping y would turn the view upside down, which is what a naive "mirror the point" helper does.
 *
 * The reflection is applied after the transform rather than to the landmark's `x` beforehand. Those
 * two happen to be **algebraically identical here** — the cover/contain transform centres the frame
 * in the box, so `box.width - (offsetX + nx·drawWidth)` expands to `offsetX + (1 - nx)·drawWidth`.
 * The canvas-space form is still the one to write: it states the reflection directly, and it stays
 * a reflection if the transform ever gains a non-centred alignment, where the normalised flip would
 * quietly stop being one.
 */
export function toCanvasPoint(
  normalised: Vec2,
  view: ViewTransform,
  box: Size,
  mirror: boolean,
): Vec2 {
  const x = view.offsetX + normalised.x * view.drawWidth
  const y = view.offsetY + normalised.y * view.drawHeight
  return { x: mirror ? box.width - x : x, y }
}
