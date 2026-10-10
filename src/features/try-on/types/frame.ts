/**
 * The vocabulary the try-on engine speaks.
 *
 * Two rules shape this file. Everything here is plain data — no DOM types, no MediaPipe types — so
 * the whole engine core can be tested without a browser. And nothing here replaces a vocabulary that
 * already exists: categories, try-on kinds and anchors all come from `@/lib/catalog`, because a
 * second list of categories is a second list to keep in sync.
 */

/** A single landmark, normalised to 0..1 against the tracked frame. */
export interface Landmark {
  readonly x: number
  readonly y: number
  /** Depth, roughly in the same scale as `x`. Relative, not metric. */
  readonly z: number
}

/**
 * Which model produced a frame.
 *
 * Only `face` has an implementation. `hand` and `pose` exist so the tracker interface is honest
 * about what the category system will eventually need — but nothing constructs them, because a stub
 * adapter that returns `{ hands: [] }` would be a file that pretends. See `anchors/registry.ts`.
 */
export type TrackerKind = 'face' | 'hand' | 'pose'

/** One detection result, or `null` from `LandmarkTracker.detect` when there was no subject. */
export interface TrackerFrame {
  readonly kind: TrackerKind
  /** Normalised landmarks in the model's own index order (478 for the face mesh). */
  readonly landmarks: readonly Landmark[]
  /** 0..1. How much the tracker trusts this frame. */
  readonly confidence: number
  /** `performance.now()` at detection. */
  readonly at: number
}

/**
 * The tracking lifecycle, as a state a UI can render.
 *
 * `holding` is the important one: a single dropped frame is extremely common (a blink, a hand
 * passing over the face, a momentary confidence dip) and tearing the earring off the screen for one
 * frame is far more noticeable than leaving it where it was. So a miss moves to `holding`, which
 * still draws, and only a sustained run of misses reaches `lost`, which does not.
 */
export type TrackingStatus = 'idle' | 'acquiring' | 'tracking' | 'holding' | 'lost'

/** Which statuses are allowed to put something on screen. */
export const RENDERABLE_STATUSES: readonly TrackingStatus[] = ['tracking', 'holding']

export function isRenderable(status: TrackingStatus): boolean {
  return RENDERABLE_STATUSES.includes(status)
}

export interface TrackingConfig {
  /** Consecutive detections required before a position is trusted. */
  readonly acquireFrames: number
  /** Consecutive misses tolerated before drawing stops. */
  readonly holdFrames: number
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  /* Three, not one. A single-frame detection can be a spurious fit on a hand or a wall; requiring
     three in a row costs 50ms at 60fps and removes almost all of that class of flicker. */
  acquireFrames: 3,
  /* Ten frames — a sixth of a second — before the earring disappears. Long enough to ride out a
     blink, short enough that walking out of frame still feels immediate. */
  holdFrames: 10,
}

/** Which of the two face-oval sides a target belongs to. */
export type EarSide = 'left' | 'right'

/**
 * One earring, positioned and sized for the renderer.
 *
 * All lengths are in **canvas pixels** — already through the video→canvas transform and already
 * mirrored if the view is mirrored. The renderer does no geometry of its own; it draws what it is
 * given. That keeps every coordinate decision in one testable place.
 */
export interface PlacementTarget {
  readonly side: EarSide
  /** Canvas px of the point the asset hangs from — the top-centre of its drawn box. */
  readonly x: number
  readonly y: number
  /** Drawn width in canvas px. Height follows from the asset's own aspect ratio. */
  readonly width: number
  /** Head roll, in radians. */
  readonly rotation: number
  /** Horizontal scale for head yaw, 0.45..1. Head-on is 1. */
  readonly squash: number
  /** 0..1. The renderer skips anything at or below `MIN_DRAW_OPACITY`. */
  readonly opacity: number
}

/** Below this the target is not drawn at all, rather than drawn wrongly. */
export const MIN_DRAW_OPACITY = 0.05

/**
 * Whether a target is worth drawing at all — shared by both renderers rather than written twice.
 *
 * The rule it encodes is a decision, not arithmetic: the solver already computes an opacity that fades
 * a badly-turned earring out, and this is where "faded far enough" becomes "not drawn". Two copies of
 * that decision would be two chances for the flat and 3D paths to disagree about which pieces exist,
 * and the disagreement would be invisible until someone compared them side by side.
 *
 * The threshold is "at or below", matching `MIN_DRAW_OPACITY`'s own documentation.
 */
export function isDrawableTarget(target: PlacementTarget): boolean {
  return target.width > 0 && target.opacity > MIN_DRAW_OPACITY
}
