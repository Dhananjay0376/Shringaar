/**
 * The Face Landmarker indices the earring solver depends on.
 *
 * Named in exactly one place, and for a specific reason: Stage 1 of this engine renders a debug
 * overlay that draws and labels these indices on a live face, so they can be confirmed by eye
 * before any jewellery code is written against them. Choosing anchor indices from documentation is
 * guessing. Drawing them is observation. If the overlay and this file disagree, one of them is a bug
 * — and they cannot disagree, because the overlay reads this file.
 *
 * **There is no earlobe landmark in the mesh.** The 478-point topology covers the face oval, the
 * eyes, the brows, the lips and the irises; the ear is outside it. Indices 234 and 454 in particular
 * are face-oval points at the cheekbone and jaw — not ears, despite being the closest thing the mesh
 * has to an ear position. Every anchor derived here is therefore an *estimate* extrapolated outward
 * from the face contour, which is why the engine ships calibration controls and why its UI describes
 * placement rather than fit. See arch.md §8.
 *
 * The A/B labels are positional, not anatomical: A is the group MediaPipe numbers lower, which sits
 * on one side of the face, and B on the other. Nothing here decides which is the subject's left —
 * that is derived from screen position at solve time, so a wrong guess about the mesh's convention
 * cannot put a left earring on a right ear.
 */

export const FACE_LANDMARKS = {
  /**
   * The scale ruler: the two outer eye corners.
   *
   * Every length in the solver is a multiple of the distance between these two. The interocular
   * distance is the most stable measurement in the mesh — it is rigid bone, it is large enough to
   * dominate landmark jitter, and it is the least affected by expression.
   */
  rulerA: 33,
  rulerB: 263,

  /**
   * The face-oval points bracketing the ear, three per side, averaged rather than trusted singly.
   *
   * Read against the order the mesh actually walks the face oval —
   * `… 356, 454, 323, 361, 288 … 152 (chin) … 58, 132, 93, 234, 127 …` — these six are the contour
   * points on either side of the ear. Which of the three sits nearest the lobe varies with face
   * shape, and picking one would bet the whole placement on that variation. The average absorbs it.
   */
  clusterA: [93, 234, 127],
  clusterB: [323, 454, 356],

  /**
   * Jaw-contour points that descend from the ear toward the chin.
   *
   * These give the *direction* the lobe hangs in. The earring is dropped along this rather than
   * straight down the screen, so a tilted head carries it correctly.
   */
  jawA: [132, 58],
  jawB: [361, 288],

  /**
   * The base of the nose, three points averaged.
   *
   * The solver's ruler for **height**, and it exists precisely because there is no ear. The lobe's
   * position cannot be read from this mesh, but the *level* it sits at can: the earlobe's lower edge
   * is level with the base of the nose — a standard facial proportion. Anchoring to that point
   * instead of to a fixed multiple of the interocular distance is what lets the drop follow the
   * subject's own face rather than an average one, and it carries head roll for free, because the
   * nose base is a mesh point that moves with the head.
   *
   * `2` is the subnasale; `94` and `19` are the alar bases. Averaged for the same reason the ear
   * clusters are: which one sits truest varies with the fit.
   */
  noseBase: [2, 94, 19],
} as const

/**
 * Everything the solver reads, flattened.
 *
 * Built by spreading the groups above, so it cannot fall out of step with them.
 */
export const REQUIRED_FACE_INDICES: readonly number[] = [
  FACE_LANDMARKS.rulerA,
  FACE_LANDMARKS.rulerB,
  ...FACE_LANDMARKS.clusterA,
  ...FACE_LANDMARKS.clusterB,
  ...FACE_LANDMARKS.jawA,
  ...FACE_LANDMARKS.jawB,
]

/**
 * Total landmarks the Face Landmarker returns with `outputFaceBlendshapes: false`.
 *
 * Only used to describe the model in copy and diagnostics. The solver never assumes this length —
 * it checks the indices it needs are present, which is the check that actually protects it.
 */
export const FACE_LANDMARK_COUNT = 478
