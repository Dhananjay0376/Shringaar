/**
 * Smooths solved targets over time.
 *
 * The solver is stateless: every frame it answers "where is the earring *right now*", from that
 * frame's landmarks. That is the right shape for it to be — stateless logic is what the tests can
 * pin — but it means the answer inherits every bit of landmark jitter. A face held still produces a
 * mesh that wobbles by a pixel or two every frame, and an earring drawn from it shimmers.
 *
 * So filtering happens here, one filter per side per field, rather than inside the solver. Two
 * consequences worth stating: the solver stays a pure function of one frame, and the smoothing can be
 * turned off to see the raw solve, which is the only way to tell "the filter is lagging" apart from
 * "the anchor is wrong".
 *
 * See `smoothing.ts` for why the filter is one-euro rather than a fixed low-pass.
 */

import {
  DEFAULT_SMOOTHING,
  INITIAL_ONE_EURO_STATE,
  oneEuro,
  type OneEuroConfig,
  type OneEuroState,
} from './smoothing'
import type { EarSide, PlacementTarget } from '../types/frame'

/** The five numbers that describe a target's place on screen. `side` is identity, not a value. */
interface SideState {
  readonly x: OneEuroState
  readonly y: OneEuroState
  readonly width: OneEuroState
  readonly rotation: OneEuroState
  readonly squash: OneEuroState
  readonly opacity: OneEuroState
  /** Detection time of the last sample for this side, so `dt` is per-side. */
  readonly at: number
}

export interface TargetSmoother {
  /** Filters one frame's targets against the previous frame's. Order does not matter. */
  smooth(targets: readonly PlacementTarget[], nowMs: number): PlacementTarget[]
  /** Drops all filter state, so the next frame is a cold start. */
  reset(): void
  /** How many sides currently hold state. Diagnostics only. */
  readonly trackedSides: number
}

export function createTargetSmoother(config: OneEuroConfig = DEFAULT_SMOOTHING): TargetSmoother {
  const states = new Map<EarSide, SideState>()

  return {
    get trackedSides(): number {
      return states.size
    },

    reset(): void {
      states.clear()
    },

    smooth(targets: readonly PlacementTarget[], nowMs: number): PlacementTarget[] {
      const seen = new Set<EarSide>()
      const smoothed: PlacementTarget[] = []

      for (const target of targets) {
        seen.add(target.side)

        const previous = states.get(target.side)
        /* A cold start gets `dt = 0`, and it makes no difference: `oneEuro` returns the very first
           sample untouched because its state value is `null`, before it ever looks at `dt`. That is the
           behaviour that matters — easing a target up from zero would drag the earring in from the
           corner of the screen on its first frame — and it comes from the initial state, not from this
           number. The zero is here only so there is no such thing as an unset timestep. */
        const dt = previous ? (nowMs - previous.at) / 1000 : 0

        const x = oneEuro(target.x, previous?.x ?? INITIAL_ONE_EURO_STATE, dt, config)
        const y = oneEuro(target.y, previous?.y ?? INITIAL_ONE_EURO_STATE, dt, config)
        const width = oneEuro(target.width, previous?.width ?? INITIAL_ONE_EURO_STATE, dt, config)
        const rotation = oneEuro(target.rotation, previous?.rotation ?? INITIAL_ONE_EURO_STATE, dt, config)
        const squash = oneEuro(target.squash, previous?.squash ?? INITIAL_ONE_EURO_STATE, dt, config)
        const opacity = oneEuro(target.opacity, previous?.opacity ?? INITIAL_ONE_EURO_STATE, dt, config)

        states.set(target.side, {
          x: x.state,
          y: y.state,
          width: width.state,
          rotation: rotation.state,
          squash: squash.state,
          opacity: opacity.state,
          at: nowMs,
        })

        smoothed.push({
          side: target.side,
          x: x.value,
          y: y.value,
          width: width.value,
          rotation: rotation.value,
          squash: squash.value,
          opacity: opacity.value,
        })
      }

      /* A side that did not appear this frame loses its state rather than keeping it warm. Holding a
         stale position would mean resuming with a stale `dt` and a stale derivative, and the far
         earring is exactly the one that disappears and returns — as the head turns away and back.
         Losing the state costs nothing visible because the solver only drops a side once its opacity
         has already fallen below `MIN_DRAW_OPACITY`: the earring is re-deriving from scratch at 5%
         opacity, where a jump cannot be seen. */
      for (const side of [...states.keys()]) {
        if (!seen.has(side)) states.delete(side)
      }

      return smoothed
    },
  }
}
