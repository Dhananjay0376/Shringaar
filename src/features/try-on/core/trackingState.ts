/**
 * The tracking lifecycle, as a pure reducer.
 *
 * This is a small state machine and it is pure for one reason: the failure it guards against is
 * about *timing*, and timing bugs are the ones that only reproduce on a real camera at a real frame
 * rate. A reducer can be stepped a thousand frames in a millisecond and asserted on, which is not
 * true of anything that reads a live video element.
 *
 * The distinction that matters: a **detection** is a frame the model returned landmarks for; it is
 * not the same as a **trusted position**. One frame of landmarks can be a spurious fit on a hand, a
 * wall or a poster, and drawing an earring on a wall for one frame is more unsettling than not
 * drawing it at all. So a run of `acquireFrames` detections is required before anything is trusted.
 *
 * The reverse asymmetry is deliberate too: a single *miss* does not drop the lock. Blinks, a hand
 * crossing the face and momentary confidence dips are constant, and tearing the earring off screen
 * for one frame is far more visible than leaving it where it was for a sixteenth of a second.
 */

import {
  DEFAULT_TRACKING_CONFIG,
  isRenderable,
  type TrackingConfig,
  type TrackingStatus,
} from '../types/frame'

export interface TrackingState {
  readonly status: TrackingStatus
  /** Consecutive detections seen so far while acquiring. */
  readonly hits: number
  /** Consecutive misses seen so far since the last detection. */
  readonly misses: number
}

export const INITIAL_TRACKING_STATE: TrackingState = { status: 'idle', hits: 0, misses: 0 }

/**
 * One frame.
 *
 * `seen` is whether the tracker returned landmarks this frame — nothing more. Confidence is applied
 * by the caller before this point (a frame below the confidence floor arrives here as `seen: false`),
 * so this machine has exactly one input and one meaning for it.
 */
export function nextTrackingStatus(
  previous: TrackingState,
  seen: boolean,
  config: TrackingConfig = DEFAULT_TRACKING_CONFIG,
): TrackingState {
  if (seen) {
    /* Recovering from `holding` or `lost` goes straight back to tracking rather than restarting the
       acquisition run. The position was trusted a moment ago and the frame is good now; making the
       customer hold still again after every blink would look like the app had forgotten them. */
    if (previous.status === 'tracking' || previous.status === 'holding') {
      return { status: 'tracking', hits: config.acquireFrames, misses: 0 }
    }

    const hits = previous.status === 'acquiring' ? previous.hits + 1 : 1
    return hits >= config.acquireFrames
      ? { status: 'tracking', hits: config.acquireFrames, misses: 0 }
      : { status: 'acquiring', hits, misses: 0 }
  }

  switch (previous.status) {
    case 'idle':
      return INITIAL_TRACKING_STATE

    /* A miss while acquiring resets the run but does not fall back to `idle`. We have glimpsed
       something; `idle` would say we have not, and the two want different words on screen. */
    case 'acquiring':
      return { status: 'acquiring', hits: 0, misses: previous.misses + 1 }

    case 'tracking':
    case 'holding': {
      const misses = previous.misses + 1
      return misses >= config.holdFrames
        ? { status: 'lost', hits: 0, misses: config.holdFrames }
        : { status: 'holding', hits: previous.hits, misses }
    }

    case 'lost':
      return previous
  }
}

/** Whether this state is allowed to put something on screen. */
export function isTrackingRenderable(state: TrackingState): boolean {
  return isRenderable(state.status)
}

/** Back to the start. Called when the camera stops, so a restart does not resume a stale lock. */
export function resetTracking(): TrackingState {
  return INITIAL_TRACKING_STATE
}
