/**
 * The swing model's pinned behaviour.
 *
 * These are property tests, not value snapshots. The constants in `DEFAULT_SWING` are a considered
 * guess — pinning `angle === 0.0173` after one step would make every future re-tune a test edit and
 * would say nothing about whether the physics is right. What is pinned instead is the behaviour that
 * must hold for *any* constants: at rest it does not move, a moving pivot deflects it, it rings down,
 * it stays inside its guard rail, and it responds to motion rather than to canvas size.
 */

import { describe, expect, it } from 'vitest'

import {
  applySwing,
  createSwingBank,
  DEFAULT_SWING,
  initialSwingState,
  stepSwing,
  type SwingConfig,
  type SwingState,
} from '../core/swing'
import type { PlacementTarget } from '../types/frame'

const FRAME_DT = 1 / 60
const WIDTH = 50
const STILL = 100

/** Seeds the pivot, since the first step deliberately produces no motion. */
function seeded(anchorX = STILL): SwingState {
  return stepSwing(initialSwingState(), anchorX, WIDTH, FRAME_DT)
}

function run(state: SwingState, steps: number, anchorX = STILL): SwingState {
  let next = state
  for (let i = 0; i < steps; i += 1) next = stepSwing(next, anchorX, WIDTH, FRAME_DT)
  return next
}

function target(overrides: Partial<PlacementTarget> = {}): PlacementTarget {
  return {
    side: 'left',
    x: 200,
    y: 300,
    width: WIDTH,
    rotation: 0,
    squash: 1,
    opacity: 1,
    ...overrides,
  }
}

describe('stepSwing — at rest', () => {
  it('does not move a piece whose pivot is not moving', () => {
    /* Exact zero, not "close to". A still head has no acceleration, and a model that drifts while the
       customer holds still is a model that will visibly creep. */
    expect(run(seeded(), 240).angle).toBe(0)
  })

  it('seeds the pivot on the first step without inventing motion', () => {
    const first = stepSwing(initialSwingState(), STILL, WIDTH, FRAME_DT)
    expect(first.lastX).toBe(STILL)
    expect(first.angle).toBe(0)
    expect(first.velocity).toBe(0)
  })

  it('seeds the pivot even when the first step has no duration', () => {
    /* Otherwise the first two frames of every session behave differently from every later pair. */
    expect(stepSwing(initialSwingState(), STILL, WIDTH, 0).lastX).toBe(STILL)
  })
})

describe('stepSwing — driven', () => {
  it('deflects the piece when the pivot accelerates', () => {
    const after = stepSwing(seeded(), STILL + 60, WIDTH, FRAME_DT)
    expect(Math.abs(after.angle)).toBeGreaterThan(0)
  })

  it('deflects opposite to the pivot acceleration, so the piece trails', () => {
    /* The pivot jumps to the right, so the piece lags to the left of it. A positive angle is clockwise
       on a canvas, and the piece is drawn downward from its anchor, so a positive angle puts its free
       end *left* of the anchor — which is the trailing direction. This assertion was `toBeLessThan(0)`
       and had to be flipped: it was pinning the sign error, not catching it, so the model passed while
       rendering the mirror of the intended motion. The convention is checked against the canvas's own
       `getTransform()`, not assumed — `ctx.rotate(0.5)` places the local point `(0, h)` at `dx < 0`. */
    const after = stepSwing(seeded(), STILL + 60, WIDTH, FRAME_DT)
    expect(after.angle).toBeGreaterThan(0)
  })

  it('responds to how fast the pivot is moving, not to where it is', () => {
    /* Two identical frames in a row: the pivot has moved a long way, but it is now holding still. The
       second must not add swing, or a piece would keep accelerating while the head sat at the edge of
       the frame. */
    const moved = stepSwing(seeded(), STILL + 60, WIDTH, FRAME_DT)
    const settled = stepSwing(moved, STILL + 60, WIDTH, FRAME_DT)
    expect(Math.abs(settled.angle)).toBeLessThan(Math.abs(moved.angle) + 1e-9)
  })

  it('rings down to rest after the pivot stops', () => {
    const moving = stepSwing(seeded(), STILL + 60, WIDTH, FRAME_DT)
    const later = run(moving, 200)
    expect(Math.abs(later.angle)).toBeLessThan(0.02)
  })

  it('overshoots the vertical on the way down, rather than creeping back', () => {
    /* Underdamped on purpose — a piece that returns in one motion reads as glued. This asserts the
       damping stays under critical; an over-damped tune would fail it and should. */
    let state: SwingState = { angle: 0.25, velocity: 0, vx: 0, lastX: STILL }
    let crossedZero = false
    for (let i = 0; i < 120; i += 1) {
      state = stepSwing(state, STILL, WIDTH, FRAME_DT)
      if (state.angle < 0) crossedZero = true
    }
    expect(crossedZero).toBe(true)
  })
})

describe('stepSwing — scale invariance', () => {
  it('gives the same angle for the same motion at twice the canvas scale', () => {
    /* The whole reason the drive is normalised by the drawn width. Without it, the same head movement
       would swing the piece twice as far in a window twice the size, and the behaviour would be a
       property of the display rather than of the piece.

       `maxDriveAccel` is lifted for this one test, and that is not tidiness — it is the only way the
       assertion can mean anything. Two earlier versions were vacuous and both were caught by deleting
       the `/ width` and watching the test still pass:

       - 100 px at width 50: raw acceleration `≈ 2935` against a 400 rail, so the clamp swallowed it.
       - 8 px at width 50: raw `≈ 197`, *under* the rail — but removing `/ width` multiplies the
         acceleration by the width, so the broken version drove both inputs to `400·dt²·drive =
         1/180 ≈ 0.0055556` and it agreed with itself for the same reason the first one did.

       The clamp cannot be outrun by making the motion smaller, because the mutation scales the term by
       the very factor under test. So the clamp is taken out of the comparison instead, and the property
       is measured against the drive term alone. `maxAngle` still bites at the default 0.3 — the
       unnormalised angles here are 0.10 and 0.21, both under it, so it cannot equalise them either;
       that was checked, not assumed. What guards the rail is the `guards` block above. */
    const unclamped: SwingConfig = { ...DEFAULT_SWING, maxDriveAccel: 1e6 }
    const small = stepSwing(stepSwing(initialSwingState(), 0, 50, FRAME_DT), 6, 50, FRAME_DT, unclamped)
    const large = stepSwing(stepSwing(initialSwingState(), 0, 100, FRAME_DT), 12, 100, FRAME_DT, unclamped)
    expect(large.angle).toBeCloseTo(small.angle, 10)
  })
})

describe('stepSwing — guards', () => {
  it('holds the angle at the limit instead of letting it spin', () => {
    const flung = stepSwing({ angle: 0.29, velocity: 40, vx: 0, lastX: STILL }, STILL, WIDTH, 0.05)
    expect(Math.abs(flung.angle)).toBeCloseTo(DEFAULT_SWING.maxAngle, 10)
  })

  it('drops the velocity against the limit, so it cannot accumulate there', () => {
    const flung = stepSwing({ angle: 0.29, velocity: 40, vx: 0, lastX: STILL }, STILL, WIDTH, 0.05)
    expect(flung.velocity).toBe(0)
  })

  it.each([
    ['a zero timestep', 0],
    ['a negative timestep', -0.01],
    ['a NaN timestep', Number.NaN],
  ])('returns the state unchanged for %s', (_label, dt) => {
    /* The invariant that matters: never a NaN, and never a step with no time behind it. A NaN here
       reaches a canvas transform, where it does not throw — every later frame is simply drawn wrong. */
    const state = seeded()
    expect(stepSwing(state, STILL + 60, WIDTH, dt)).toBe(state)
  })

  it.each([
    ['a non-finite pivot', Number.NaN, WIDTH],
    ['a zero width', STILL, 0],
    ['a negative width', STILL, -10],
    /* Was a second copy of the NaN case above — two names for one input, so one of them was dead
       weight. An infinite width is the case that is actually distinct: it passes the `> 0` guard, so
       it is reachable, and it must not produce a NaN by way of `1 / Infinity`. */
    ['an infinite pivot', Number.POSITIVE_INFINITY, WIDTH],
  ])('returns the state unchanged for %s', (_label, anchorX, width) => {
    const state = seeded()
    expect(stepSwing(state, anchorX, width, FRAME_DT)).toBe(state)
  })

  it('stays finite through a long run of noisy input', () => {
    let state = initialSwingState()
    for (let i = 0; i < 2000; i += 1) {
      /* Alternating extremes — the worst case a jittering landmark mesh can produce. */
      state = stepSwing(state, i % 2 === 0 ? 500 : -500, WIDTH, 1 / 30)
    }
    expect(Number.isFinite(state.angle)).toBe(true)
    expect(Number.isFinite(state.velocity)).toBe(true)
    expect(Math.abs(state.angle)).toBeLessThanOrEqual(DEFAULT_SWING.maxAngle + 1e-9)
  })
})

describe('applySwing', () => {
  it('leaves a target identical on the step that only seeds the bank', () => {
    const bank = createSwingBank()
    const piece = target()
    const drawn = applySwing([piece], bank, 0)
    /* Identity, not equality: at a zero angle there is no reason to allocate a new target, and the
       draw path is the hottest loop in the feature. */
    expect(drawn[0]).toBe(piece)
  })

  it('folds the swing into rotation and touches nothing else', () => {
    const bank = createSwingBank()
    /* The pivot has to actually move: a bank fed the same x twice produces no swing at all, and the
       assertion below would pass against a renderer that ignored the swing entirely. */
    const before = target({ x: 200, rotation: 0.2, squash: 0.7, opacity: 0.9 })
    const after = target({ x: 260, rotation: 0.2, squash: 0.7, opacity: 0.9 })
    applySwing([before], bank, FRAME_DT)
    const swung = applySwing([after], bank, FRAME_DT)

    const moved = swung[0]
    expect(moved).toBeDefined()
    expect(moved?.rotation).not.toBe(0.2)
    expect(moved?.x).toBe(after.x)
    expect(moved?.y).toBe(after.y)
    expect(moved?.width).toBe(after.width)
    expect(moved?.squash).toBe(after.squash)
    expect(moved?.opacity).toBe(after.opacity)
    expect(moved?.side).toBe(after.side)
  })

  it('adds the swing to the head roll rather than replacing it', () => {
    /* Rotation carries two separate things — head roll from the solver, swing from here. Neither may
       overwrite the other: the renderer is handed the sum. Two banks, identical seed and identical
       pivot motion, differing only in the roll handed in, so the difference between them *is* the
       roll. */
    const plainBank = createSwingBank()
    applySwing([target({ x: 200, rotation: 0 })], plainBank, FRAME_DT)
    const plain = applySwing([target({ x: 260, rotation: 0 })], plainBank, FRAME_DT)[0]?.rotation ?? 0

    const rolledBank = createSwingBank()
    applySwing([target({ x: 200, rotation: 0.5 })], rolledBank, FRAME_DT)
    const rolled = applySwing([target({ x: 260, rotation: 0.5 })], rolledBank, FRAME_DT)[0]?.rotation ?? 0

    expect(plain).not.toBe(0)
    expect(rolled - plain).toBeCloseTo(0.5, 10)
  })

  it('clears the bank when nothing is drawn, so a piece that returns starts at rest', () => {
    const bank = createSwingBank()
    applySwing([target()], bank, FRAME_DT)
    applySwing([target()], bank, FRAME_DT)
    expect(bank.size).toBeGreaterThan(0)

    applySwing([], bank, FRAME_DT)
    expect(bank.size).toBe(0)
  })

  it('drives both sides together, as a translating head does', () => {
    /* The pivot is the mean of the drawn targets, which is the head's own motion. A head *rotating*
       would drive the two sides differently and this deliberately does not model that. The pivot is
       moved between the calls so the swing is non-zero — otherwise this asserts 0 === 0 and would
       pass against an implementation that never swings anything. */
    const bank = createSwingBank()
    applySwing([target({ side: 'left', x: 200 }), target({ side: 'right', x: 210 })], bank, FRAME_DT)
    const swung = applySwing(
      [target({ side: 'left', x: 260 }), target({ side: 'right', x: 270 })],
      bank,
      FRAME_DT,
    )
    const left = swung[0]?.rotation ?? Number.NaN
    const right = swung[1]?.rotation ?? Number.NaN
    expect(left).not.toBe(0)
    expect(left).toBeCloseTo(right, 10)
  })

  it('forgets a side that stopped being drawn rather than resuming its stale angle', () => {
    const bank = createSwingBank()
    applySwing([target({ side: 'left' }), target({ side: 'right' })], bank, FRAME_DT)
    applySwing([target({ side: 'left' })], bank, FRAME_DT)
    expect(bank.has('right')).toBe(false)
  })
})
