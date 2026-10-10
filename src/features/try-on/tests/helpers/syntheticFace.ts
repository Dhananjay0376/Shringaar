/**
 * A synthetic face, for testing the solver without a camera.
 *
 * Two builders, deliberately separate. `syntheticFaceFrame` constructs the frame the solver consumes
 * directly, which is how the *solver's* arithmetic gets tested in isolation. `syntheticLandmarks`
 * goes the long way round — normalised landmark points that `buildFaceFrame` has to project, measure
 * and interpret — which is how the *projection and yaw estimation* get tested.
 *
 * Testing only the second would make a broken `buildFaceFrame` look like a broken solver; testing
 * only the first would leave the projection untested. Both, and the two meet in the middle.
 *
 * Proportions are taken from the mesh's own geometry, at an interocular distance of 128px in a
 * 640×480 frame. That is the default, and every option scales it.
 */

import type { FaceFrame } from '../../core/framing'
import { vec2, type Vec2 } from '../../core/geometry'
import { FACE_LANDMARKS, FACE_LANDMARK_COUNT } from '../../core/landmarks'
import type { Size } from '../../core/coordinates'
import type { Landmark } from '../../types/frame'

/** Offsets from the face centre, as multiples of the interocular distance. */
const CLUSTER_X = 1.0
const CLUSTER_Y = 0.1875
const JAW_X = 0.8
const JAW_Y = 0.75
const NOSE_BASE_X = 0
/**
 * The base of the nose, below the eye line by the standard facial proportion — the eye line to the
 * subnasale is about half the interocular distance.
 *
 * This one is worth noting, because it is the fixture's only anatomical claim: at this value the
 * anatomy-anchored drop and the fixed-proportion drop it replaced land within ~1px of each other on a
 * canonically-proportioned face. That is the behaviour the change is for. They diverge only as the
 * face departs from the canon, which is exactly the case the fixed constant could not handle.
 */
const NOSE_BASE_Y = 0.5

const DEFAULT_INTEROCULAR = 128
const DEFAULT_VIDEO: Size = { width: 640, height: 480 }

export interface SyntheticFaceOptions {
  /** Canvas px between the eye corners. */
  readonly interocular?: number
  /** Canvas px centre of the face. */
  readonly centre?: Vec2
  /** Head roll in radians, applied about the face centre. */
  readonly roll?: number
  /** Target yaw in radians, realised by setting the cheek clusters' depths. */
  readonly yaw?: number
  /**
   * Nose-base height as a multiple of interocular below the eye line. Omit for the canonical value.
   *
   * The handle for testing the thing the anatomical anchor exists to do: a long face and a short one
   * differ here, and the anchor is supposed to follow rather than assume the average.
   */
  readonly noseBaseY?: number
  /** Jaw-point height as a multiple of interocular. Raise toward `CLUSTER_Y` to flatten the jaw direction. */
  readonly jawY?: number
  /** Omit the nose base from the frame entirely, to exercise the solver's fallback path. */
  readonly withoutNoseBase?: boolean
}

interface Geometry {
  readonly interocular: number
  readonly centre: Vec2
  readonly rulerA: Vec2
  readonly rulerB: Vec2
  readonly clusterA: readonly Vec2[]
  readonly clusterB: readonly Vec2[]
  readonly jawA: readonly Vec2[]
  readonly jawB: readonly Vec2[]
  readonly noseBase: readonly Vec2[]
}

/** The two heights that carry anatomy, in interocular units below the eye line. */
interface LayoutHeights {
  readonly jawY: number
  readonly noseBaseY: number
}

/** Upright, unrolled, unyawed points — the raw layout before any transform. */
function layout(
  interocular: number,
  centre: Vec2,
  heights: LayoutHeights,
): Omit<Geometry, 'interocular' | 'centre'> {
  const clusterOffset = interocular

  const clusterCentreA = vec2(centre.x - CLUSTER_X * clusterOffset, centre.y + CLUSTER_Y * interocular)
  const clusterCentreB = vec2(centre.x + CLUSTER_X * clusterOffset, centre.y + CLUSTER_Y * interocular)
  const jawCentreA = vec2(centre.x - JAW_X * clusterOffset, centre.y + heights.jawY * interocular)
  const jawCentreB = vec2(centre.x + JAW_X * clusterOffset, centre.y + heights.jawY * interocular)
  const noseBaseCentre = vec2(
    centre.x + NOSE_BASE_X * clusterOffset,
    centre.y + heights.noseBaseY * interocular,
  )

  return {
    rulerA: vec2(centre.x - interocular / 2, centre.y),
    rulerB: vec2(centre.x + interocular / 2, centre.y),
    /* Three cluster points spread slightly around the centre, so the solver's average is a real
       average rather than three copies of one number. */
    clusterA: [
      vec2(clusterCentreA.x - 0.04 * interocular, clusterCentreA.y - 0.04 * interocular),
      clusterCentreA,
      vec2(clusterCentreA.x + 0.04 * interocular, clusterCentreA.y + 0.04 * interocular),
    ],
    clusterB: [
      vec2(clusterCentreB.x + 0.04 * interocular, clusterCentreB.y - 0.04 * interocular),
      clusterCentreB,
      vec2(clusterCentreB.x - 0.04 * interocular, clusterCentreB.y + 0.04 * interocular),
    ],
    jawA: [
      vec2(jawCentreA.x - 0.06 * interocular, jawCentreA.y - 0.07 * interocular),
      vec2(jawCentreA.x + 0.06 * interocular, jawCentreA.y + 0.07 * interocular),
    ],
    jawB: [
      vec2(jawCentreB.x + 0.06 * interocular, jawCentreB.y - 0.07 * interocular),
      vec2(jawCentreB.x - 0.06 * interocular, jawCentreB.y + 0.07 * interocular),
    ],
    /* Spread horizontally, the way the alar bases sit either side of the subnasale, so the solver's
       average is a real average and not three copies of one number. */
    noseBase: [
      vec2(noseBaseCentre.x - 0.05 * interocular, noseBaseCentre.y),
      noseBaseCentre,
      vec2(noseBaseCentre.x + 0.05 * interocular, noseBaseCentre.y),
    ],
  }
}

/** Rotates a point about `origin` by `angle` radians in screen space (y down). */
function rotateAbout(point: Vec2, origin: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return vec2(origin.x + dx * cos - dy * sin, origin.y + dx * sin + dy * cos)
}

function geometry(options: SyntheticFaceOptions): Geometry {
  const interocular = options.interocular ?? DEFAULT_INTEROCULAR
  const centre = options.centre ?? vec2(320, 240)
  const roll = options.roll ?? 0
  const base = layout(interocular, centre, {
    jawY: options.jawY ?? JAW_Y,
    noseBaseY: options.noseBaseY ?? NOSE_BASE_Y,
  })
  const noseBase: readonly Vec2[] = options.withoutNoseBase ? [] : base.noseBase

  if (roll === 0) return { ...base, noseBase, interocular, centre }

  const turn = (p: Vec2): Vec2 => rotateAbout(p, centre, roll)
  return {
    interocular,
    centre,
    rulerA: turn(base.rulerA),
    rulerB: turn(base.rulerB),
    clusterA: base.clusterA.map(turn),
    clusterB: base.clusterB.map(turn),
    jawA: base.jawA.map(turn),
    jawB: base.jawB.map(turn),
    noseBase: noseBase.map(turn),
  }
}

/** The frame the solver consumes, built directly — no projection involved. */
export function syntheticFaceFrame(options: SyntheticFaceOptions = {}): FaceFrame {
  const g = geometry(options)
  return {
    rulerA: g.rulerA,
    rulerB: g.rulerB,
    interocular: g.interocular,
    roll: options.roll ?? 0,
    yaw: options.yaw ?? 0,
    clusterA: g.clusterA,
    clusterB: g.clusterB,
    jawA: g.jawA,
    jawB: g.jawB,
    noseBase: g.noseBase,
  }
}

/**
 * Normalised landmarks for the same face, for feeding through `buildFaceFrame`.
 *
 * Requires an identity transform to be meaningful — pass the video's own size as the box — because
 * the points are converted to normalised units by dividing by the box, and a `cover` crop would move
 * them. That constraint lives here rather than in the solver, and the tests that use this pass a
 * matching box.
 */
export function syntheticLandmarks(
  options: SyntheticFaceOptions & { readonly video?: Size } = {},
): Landmark[] {
  const video = options.video ?? DEFAULT_VIDEO
  const g = geometry(options)

  const landmarks: Landmark[] = Array.from({ length: FACE_LANDMARK_COUNT }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }))

  const put = (index: number, px: Vec2, z = 0): void => {
    landmarks[index] = { x: px.x / video.width, y: px.y / video.height, z }
  }

  put(FACE_LANDMARKS.rulerA, g.rulerA)
  put(FACE_LANDMARKS.rulerB, g.rulerB)

  FACE_LANDMARKS.clusterA.forEach((index, i) => {
    const point = g.clusterA[i]
    if (point) put(index, point)
  })
  FACE_LANDMARKS.clusterB.forEach((index, i) => {
    const point = g.clusterB[i]
    if (point) put(index, point)
  })
  FACE_LANDMARKS.jawA.forEach((index, i) => {
    const point = g.jawA[i]
    if (point) put(index, point)
  })
  FACE_LANDMARKS.jawB.forEach((index, i) => {
    const point = g.jawB[i]
    if (point) put(index, point)
  })
  FACE_LANDMARKS.noseBase.forEach((index, i) => {
    const point = g.noseBase[i]
    if (point) put(index, point)
  })

  /* Yaw is realised through depth, the way the estimator reads it: the far cluster recedes. Positive
     yaw means the face turned toward cluster A, so A comes forward (smaller z) and B recedes. */
  const yaw = options.yaw ?? 0
  if (yaw !== 0) {
    const widthNormalised = (2 * g.interocular) / video.width
    const depthDifference = Math.tan(yaw) * Math.abs(widthNormalised)
    for (const index of FACE_LANDMARKS.clusterA) put(index, pxOf(landmarks, index, video), -depthDifference / 2)
    for (const index of FACE_LANDMARKS.clusterB) put(index, pxOf(landmarks, index, video), depthDifference / 2)
  }

  return landmarks
}

/** Recovers the canvas-space point already stored at an index, so depth can be set without redoing layout. */
function pxOf(landmarks: readonly Landmark[], index: number, video: Size): Vec2 {
  const landmark = landmarks[index]
  if (!landmark) return vec2(0, 0)
  return vec2(landmark.x * video.width, landmark.y * video.height)
}

export const SYNTHETIC_DEFAULT_VIDEO = DEFAULT_VIDEO
