/**
 * The detection loop.
 *
 * One `requestAnimationFrame` cycle that calls the tracker once per *new video frame*, not once per
 * animation frame. Those are not the same number: a 30fps camera on a 120Hz display would otherwise
 * run the model four times per new picture, which costs four times the CPU for zero extra accuracy —
 * and, because MediaPipe throws on a repeated timestamp, would have to be guarded anyway.
 *
 * The guard is `video.currentTime`: it advances only when a new frame is decoded, so comparing it to
 * the last value we detected on is exactly "is there new pixels to look at". This is MediaPipe's own
 * documented pattern, and it is the reason the timestamp and the frame check are separate concerns.
 *
 * The clock is `performance.now()`, read once per iteration. It is monotonic, so the strictly-
 * increasing rule the model imposes is satisfied by construction rather than by luck — `Date.now()`
 * would go backwards over an NTP correction and throw mid-session.
 */

export interface LoopStats {
  /** Frames per second actually detected, measured over a rolling window. */
  readonly fps: number
  /** `performance.now()` of the last detection. */
  readonly lastAt: number
  /** Milliseconds the last detection took. A number to watch when the model is the bottleneck. */
  readonly lastDetectMs: number
  /** Detections skipped because the video had not produced a new frame. */
  readonly skipped: number
}

export const INITIAL_LOOP_STATS: LoopStats = { fps: 0, lastAt: 0, lastDetectMs: 0, skipped: 0 }

export interface LoopCallbacks {
  /**
   * Called once per new video frame. `timestampMs` comes from one monotonic clock and always
   * increases, so it can be handed straight to the model.
   */
  onFrame(timestampMs: number): void
  /** Called every iteration with current stats, including iterations skipped for a stale video. */
  onStats(stats: LoopStats): void
  /** Called when a frame threw. The loop keeps running unless `stop` is returned. */
  onError?(error: unknown): void
}

export interface DetectionLoop {
  /** Begins scheduling. Idempotent: a second call while running does nothing. */
  start(): void
  /** Cancels the pending frame. Idempotent. */
  stop(): void
  readonly running: boolean
}

/**
 * How many detections the fps reading averages over.
 *
 * A single-frame `1/dt` reading is useless — it swings between 8 and 400 on any real machine because
 * a rAF callback can be delayed by a garbage collection. Averaging over a second of frames reports
 * something a person can read and a regression can be measured against.
 */
const FPS_WINDOW = 30

export function createDetectionLoop(
  video: HTMLVideoElement,
  callbacks: LoopCallbacks,
): DetectionLoop {
  let handle: number | null = null
  let lastVideoTime = -1
  let stats = INITIAL_LOOP_STATS
  /* The window is kept as two sums over the last FPS_WINDOW detections rather than a queue of
     timestamps: constant memory, and the division happens once per report. */
  let windowMs = 0
  let windowCount = 0
  let windowStart = 0

  const tick = (): void => {
    handle = requestAnimationFrame(tick)

    const currentTime = video.currentTime
    if (currentTime === lastVideoTime) {
      stats = { ...stats, skipped: stats.skipped + 1 }
      callbacks.onStats(stats)
      return
    }
    lastVideoTime = currentTime

    const timestampMs = performance.now()
    const startedAt = timestampMs

    try {
      callbacks.onFrame(timestampMs)
    } catch (error) {
      callbacks.onError?.(error)
    }

    const elapsed = performance.now() - startedAt
    if (windowCount === 0) windowStart = startedAt
    windowMs = startedAt - windowStart
    windowCount += 1

    /* Closes the window once it holds a full second of detections, then restarts it. Reporting only
       on a closed window is what stops the displayed number flickering. */
    if (windowCount >= FPS_WINDOW) {
      const seconds = windowMs / 1000
      stats = {
        fps: seconds > 0 ? ((windowCount - 1) / seconds) : 0,
        lastAt: timestampMs,
        lastDetectMs: elapsed,
        skipped: stats.skipped,
      }
      windowMs = 0
      windowCount = 0
      callbacks.onStats(stats)
      return
    }

    /* Between window closes the fps figure is carried over unchanged rather than recomputed from a
       partial window, which would report a low number for the first few frames of every second. */
    stats = { ...stats, lastAt: timestampMs, lastDetectMs: elapsed }
    callbacks.onStats(stats)
  }

  return {
    start(): void {
      if (handle !== null) return
      /* Reset per run, so a stop/start cycle does not measure across the gap — which would report the
         time spent stopped as an enormous frame time and a near-zero fps. */
      lastVideoTime = -1
      windowMs = 0
      windowCount = 0
      stats = INITIAL_LOOP_STATS
      handle = requestAnimationFrame(tick)
    },
    stop(): void {
      if (handle === null) return
      cancelAnimationFrame(handle)
      handle = null
    },
    get running(): boolean {
      return handle !== null
    },
  }
}
