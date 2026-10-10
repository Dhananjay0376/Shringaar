/**
 * The tracker contract.
 *
 * An interface with one implementation. `hand` and `pose` are named in `TrackerKind` because the
 * category system will need them, but there is deliberately **no stub adapter** — a
 * `HandTracker` that returns an empty array is a file that pretends to work, and the honest statement
 * of "not built" is a missing entry in `anchors/registry.ts`, which the UI reports as such.
 *
 * The interface is shaped so the work can move off the main thread later without changing callers:
 * `detect` takes a timestamp rather than reading a clock, and returns a value rather than emitting
 * one. That means a worker-backed implementation is a drop-in, not a refactor.
 */

import type { TrackerFrame, TrackerKind } from '../types/frame'

export interface LandmarkTracker {
  readonly kind: TrackerKind
  /**
   * Loads the model and prepares for detection. Safe to call twice: the second call is a no-op,
   * because `<StrictMode>` in development runs effects twice and a second model load would mean two
   * landmarkers competing for the GPU.
   */
  start(): Promise<void>
  /**
   * Detects in the current video frame.
   *
   * `null` means "no subject this frame", which is a normal state and not an error — the caller
   * distinguishes it from a thrown failure. `timestampMs` must increase strictly across calls; the
   * model throws on a repeated or decreasing timestamp, so the caller owns that monotonicity.
   */
  detect(timestampMs: number): TrackerFrame | null
  /** Releases the model. Idempotent, so a double-unmount in development cannot throw. */
  stop(): void
}

/**
 * A failure that the UI should show verbatim.
 *
 * Distinct from a generic `Error` because the messages here are written for a shopper — "your browser
 * blocked the camera" — and are meant to be rendered, not logged.
 */
export class TrackerError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'TrackerError'
  }
}
