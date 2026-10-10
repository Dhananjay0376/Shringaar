/**
 * Where the MediaPipe runtime and model come from, and the one place they are loaded.
 *
 * Both URLs are constants here rather than scattered through the adapter so that moving to
 * self-hosted assets later is a two-line change. That matters more than it looks: `@mediapipe/tasks-
 * vision` **already ships the wasm files** in `node_modules/@mediapipe/tasks-vision/wasm/`, so
 * vendoring is genuinely available rather than hypothetical. It is not done here because the CDN
 * keeps the deployed bundle smaller and the version pin makes the two ends agree — see below.
 *
 * The version pin is exact (`1.1.0`, no caret) and appears in both URLs on purpose. The JS loader and
 * the wasm binary are a matched pair: a loader from one release driving another release's wasm fails
 * in ways that surface as an opaque "failed to asynchronously prepare wasm", so they are pinned
 * together and any upgrade is deliberate rather than a floating-range surprise.
 */

import { TrackerError } from './types'
import type { FaceLandmarker } from '@mediapipe/tasks-vision'

/** Must match the installed `@mediapipe/tasks-vision` version exactly. */
export const MEDIAPIPE_VERSION = '1.1.0'

export const MEDIAPIPE_WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`

/**
 * The float16 face landmark model: 478 points plus blendshapes, about 3.7 MB.
 *
 * Google's own model host, so it is served with the CORS headers the wasm loader needs. The float16
 * variant is chosen over float32 deliberately — the accuracy difference does not survive the
 * landmark noise floor at webcam resolution, and the download is a third smaller.
 */
export const FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/**
 * The in-flight load, so concurrent callers share one.
 *
 * This is the load-bearing part of the file. `<StrictMode>` mounts every effect twice in development,
 * and without a shared promise that means two `createFromOptions` calls, two wasm instantiations and
 * two models resident — which shows up as doubled memory and a visibly slow first frame, and is
 * exactly the kind of thing that only appears in dev and gets shipped.
 *
 * A rejected load is not cached: the promise is cleared in `finally` so a transient network failure
 * can be retried by the next attempt rather than poisoning every future call with the first error.
 */
let inFlight: Promise<FaceLandmarker> | null = null

/**
 * Loads the model, or returns the one already loaded.
 *
 * `numFaces: 1` is not just a performance choice: MediaPipe applies its own temporal smoothing to the
 * landmarks **only** when exactly one face is requested. With `numFaces > 1` that smoothing is
 * disabled and the raw per-frame jitter is larger, which the One Euro filter downstream would then
 * have to absorb on its own.
 *
 * Blendshapes and the facial transformation matrix are both off. Neither is read by anything here,
 * and each adds per-frame work plus output allocation.
 */
export async function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (inFlight) return inFlight

  inFlight = (async () => {
    /* Imported dynamically, and that is load-bearing rather than stylistic. A static import puts the
       whole tasks-vision runtime — roughly 160 kB, most of it the wasm bindings — into the entry
       chunk, which means every seller browsing their dashboard downloads a face tracker they will
       never use. Measured: static import took the entry chunk from 666 kB to 830 kB.

       Type-only imports are erased at compile time, so the `FaceLandmarker` type above costs nothing
       at runtime. This is the one place the library is ever pulled in. */
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')

    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT)
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL_URL,
        /* CPU, not GPU. The GPU delegate needs a WebGL context bound to a canvas, and it competes
           with the Three.js renderer for the same context on the 3D path. At 640×480 the CPU
           delegate holds frame rate comfortably, and it removes a whole class of context conflicts. */
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    })
  })()

  try {
    return await inFlight
  } catch (cause) {
    /* Written for the person reading it in a browser, because that is where this lands: a blocked
       CDN, an offline device, or a corporate proxy that strips the wasm MIME type. */
    throw new TrackerError(
      'The face tracking model could not be loaded. Check your connection and reload the page.',
      cause,
    )
  } finally {
    /* Cleared either way. On success the shared promise has done its job and a later `stop()` →
       `start()` cycle should build a fresh landmarker; on failure this is what allows a retry. */
    inFlight = null
  }
}

/**
 * The model's landmark count, asserted rather than assumed.
 *
 * `core/landmarks.ts` indexes up to 477. If a future model revision returned fewer points, every
 * index past the end would read `undefined` and `buildFaceFrame` would silently report "no face" for
 * every frame — a total failure with no error anywhere. This turns that into one loud message.
 */
export const EXPECTED_LANDMARK_COUNT = 478

export function assertLandmarkCount(count: number): void {
  if (count !== EXPECTED_LANDMARK_COUNT) {
    throw new TrackerError(
      `The face tracking model returned ${count} landmarks, but ${EXPECTED_LANDMARK_COUNT} are expected. Try-on cannot place jewellery accurately with this model.`,
    )
  }
}
