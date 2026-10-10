import { describe, expect, it } from 'vitest'

import { computeViewTransform } from '../core/coordinates'
import { MIN_INTEROCULAR_PX, buildFaceFrame } from '../core/framing'
import { FACE_LANDMARKS, FACE_LANDMARK_COUNT } from '../core/landmarks'
import type { Landmark } from '../types/frame'
import { SYNTHETIC_DEFAULT_VIDEO, syntheticLandmarks } from './helpers/syntheticFace'

const VIDEO = SYNTHETIC_DEFAULT_VIDEO
const BOX = SYNTHETIC_DEFAULT_VIDEO
const CENTRE_X = 320

/** The identity case: the box is the video, so `cover` crops nothing and px map to px. */
function frame(options: Parameters<typeof syntheticLandmarks>[0] = {}, mirror = false) {
  return buildFaceFrame(syntheticLandmarks(options), VIDEO, BOX, mirror)
}

describe('buildFaceFrame — the identity transform', () => {
  it('measures the interocular distance in canvas px', () => {
    /* 128px by construction, and the whole solver is expressed in multiples of it. */
    expect(frame()?.interocular).toBeCloseTo(128, 6)
  })

  it('projects the eye corners to where the synthetic face put them', () => {
    const built = frame()
    expect(built?.rulerA.x).toBeCloseTo(CENTRE_X - 64, 6)
    expect(built?.rulerB.x).toBeCloseTo(CENTRE_X + 64, 6)
    expect(built?.rulerA.y).toBeCloseTo(240, 6)
  })

  it('reports no roll and no yaw for a level, frontal face', () => {
    const built = frame()
    expect(built?.roll).toBeCloseTo(0, 9)
    expect(built?.yaw).toBeCloseTo(0, 9)
  })

  it('carries the jaw and cluster groups through', () => {
    const built = frame()
    expect(built?.clusterA).toHaveLength(FACE_LANDMARKS.clusterA.length)
    expect(built?.clusterB).toHaveLength(FACE_LANDMARKS.clusterB.length)
    expect(built?.jawA).toHaveLength(FACE_LANDMARKS.jawA.length)
    expect(built?.jawB).toHaveLength(FACE_LANDMARKS.jawB.length)
  })
})

describe('buildFaceFrame — roll', () => {
  it('reads the head tilt and its sign from the ruler', () => {
    expect(frame({ roll: 0.2 })?.roll).toBeCloseTo(0.2, 6)
    expect(frame({ roll: -0.2 })?.roll).toBeCloseTo(-0.2, 6)
  })

  /* The selfie camera mirrors the preview, so this is the *default* path, not an edge case. Mirroring
     is a reflection: it flips the ruler's x component, and `atan2` of a negated dx reports the
     opposite direction of the same line — off by π. Left uncorrected, an earring rotated by that
     angle hangs upside down, which is the single most obvious way this feature can look broken. */
  it('negates roll under mirroring rather than returning an angle a half-turn away', () => {
    const mirrored = frame({ roll: 0.2 }, true)
    expect(mirrored?.roll).toBeCloseTo(-0.2, 6)
  })

  it('keeps the mirrored roll inside a quarter turn', () => {
    for (const roll of [-0.4, -0.1, 0, 0.1, 0.4]) {
      const mirrored = frame({ roll }, true)
      expect(Math.abs(mirrored?.roll ?? 0)).toBeLessThan(Math.PI / 2)
    }
  })
})

describe('buildFaceFrame — mirroring', () => {
  it('flips x about the box centre and leaves y alone', () => {
    const plain = frame()
    const mirrored = frame({}, true)

    expect(mirrored?.rulerA.x).toBeCloseTo(BOX.width - (plain?.rulerA.x ?? 0), 6)
    expect(mirrored?.rulerA.y).toBeCloseTo(plain?.rulerA.y ?? 0, 9)
  })

  it('leaves the interocular distance unchanged', () => {
    /* A reflection preserves length. If mirroring changed the scale, every earring would resize when
       the mirror toggle was flipped. */
    expect(frame({}, true)?.interocular).toBeCloseTo(frame()?.interocular ?? 0, 9)
  })

  it('leaves the yaw magnitude unchanged', () => {
    /* Yaw is read from depth, which a horizontal reflection does not touch. It must not be flipped
       with x, or the far earring would swap sides on the mirror toggle. */
    const plain = frame({ yaw: 0.6 })
    const mirrored = frame({ yaw: 0.6 }, true)
    expect(mirrored?.yaw).toBeCloseTo(plain?.yaw ?? 0, 9)
  })
})

describe('buildFaceFrame — yaw', () => {
  it('recovers the yaw the face was built with', () => {
    /* A round trip through normalised depth and back. If the estimator mixed units — canvas-px depth
       over a normalised width — this would come back wrong by a factor of the frame size. */
    for (const yaw of [-0.8, -0.3, 0, 0.3, 0.8]) {
      expect(frame({ yaw })?.yaw).toBeCloseTo(yaw, 6)
    }
  })

  /* The bug this guards: a canvas-px numerator over a normalised denominator would make the reported
     angle depend on the frame size, so the earring would fade out at a different head turn depending
     on the camera resolution. */
  it('reports the same yaw at a different frame size', () => {
    const at480 = buildFaceFrame(
      syntheticLandmarks({ yaw: 0.5, video: { width: 640, height: 480 } }),
      { width: 640, height: 480 },
      { width: 640, height: 480 },
      false,
    )
    const at720 = buildFaceFrame(
      syntheticLandmarks({ yaw: 0.5, video: { width: 1280, height: 720 } }),
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
      false,
    )

    expect(at480?.yaw).toBeCloseTo(at720?.yaw ?? 0, 6)
  })
})

describe('buildFaceFrame — refusing a frame', () => {
  it('returns null when the face is below the minimum size', () => {
    /* 12px interocular is below the 16px floor: landmark jitter is a large fraction of the
       measurement there, and the derived anchor would swing wildly. Refusing to draw is the honest
       outcome, and it is a different state from "no face" on screen. */
    expect(MIN_INTEROCULAR_PX).toBeGreaterThan(12)
    expect(frame({ interocular: 12 })).toBeNull()
  })

  it('accepts a face at exactly the minimum size', () => {
    expect(frame({ interocular: MIN_INTEROCULAR_PX })).not.toBeNull()
  })

  it('returns null when a required landmark is absent', () => {
    const landmarks = syntheticLandmarks()
    const short: Landmark[] = landmarks.slice(0, 100)
    expect(buildFaceFrame(short, VIDEO, BOX, false)).toBeNull()
  })

  it('returns null when a required landmark is not finite', () => {
    /* The model can emit a NaN on a bad frame. Left alone it reaches the renderer transform, where it
       does not throw — it silently draws nothing, for every frame after. */
    const landmarks = syntheticLandmarks()
    landmarks[FACE_LANDMARKS.rulerA] = { x: Number.NaN, y: 0.5, z: 0 }
    expect(buildFaceFrame(landmarks, VIDEO, BOX, false)).toBeNull()
  })

  it('returns null for an empty landmark list', () => {
    expect(buildFaceFrame([], VIDEO, BOX, false)).toBeNull()
  })

  it('treats `undefined` from the model as no face, not as a crash', () => {
    /* `faceLandmarks[0]` is `NormalizedLandmark[] | undefined` under `noUncheckedIndexedAccess`, and
       the caller is expected to pass an empty array rather than reach for `!`. */
    const sparse: Landmark[] = Array.from({ length: FACE_LANDMARK_COUNT }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
    }))
    delete (sparse as Partial<Landmark[]>)[FACE_LANDMARKS.clusterA[0] as number]
    expect(buildFaceFrame(sparse, VIDEO, BOX, false)).toBeNull()
  })
})

describe('buildFaceFrame — non-identity transforms', () => {
  it('scales the interocular distance with the box', () => {
    /* Double the box with a `contain` fit and the ruler doubles, because the whole face scales. */
    const doubled = buildFaceFrame(syntheticLandmarks(), VIDEO, { width: 1280, height: 960 }, false, 'contain')
    expect(doubled?.interocular).toBeCloseTo(256, 6)
  })

  it('agrees with the transform it computes itself', () => {
    /* `buildFaceFrame` deliberately computes its own `ViewTransform` rather than accepting one, so
       there is no way to hand it points from a different transform than it believes it is using.
       This pins that it uses the one it derives. */
    const box = { width: 900, height: 500 }
    const view = computeViewTransform(VIDEO, box, 'cover')
    const built = buildFaceFrame(syntheticLandmarks(), VIDEO, box, false)

    expect(built?.rulerA.y).toBeCloseTo(view.offsetY + 240 * view.scale, 6)
  })
})
