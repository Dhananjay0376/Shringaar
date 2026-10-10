/**
 * The earring solver — the one category this engine actually implements.
 *
 * ## What it is doing, honestly
 *
 * The Face Landmarker returns 478 points covering the face oval, the eyes, the brows, the lips and
 * the irises. **There is no ear in that mesh.** The closest points to an ear are the face-oval
 * contour at the cheekbone and jaw, which is where the numbers 234 and 454 live — and those are
 * facial side references, not earlobes, however often they get described as such.
 *
 * So this is not ear tracking. It is a *derived placement*: estimate where the ear is from the shape
 * of the face around it, extrapolate outward past the contour, and drop the asset along the jaw
 * direction. That estimate has real error, the error varies with face shape, and the calibration
 * controls exist because of it. The UI is written to describe placement, never fit, and never
 * accuracy.
 *
 * ## The frame everything is measured in
 *
 * Every length here is a multiple of the interocular distance, so the same constants hold for a face
 * filling the screen and one across the room. Nothing is a pixel count.
 *
 * ## What breaks it
 *
 * - A large head turn. Yaw past roughly 30° fades the far earring out rather than drawing it in the
 *   wrong place, and past roughly 60° removes it. A missing earring reads as "turn back"; a wrong
 *   one reads as a broken product.
 * - Hair over the ear. The mesh cannot see hair, so nothing occludes the earring and it will draw on
 *   top of it. There is no depth test to add, because there is no depth information about the hair.
 * - Faces the model does not fit well. The placement degrades with the landmark fit, and low light
 *   degrades the fit before it visibly degrades the video.
 */

import type { CategoryKey } from '@/lib/catalog'
import type { Calibration } from '../core/calibration'
import { add, clamp, mean, normalise, scaleBy, sub, vec2, type Vec2 } from '../core/geometry'
import type { FaceFrame } from '../core/framing'
import { MIN_DRAW_OPACITY, type EarSide, type PlacementTarget } from '../types/frame'
import type { AnchorSolver } from './types'

/**
 * Base geometry, in interocular units.
 *
 * These are starting points measured from the mesh's own proportions, not fitted to a particular
 * face — which is exactly why the calibration sliders exist and why the UI does not claim the
 * default is correct for everyone.
 *
 * `outward` was lowered from **0.30 to 0.24** on 2026-10-11, on the first real-face report this
 * engine has had: the piece sat "a bit ahead of the ear" — outside it, along the cheek line. That is
 * the direction the error was expected in, because the cluster mean is taken at the cheekbone and
 * extrapolated outward, and no earlobe exists in the mesh to check the extrapolation against.
 *
 * **This is a correction from one report about one face, not a fitted value.** It was deliberately
 * kept modest rather than guessed large: whatever remains is what the outward slider is for, and
 * under-correcting is visible as "still slightly out" while over-correcting sinks the piece into the
 * jaw, which reads as broken rather than as mis-tuned. If a slider value does the job for a given
 * face, that number is the better default — see the note in `ar-engine.md`.
 */
export const EAR_GEOMETRY = {
  /** How far beyond the cheek contour the lobe is estimated to sit. */
  outward: 0.24,
  /**
   * Fallback drop below the ear cluster mean, along the jaw direction.
   *
   * Used only when the anatomical anchor is unavailable or untrustworthy — see `lobeDrop`. It is the
   * engine's original answer, and keeping it means a frame with no nose base behaves exactly as it did
   * before rather than worse.
   */
  drop: 0.26,
  /**
   * Where the piercing sits relative to the base of the nose, as a multiple of interocular. Negative
   * is above it.
   *
   * The lobe's lower edge is level with the base of the nose; a piercing sits a little above that
   * edge, which is where −0.06 comes from (≈5–6 mm on a ~90 mm interocular).
   *
   * **This is a facial-proportion canon, not a measurement of anyone.** It was deliberately not tuned
   * to the synthetic head used for live testing — fitting a constant to a face this engine drew itself
   * would be fitting to a fake, which is the trap the honesty rules name. What it buys over the old
   * fixed drop is that it moves with the subject's face instead of assuming an average one.
   */
  lobeFromNoseBase: -0.06,
  /** Drawn asset width as a multiple of the interocular distance. */
  assetScale: 0.40,
} as const

/**
 * How vertical the jaw direction has to be before the anatomical drop is trusted.
 *
 * The drop is found by dividing by `down.y`, so a jaw direction near horizontal makes the answer
 * unbounded — a tilted head is not a reason to fling a piece down the subject's face.
 */
const JAW_VERTICAL_MIN = 0.35

/** Ceiling on the anatomical drop, as a multiple of interocular, so a bad nose read cannot run away. */
const MAX_LOBE_DROP = 0.6

/**
 * Yaw, in radians, at which the far earring begins to fade and at which it is gone.
 *
 * Roughly 31° and 57°. The fade is linear between them: continuous, monotonic, and with no jump at
 * either end, so a slow head turn produces a slow fade rather than a pop.
 */
export const YAW_FADE_START = 0.55
export const YAW_FADE_END = 1.0

/**
 * How visible an earring should be at a given yaw.
 *
 * Only the far side fades. The near ear is fully visible at any angle the tracker can still handle,
 * because turning toward an ear never occludes it.
 */
export function earOpacityForYaw(yaw: number, isFarSide: boolean): number {
  if (!isFarSide) return 1
  const magnitude = Math.abs(yaw)
  if (magnitude <= YAW_FADE_START) return 1
  if (magnitude >= YAW_FADE_END) return 0
  return 1 - (magnitude - YAW_FADE_START) / (YAW_FADE_END - YAW_FADE_START)
}

/**
 * The direction a lobe hangs in at a cluster: from the contour point toward the jaw.
 *
 * Falls back to straight down the screen when the jaw points are missing or coincide with the
 * cluster, so a degenerate frame produces a slightly wrong direction rather than a NaN one.
 */
function lobeDirection(clusterCentre: Vec2, jawPoints: readonly Vec2[]): Vec2 {
  const direction = normalise(sub(mean(jawPoints), clusterCentre))
  if (direction.x === 0 && direction.y === 0) return vec2(0, 1)
  return direction
}

interface SideInput {
  readonly cluster: readonly Vec2[]
  readonly jaw: readonly Vec2[]
  readonly otherClusterCentre: Vec2
  /** −1 or +1, so the two sides get opposite halves of the tilt control. */
  readonly tiltSign: number
}

/**
 * How far to travel down the jaw, from the outward-offset point, to reach the lobe.
 *
 * Two answers, and the anatomical one wins when it can be trusted. The mesh has no ear, so the lobe's
 * *position* cannot be read — but its *level* can, from the base of the nose, and that is the whole
 * point: the old fixed multiple of the interocular distance assumed an average face, so a long face
 * put the piece above the lobe and a short one put it below. Following the subject's own nose base
 * removes that assumption, and because the nose base is a mesh point it tracks head roll for free.
 *
 * Falls back to the fixed proportion when the anatomical answer is missing or unbounded: no nose-base
 * landmarks in the frame, or a jaw direction so close to horizontal that dividing by `down.y` explodes.
 * The result is clamped for the same reason. A fallback here is not a failure — it is the engine's
 * previous behaviour, unchanged.
 *
 * `offset` is the calibration and tilt the seller or customer has dialled in, and it rides on top of
 * whichever answer is used, so the slider keeps full authority over the final placement either way.
 */
function lobeDrop(
  frame: FaceFrame,
  from: Vec2,
  down: Vec2,
  interocular: number,
  offset: number,
): number {
  const fallback = (EAR_GEOMETRY.drop + offset) * interocular
  if (frame.noseBase.length === 0) return fallback
  if (Math.abs(down.y) < JAW_VERTICAL_MIN) return fallback

  const targetY = mean(frame.noseBase).y + (EAR_GEOMETRY.lobeFromNoseBase + offset) * interocular
  const wanted = (targetY - from.y) / down.y
  if (!Number.isFinite(wanted)) return fallback

  return clamp(wanted, 0, MAX_LOBE_DROP * interocular)
}

function solveSide(
  input: SideInput,
  frame: FaceFrame,
  calibration: Calibration,
  interocular: number,
): { point: Vec2; opacity: number } {
  const centre = mean(input.cluster)

  /* Outward is the axis between the two cheeks, pointed away from the far cheek. Using the *other*
     cluster rather than a face centroid means the direction is right even when the face is off to
     one side of the frame, and it needs no extra landmarks. */
  const outward = normalise(sub(centre, input.otherClusterCentre))
  const down = lobeDirection(centre, input.jaw)

  const outwardStep = (EAR_GEOMETRY.outward + calibration.outward) * interocular
  const fromOutward = add(centre, scaleBy(outward, outwardStep))

  const dropStep = lobeDrop(
    frame,
    fromOutward,
    down,
    interocular,
    calibration.drop + (calibration.tilt / 2) * input.tiltSign,
  )

  const point = add(fromOutward, scaleBy(down, dropStep))

  /* Which side is far from the camera depends on which way the head turned. Positive yaw means the
     face turned toward the A cluster, so the A cheek has come forward and B has receded. */
  const isA = input.tiltSign < 0
  const isFarSide = isA ? frame.yaw < 0 : frame.yaw > 0

  return { point, opacity: earOpacityForYaw(frame.yaw, isFarSide) }
}

/**
 * Both earrings, positioned for this frame.
 *
 * Returns targets sorted left-to-right **in the final canvas**, which is also how `side` is decided.
 * Nothing here relies on a convention about which mesh index is the subject's left ear — that
 * assumption would be one documentation lookup away from putting a left earring on a right ear, and
 * it is not needed: the answer is visible in the geometry.
 */
export function solveEarrings(frame: FaceFrame, calibration: Calibration): PlacementTarget[] {
  const interocular = frame.interocular
  if (!(interocular > 0)) return []

  const width = interocular * EAR_GEOMETRY.assetScale * calibration.size
  if (!(width > 0)) return []

  const clusterCentreA = mean(frame.clusterA)
  const clusterCentreB = mean(frame.clusterB)

  const a = solveSide(
    { cluster: frame.clusterA, jaw: frame.jawA, otherClusterCentre: clusterCentreB, tiltSign: -1 },
    frame,
    calibration,
    interocular,
  )
  const b = solveSide(
    { cluster: frame.clusterB, jaw: frame.jawB, otherClusterCentre: clusterCentreA, tiltSign: 1 },
    frame,
    calibration,
    interocular,
  )

  /* Squash for foreshortening. At a large yaw a flat earring is seen edge-on and should narrow; the
     floor stops it collapsing to a line, which would read as a rendering fault rather than a turn. */
  const squash = clamp(Math.cos(frame.yaw), 0.45, 1)

  const sides: ReadonlyArray<{ side: EarSide; solved: { point: Vec2; opacity: number } }> =
    a.point.x <= b.point.x
      ? [
          { side: 'left', solved: a },
          { side: 'right', solved: b },
        ]
      : [
          { side: 'left', solved: b },
          { side: 'right', solved: a },
        ]

  return sides
    .filter((entry) => entry.solved.opacity > MIN_DRAW_OPACITY)
    .map((entry) => ({
      side: entry.side,
      x: entry.solved.point.x,
      y: entry.solved.point.y,
      width,
      rotation: frame.roll,
      squash,
      opacity: entry.solved.opacity,
    }))
}

/** The registry entry for earrings. */
export const earringSolver: AnchorSolver = {
  category: 'earrings' satisfies CategoryKey,
  requiredAnchor: 'ear',
  solve: solveEarrings,
}
