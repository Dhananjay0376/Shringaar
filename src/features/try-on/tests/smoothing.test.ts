import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SMOOTHING,
  INITIAL_ONE_EURO_STATE,
  oneEuro,
  resetOneEuro,
  smoothingAlpha,
  type OneEuroState,
} from '../core/smoothing'

/** Feeds a value sequence at a fixed frame rate and returns every output. */
function run(
  samples: readonly number[],
  fps: number,
  config = DEFAULT_SMOOTHING,
): { outputs: number[]; state: OneEuroState } {
  const dt = 1 / fps
  let state = INITIAL_ONE_EURO_STATE
  const outputs: number[] = []
  for (const sample of samples) {
    const step = oneEuro(sample, state, dt, config)
    outputs.push(step.value)
    state = step.state
  }
  return { outputs, state }
}

describe('smoothingAlpha', () => {
  it('approaches 1 as the timestep grows, without ever reaching it', () => {
    /* The exact value is `1 / (1 + tau/dt)`, so at a 1 Hz cutoff a 1-second timestep gives 0.8627.
       Asserting "close to 1" here would be asserting something the formula cannot deliver: a
       time-invariant low-pass never passes a step through completely in one sample. */
    expect(smoothingAlpha(1, 1)).toBeCloseTo(0.8627, 3)

    /* The property that actually matters: monotonic in dt, bounded above by 1. */
    let previous = 0
    for (const dt of [0.01, 0.1, 0.5, 1, 5, 100]) {
      const value = smoothingAlpha(1, dt)
      expect(value).toBeGreaterThan(previous)
      expect(value).toBeLessThan(1)
      previous = value
    }
  })

  it('approaches 0 for a vanishing timestep, so the filter freezes rather than jumping', () => {
    expect(smoothingAlpha(1, 1e-6)).toBeLessThan(1e-4)

    /* Exactly zero is the case that would be Infinity without the guard, and a coefficient of
       Infinity propagates straight into the output. */
    expect(smoothingAlpha(1, 0)).toBe(0)
  })

  it('returns 1 for a non-positive cutoff rather than dividing by zero', () => {
    expect(smoothingAlpha(0, 1 / 60)).toBe(1)
  })
})

describe('oneEuro', () => {
  it('passes the first sample through untouched', () => {
    /* Nothing to smooth against, and easing up from zero would drag the earring in from the corner
       of the screen on the first frame of every session. */
    const { value } = oneEuro(0.73, INITIAL_ONE_EURO_STATE, 1 / 60)
    expect(value).toBe(0.73)
  })

  it('holds a constant input exactly', () => {
    const { outputs } = run([5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 60)
    for (const output of outputs) expect(output).toBeCloseTo(5, 9)
  })

  it('lags a step, then converges to it on the minCutoff tail', () => {
    /* Two distinct behaviours, and the second is the one worth understanding. The first frames after
       the step move fast, because the derivative term has opened the cutoff up. Then, as the value
       settles and the derivative decays, the cutoff falls back to `minCutoff` and the last few
       percent crawl in at 1.2 Hz. That slow tail is deliberate: it is what stops the filter
       overshooting on a noisy frame. So 17 frames is not enough to finish — by design. */
    const { outputs } = run([0, 0, 0, ...Array<number>(60).fill(1)], 60)

    const atStep = outputs[3] ?? 0
    expect(atStep).toBeGreaterThan(0)
    expect(atStep).toBeLessThan(1)

    /* Still visibly lagging well after the step... */
    expect(outputs[3 + 16]).toBeGreaterThan(0.9)
    expect(outputs[3 + 16]).toBeLessThan(1)

    /* ...and the tail does close, just slowly. */
    expect(outputs[outputs.length - 1]).toBeCloseTo(1, 3)
  })

  it('is more responsive at a higher beta', () => {
    const samples = [0, 0, 0, 1, 1, 1]
    const sluggish = run(samples, 60, { minCutoff: 1.2, beta: 0, derivativeCutoff: 1.2 })
    const eager = run(samples, 60, { minCutoff: 1.2, beta: 0.5, derivativeCutoff: 1.2 })

    expect(eager.outputs[3] ?? 0).toBeGreaterThan(sluggish.outputs[3] ?? 0)
  })

  it('damps a single-frame spike instead of following it', () => {
    /* The whole point. A landmark that jumps for one frame must not move the earring by the same
       amount — that is the shimmer the filter exists to remove. */
    const { outputs } = run([0, 0, 0, 0, 20, 0, 0, 0], 60)
    const spike = outputs[4] ?? 0
    expect(spike).toBeGreaterThan(0)
    expect(spike).toBeLessThan(20 * 0.5)
  })

  it('does not divide by zero when dt is zero or negative', () => {
    const state: OneEuroState = { value: 3, derivative: 0 }

    for (const dt of [0, -1]) {
      const step = oneEuro(9, state, dt)
      expect(step.value).toBe(3)
      expect(Number.isNaN(step.value)).toBe(false)
      expect(step.state).toEqual(state)
    }
  })

  it('ignores a non-finite sample rather than poisoning the state', () => {
    const state: OneEuroState = { value: 2, derivative: 0 }
    const step = oneEuro(Number.NaN, state, 1 / 60)

    expect(step.value).toBe(2)
    expect(step.state).toEqual(state)

    /* And the filter still works afterwards — a NaN that got into `state.value` would silently break
       every subsequent frame. */
    const next = oneEuro(4, step.state, 1 / 60)
    expect(Number.isFinite(next.value)).toBe(true)
  })

  /* Approximate, not exact: the derivative estimate is itself filtered, so 30 and 60 fps do not
     agree to the last bit. Close enough that a customer cannot see the difference, which is the
     claim worth holding. */
  it('smooths a step about equally at 30fps and 60fps over the same elapsed time', () => {
    const at60 = run([0, 0, 0, ...Array<number>(60).fill(1)], 60).outputs
    const at30 = run([0, 0, 0, ...Array<number>(30).fill(1)], 30).outputs

    /* Compare at the same wall-clock point: 30 frames at 60fps and 15 frames at 30fps are both 0.5s
       after the step. */
    const sixtyFps = at60[3 + 29] ?? 0
    const thirtyFps = at30[3 + 14] ?? 0
    expect(sixtyFps).toBeCloseTo(thirtyFps, 1)
  })
})

describe('resetOneEuro', () => {
  it('forgets the previous value so a restart does not resume from a stale position', () => {
    expect(resetOneEuro()).toEqual(INITIAL_ONE_EURO_STATE)
  })
})
