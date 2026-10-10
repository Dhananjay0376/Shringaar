/**
 * The camera, and every way it can fail in words a shopper can act on.
 *
 * The failure modes are the point of this file. `getUserMedia` rejects with a `DOMException` whose
 * `name` distinguishes "you clicked Block" from "no camera is attached" from "another app has it",
 * and those need three different sentences — a single "camera unavailable" would leave someone
 * clicking a permission button that is not the problem. Getting this wrong is the most common way a
 * try-on feature fails in the field, so each name maps to its own message.
 *
 * All of it is requested on demand. There is no enumeration at page load, because on several browsers
 * merely calling `enumerateDevices()` before permission is granted returns devices with blank labels —
 * and asking for the camera before the customer clicks *Try it on* is how a page earns a reputation.
 */

/** Target capture size. 640×480 is enough for 478 landmarks and cheap enough to run every frame. */
const IDEAL_WIDTH = 640
const IDEAL_HEIGHT = 480

export class CameraError extends Error {
  /** Whether a retry could plausibly succeed. Drives whether the UI offers a "Try again" button. */
  readonly retryable: boolean

  constructor(message: string, retryable: boolean, readonly cause?: unknown) {
    super(message)
    this.name = 'CameraError'
    this.retryable = retryable
  }
}

/**
 * Turns a `getUserMedia` rejection into something worth showing.
 *
 * Every branch names a *next action* rather than a cause, because "NotAllowedError" tells a shopper
 * nothing they can use.
 */
export function describeCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error

  const name = error instanceof DOMException ? error.name : ''

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new CameraError(
        'Camera access was blocked. Allow camera access for this site in your browser settings, then try again.',
        true,
        error,
      )
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError(
        'No camera was found on this device. Try-on needs a camera to place jewellery on you.',
        false,
        error,
      )
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError(
        'The camera is already in use by another app. Close the other app and try again.',
        true,
        error,
      )
    case 'OverconstrainedError':
      return new CameraError(
        'This camera does not support the settings try-on needs. Try a different camera.',
        true,
        error,
      )
    case 'SecurityError':
      return new CameraError(
        'The browser blocked camera access on this page. Try-on needs a secure (https) connection.',
        false,
        error,
      )
    default:
      /* Includes the case where `navigator.mediaDevices` is missing entirely — an insecure origin or
         a browser without support, which is a real possibility this must not crash on. */
      if (!hasCameraSupport()) {
        return new CameraError(
          'This browser cannot access the camera, or the page is not on a secure connection. Try-on needs both.',
          false,
          error,
        )
      }
      return new CameraError('The camera could not be started. Try again.', true, error)
  }
}

export function hasCameraSupport(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

export interface OpenCameraOptions {
  /** A specific `deviceId`, or omitted for the default — which is the selfie camera on a phone. */
  readonly deviceId?: string
  /**
   * Preferred facing. Ignored when `deviceId` is given, because a specific device is a stronger
   * statement of intent than a preference, and honouring both would silently ignore the choice the
   * customer just made in the device picker.
   */
  readonly facingMode?: 'user' | 'environment'
}

/** Builds the constraints for a request, preferring the exact device when one is named. */
function videoConstraints(options: OpenCameraOptions): MediaTrackConstraints {
  const size = { width: { ideal: IDEAL_WIDTH }, height: { ideal: IDEAL_HEIGHT } }
  if (options.deviceId) {
    /* `exact` because the caller picked this device from a list they can see. A `ideal` hint would
       let the browser quietly hand back a different camera and make the picker look broken. */
    return { deviceId: { exact: options.deviceId }, ...size }
  }
  return { facingMode: options.facingMode ?? 'user', ...size }
}

/**
 * Opens the camera and attaches it to a video element, resolving once there is a frame to draw.
 *
 * Resolving on `play()` rather than on `getUserMedia` matters: the stream can exist while the element
 * has no dimensions yet, and starting the detection loop against a 0×0 video throws inside MediaPipe
 * with a message that says nothing useful.
 */
export async function openCamera(
  video: HTMLVideoElement,
  options: OpenCameraOptions = {},
): Promise<MediaStream> {
  if (!hasCameraSupport()) {
    throw describeCameraError(undefined)
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(options),
      audio: false,
    })
  } catch (error) {
    throw describeCameraError(error)
  }

  try {
    video.srcObject = stream
    /* Set here rather than relying on the JSX attributes, because a stream attached to an element
       that is not muted will be refused autoplay by every mobile browser. */
    video.muted = true
    video.playsInline = true

    await waitForMetadata(video)
    await video.play()
  } catch (error) {
    /* The stream is already open at this point. Leaving it live would hold the camera light on with
       nothing on screen — the worst of both. */
    stopCamera(stream)
    throw new CameraError('The camera started but the video could not be displayed. Try again.', true, error)
  }

  return stream
}

/**
 * Waits until the element knows the video's dimensions.
 *
 * Checks `readyState` first: when a stream is attached to an element that has *already* loaded, the
 * `loadedmetadata` event has fired and will never fire again, so listening alone would hang forever.
 * This is the usual cause of a try-on screen that sits on "Starting camera…" after the second start.
 */
function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
    }
    const onLoaded = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(new Error('The video element reported an error before any frame arrived.'))
    }
    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('error', onError)
  })
}

/**
 * Releases every track.
 *
 * Stopping the tracks is what turns the camera indicator off; clearing `srcObject` alone leaves the
 * device open. Both are done, and both are guarded, because this runs from an unmount path where
 * throwing would take the whole page down with it.
 */
export function stopCamera(stream: MediaStream | null | undefined): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {
      /* A track that is already ended throws on some browsers. Nothing left to release. */
    }
  }
}

export interface CameraDevice {
  readonly deviceId: string
  readonly label: string
}

/**
 * The cameras available, for the device picker.
 *
 * Labelled devices appear only after permission has been granted at least once; before that the
 * labels are empty strings, and this fills in a positional name so the list is usable rather than a
 * column of blanks. Returns an empty list rather than throwing when enumeration is unavailable — a
 * missing picker is a smaller problem than a broken page.
 */
export async function listCameras(): Promise<CameraDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return []

  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }))
  } catch {
    return []
  }
}

/** Detaches the stream from an element without stopping it, for swapping between cameras. */
export function detachVideo(video: HTMLVideoElement | null | undefined): void {
  if (video) video.srcObject = null
}
