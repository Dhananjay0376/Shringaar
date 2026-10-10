/**
 * The one hook that owns a try-on session: camera, tracker, loop, and the teardown of all three.
 *
 * Two decisions shape it.
 *
 * **The latest frame is a ref, not state.** A detection arrives 30–60 times a second. Pushing each
 * one through `useState` would re-render the whole subtree sixty times a second, which costs more
 * than the model does and makes the fps counter measure React rather than tracking. The frame goes
 * into a ref, and the consumer draws from it imperatively — a canvas draw is not a React render.
 * Anything genuinely rare (the tracking status, a closed fps window, an error) *is* state, because
 * those change a handful of times per second at most and the UI has to reflect them.
 *
 * **Start is explicit; only teardown is automatic.** Opening the camera is a permission prompt and a
 * camera light, so it happens when the customer asks for it, never on mount. Teardown, by contrast,
 * must be automatic and must survive `<StrictMode>` mounting every effect twice — hence the ref-held
 * session and the idempotent stop.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import {
  DEFAULT_TRACKING_CONFIG,
  isRenderable,
  type TrackingStatus,
  type TrackerFrame,
} from '../types/frame'
import {
  INITIAL_TRACKING_STATE,
  nextTrackingStatus,
  resetTracking,
  type TrackingState,
} from '../core/trackingState'
import {
  CameraError,
  hasCameraSupport,
  listCameras,
  openCamera,
  stopCamera,
  type CameraDevice,
} from '../tracking/camera'
import { FaceLandmarkerTracker } from '../tracking/faceLandmarker'
import {
  INITIAL_LOOP_STATS,
  createDetectionLoop,
  type DetectionLoop,
  type LoopStats,
} from '../tracking/loop'
import type { LandmarkTracker } from '../tracking/types'

export type SessionStatus = 'idle' | 'starting' | 'running' | 'error'

export interface SessionError {
  readonly message: string
  /** Whether "Try again" is worth offering. A denied permission is retryable; no camera is not. */
  readonly retryable: boolean
}

export interface TryOnSessionOptions {
  /**
   * Called once per new video frame, after detection. `frame` is `null` when no face was found, which
   * is a normal state and the reason the consumer must handle it rather than assume landmarks exist.
   */
  onFrame?(frame: TrackerFrame | null, status: TrackingStatus): void
  /** Called when a frame threw inside the tracker. The loop keeps running. */
  onError?(error: unknown): void
}

export interface TryOnSession {
  readonly status: SessionStatus
  readonly error: SessionError | null
  readonly stats: LoopStats
  readonly trackingStatus: TrackingStatus
  /** Mirrors `trackingStatus` for the render path. False when nothing should be drawn. */
  readonly renderable: boolean
  readonly cameras: readonly CameraDevice[]
  /**
   * The latest detection, or `null`. A ref on purpose: reading it does not re-render, and the
   * overlay draws from it once per frame.
   *
   * Typed `RefObject<TrackerFrame>` rather than `RefObject<TrackerFrame | null>`: React 18's
   * `RefObject<T>` is already `{ readonly current: T | null }`.
   */
  readonly frameRef: RefObject<TrackerFrame>
  /**
   * Attach to the `<video>` element. The stage spreads this on its node; the hook does everything
   * else, so there is exactly one way the element and the session become connected.
   */
  readonly videoRef: RefObject<HTMLVideoElement>
  readonly isSupported: boolean
  start(): Promise<void>
  stop(): void
  /** Switches camera and restarts. A no-op while idle, where there is no session to move. */
  selectCamera(deviceId: string): Promise<void>
}

/** How often the fps readout is allowed to reach React. Four times a second is legible and cheap. */
const STATS_INTERVAL_MS = 250

export function useTryOnSession(options: TryOnSessionOptions = {}): TryOnSession {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const frameRef = useRef<TrackerFrame | null>(null)

  const [status, setStatus] = useState<SessionStatus>('idle')
  const [error, setError] = useState<SessionError | null>(null)
  const [stats, setStats] = useState<LoopStats>(INITIAL_LOOP_STATS)
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('idle')
  const [cameras, setCameras] = useState<readonly CameraDevice[]>([])

  /* Everything mutable and un-rendered lives here, in one object so the pieces cannot get out of step
     with each other — and so a StrictMode double mount cannot produce two half-initialised sessions. */
  const sessionRef = useRef<{
    stream: MediaStream | null
    tracker: LandmarkTracker | null
    loop: DetectionLoop | null
    tracking: TrackingState
    lastStatsAt: number
  }>({ stream: null, tracker: null, loop: null, tracking: INITIAL_TRACKING_STATE, lastStatsAt: 0 })

  /* Read through a ref so `start` and the loop callbacks never need rebuilding. An inline arrow
     passed as `onFrame` has a new identity on every render, so capturing it directly would make
     `start` depend on it and tear the loop down continuously. */
  const callbacksRef = useRef(options)
  useEffect(() => {
    callbacksRef.current = options
  }, [options])

  const isSupported = hasCameraSupport()

  /**
   * Releases everything. Loop first, so nothing calls into the model while it is being closed;
   * camera last, so a throw above cannot leave the light on.
   */
  const stop = useCallback((): void => {
    const session = sessionRef.current
    session.loop?.stop()
    session.loop = null
    session.tracker?.stop()
    session.tracker = null
    stopCamera(session.stream)
    session.stream = null
    if (videoRef.current) videoRef.current.srcObject = null
    session.tracking = resetTracking()
    frameRef.current = null
    /* Tells the consumer the frame is gone, so whatever was drawn from it is cleared. The loop has
       already stopped, so nothing else will redraw: without this the last frame's overlay stays
       painted on the canvas after Stop — faintly visible behind the curtain, and stale the moment
       the camera restarts at a different size. */
    callbacksRef.current.onFrame?.(null, 'idle')
    setTrackingStatus('idle')
    setStats(INITIAL_LOOP_STATS)
    setStatus('idle')
  }, [])

  const startWithDevice = useCallback(
    async (deviceId: string | undefined): Promise<void> => {
      /* Guards a double click and StrictMode's second mount. A second `getUserMedia` for the same
         device fails outright on several platforms because the first still holds it. */
      if (sessionRef.current.tracker || sessionRef.current.stream) return

      const video = videoRef.current
      if (!video) {
        setError({ message: 'The video preview is not ready yet. Try again in a moment.', retryable: true })
        setStatus('error')
        return
      }

      setStatus('starting')
      setError(null)

      try {
        const stream = await openCamera(video, deviceId ? { deviceId } : {})
        sessionRef.current.stream = stream

        /* Populated only now: before permission the labels are blank strings, so a picker built
           earlier would be a list of unnamed devices. */
        setCameras(await listCameras())

        const tracker = new FaceLandmarkerTracker(video)
        sessionRef.current.tracker = tracker
        await tracker.start()

        /* A `stop()` during the awaits above — the customer navigating away mid-load — leaves nothing
           to start, and without this check the loop would be created against a released camera. */
        if (sessionRef.current.tracker !== tracker) return

        sessionRef.current.tracking = INITIAL_TRACKING_STATE
        sessionRef.current.loop = createDetectionLoop(video, {
          onFrame: (timestampMs) => {
            const session = sessionRef.current
            const detected = session.tracker?.detect(timestampMs) ?? null
            frameRef.current = detected

            /* `seen` drives the state machine, and a detection counts as having seen the customer even
               if it cannot be drawn — so the status does not flap when the face is present but the
               frame is unusable. */
            session.tracking = nextTrackingStatus(session.tracking, detected !== null, DEFAULT_TRACKING_CONFIG)
            const next = session.tracking.status

            /* Compared before setting: this runs per frame, and setting state unconditionally would
               re-render sixty times a second for a value that changes a few times a minute. */
            setTrackingStatus((previous) => (previous === next ? previous : next))

            callbacksRef.current.onFrame?.(detected, next)
          },
          onStats: (next) => {
            const now = performance.now()
            if (now - sessionRef.current.lastStatsAt < STATS_INTERVAL_MS) return
            sessionRef.current.lastStatsAt = now
            setStats(next)
          },
          onError: (cause) => {
            callbacksRef.current.onError?.(cause)
          },
        })

        sessionRef.current.loop.start()
        setStatus('running')
      } catch (cause) {
        /* The camera may be open even though the model failed — `openCamera` succeeded and something
           after it threw. Everything is released before reporting, so a failed start never leaves the
           camera light on. */
        stop()
        setError(toSessionError(cause))
        setStatus('error')
      }
    },
    [stop],
  )

  /** The plain "start with the default camera" entry point. */
  const start = useCallback((): Promise<void> => startWithDevice(undefined), [startWithDevice])

  const selectCamera = useCallback(
    async (deviceId: string): Promise<void> => {
      if (status !== 'running') return
      stop()
      await startWithDevice(deviceId)
    },
    [startWithDevice, status, stop],
  )

  /* The only automatic teardown, and it must hold under StrictMode: the effect runs, cleans up, and
     runs again on mount in development. `stop` is idempotent and every field is null-checked, so the
     second pass is harmless — and a regression here shows up as a camera light that stays on after
     leaving the page. */
  useEffect(() => stop, [stop])

  return {
    status,
    error,
    stats,
    trackingStatus,
    renderable: isRenderable(trackingStatus),
    cameras,
    frameRef,
    videoRef,
    isSupported,
    start,
    stop,
    selectCamera,
  }
}

function toSessionError(cause: unknown): SessionError {
  if (cause instanceof CameraError) return { message: cause.message, retryable: cause.retryable }
  if (cause instanceof Error) return { message: cause.message, retryable: true }
  return { message: 'Try-on could not be started. Try again.', retryable: true }
}
