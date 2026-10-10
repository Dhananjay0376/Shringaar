import { describe, expect, it } from 'vitest'

import { computeViewTransform, toCanvasPoint } from '../core/coordinates'
import { vec2 } from '../core/geometry'

const VIDEO_4_3 = { width: 640, height: 480 }
const VIDEO_16_9 = { width: 1280, height: 720 }

describe('computeViewTransform', () => {
  it('cover picks the larger ratio and centres the overflow', () => {
    /* A 4:3 frame in a square box: the box is relatively wider, so height is the binding dimension
       and the frame overflows horizontally. */
    const box = { width: 400, height: 400 }
    const view = computeViewTransform(VIDEO_4_3, box, 'cover')

    expect(view.scale).toBeCloseTo(400 / 480, 12)
    expect(view.drawHeight).toBeCloseTo(400, 12)
    expect(view.drawWidth).toBeCloseTo(640 * (400 / 480), 12)
    /* Both offsets are ≤ 0 under cover — the frame is at least as large as the box. */
    expect(view.offsetY).toBeCloseTo(0, 12)
    expect(view.offsetX).toBeLessThan(0)
  })

  it('contain picks the smaller ratio and letterboxes', () => {
    const box = { width: 400, height: 400 }
    const view = computeViewTransform(VIDEO_4_3, box, 'contain')

    expect(view.scale).toBeCloseTo(400 / 640, 12)
    expect(view.drawWidth).toBeCloseTo(400, 12)
    expect(view.drawHeight).toBeCloseTo(480 * (400 / 640), 12)
    expect(view.offsetX).toBeCloseTo(0, 12)
    expect(view.offsetY).toBeGreaterThan(0)
  })

  /* The bug this function exists to prevent. Measuring with `x * box.width, y * box.height` is
     correct only when the aspect ratios match; otherwise the space is stretched, and a distance
     like the interocular measurement means one thing horizontally and another vertically — so the
     earring resizes when the customer rotates their phone. */
  it('preserves aspect ratio, so a length is a length in every direction', () => {
    const box = { width: 500, height: 900 }
    const view = computeViewTransform(VIDEO_16_9, box, 'cover')

    expect(view.drawWidth / view.drawHeight).toBeCloseTo(16 / 9, 12)
  })

  it('applies one scale factor to both axes', () => {
    const box = { width: 500, height: 900 }
    const view = computeViewTransform(VIDEO_16_9, box, 'cover')

    /* px per source pixel must be identical on x and y. This is the same claim as the test above,
       stated in the form that would actually catch an anisotropic implementation. */
    expect(view.drawWidth / VIDEO_16_9.width).toBeCloseTo(view.drawHeight / VIDEO_16_9.height, 12)
  })

  it('degrades to an empty transform rather than dividing by zero', () => {
    expect(computeViewTransform({ width: 0, height: 0 }, { width: 400, height: 400 })).toEqual({
      scale: 0,
      offsetX: 0,
      offsetY: 0,
      drawWidth: 0,
      drawHeight: 0,
    })
    expect(
      computeViewTransform(VIDEO_4_3, { width: 0, height: 400 }).drawWidth,
    ).toBe(0)
  })

  it('is the identity when the frame exactly fills the box', () => {
    const view = computeViewTransform(VIDEO_4_3, VIDEO_4_3, 'cover')
    expect(view.scale).toBeCloseTo(1, 12)
    expect(view.offsetX).toBeCloseTo(0, 12)
    expect(view.offsetY).toBeCloseTo(0, 12)
  })
})

/*
 * Why `TryOnStage` reshapes the box to the camera's aspect ratio instead of trusting a fixed 4:3.
 *
 * A phone's front camera commonly delivers 16:9. In a fixed 4:3 box, `cover` binds on height, so the
 * frame is drawn wider than the box and the surplus is clipped symmetrically — and the clipped part
 * is the left and right edge of the frame, which is where the ears are. These numbers are the reason
 * the stage writes an inline `aspect-ratio` from `videoWidth`/`videoHeight`: they are not a
 * hypothetical, they are what the measured lab box does with a 16:9 camera.
 */
describe('the crop the stage avoids', () => {
  /* The lab box as measured in the browser: 611×458 CSS px at devicePixelRatio 1.25. */
  const BOX = { width: 611, height: 458 }

  it('loses a quarter of the frame width to a 16:9 camera in a 4:3 box', () => {
    const view = computeViewTransform(VIDEO_16_9, BOX, 'cover')

    expect(BOX.width / view.drawWidth).toBeCloseTo(0.75, 2)
    expect(view.offsetX).toBeLessThan(-100)
  })

  it('clips the edges the ears sit on right off the canvas', () => {
    const view = computeViewTransform(VIDEO_16_9, BOX, 'cover')

    /* Landmarks at the extreme left and right of the camera frame — the face-oval points nearest the
       ear are well out here — land outside the box entirely. */
    expect(toCanvasPoint(vec2(0, 0.5), view, BOX, false).x).toBeLessThan(0)
    expect(toCanvasPoint(vec2(1, 0.5), view, BOX, false).x).toBeGreaterThan(BOX.width)
  })

  it('hides the crop at the centre, which is why it went unnoticed', () => {
    const view = computeViewTransform(VIDEO_16_9, BOX, 'cover')
    expect(toCanvasPoint(vec2(0.5, 0.5), view, BOX, false).x).toBeCloseTo(BOX.width / 2, 9)
  })

  it('crops nothing once the box is shaped like the camera', () => {
    /* The invariant `TryOnStage` maintains, and the reason `cover` is safe to declare: with the box
       matching the frame, the transform is the identity and the overlay's projection and the
       solver's cannot drift apart. */
    const box = { width: 1280, height: 720 }
    const view = computeViewTransform(VIDEO_16_9, box, 'cover')

    expect(view.offsetX).toBeCloseTo(0, 9)
    expect(view.offsetY).toBeCloseTo(0, 9)
    expect(view.drawWidth).toBeCloseTo(box.width, 9)
    expect(view.drawHeight).toBeCloseTo(box.height, 9)
  })
})

describe('toCanvasPoint', () => {
  const box = { width: 640, height: 480 }
  const identity = computeViewTransform(VIDEO_4_3, box, 'cover')

  it('maps the corners of the frame to the corners of the box unmirrored', () => {
    expect(toCanvasPoint(vec2(0, 0), identity, box, false)).toEqual({ x: 0, y: 0 })
    expect(toCanvasPoint(vec2(1, 1), identity, box, false)).toEqual({ x: 640, y: 480 })
  })

  it('maps a corner to the opposite side when mirrored', () => {
    /* The same landmark, mirrored: x goes to the far edge, y does not move. */
    expect(toCanvasPoint(vec2(0, 0), identity, box, true)).toEqual({ x: 640, y: 0 })
    expect(toCanvasPoint(vec2(1, 1), identity, box, true)).toEqual({ x: 0, y: 480 })
  })

  it('flips x only, never y', () => {
    const normalised = vec2(0.25, 0.75)
    const plain = toCanvasPoint(normalised, identity, box, false)
    const mirrored = toCanvasPoint(normalised, identity, box, true)

    expect(mirrored.y).toBe(plain.y)
    expect(mirrored.x).not.toBeCloseTo(plain.x, 6)
  })

  it('leaves a point on the vertical centre line unmoved', () => {
    const centre = toCanvasPoint(vec2(0.5, 0.4), identity, box, true)
    expect(centre.x).toBeCloseTo(320, 12)
  })

  /* Mirroring must be applied once. Applying it twice is a no-op, which would look correct in a
     screenshot and be wrong the moment anything asymmetric — a per-side calibration offset, a
     left-only tilt — depends on it. */
  it('is not idempotent, so double-application is detectable', () => {
    const once = toCanvasPoint(vec2(0.2, 0.5), identity, box, true)
    const twice = { x: box.width - once.x, y: once.y }
    expect(twice.x).not.toBeCloseTo(once.x, 6)
  })

  it('reflects about the box centre line, not about the drawn frame', () => {
    /* Under `cover` the frame overflows the box, so `box.width - x` and `view.drawWidth - x` are
       two different reflections. Only the first is a mirror view. */
    const square = { width: 400, height: 400 }
    const view = computeViewTransform(VIDEO_4_3, square, 'cover')
    const normalised = vec2(0.2, 0.5)

    const plain = toCanvasPoint(normalised, view, square, false)
    const mirrored = toCanvasPoint(normalised, view, square, true)

    expect(mirrored.x).toBeCloseTo(square.width - plain.x, 9)
    expect(mirrored.y).toBe(plain.y)

    /* Guard against a vacuous pass: if the crop were zero the two candidate reflections would
       coincide and the assertion above would hold either way. */
    expect(view.offsetX).toBeLessThan(0)
    expect(square.width - plain.x).not.toBeCloseTo(view.drawWidth - plain.x, 3)
  })
})
