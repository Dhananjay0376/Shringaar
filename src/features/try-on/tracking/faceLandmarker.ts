/**
 * The Face Landmarker, behind `LandmarkTracker`.
 *
 * One of two things in this module is easy to get wrong, and it is the timestamp. `detectForVideo`
 * throws if the timestamp does not strictly increase, and the exception is raised from inside wasm
 * where it arrives as an unhelpful numeric error. The caller supplies the timestamp, and
 * `tracking/loop.ts` guarantees it comes from one increasing clock — but a direct caller passing
 * `Date.now()` twice in the same millisecond would break it, so the adapter also refuses to reuse a
 * timestamp rather than trusting the caller.
 *
 * The other is the shape of `faceLandmarks`. It is an array *per face* — `NormalizedLandmark[][]` —
 * and even with `numFaces: 1` it can be empty, and `faceLandmarks[0]` is typed
 * `NormalizedLandmark[] | undefined` under `noUncheckedIndexedAccess`. Absent and empty both mean
 * "no face this frame", they are handled in one place, and `!` is never used.
 */

import { loadFaceLandmarker, assertLandmarkCount } from './mediapipe'
import { TrackerError, type LandmarkTracker } from './types'
import type { Landmark, TrackerFrame } from '../types/frame'
import type { FaceLandmarker } from '@mediapipe/tasks-vision'

export class FaceLandmarkerTracker implements LandmarkTracker {
  readonly kind = 'face' as const

  private landmarker: FaceLandmarker | null = null
  private starting: Promise<void> | null = null
  /** Guards against a non-increasing timestamp, which the model rejects by throwing. */
  private lastTimestamp = -1

  /**
   * The video element is required, not optional.
   *
   * Taking it here rather than through a settable property removes a whole state — a tracker that
   * exists but has nothing to read — and with it the runtime error that state would need. The model
   * accepts any `TexImageSource`, so a future implementation can pass an `OffscreenCanvas` without
   * changing anything else.
   */
  constructor(private readonly video: HTMLVideoElement) {}

  /**
   * Loads the model. Safe to call concurrently and repeatedly.
   *
   * `starting` is what makes it safe under `<StrictMode>`: the second call in the same tick attaches
   * to the first call's promise instead of loading a second model. Without it, development runs two
   * landmarkers over one video element.
   */
  async start(): Promise<void> {
    if (this.landmarker) return
    if (this.starting) return this.starting

    this.starting = (async () => {
      this.landmarker = await loadFaceLandmarker()
    })()

    try {
      await this.starting
    } finally {
      /* Cleared so a failed load does not leave `starting` resolved-and-stuck, which would make every
         later `start()` a no-op and the tracker permanently dead with no error to show. */
      this.starting = null
    }
  }

  detect(timestampMs: number): TrackerFrame | null {
    const landmarker = this.landmarker
    if (!landmarker) return null

    /* Strictly increasing, enforced here rather than assumed. Reusing a timestamp does not return a
       stale result — it throws from inside wasm, and the throw would surface far from this line. */
    if (!(timestampMs > this.lastTimestamp)) return null
    this.lastTimestamp = timestampMs

    let result
    try {
      result = landmarker.detectForVideo(this.video, timestampMs)
    } catch (cause) {
      /* A frame the model could not process — a decode hiccup, or a video element whose dimensions
         went to zero. Returning null treats it as a dropped frame, which the tracking state machine
         already handles by holding the last position. Propagating would kill the loop on one bad
         frame, which on a real camera happens sooner or later. */
      if (cause instanceof TrackerError) throw cause
      return null
    }

    const landmarks = result.faceLandmarks[0]
    if (!landmarks || landmarks.length === 0) return null

    /* Wrong landmark count is not a dropped frame: it means every index the solver uses is
       meaningless, and continuing would place jewellery using whichever points happen to exist. This
       one propagates and stops the session. */
    assertLandmarkCount(landmarks.length)

    return {
      kind: 'face',
      landmarks: landmarks.map(toLandmark),
      confidence: confidenceOf(landmarks),
      at: timestampMs,
    }
  }

  /**
   * Releases the model.
   *
   * `close()` is inherited from `TaskRunner` and is confirmed to exist in the shipped declarations,
   * so this needs no feature detection. Idempotent: a second unmount must not throw, and clearing
   * `landmarker` first means a concurrent `detect` sees `null` and reports no face rather than
   * calling into freed wasm memory.
   */
  stop(): void {
    const landmarker = this.landmarker
    this.landmarker = null
    this.lastTimestamp = -1
    if (!landmarker) return
    try {
      landmarker.close()
    } catch {
      /* Closing an already-closed landmarker throws on some builds. There is nothing to recover. */
    }
  }
}

function toLandmark(point: { x: number; y: number; z: number }): Landmark {
  return { x: point.x, y: point.y, z: point.z }
}

/**
 * A confidence proxy from the landmark spread.
 *
 * The Face Landmarker does not expose a per-face confidence score. What it does expose is `z`, and a
 * degenerate fit — the model locking onto a pattern on a wall, or a face turned nearly away — shows up
 * as landmarks that have collapsed in depth. This maps that to 0..1 so the tracking state machine has
 * something to threshold on.
 *
 * It is a proxy and is named one. It is never used to claim accuracy, only to decide whether to hold
 * the last known position or to stop drawing.
 */
function confidenceOf(landmarks: readonly { z: number }[]): number {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const point of landmarks) {
    if (point.z < min) min = point.z
    if (point.z > max) max = point.z
  }
  const spread = max - min
  if (!Number.isFinite(spread)) return 0
  /* A real face spans a few tenths in z. Below 0.02 the fit has collapsed; above 0.35 saturates. */
  return Math.min(1, Math.max(0, (spread - 0.02) / 0.33))
}
