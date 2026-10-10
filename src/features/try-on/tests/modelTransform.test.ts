/**
 * The 3D placement contract, pinned without a GPU.
 *
 * `three.ts` cannot be tested in this suite — it needs a WebGL context, and a stubbed one would test the
 * stub. So everything that could be wrong about where a model lands was moved into `modelTransform.ts`
 * and is pinned here instead: the coordinate convention, the sign of the rotation, the clamp on
 * opacity. What remains in `three.ts` is applying four numbers to an `Object3D`, which is the part a
 * browser can be trusted to get right.
 */

import { describe, expect, it } from 'vitest'

import { modelTransformFor, normalisingScale } from '../renderers/modelTransform'
import type { RendererFrame } from '../renderers/types'
import { isDrawableTarget, MIN_DRAW_OPACITY, type PlacementTarget } from '../types/frame'

const FRAME: RendererFrame = { width: 640, height: 480, pixelRatio: 1 }
/** A normalised model: its bounding box is one unit wide, so `scale` reads as "pixels wide". */
const UNIT_BOUNDS = { width: 1, height: 1.6, depth: 0.2 }

function target(overrides: Partial<PlacementTarget> = {}): PlacementTarget {
  return { side: 'left', x: 320, y: 240, width: 40, rotation: 0, squash: 1, opacity: 1, ...overrides }
}

/** Throws rather than returning a nullable, so a test that expected a transform reads clearly. */
function transformOf(t: PlacementTarget, frame: RendererFrame = FRAME) {
  const result = modelTransformFor(t, frame, UNIT_BOUNDS)
  if (!result) throw new Error('expected a transform')
  return result
}

describe('modelTransformFor — the coordinate convention', () => {
  /* The camera's frustum spans the box centred on the origin, so the box centre is world (0, 0). A test
     that skipped this would pass with the convention inverted, which is exactly the bug — a piece on
     the opposite side of the head — that this pins. */
  it('puts the centre of the box at the world origin', () => {
    const transform = transformOf(target({ x: 320, y: 240 }))
    expect(transform.x).toBe(0)
    expect(transform.y).toBe(0)
  })

  /* Screen y points down and world y points up. A point above the centre of the box must therefore come
     back with a *positive* world y — the sign that, got wrong, puts earrings at the chin. */
  it('flips the vertical axis, because screen y points down and world y points up', () => {
    const upper = transformOf(target({ x: 100, y: 50 }))
    expect(upper.x).toBe(-220)
    expect(upper.y).toBe(190)
  })

  it('keeps everything on one plane', () => {
    expect(transformOf(target()).z).toBe(0)
  })
})

describe('modelTransformFor — size, rotation and opacity', () => {
  it('sizes the model by its bounding-box width', () => {
    expect(transformOf(target({ width: 40 })).scale).toBe(40)
  })

  it('divides by the model’s own units, so a model authored in millimetres lands the same', () => {
    /* 100 units wide, drawn 40px wide. A model authored in metres — 0.1 units — would give the same
       answer, which is the whole point of normalising by the bounding box rather than trusting a unit. */
    const result = modelTransformFor(target({ width: 40 }), FRAME, { width: 100, height: 160, depth: 20 })
    expect(result?.scale).toBe(0.4)
  })

  /* Screen y points down, so a positive roll is clockwise on screen; in a frame whose y points up that
     is a negative rotation. Not negating it tilts the piece by twice the head roll. */
  it('negates the roll into the camera’s handedness', () => {
    expect(transformOf(target({ rotation: 0.25 })).rotationZ).toBe(-0.25)
  })

  it('carries the yaw squash through unchanged', () => {
    expect(transformOf(target({ squash: 0.6 })).squash).toBe(0.6)
  })

  it('clamps opacity into a range a material accepts', () => {
    expect(transformOf(target({ opacity: 1.7 })).opacity).toBe(1)
    expect(transformOf(target({ opacity: -3 })).opacity).toBe(0)
  })

  /* Refusing rather than returning a degenerate transform: a NaN or zero scale reaching a `Matrix4`
     produces a mesh that is silently absent, which is the hardest rendering failure to attribute. */
  it('refuses an unsizeable model rather than producing a degenerate matrix', () => {
    expect(modelTransformFor(target(), FRAME, { width: 0, height: 1, depth: 1 })).toBeNull()
    expect(modelTransformFor(target(), FRAME, { width: Number.NaN, height: 1, depth: 1 })).toBeNull()
    expect(modelTransformFor(target({ width: 0 }), FRAME, UNIT_BOUNDS)).toBeNull()
  })
})

describe('normalisingScale', () => {
  it('turns a bounding box into unit width', () => {
    expect(normalisingScale({ width: 250, height: 400, depth: 30 })).toBe(1 / 250)
  })

  it('refuses a model with no measurable width, the same case the transform refuses', () => {
    expect(normalisingScale({ width: 0, height: 1, depth: 1 })).toBeNull()
    expect(normalisingScale({ width: Number.NaN, height: 1, depth: 1 })).toBeNull()
  })
})

/**
 * The gate both renderers filter with.
 *
 * It lives in `types/frame.ts` rather than in either renderer because two copies of "which pieces
 * exist" is two chances for the flat and 3D paths to disagree — and the disagreement would be invisible
 * until someone put the two side by side.
 */
describe('isDrawableTarget', () => {
  it('draws an ordinary target', () => {
    expect(isDrawableTarget(target())).toBe(true)
  })

  it('skips at or below the threshold, matching the constant’s own wording', () => {
    expect(isDrawableTarget(target({ opacity: MIN_DRAW_OPACITY }))).toBe(false)
    expect(isDrawableTarget(target({ opacity: MIN_DRAW_OPACITY + 0.001 }))).toBe(true)
  })

  it('skips a zero-width target rather than drawing a degenerate one', () => {
    expect(isDrawableTarget(target({ width: 0 }))).toBe(false)
  })
})
