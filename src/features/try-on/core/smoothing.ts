/**
 * The One Euro filter — jitter removal without the lag.
 *
 * A fixed low-pass filter forces one trade-off on the whole session: smooth enough to kill the
 * shimmer when the customer holds still, or responsive enough to keep up when they turn their head.
 * Pick either and the other suffers, because the right answer depends on how fast the signal is
 * moving at that instant.
 *
 * One Euro makes the cutoff a function of speed. At rest the derivative is ~0, the cutoff collapses
 * to `minCutoff`, and the output is heavily smoothed. On a fast turn the derivative is large, the
 * cutoff rises with `beta`, and the filter all but gets out of the way. It is the standard fix for
 * exactly this problem in AR and VR.
 *
 * Reference: Casiez, Roussel & Vogel, "1€ Filter" (CHI 2012).
 */

export interface OneEuroConfig {
  /** Hz. The cutoff floor. Lower is smoother at rest and adds lag. */
  readonly minCutoff: number
  /** How sharply the cutoff opens up with speed. Higher follows fast motion more closely. */
  readonly beta: number
  /** Hz. Cutoff for the derivative estimate itself. Usually left equal to `minCutoff`. */
  readonly derivativeCutoff: number
}

/**
 * Tuned for a face held at arm's length on a phone camera.
 *
 * `minCutoff` of 1.2 Hz is low enough to visibly calm a still head — the landmark mesh is noticeably
 * noisy frame to frame, especially indoors. `beta` of 0.04 is what lets a head turn stay attached to
 * the ear rather than trailing it.
 */
export const DEFAULT_SMOOTHING: OneEuroConfig = {
  minCutoff: 1.2,
  beta: 0.04,
  derivativeCutoff: 1.2,
}

export interface OneEuroState {
  /** The filtered value, or `null` before the first sample. */
  readonly value: number | null
  /** The filtered derivative, in units per second. */
  readonly derivative: number
}

export const INITIAL_ONE_EURO_STATE: OneEuroState = { value: null, derivative: 0 }

/**
 * The exponential-smoothing coefficient for a cutoff and a timestep.
 *
 * Both edge cases are returned rather than left to the arithmetic. `dt → 0` would make `tau/dt`
 * infinite and the coefficient 0, freezing the filter; `cutoff → 0` would make it infinite. Neither
 * throws, and both are wrong quietly, so they are stated here.
 */
export function smoothingAlpha(cutoffHz: number, dtSeconds: number): number {
  if (cutoffHz <= 0) return 1
  if (dtSeconds <= 0) return 0
  const tau = 1 / (2 * Math.PI * cutoffHz)
  return 1 / (1 + tau / dtSeconds)
}

/**
 * One filter step.
 *
 * The first sample is passed through untouched — there is nothing to smooth it against, and easing a
 * value up from zero would drag the earring in from the corner of the screen on the first frame.
 *
 * A non-positive `dt` returns the previous value and state unchanged. It means "no time passed", so
 * there is no derivative to compute and no basis for moving; dividing by it is how a NaN gets into
 * a renderer transform, where it does not throw but poisons everything downstream.
 */
export function oneEuro(
  value: number,
  state: OneEuroState,
  dtSeconds: number,
  config: OneEuroConfig = DEFAULT_SMOOTHING,
): { value: number; state: OneEuroState } {
  if (state.value === null) {
    return { value, state: { value, derivative: 0 } }
  }

  if (!(dtSeconds > 0) || !Number.isFinite(value)) {
    return { value: state.value, state }
  }

  const rawDerivative = (value - state.value) / dtSeconds
  const derivativeAlpha = smoothingAlpha(config.derivativeCutoff, dtSeconds)
  const derivative = state.derivative + derivativeAlpha * (rawDerivative - state.derivative)

  const cutoff = config.minCutoff + config.beta * Math.abs(derivative)
  const alpha = smoothingAlpha(cutoff, dtSeconds)
  const next = state.value + alpha * (value - state.value)

  return { value: next, state: { value: next, derivative } }
}

/** Clears the filter, so a tracking loss does not resume from a stale position. */
export function resetOneEuro(): OneEuroState {
  return INITIAL_ONE_EURO_STATE
}
