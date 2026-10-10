/**
 * The overlay's gate, and the projection under it.
 *
 * This file exists because of a bug that shipped. `TryOnProduct` passed `showLabels: false` meaning
 * "no diagnostics for a customer", and got a face covered in rings and leader lines anyway, because
 * `showLabels` only ever controlled the numbers. Nothing caught it: the gate lived in a React hook, so
 * it needed a camera and a DOM to observe, and no test in this suite drives either.
 *
 * So the gate moved into `drawOverlay` itself, where a recording context can see it — and the first
 * three tests below are the ones that would have failed on the broken code.
 */

import { describe, expect, it } from 'vitest'

import { drawOverlay, type OverlayOptions } from '../components/LandmarkOverlay'
import { FACE_LANDMARKS } from '../core/landmarks'
import type { TrackerFrame } from '../types/frame'
import { syntheticLandmarks } from './helpers/syntheticFace'

/**
 * A recording stand-in for a 2D context.
 *
 * The overlay's whole job is "issue these calls in this order", and every question worth asking about
 * it — did it draw at all, where did the dots land, how many labels — is a question about calls. The
 * real context needs a browser; this needs a function that pushes strings.
 */
function stubCanvas(): {
  context: CanvasRenderingContext2D
  ops: string[]
  arcs: { x: number; y: number; radius: number }[]
  labels: { text: string; x: number; y: number }[]
} {
  const ops: string[] = []
  const arcs: { x: number; y: number; radius: number }[] = []
  const labels: { text: string; x: number; y: number }[] = []

  const context = {
    strokeStyle: '',
    lineWidth: 0,
    fillStyle: '',
    font: '',
    textBaseline: '',
    beginPath(): void {
      ops.push('beginPath')
    },
    moveTo(x: number, y: number): void {
      ops.push(`moveTo(${x},${y})`)
    },
    lineTo(x: number, y: number): void {
      ops.push(`lineTo(${x},${y})`)
    },
    stroke(): void {
      ops.push('stroke')
    },
    fill(): void {
      ops.push('fill')
    },
    arc(x: number, y: number, radius: number): void {
      ops.push('arc')
      arcs.push({ x, y, radius })
    },
    fillText(text: string, x: number, y: number): void {
      ops.push('fillText')
      labels.push({ text, x, y })
    },
  }

  return { context: context as unknown as CanvasRenderingContext2D, ops, arcs, labels }
}

/* The identity case, and deliberately so. `syntheticLandmarks` lays the face out in canvas px and
   divides by the video size to normalise; passing the same rectangle as the box means the projection
   is the identity, so the expected dot positions are the synthetic face's own numbers rather than a
   second copy of the projection maths that could be wrong in the same way. */
const VIDEO = { width: 640, height: 480 }
const BOX = { width: 640, height: 480 }

function frame(): TrackerFrame {
  return { kind: 'face', landmarks: syntheticLandmarks(), confidence: 1, at: 0 }
}

function options(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return { video: VIDEO, box: BOX, mirror: false, ...overrides }
}

/** Every index the overlay is capable of drawing, so a label count can be checked against it. */
const DRAWABLE_INDICES = [
  FACE_LANDMARKS.rulerA,
  FACE_LANDMARKS.rulerB,
  ...FACE_LANDMARKS.clusterA,
  ...FACE_LANDMARKS.clusterB,
  ...FACE_LANDMARKS.jawA,
  ...FACE_LANDMARKS.jawB,
]

describe('drawOverlay — the diagnostics gate', () => {
  /* The regression. Before the gate existed, this call drew 18 arcs and 12 strokes — the rings, the
     leader lines and the dots — over a shopper's face. */
  it('draws nothing at all when the caller says nothing, which is the customer default', () => {
    const { context, ops } = stubCanvas()
    drawOverlay(context, frame(), options())

    expect(ops).toEqual([])
  })

  it('draws nothing when diagnostics are explicitly off, even with the labels asked for', () => {
    const { context, ops } = stubCanvas()
    drawOverlay(context, frame(), options({ showDiagnostics: false, showLabels: true }))

    /* The state the product page was actually in: it wanted no dots and asked for no numbers, and the
       numbers were the only thing that flag controlled. */
    expect(ops).toEqual([])
  })

  it('draws the dots and the rings but no numbers when diagnostics are on and labels are off', () => {
    const { context, ops, arcs, labels } = stubCanvas()
    drawOverlay(context, frame(), options({ showDiagnostics: true, showLabels: false }))

    expect(arcs.length).toBeGreaterThan(0)
    expect(labels).toEqual([])
    expect(ops).not.toContain('fillText')
  })

  it('labels every index it draws, and only those, when the labels are on', () => {
    const { context, labels } = stubCanvas()
    drawOverlay(context, frame(), options({ showDiagnostics: true, showLabels: true }))

    expect(labels.map((label) => label.text)).toEqual(DRAWABLE_INDICES.map(String))
  })

  it.each<[string, TrackerFrame | null]>([
    ['no frame', null],
    ['a frame with no landmarks', { kind: 'face', landmarks: [], confidence: 0, at: 0 }],
  ])('draws nothing for %s', (_name, bad) => {
    const { context, ops } = stubCanvas()
    drawOverlay(context, bad, options({ showDiagnostics: true }))

    expect(ops).toEqual([])
  })

  it('draws nothing when the video has no size, rather than drawing at the origin', () => {
    const { context, ops } = stubCanvas()
    drawOverlay(context, frame(), options({ showDiagnostics: true, video: { width: 0, height: 0 } }))

    /* A zero-size source makes the projection degenerate. Bailing is the honest answer; multiplying
       through it would put every dot on top of every other one at (0, 0). */
    expect(ops).toEqual([])
  })
})

describe('drawOverlay — the projection', () => {
  /* The point of sharing `toCanvasPoint` with the solver: a dot drawn here and an earring placed there
     are the same claim about where a landmark is. If these ever disagree, the lab becomes an
     instrument that measures something other than the thing it is pointed at. */
  it('lands the ruler points where the synthetic face put them', () => {
    const { context, arcs } = stubCanvas()
    drawOverlay(context, frame(), options({ showDiagnostics: true }))

    /* The synthetic face is 128px interocular about a centre of (320, 240): the eye corners are at
       x = 320 ± 64. The dots are the radius-3 arcs; the rings are radius 7. */
    const dots = arcs.filter((arc) => arc.radius === 3)
    expect(dots).toContainEqual({ x: 320 - 64, y: 240, radius: 3 })
    expect(dots).toContainEqual({ x: 320 + 64, y: 240, radius: 3 })
  })

  it('mirrors x only, and about the box rather than the video', () => {
    const { context, arcs } = stubCanvas()
    drawOverlay(context, frame(), options({ showDiagnostics: true, mirror: true }))

    const dots = arcs.filter((arc) => arc.radius === 3)
    /* y is untouched — a mirrored preview is a flip, not a rotation. */
    expect(dots).toContainEqual({ x: BOX.width - (320 - 64), y: 240, radius: 3 })
    expect(dots).toContainEqual({ x: BOX.width - (320 + 64), y: 240, radius: 3 })
  })

  it('draws one dot per resolvable landmark, and one ring per group', () => {
    const { context, arcs } = stubCanvas()
    drawOverlay(context, frame(), options({ showDiagnostics: true }))

    const dots = arcs.filter((arc) => arc.radius === 3)
    const rings = arcs.filter((arc) => arc.radius === 7)
    expect(dots).toHaveLength(DRAWABLE_INDICES.length)
    expect(rings).toHaveLength(6)
  })
})
