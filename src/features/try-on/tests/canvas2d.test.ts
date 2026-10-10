import { describe, expect, it } from 'vitest'

import { createCanvas2DRenderer } from '../renderers/canvas2d'
import type { DrawableAsset, RendererFrame } from '../renderers/types'
import { MIN_DRAW_OPACITY, type PlacementTarget } from '../types/frame'

const FRAME: RendererFrame = { width: 640, height: 480, pixelRatio: 1 }
const ASSET: DrawableAsset = { source: {} as CanvasImageSource, width: 40, height: 100 }

/**
 * A recording stand-in for a 2D context.
 *
 * The renderer's job is entirely "issue these calls in this order", and the one decision in it that is
 * easy to get subtly wrong — where the anchor sits — is a number passed to `drawImage`. Asserting on
 * *calls* rather than on pixels is what makes that checkable without a browser: the alternative is a
 * screenshot comparison, which fails for font and antialiasing reasons and tells you far less.
 */
function stubCanvas(): {
  canvas: HTMLCanvasElement
  ops: string[]
  images: { x: number; y: number; width: number; height: number }[]
  transforms: number[][]
  alphas: number[]
} {
  const ops: string[] = []
  const images: { x: number; y: number; width: number; height: number }[] = []
  const transforms: number[][] = []
  const alphas: number[] = []
  let alpha = 1
  /* `drawImage` is called inside a translated frame, so its own arguments are relative to the anchor.
     Accumulating the translation here reports every draw in canvas coordinates instead, which is both
     what a reader of the test expects to see and a check in its own right: if the renderer ever stopped
     translating, the assertions below would not merely shift, they would stop making sense. */
  let originX = 0
  let originY = 0

  const context = {
    setTransform(...values: number[]): void {
      ops.push('setTransform')
      transforms.push(values)
    },
    clearRect(): void {
      ops.push('clearRect')
    },
    save(): void {
      ops.push('save')
    },
    restore(): void {
      ops.push('restore')
    },
    translate(x: number, y: number): void {
      ops.push(`translate(${x},${y})`)
      originX += x
      originY += y
    },
    rotate(): void {
      ops.push('rotate')
    },
    scale(x: number): void {
      ops.push(`scale(${x})`)
    },
    drawImage(_source: unknown, x: number, y: number, width: number, height: number): void {
      ops.push('drawImage')
      images.push({ x: originX + x, y: originY + y, width, height })
    },
    get globalAlpha(): number {
      return alpha
    },
    set globalAlpha(value: number) {
      alpha = value
      alphas.push(value)
    },
  }

  const canvas = {
    getContext: (id: string) => (id === '2d' ? context : null),
  } as unknown as HTMLCanvasElement

  return { canvas, ops, images, transforms, alphas }
}

function target(overrides: Partial<PlacementTarget> = {}): PlacementTarget {
  return { side: 'left', x: 200, y: 300, width: 40, rotation: 0, squash: 1, opacity: 1, ...overrides }
}

function renderer(asset: DrawableAsset | null = ASSET) {
  const stub = stubCanvas()
  const draw = createCanvas2DRenderer(stub.canvas)
  if (!draw) throw new Error('the stub canvas refused a 2d context')
  draw.setAsset(asset)
  return { ...stub, draw }
}

describe('createCanvas2DRenderer', () => {
  it('returns null rather than a renderer when there is no 2d context', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement
    expect(createCanvas2DRenderer(canvas)).toBeNull()
  })

  it('clears the whole box before drawing, with the transform already applied', () => {
    const { draw, ops, transforms } = renderer()
    draw.draw([target()], { ...FRAME, pixelRatio: 2 })

    /* Order matters: clearing before the transform would clear a box of the wrong size on a retina
       display — the top-left quadrant — and leave the rest of the previous frame visible. */
    expect(ops.slice(0, 2)).toEqual(['setTransform', 'clearRect'])
    expect(transforms[0]).toEqual([2, 0, 0, 2, 0, 0])
  })

  it('draws nothing at all when it has no asset', () => {
    const { draw, ops, images } = renderer(null)
    draw.draw([target()], FRAME)

    expect(images).toHaveLength(0)
    /* Still cleared — an asset that fails to load must not leave the last one on screen. */
    expect(ops).toContain('clearRect')
  })

  /* The anchor contract. `x`/`y` is the point the piece HANGS from — the top-centre of the drawn box —
     so the image starts at the anchor vertically and straddles it horizontally. Centring it in both
     axes instead would float the earring up the side of the head, which reads as broken tracking when
     it is only a constant offset. */
  it('hangs the asset from the anchor: centred horizontally, starting at it vertically', () => {
    const { draw, images } = renderer()
    draw.draw([target({ x: 200, y: 300, width: 80 })], FRAME)

    expect(images[0]).toEqual({ x: 200 - 40, y: 300, width: 80, height: 200 })
  })

  it('derives the drawn height from the asset aspect ratio, not from the target', () => {
    const { draw, images } = renderer({ ...ASSET, width: 100, height: 50 })
    draw.draw([target({ width: 60 })], FRAME)

    expect(images[0]?.height).toBe(30)
  })

  it('applies the transform in the order the squash depends on', () => {
    const { draw, ops } = renderer()
    draw.draw([target({ squash: 0.6 })], FRAME)

    /* Rotate before squash. Squashing first would compress along the screen's horizontal axis, so a
       tilted head would foreshorten the earring along an axis the face is not turning about. */
    expect(ops).toEqual([
      'setTransform',
      'clearRect',
      'save',
      `translate(200,300)`,
      'rotate',
      `scale(0.6)`,
      'drawImage',
      'restore',
    ])
  })

  it('balances every save with a restore, so the context stack cannot drift', () => {
    const { draw, ops } = renderer()
    draw.draw([target(), target({ side: 'right' }), target({ opacity: 0.5 })], FRAME)

    expect(ops.filter((op) => op === 'save')).toHaveLength(3)
    expect(ops.filter((op) => op === 'restore')).toHaveLength(3)
  })

  it('carries the target opacity into the compositing alpha', () => {
    const { draw, alphas } = renderer()
    draw.draw([target({ opacity: 0.42 })], FRAME)

    expect(alphas).toEqual([0.42])
  })

  it('clamps an out-of-range opacity into something a compositor accepts', () => {
    const { draw, alphas } = renderer()
    draw.draw([target({ opacity: 1.7 })], FRAME)

    expect(alphas).toEqual([1])
  })

  /* The threshold is "at or below", matching the constant's own documentation and the solver's filter.
     A target exactly on the boundary must be skipped, not drawn at 5% — the two would disagree about
     which targets exist, and the disagreement would be invisible on screen. */
  it('skips a target at or below the draw threshold', () => {
    const { draw, images } = renderer()
    draw.draw([target({ opacity: MIN_DRAW_OPACITY }), target({ opacity: MIN_DRAW_OPACITY + 0.001 })], FRAME)

    expect(images).toHaveLength(1)
  })

  it('skips a zero-width target rather than drawing a degenerate rectangle', () => {
    const { draw, ops, images } = renderer()
    draw.draw([target({ width: 0 })], FRAME)

    expect(images).toHaveLength(0)
    expect(ops).not.toContain('save')
  })

  it('is a clear, not a crash, when handed no targets', () => {
    const { draw, ops, images } = renderer()
    draw.draw([], FRAME)

    expect(images).toHaveLength(0)
    expect(ops).toEqual(['setTransform', 'clearRect'])
  })
})
