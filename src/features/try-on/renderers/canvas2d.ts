/**
 * The Canvas 2D renderer — the one that actually draws an earring.
 *
 * It exists before the Three.js renderer on purpose. A flat image placed correctly on an ear is a
 * real, useful try-on for a piece photographed on a plain background, and it is measurable: the
 * target is a rectangle, the asset is a rectangle, and whether they line up is a question with an
 * answer. Three.js adds depth, lighting and a camera — all of which can be wrong in ways that are
 * hard to attribute. Getting the flat case exactly right first means that when the 3D case looks
 * wrong, geometry is not the suspect.
 *
 * The anchor contract comes from `types/frame.ts` and is easy to get backwards, so it is restated
 * here: **`x`/`y` is the point the asset HANGS from — the top-centre of its drawn box.** An earring
 * hangs off the lobe. So the draw translates to the anchor, rotates by roll, squashes horizontally,
 * and then draws the image at `(-width/2, 0)` — centred on the anchor horizontally, starting *at* it
 * vertically. Drawing at `(-width/2, -height/2)` would centre the earring on the lobe and float it up
 * the side of the head, which reads as "the tracking is broken" when it is only the offset.
 */

import { isDrawableTarget } from '../types/frame'
import type { DrawableAsset, RendererFrame, TryOnRenderer } from './types'
import type { PlacementTarget } from '../types/frame'

export interface Canvas2DRenderer extends TryOnRenderer {
  /**
   * Sets the image to draw. `null` clears it, which is a valid state — the canvas keeps drawing
   * (nothing) while a product's asset loads, rather than the caller needing a special case.
   */
  setAsset(asset: DrawableAsset | null): void
  readonly hasAsset: boolean
}

export function createCanvas2DRenderer(canvas: HTMLCanvasElement): Canvas2DRenderer | null {
  const context = canvas.getContext('2d')
  if (!context) return null

  let asset: DrawableAsset | null = null

  return {
    kind: 'canvas2d',

    get hasAsset(): boolean {
      return asset !== null
    },

    setAsset(next: DrawableAsset | null): void {
      asset = next
    },

    draw(targets: readonly PlacementTarget[], frame: RendererFrame): void {
      const { width, height, pixelRatio } = frame

      /* The transform is set from scratch every frame rather than `save`/`restore`d around the whole
         draw. A saved-and-restored transform would accumulate — `restore` pairs with `save`, but a
         throw between them leaves the stack unbalanced and every later frame draws at the wrong
         scale, with nothing on screen to say why. Resetting is idempotent, so no failure here can
         leave a permanent mark on the context. */
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)

      if (!asset || asset.width <= 0 || asset.height <= 0) return
      const aspect = asset.height / asset.width

      for (const target of targets) {
        /* The same predicate the Three.js renderer filters on, from `types/frame.ts`. The solver has
           already dropped these targets, so this is a second gate rather than the mechanism — it stays
           because a renderer that draws every target it is handed is a renderer whose output depends on
           the solver's filtering rules, and those rules are about tracking, not drawing. */
        if (!isDrawableTarget(target)) continue

        const drawnHeight = target.width * aspect

        context.save()
        /* Clamped for the same reason the solver clamps: this goes straight into a compositing
           parameter, and an out-of-range alpha is silently clamped by the browser in some engines and
           throws in none — so the clamp belongs where it is documented, not left to the engine. */
        context.globalAlpha = Math.min(1, Math.max(0, target.opacity))
        context.translate(target.x, target.y)
        context.rotate(target.rotation)
        /* Squash is horizontal foreshortening from head yaw. Applied after the rotation, so it
           compresses along the face's own left-right axis rather than the screen's — otherwise a
           tilted head would squash the earring along an axis the face is not turning about. */
        context.scale(target.squash, 1)
        context.drawImage(asset.source, -target.width / 2, 0, target.width, drawnHeight)
        context.restore()
      }
    },
  }
}
