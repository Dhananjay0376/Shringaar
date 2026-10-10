/**
 * The landmark overlay — the reason Stage 1 exists.
 *
 * Building the earring solver against documented landmark indices would be guessing. This draws the
 * mesh over a real face so the indices in `core/landmarks.ts` can be *looked at*: the two ruler
 * points, the two ear clusters and the two jaw groups each get their own colour and label, so a
 * wrong index is visible immediately as a dot in the wrong place rather than as an earring on a
 * forehead three stages later.
 *
 * It draws nothing the solver does not read. Drawing all 478 points and a hairline mesh is more
 * impressive and less useful: the question is never "is the model running" — it is "is index 234
 * where I think it is", and that is answered by showing exactly the points that claim to matter.
 */

import { computeViewTransform, toCanvasPoint, type Fit, type Size } from '../core/coordinates'
import { vec2, type Vec2 } from '../core/geometry'
import { FACE_LANDMARKS } from '../core/landmarks'
import type { Landmark, TrackerFrame } from '../types/frame'

export interface OverlayGroup {
  readonly label: string
  readonly colour: string
  readonly indices: readonly number[]
}

/**
 * The groups, coloured to match their role in the solver.
 *
 * The A/B split is shown rather than the anatomical names, because the A/B split is the honest
 * description: the model does not know which side of the mesh is the subject's left, and neither do
 * we until the projection says which side of the screen each landed on.
 */
export const OVERLAY_GROUPS: readonly OverlayGroup[] = [
  { label: 'ruler A (33)', colour: '#22d3ee', indices: [FACE_LANDMARKS.rulerA] },
  { label: 'ruler B (263)', colour: '#22d3ee', indices: [FACE_LANDMARKS.rulerB] },
  { label: 'cluster A', colour: '#f472b6', indices: FACE_LANDMARKS.clusterA },
  { label: 'cluster B', colour: '#fb923c', indices: FACE_LANDMARKS.clusterB },
  { label: 'jaw A', colour: '#a78bfa', indices: FACE_LANDMARKS.jawA },
  { label: 'jaw B', colour: '#4ade80', indices: FACE_LANDMARKS.jawB },
]

/** Every index the overlay draws, for a quick completeness check in the lab. */
export const OVERLAY_INDICES: readonly number[] = OVERLAY_GROUPS.flatMap((group) => group.indices)

export interface OverlayOptions {
  /** The tracked frame's own size — whatever the camera delivered, typically 640×480. */
  readonly video: Size
  /** The canvas box in CSS px: the same rectangle the `<video>` is laid out in. */
  readonly box: Size
  /** Mirrors the landmark x, matching the video's own mirroring so the dots sit on the face. */
  readonly mirror: boolean
  /** Must match the fit the solver used. Defaults to the stage's `cover`. */
  readonly fit?: Fit
  /**
   * Draw the diagnostic marks at all — the leader lines, the dots and the cluster rings.
   *
   * Off by default, and off is what a customer gets. This is the gate the whole overlay hangs on:
   * the marks exist to answer a developer's question (*where did the solver's indices actually land
   * on this face*), and a shopper has no such question. The rings and leader lines are drawn whether
   * or not the numbers are on, so a caller that wanted them hidden and passed only `showLabels: false`
   * got a face covered in dots and nothing to explain them.
   *
   * The gate lives here, in the function that does the drawing, rather than in each caller. A guard in
   * the caller is a guard that can be forgotten the next time someone adds a caller — and one was.
   */
  readonly showDiagnostics?: boolean
  /** Draw the numbered labels. Off by default — at 478 points they overlap into noise. */
  readonly showLabels?: boolean
}

/**
 * The projection, built once per frame from exactly the same maths the solver uses.
 *
 * This used to be an inline `x * box.width` with a comment claiming the overlay "has no letterboxing
 * to account for, because it is drawn on a canvas sized exactly to the video box". That reasoning is
 * wrong, and wrong in a way that matters: sizing the canvas to the video's *box* says nothing about
 * the video *inside* it, because `object-fit: cover` crops whenever the camera's aspect ratio differs
 * from the box's. Under `cover` the naive form is correct only when the two ratios happen to match —
 * which they did, at 4:3 in a 4:3 box, so the bug sat dormant.
 *
 * Dormant is not harmless. This overlay is the instrument used to confirm that the solver's landmark
 * indices are where they claim to be, and an instrument that projects differently from the thing it
 * measures cannot do that: on a 16:9 phone the dots would sit somewhere the earrings never will, and
 * the "fix" would land on the wrong file. Sharing `toCanvasPoint` makes disagreement impossible
 * rather than unlikely.
 */
function projector(options: OverlayOptions): ((landmark: Landmark) => Vec2) | null {
  const view = computeViewTransform(options.video, options.box, options.fit ?? 'cover')
  if (view.scale === 0) return null
  return (landmark) => toCanvasPoint(vec2(landmark.x, landmark.y), view, options.box, options.mirror)
}

/**
 * Draws the overlay for one frame.
 *
 * Landmarks arrive normalised and are projected through the same `toCanvasPoint` the solver uses, so
 * a dot drawn here and an earring placed there are the same claim about where a landmark is.
 *
 * **It draws nothing unless `showDiagnostics` is set**, which is the default. That is the only reason
 * the customer page can call the same hook as the lab without a second drawing path — and the reason
 * the gate is here rather than at the call site, so there is exactly one place for it to be right.
 *
 * **It does not clear the canvas, and the caller must.** It used to, and that was fine while the dots
 * were the only thing on the surface. They are not any more: the earrings are drawn first and the
 * dots go on top, which is the only arrangement that shows whether the anchor landed on the ear. Two
 * components both clearing would mean whichever drew second erased the first, and the symptom —
 * earrings that appear only when the diagnostic overlay is switched off — would point at the wrong
 * file entirely.
 */
export function drawOverlay(
  context: CanvasRenderingContext2D,
  frame: TrackerFrame | null,
  options: OverlayOptions,
): void {
  const { showLabels = false, showDiagnostics = false } = options

  /* Before the projector, so an off overlay costs nothing at all — and so that "off" cannot mean
     anything except "no marks drawn". */
  if (!showDiagnostics) return

  const px = projector(options)
  if (!px || !frame || frame.landmarks.length === 0) return

  for (const group of OVERLAY_GROUPS) {
    const points = group.indices
      .map((index) => frame.landmarks[index])
      .filter((landmark): landmark is Landmark => Boolean(landmark))

    if (points.length === 0) continue

    /* The cluster mean is drawn as a ring, because that average is the actual input to the solver —
       the individual points are shown only to make the average legible. */
    const mean = points.reduce(
      (accumulator, point) => {
        const mapped = px(point)
        return { x: accumulator.x + mapped.x / points.length, y: accumulator.y + mapped.y / points.length }
      },
      { x: 0, y: 0 },
    )

    context.strokeStyle = `${group.colour}88`
    context.lineWidth = 1
    context.beginPath()
    points.forEach((point, index) => {
      const mapped = px(point)
      if (index === 0) context.moveTo(mapped.x, mapped.y)
      else context.lineTo(mapped.x, mapped.y)
    })
    context.stroke()

    context.fillStyle = group.colour
    for (const point of points) {
      const mapped = px(point)
      context.beginPath()
      context.arc(mapped.x, mapped.y, 3, 0, Math.PI * 2)
      context.fill()
    }

    context.strokeStyle = '#ffffff'
    context.lineWidth = 1.5
    context.beginPath()
    context.arc(mean.x, mean.y, 7, 0, Math.PI * 2)
    context.stroke()
  }

  if (showLabels) {
    context.font = '11px ui-monospace, monospace'
    context.fillStyle = '#f8fafc'
    context.textBaseline = 'middle'
    for (const group of OVERLAY_GROUPS) {
      for (const index of group.indices) {
        const landmark = frame.landmarks[index]
        if (!landmark) continue
        const mapped = px(landmark)
        /* Offset so the number does not sit under its own dot. */
        context.fillText(String(index), mapped.x + 6, mapped.y - 6)
      }
    }
  }
}
