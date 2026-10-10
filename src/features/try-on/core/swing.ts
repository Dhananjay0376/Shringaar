/**
 * Pendulum physics for a hanging piece.
 *
 * An earring welded rigidly to the lobe is the single strongest tell that a try-on is a sticker. A
 * jhumka has mass on a short drop, so it lags a moving head, overshoots, and rings down â€” and adding
 * that costs one rotation per frame.
 *
 * ## What this is, precisely
 *
 * It is a **damped, driven pendulum**, integrated per frame:
 *
 *     Î¸'' = âˆ’kÂ·sin Î¸ âˆ’ cÂ·Î¸' + dÂ·a
 *
 * where `a` is the pivot's horizontal acceleration. That is a real physical model and it is simulated,
 * not measured: nothing here looks at the piece's actual mass, its centre of mass, or how long its
 * drop is. The constants are tuned to *look* like a hanging earring, and the honest description of the
 * result is "it swings believably", never "it is a simulation of this piece".
 *
 * ## The sign of the drive term, which is written down because it was got wrong once
 *
 * `+dÂ·a`, and the `+` is load-bearing. A pivot accelerating to the right throws its bob to the *left*
 * â€” the pseudo-force in the pivot's frame is âˆ’mA â€” so the piece **trails**. In this file's canvas
 * convention a *positive* angle is clockwise on screen, which for a box drawn downward from its anchor
 * (local point `(0, h)`, see `renderers/canvas2d.ts`) puts the free end **left** of the anchor. So
 * rightward acceleration (`a > 0`) has to produce a positive angle, and the drive term carries that
 * sign.
 *
 * The convention is not guessed at: `ctx.rotate(0.5)` with the canvas's own `getTransform()` places
 * `(0, h)` at `dx < 0`. Get this backwards and nothing throws, nothing NaNs, and every moving frame
 * renders the mirror of the intended motion â€” the piece *leads* the head, which is the sticker-like
 * tell this whole file exists to remove.
 *
 * ## Two decisions worth stating
 *
 * **Driven by acceleration, not velocity.** Pivot acceleration is what deflects a pendulum in the
 * pivot's own frame, so that is what drives it. Acceleration is a *second* difference of the landmark
 * position, which amplifies mesh noise far more than the position does â€” so it is taken from the
 * already-smoothed velocity and clamped, rather than differenced and trusted.
 *
 * **Normalised by the piece's drawn width.** Raw canvas-pixel acceleration would make the same head
 * motion swing the piece twice as far in a window twice the size. Dividing by the drawn width â€” which
 * is itself proportional to the interocular distance â€” makes the response scale-invariant, so the
 * piece behaves the same on a phone and on a desktop.
 *
 * **It cannot be verified against a real earring.** No measurement of a real jhumka was taken. The
 * constants below are a considered guess.
 */

import { clamp } from './geometry'
import { smoothingAlpha } from './smoothing'
import type { EarSide, PlacementTarget } from '../types/frame'

export interface SwingConfig {
  /** Ï‰Â². Restoring stiffness â€” how briskly the piece returns to hanging straight. */
  readonly stiffness: number
  /** Damping coefficient. Higher settles sooner, with fewer visible overshoots. */
  readonly damping: number
  /** Hz. Cutoff for smoothing the pivot velocity before it is differentiated into acceleration. */
  readonly velocityCutoff: number
  /** How strongly pivot acceleration deflects the piece, in radians per (normalised accel). */
  readonly drive: number
  /** Ceiling on normalised acceleration, so one bad landmark frame cannot fling the piece. */
  readonly maxDriveAccel: number
  /** Hard limit on the swing angle, radians. */
  readonly maxAngle: number
}

/**
 * Tuned to read as weight, not as measurement.
 *
 * `stiffness` of 100 is Ï‰ â‰ˆ 10 rad/s, about **1.6 Hz**. A real jhumka on a ~2.5 cm drop rings nearer
 * 3 Hz; this is deliberately slower, because at 3 Hz on a 640 px canvas the motion reads as a jitter
 * rather than as a piece with mass.
 *
 * `damping` of 5 against that stiffness is Î¶ â‰ˆ 0.25 â€” underdamped on purpose. A piece that settles in
 * a single motion looks glued; two or three shrinking overshoots is what swinging looks like.
 *
 * `maxAngle` of 0.30 rad (â‰ˆ17Â°) is far larger than a real earring reaches from ordinary head
 * movement. It is a guard rail, not a target â€” it exists so a tracking glitch cannot spin the piece
 * round the ear, and ordinary motion should stay well under it.
 */
export const DEFAULT_SWING: SwingConfig = {
  stiffness: 100,
  damping: 5,
  velocityCutoff: 5,
  drive: 0.05,
  maxDriveAccel: 400,
  maxAngle: 0.3,
}

export interface SwingState {
  /** Radians, added to the target's own head-roll rotation. Positive is clockwise on screen. */
  readonly angle: number
  /** Radians per second. */
  readonly velocity: number
  /** Smoothed pivot velocity, px/s. The basis the acceleration is differenced from. */
  readonly vx: number
  /** Pivot x at the last step, or `null` before the first sample. */
  readonly lastX: number | null
}

export function initialSwingState(): SwingState {
  return { angle: 0, velocity: 0, vx: 0, lastX: null }
}

/**
 * One integration step.
 *
 * The first sample only seeds the pivot position. There is no previous x to difference against, and
 * inventing motion from `lastX = 0` would fling the piece across the ear on frame one.
 *
 * A non-positive or non-finite `dt` returns the state untouched. It means "no time passed", so there
 * is no velocity to derive, no acceleration to drive with, and dividing by it is how a NaN reaches a
 * canvas transform â€” where it does not throw, and where every later frame is drawn at the wrong angle.
 */
export function stepSwing(
  state: SwingState,
  anchorX: number,
  width: number,
  dtSeconds: number,
  config: SwingConfig = DEFAULT_SWING,
): SwingState {
  if (!Number.isFinite(anchorX) || !(width > 0)) return state

  /* Seeded before the `dt` guard, so a zero-length first step still records where the pivot is. The
     alternative â€” seeding only once `dt` is usable â€” costs a frame of swing on every session start
     and makes the first two frames behave differently from every later pair. */
  if (state.lastX === null) {
    return { angle: state.angle, velocity: state.velocity, vx: 0, lastX: anchorX }
  }

  if (!(dtSeconds > 0)) return state

  const alpha = smoothingAlpha(config.velocityCutoff, dtSeconds)
  const rawVx = (anchorX - state.lastX) / dtSeconds
  const vx = state.vx + alpha * (rawVx - state.vx)

  const accel = clamp(
    (vx - state.vx) / dtSeconds / width,
    -config.maxDriveAccel,
    config.maxDriveAccel,
  )

  /* `sin`, not the angle itself: a real pendulum slows at the extremes of its arc instead of behaving
     like a linear spring. It only matters past ~30Â°, which the clamp keeps it under â€” but the clamp is
     a guard rail and the model should not depend on it to stay sane.

     `+`, not `âˆ’`, on the drive: rightward acceleration must put the free end left, which is a positive
     angle. See the header. The restoring and damping terms take `âˆ’` for the ordinary reason â€” they
     oppose the displacement and the velocity. */
  const angularAccel =
    -config.stiffness * Math.sin(state.angle) - config.damping * state.velocity + config.drive * accel

  /* Semi-implicit Euler: velocity first, then position from the *new* velocity. One line longer than
     explicit Euler and it does not pump energy into the system, which explicit Euler does â€” a spring
     integrated that way gains amplitude every frame until it hits the clamp and stays there. */
  let velocity = state.velocity + angularAccel * dtSeconds
  let angle = state.angle + velocity * dtSeconds

  if (Math.abs(angle) > config.maxAngle) {
    angle = Math.sign(angle) * config.maxAngle
    /* Velocity is dropped on contact as well as clamped. Leaving it would let it accumulate against
       the limit, so the piece would sit pinned at the guard rail and then snap when the drive eased. */
    velocity = 0
  }

  return { angle, velocity, vx, lastX: anchorX }
}

/** Longest step the integrator will take, seconds. A backgrounded tab must not fling the piece. */
export const MAX_SWING_DT = 0.05

/** Per-side integrator state. One entry per earring currently on screen. */
export type SwingBank = Map<EarSide, SwingState>

export function createSwingBank(): SwingBank {
  return new Map()
}

/**
 * Advances both pieces and folds the result into their rotation.
 *
 * The pivot is the **mean of the drawn targets**, which is the head's own horizontal motion â€” so both
 * pieces swing together, as they do when a head translates. A head *rotating* would drive the two
 * sides differently and this does not model that; it is a stated limit, not an oversight.
 *
 * With nothing on screen the bank is cleared rather than left holding a stale angle, so a piece that
 * fades back in starts at rest instead of resuming mid-swing.
 */
export function applySwing(
  targets: readonly PlacementTarget[],
  bank: SwingBank,
  dtSeconds: number,
  config: SwingConfig = DEFAULT_SWING,
): readonly PlacementTarget[] {
  if (targets.length === 0) {
    bank.clear()
    return targets
  }

  let sumX = 0
  let sumWidth = 0
  for (const target of targets) {
    sumX += target.x
    sumWidth += target.width
  }
  const pivotX = sumX / targets.length
  const width = sumWidth / targets.length
  if (!(width > 0)) return targets

  const drawn = new Set<EarSide>(targets.map((target) => target.side))
  for (const side of [...bank.keys()]) {
    if (!drawn.has(side)) bank.delete(side)
  }

  return targets.map((target) => {
    const next = stepSwing(bank.get(target.side) ?? initialSwingState(), pivotX, width, dtSeconds, config)
    bank.set(target.side, next)
    return next.angle === 0 ? target : { ...target, rotation: target.rotation + next.angle }
  })
}
