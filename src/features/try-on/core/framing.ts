/**
 * The face-local frame.
 *
 * Everything the earring solver knows about a face comes from here: how big it is, which way it is
 * tilted, and which way it has turned. The solver itself then works entirely in this frame, which is
 * what makes it independent of where the face is on screen and how far away it is.
 *
 * One measurement carries all the scale. The interocular distance — the two outer eye corners — is
 * the most stable thing in the mesh, so every length downstream is a multiple of it rather than a
 * pixel count. That is what lets the same constants work for a face filling the frame and a face
 * across the room.
 *
 * Yaw is the weak one, and it is treated as weak. There is no true head pose here: yaw is inferred
 * from the depth difference between the two cheek clusters, which is a relative indicator good
 * enough to fade an earring out and to squash it horizontally. It is never used to place anything,
 * because a relative depth reading does not support a metric claim.
 */

import { computeViewTransform, toCanvasPoint, type Size, type ViewTransform } from './coordinates'
import { angleBetween, distance, vec2, type Vec2 } from './geometry'
import { FACE_LANDMARKS } from './landmarks'
import type { Landmark } from '../types/frame'

/**
 * Below this the face is too small for the landmarks to mean anything.
 *
 * At 640×480 a face filling a third of the frame has an interocular distance around 40–60px. Sixteen
 * is a face well across the room, where landmark jitter is a large fraction of the measurement and
 * the derived anchor would swing wildly. Refusing to draw is the honest outcome.
 */
export const MIN_INTEROCULAR_PX = 16

export interface FaceFrame {
  readonly rulerA: Vec2
  readonly rulerB: Vec2
  /** Canvas px between the outer eye corners. The unit of every other length here. */
  readonly interocular: number
  /** Head roll in radians, measured from the ruler. Screen space, y down. */
  readonly roll: number
  /**
   * Signed radians. Positive when the face has turned toward the A cluster's side.
   *
   * Clamped to (−π/2, π/2) by construction, so a face that is somehow behind the measured axis
   * cannot report a yaw that looks like a face turned inside out.
   */
  readonly yaw: number
  /** The projected face-oval clusters, three points each, in canvas px. */
  readonly clusterA: readonly Vec2[]
  readonly clusterB: readonly Vec2[]
  /** The projected jaw points, two each, in canvas px. */
  readonly jawA: readonly Vec2[]
  readonly jawB: readonly Vec2[]
  /**
   * The projected base of the nose, canvas px. The solver's anatomical reference for *height* —
   * the earlobe's level, since the lobe itself is not in the mesh.
   *
   * The one field here that is allowed to be **empty**. The solver's own landmarks are
   * all-or-nothing, but this is supporting evidence rather than a measurement it cannot work
   * without: absent, the earring falls back to a fixed proportion of the face, which is what the
   * engine did everywhere before. Refusing the whole frame over it would be a regression, not
   * caution.
   */
  readonly noseBase: readonly Vec2[]
}

/**
 * Projects the landmarks the solver needs, or returns `null` if any is missing.
 *
 * All-or-nothing on purpose. A frame with the ruler but not the clusters is not a partial result to
 * be worked around; it is a frame the solver has no business guessing at, and returning null makes
 * the caller handle that once instead of at every index.
 */
function projectRequired(
  landmarks: readonly Landmark[],
  view: ViewTransform,
  box: Size,
  mirror: boolean,
): Map<number, Vec2> | null {
  const indices = [
    FACE_LANDMARKS.rulerA,
    FACE_LANDMARKS.rulerB,
    ...FACE_LANDMARKS.clusterA,
    ...FACE_LANDMARKS.clusterB,
    ...FACE_LANDMARKS.jawA,
    ...FACE_LANDMARKS.jawB,
  ]

  const projected = new Map<number, Vec2>()
  for (const index of indices) {
    /* `noUncheckedIndexedAccess` types this as `Landmark | undefined`, and that is the right type:
       the model is documented at 478 points, but a shorter array is reachable if a future
       configuration asks for a reduced mesh. Reading `!` here would turn that into a silent
       undefined-property crash inside the render loop. */
    const landmark = landmarks[index]
    if (!landmark) return null
    if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null
    projected.set(index, toCanvasPoint(vec2(landmark.x, landmark.y), view, box, mirror))
  }
  return projected
}

function projectGroup(
  landmarks: readonly Landmark[],
  indices: readonly number[],
  view: ViewTransform,
  box: Size,
  mirror: boolean,
): Vec2[] {
  const points: Vec2[] = []
  for (const index of indices) {
    const landmark = landmarks[index]
    if (!landmark) continue
    points.push(toCanvasPoint(vec2(landmark.x, landmark.y), view, box, mirror))
  }
  return points
}

/**
 * Builds the face-local frame, or returns `null` when there is not enough face to work with.
 *
 * Takes the video's frame size and the canvas box rather than receiving pre-projected points, so
 * one call does the whole job and there is no way to hand it points from a different transform than
 * the one it believes it is using.
 */
export function buildFaceFrame(
  landmarks: readonly Landmark[],
  video: Size,
  box: Size,
  mirror: boolean,
  fit: 'cover' | 'contain' = 'cover',
): FaceFrame | null {
  const view = computeViewTransform(video, box, fit)

  const points = projectRequired(landmarks, view, box, mirror)
  if (!points) return null

  const rulerA = points.get(FACE_LANDMARKS.rulerA)
  const rulerB = points.get(FACE_LANDMARKS.rulerB)
  if (!rulerA || !rulerB) return null

  const interocular = distance(rulerA, rulerB)
  if (!(interocular >= MIN_INTEROCULAR_PX)) return null

  const clusterA = projectGroup(landmarks, FACE_LANDMARKS.clusterA, view, box, mirror)
  const clusterB = projectGroup(landmarks, FACE_LANDMARKS.clusterB, view, box, mirror)
  if (clusterA.length === 0 || clusterB.length === 0) return null

  /* Roll from the ruler. `angleBetween` is signed, so a head tilted one way and the same amount the
     other give opposite numbers and the earrings counter-rotate to the correct side. */
  const roll = normaliseRoll(angleBetween(rulerA, rulerB))

  return {
    rulerA,
    rulerB,
    interocular,
    roll,
    yaw: estimateYaw(landmarks),
    clusterA,
    clusterB,
    jawA: projectGroup(landmarks, FACE_LANDMARKS.jawA, view, box, mirror),
    jawB: projectGroup(landmarks, FACE_LANDMARKS.jawB, view, box, mirror),
    noseBase: projectGroup(landmarks, FACE_LANDMARKS.noseBase, view, box, mirror),
  }
}

/**
 * Folds a ruler direction onto the nearer half-turn.
 *
 * `angleBetween(rulerA, rulerB)` is the direction of the vector *from one eye corner to the other*,
 * not the orientation of the eye line — and those differ by a half-turn when the vector points the
 * other way. That happens as soon as the view is mirrored, because mirroring negates dx and `atan2`
 * of a negated dx lands in the opposite quadrant: a head tilted 0.2 rad reports `π − 0.2`.
 *
 * Since the earring is rotated by this angle, the uncorrected value hangs it upside down — on the
 * mirrored path, which is what a front-facing camera uses by default. Folding onto the nearer
 * half-turn gives back the orientation, and a signed rotation to match it.
 *
 * A head genuinely tilted past a quarter turn is not recoverable here, and does not need to be: at
 * that angle the face is nearly sideways and no earring placement is meaningful. Choosing the nearer
 * orientation is still a better answer than a half-turn-flipped earring.
 */
function normaliseRoll(angle: number): number {
  if (angle > Math.PI / 2) return angle - Math.PI
  if (angle <= -Math.PI / 2) return angle + Math.PI
  return angle
}

/**
 * Yaw from the depth separation of the two cheek clusters, over the face's width.
 *
 * Depth and width are both taken from the **normalised** landmarks, not the projected ones. Mixing a
 * canvas-pixel numerator with a normalised denominator would make the angle change when the window
 * was resized, which is the kind of bug that looks like a tracking problem and is not one.
 *
 * The denominator is the *absolute* width, so the result is confined to (−π/2, π/2) whichever side
 * of the screen each cluster landed on. A signed denominator would read a mirrored view as a head
 * turned 180°.
 */
function estimateYaw(landmarks: readonly Landmark[]): number {
  const a = meanDepth(landmarks, FACE_LANDMARKS.clusterA)
  const b = meanDepth(landmarks, FACE_LANDMARKS.clusterB)
  if (!a || !b) return 0

  const width = Math.abs(b.x - a.x)
  if (!(width > 1e-6)) return 0

  return Math.atan2(b.z - a.z, width)
}

function meanDepth(
  landmarks: readonly Landmark[],
  indices: readonly number[],
): { x: number; z: number } | null {
  let x = 0
  let z = 0
  let count = 0
  for (const index of indices) {
    const landmark = landmarks[index]
    if (!landmark) continue
    x += landmark.x
    z += landmark.z
    count += 1
  }
  if (count === 0) return null
  return { x: x / count, z: z / count }
}
