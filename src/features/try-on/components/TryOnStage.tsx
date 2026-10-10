/**
 * The video and the overlay canvas, composited.
 *
 * The two elements are stacked and must agree on geometry exactly. The canvas is sized to the box the
 * video is laid out in, and the box itself is reshaped to the camera's own aspect ratio as soon as
 * metadata arrives — so `object-fit: cover` has nothing to crop and the video fills the box exactly.
 * That is what lets `core/coordinates.ts` keep the one-scale-both-axes contract and still land the
 * dots on the face rather than near it, at any window size.
 *
 * The canvas is scaled by `devicePixelRatio`. Drawing it at CSS resolution on a phone gives a 2× or
 * 3× display a visibly soft overlay, and since the browser upscales the whole canvas it is not a
 * subtle difference.
 *
 * **Mirroring is one flag with two consumers, and they must always agree.** Landmarks arrive in the
 * camera image's own coordinate space. A dot drawn at `x` lands on its feature only while the video
 * is drawn unflipped; put the dot at `width - x` and it lands on the opposite side. So `mirror` flips
 * *both* — the video via `scaleX(-1)` and the landmarks via `toCanvasPoint` — or neither. Flipping
 * only the landmarks, which this file used to do, does not produce a mirror preview; it produces an
 * overlay drawn on the wrong side of a face whose symmetry hides it, and, in Stage 2, an earring hung
 * on the wrong ear.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

import { Button } from '@/components/ui/Button'
import type { SessionError, SessionStatus } from '../hooks/useTryOnSession'

export interface TryOnStageProps {
  /* `RefObject<HTMLVideoElement>`, not `RefObject<HTMLVideoElement | null>` — in React 18's types
     `RefObject<T>` already means `{ readonly current: T | null }`, so adding `| null` inside the
     parameter makes `current` doubly nullable and stops the ref being assignable to a DOM node. */
  readonly videoRef: RefObject<HTMLVideoElement>
  readonly canvasRef: RefObject<HTMLCanvasElement>
  readonly status: SessionStatus
  readonly error: SessionError | null
  readonly onStart: () => void
  readonly isSupported: boolean
  /**
   * Mirror the preview, as a mirror would. Must be the same value the caller passes to its projection
   * maths — see the note at the top of this file for why the two cannot be allowed to differ.
   */
  readonly mirror?: boolean
  /** Rendered under the stage — the controls. */
  readonly children?: ReactNode
  /** An overlay drawn over the video, above the canvas. Used for the status chip. */
  readonly badge?: ReactNode
  /**
   * Remounts the canvas when it changes.
   *
   * A canvas has exactly one context for its lifetime: once `getContext('2d')` has been called on an
   * element, a later `getContext('webgl2')` on that same element returns `null`, and the piece simply
   * never appears with nothing said. So switching a stage between the flat and the 3D renderer has to
   * hand the new renderer a *new element*, and a React `key` is the shortest honest way to say that.
   *
   * Only the lab switches renderers mid-session; a product page's asset kind is fixed, and the key
   * never changes there.
   */
  readonly canvasKey?: string
}

export function TryOnStage({
  videoRef,
  canvasRef,
  status,
  error,
  onStart,
  isSupported,
  mirror = false,
  children,
  badge,
  canvasKey,
}: TryOnStageProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)

  /* Keep the canvas backing store matched to the box it is displayed in. A `ResizeObserver` rather
     than a window listener, because the box changes when the *layout* changes — a sidebar opening, a
     phone rotating, an error message appearing below — and none of those fire a window resize. */
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!container || !canvas || !video) return

    /* The box takes the camera's shape, so `object-fit: cover` never has anything to crop.
     *
     * A fixed 4:3 box in front of a 16:9 camera — which is what most phone front cameras deliver —
     * makes `cover` scale to fill the taller ratio and slice roughly a quarter off each side. The
     * sides of the frame are exactly where the ears are, and an earring try-on that crops the ears
     * off is broken by construction rather than by degree. Matching the box to the frame keeps the
     * `cover` transform in `core/coordinates.ts` an identity, which is the condition under which
     * "what the customer sees is what the canvas measures" is true rather than merely plausible.
     *
     * Until metadata arrives `videoWidth` is 0 and the inline style is cleared, leaving the CSS
     * `aspect-ratio` to shape the placeholder behind the curtain. */
    const adoptFrameSize = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const next = `${video.videoWidth} / ${video.videoHeight}`
        if (container.style.aspectRatio !== next) container.style.aspectRatio = next
      } else if (container.style.aspectRatio !== '') {
        container.style.aspectRatio = ''
      }
    }

    const resize = (): void => {
      adoptFrameSize()

      const ratio = Math.min(window.devicePixelRatio || 1, 3)
      const width = video.clientWidth || container.clientWidth
      const height = video.clientHeight || container.clientHeight
      if (width === 0 || height === 0) return

      const backingWidth = Math.round(width * ratio)
      const backingHeight = Math.round(height * ratio)
      /* Only touch the backing store when it actually changes: assigning to `canvas.width` clears the
         canvas and resets its context, and doing that every frame would flash. */
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    observer.observe(video)
    window.addEventListener('orientationchange', resize)
    /* Neither of these changes the layout, so the observer never sees them: `loadedmetadata` is when
       the camera's size first becomes known, and `emptied` is when a stopped stream takes it away. */
    video.addEventListener('loadedmetadata', adoptFrameSize)
    video.addEventListener('emptied', adoptFrameSize)

    return () => {
      observer.disconnect()
      window.removeEventListener('orientationchange', resize)
      video.removeEventListener('loadedmetadata', adoptFrameSize)
      video.removeEventListener('emptied', adoptFrameSize)
    }
  }, [canvasRef, videoRef])

  return (
    <div className="try-stage">
      <div className="try-stage__box" ref={containerRef}>
        <video
          ref={videoRef}
          className={mirror ? 'try-stage__video try-stage__video--mirrored' : 'try-stage__video'}
          playsInline
          muted
          autoPlay
          /* `aria-label` rather than a caption: a screen reader user needs to know what this is, and
             the honest description is the one the visible copy gives. */
          aria-label="Live camera preview for trying on jewellery"
        />
        {/* The `key` is what forces a fresh element when the renderer changes; see `canvasKey`. */}
        <canvas key={canvasKey} ref={canvasRef} className="try-stage__canvas" aria-hidden="true" />

        {badge ? <div className="try-stage__badge">{badge}</div> : null}

        {status === 'idle' ? (
          <div className="try-stage__curtain">
            <p className="try-stage__curtain-title">Try this piece on</p>
            <p className="try-stage__curtain-body">
              Your camera is used only on this device. Nothing is recorded, uploaded or stored.
            </p>
            {isSupported ? (
              <Button onClick={onStart} variant="primary">
                Start camera
              </Button>
            ) : (
              <p className="try-stage__curtain-body try-stage__curtain-body--warn">
                This browser cannot access the camera, or the page is not on a secure connection.
              </p>
            )}
          </div>
        ) : null}

        {status === 'starting' ? (
          <div className="try-stage__curtain">
            <p className="try-stage__curtain-title">Starting camera…</p>
            <p className="try-stage__curtain-body">
              Loading the face tracking model. This takes a moment the first time.
            </p>
          </div>
        ) : null}

        {status === 'error' && error ? (
          <div className="try-stage__curtain try-stage__curtain--error" role="alert">
            <p className="try-stage__curtain-title">Camera unavailable</p>
            <p className="try-stage__curtain-body">{error.message}</p>
            {error.retryable ? (
              <Button onClick={onStart} variant="primary">
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {children ? <div className="try-stage__controls">{children}</div> : null}
    </div>
  )
}
