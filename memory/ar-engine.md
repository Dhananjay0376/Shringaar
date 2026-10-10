# AR engine

**Last updated:** 2026-10-11
**Code:** `src/features/try-on/` (~50 files) · **Routes:** `/tryon/:productId` (customer), `/tryon/lab` (diagnostics)
**Deep record:** `arch.md` §8 has the *"read this before believing a screenshot"* paragraph.

---

## What it is, in one line

The seller's try-on asset is drawn onto a live webcam feed at a position estimated from MediaPipe
Face Landmarker output. **Earrings only.** Everything runs on the device; no frame, image or landmark
is uploaded.

---

## Camera lifecycle

`tracking/camera.ts`, orchestrated by `hooks/useTryOnSession.ts`.

| Step | Detail |
| --- | --- |
| Support check | `hasCameraSupport()` — `navigator.mediaDevices?.getUserMedia` |
| Constraints | `{ video: { facingMode: 'user', width: {ideal: 640}, height: {ideal: 480} }, audio: false }` |
| Device chosen from the picker | `deviceId: { exact }` — an `ideal` hint would let the browser hand back a different camera and make the picker look broken |
| Attach | `video.srcObject = stream`; **`muted` and `playsInline` set programmatically**, because a stream on a non-muted element is refused autoplay by every mobile browser |
| Resolve | on `loadedmetadata` **then** `play()` — not on `getUserMedia`, because the stream can exist while the element has no frame to draw |

### Teardown — the part that has to be right

`stop()` releases in this order, and the order is deliberate: **loop first** (nothing calls into the
model while it closes), **camera last** (a throw above cannot leave the light on).

```
loop.stop() → tracker.stop() → stopCamera(stream) → video.srcObject = null
            → resetTracking() → frameRef.current = null → onFrame(null, 'idle')
```

The final `onFrame(null, 'idle')` is load-bearing: the loop has already stopped, so without it the
last frame's overlay stays painted on the canvas after Stop — faintly visible behind the curtain, and
stale the moment the camera restarts at a different size.

**`<StrictMode>` mounts every effect twice in dev.** `startWithDevice` bails if a tracker or stream
already exists (a second `getUserMedia` for the same device fails outright on several platforms
because the first still holds it), and `stop()` is idempotent with every field null-checked. A
regression here shows up as a camera light that stays on after leaving the page.

### Failure states — each says its own thing

`describeCameraError()` maps a `DOMException` to a message that names the cause: **denied** ("you
clicked Block"), **no camera attached**, **camera in use by another app**, **unsupported browser**. It
also carries `retryable`, so *"Try again"* is offered for a denial and not for a missing device.

---

## Tracking — MediaPipe Face Landmarker

`tracking/mediapipe.ts` (load) · `tracking/faceLandmarker.ts` (adapter) · `tracking/loop.ts`.

- WASM: `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm`
- Model: `storage.googleapis.com/.../face_landmarker/float16/1/face_landmarker.task` (~3.7 MB)
- **Both URLs carry the same exact version pin** — the JS loader and the wasm binary are a matched
  pair, and a mismatch surfaces as an opaque *"failed to asynchronously prepare wasm"*.
- `runningMode: 'VIDEO'` · `numFaces: 1` · `delegate: 'CPU'` · blendshapes and transformation
  matrices **off** (nothing reads them).
  - `numFaces: 1` is not only a performance choice — MediaPipe applies its own temporal smoothing
    **only** when exactly one face is requested.
  - CPU not GPU: the GPU delegate needs a WebGL context bound to a canvas and would compete with the
    Three.js renderer for it.
- The in-flight load is a **shared promise**, cleared in `finally`. Under `<StrictMode>` this prevents
  two wasm instantiations and two resident models; clearing on rejection allows a retry instead of
  poisoning every future call with the first error.
- `assertLandmarkCount()` fails loudly if the model does not return exactly **478** points — every
  index past the end would otherwise read `undefined` and report "no face" for every frame, a total
  failure with no error anywhere.
- `faceLandmarks` is an array **per face**. `numFaces: 1` means the face is `faceLandmarks[0]`, typed
  `NormalizedLandmark[] | undefined` under `noUncheckedIndexedAccess`. The adapter treats absent and
  empty as the same *no face this frame* state and never reaches for `!`.

### The loop

One `requestAnimationFrame` cycle per **new video frame**, not per display frame. The guard is
`video.currentTime`, which advances only when a new frame is decoded — a naive `rAF` loop would run
detection two or three times against the same frame.

### Tracking state machine

`core/trackingState.ts`. Config lives in `types/frame.ts`:

```ts
DEFAULT_TRACKING_CONFIG = { acquireFrames: 3, holdFrames: 10 }
```

| Status | Drawn? | Meaning |
| --- | --- | --- |
| `idle` | no | Nothing started, or stopped |
| `acquiring` | **no** | Fewer than 3 consecutive detections — not yet trusted |
| `tracking` | **yes** | Position trusted |
| `holding` | **yes** | A miss occurred; last position retained |
| `lost` | no | 10 consecutive misses (≈1/6 s) |

`RENDERABLE_STATUSES = ['tracking', 'holding']`. `acquireFrames: 3` rejects a single-frame spurious
fit on a hand or wall. `holding` is the important one: a dropped frame is extremely common (a blink, a
hand passing over the face) and tearing the earring off for one frame is far more noticeable than
leaving it where it was.

**`holding`'s replay path has never been triggered on camera.** Implemented and reasoned, unverified.

---

## Coordinates and framing

`core/framing.ts` (`buildFaceFrame`), `core/coordinates.ts`.

Landmarks arrive normalised 0..1. They are transformed to **canvas pixels** once, in one place, so
every downstream number is already through the video→canvas transform and already mirrored if the
view is mirrored. The renderer does **no** geometry of its own — that keeps every coordinate decision
in one testable function.

Mirroring flips **x only, never y**. `buildFaceFrame` takes a `mirror` flag and a fit mode (`contain`),
and the stage, the overlay and the solver all consume the same frame, which is how the video and the
canvas are guaranteed to agree.

---

## Anchors — the honest core

`anchors/earring.ts`.

**There is no earlobe landmark in the 478-point topology.** Landmarks **234** and **454** are
facial side reference points on the face-oval contour, *not* earlobes. The solver therefore derives
an ear position from a face-local frame and offsets it outward, and the UI says so.

| Role | Indices |
| --- | --- |
| Scale unit (most stable metric in the mesh) | `33` / `263` — outer eye corners → **interocular** |
| Face width | `234` / `454` |
| Roll | `atan2` of `263 − 33` |
| Ear cluster, left | `93, 234, 127` — **averaged**, not bet on singly |
| Ear cluster, right | `323, 454, 356` |
| Lobe direction | left `132, 58` · right `361, 288` |
| **Lobe height** | `2, 94, 19` — subnasale + both alar bases, averaged → **the nose base** |

Base geometry, in **interocular units** (`EAR_GEOMETRY`):

```ts
{ outward: 0.24, drop: 0.26, lobeFromNoseBase: -0.06, assetScale: 0.40 }
```

These are starting points measured from the mesh's own proportions — **not fitted to any face**,
which is exactly why calibration exists and why the UI does not claim the default is right for
everyone. **The ~35 px outward offset observed on the synthetic cartoon head is NOT a default and
must never be hardcoded as one** — it is a property of a cartoon whose ears sit inboard of the
contour 234/454 trace.

### The drop has two answers, and the anatomical one wins

`lobeDrop()` in `anchors/earring.ts`. The mesh has no ear, so the lobe's **position** cannot be read
from it — but its **level** can. The earlobe's lower edge sits level with the base of the nose, so the
solver measures the nose base and solves the drop as *the distance along the jaw direction that
reaches it*:

```
targetY = noseBaseY + (lobeFromNoseBase + calibrationOffset) · interocular
drop    = (targetY − fromOutward.y) / down.y
```

Why this replaced a fixed multiple: the old `drop: 0.26` assumed an average face, so a **long** face
put the piece above the lobe and a **short** one put it below. Following the subject's own nose base
removes that assumption, and because the nose base is a mesh point it **tracks head roll for free**.
On a canonically-proportioned face the two answers land **within ~1 px of each other** (172.77, 296.32
vs 172.43, 295.35 at interocular 128) — a refinement, not a jump. They diverge exactly as the face
departs from the canon, which is the case the constant could not handle.

**`lobeFromNoseBase: -0.06` is a facial-proportion canon, not a measurement of anyone** — ≈5–6 mm
above the lobe edge on a ~90 mm interocular. It was **deliberately not tuned to the synthetic head**:
fitting a constant to a face this engine drew itself would be fitting to a fake. Still **unvalidated on
real skin.**

Three guards, each with a test that fails without it:

| Guard | Trigger | Answer |
| --- | --- | --- |
| `frame.noseBase.length === 0` | projectGroup found no nose-base indices | fixed `drop + offset` |
| `\|down.y\| < JAW_VERTICAL_MIN` (0.35) | jaw direction near horizontal | fixed `drop + offset` |
| `clamp(wanted, 0, MAX_LOBE_DROP · interocular)` (0.6) | nose-base read absurd | capped travel |

The middle one is not decorative. At *nearly* flat — not exactly flat, which the `isFinite` check
catches first — the quotient is finite and huge (~840 px of travel for a plausible nose base), and the
clamp alone would bound it into a **sideways fling** rather than a drop. Removing the guard moves the
anchor 76 px sideways on the test fixture.

**`drop` survives as the fallback, not as the primary answer.** Keeping it means a frame with no nose
base behaves exactly as the engine did before rather than worse. The calibration offset rides on top of
*either* branch, so the slider keeps full authority over the final placement whichever answer ran.

`outward` was lowered **0.30 → 0.24** on 2026-10-11, on the **first real-face report this engine has
ever had**: the piece sat *"a bit ahead of the ear"* — outside it, along the cheek line. That is the
direction the error was expected in, because the ear-cluster mean is taken at the cheekbone and
extrapolated outward, and **there is no earlobe landmark in the 478-point mesh** to check the
extrapolation against.

**This is a correction from one report about one face, not a fitted value.** It was kept deliberately
modest: under-correcting shows as *"still slightly out"*, while over-correcting sinks the piece into
the jaw, which reads as broken rather than mis-tuned. The per-face correction mechanism is the
calibration slider, which persists — if a slider value does the job for a given face, that number is
the better default. Only **one synthetic-cartoon-head run** sanity-checked it; **a human face has
still never been measured.**

### Confidence and fading

- `YAW_FADE_START = 0.55` (~31°) · `YAW_FADE_END = 1.0` (~57°). Only the **far** side fades — turning
  *toward* an ear never occludes it. The fade is linear between the two stops, so a slow head turn
  produces a slow fade rather than a pop.
- `MIN_DRAW_OPACITY = 0.05`. `isRenderableTarget()` skips anything at or below it — "faded far
  enough" becomes "not drawn".

### Solvers present

`anchors/registry.ts` returns `earringSolver` for `earrings` and **`null` for every other category**,
rendered as *"Try-on is not available for this category yet."* An empty stage would look like a bug,
not a missing feature. `IMPLEMENTED_AR_CATEGORIES` in `renderers/select.ts` is **derived** from
`lib/catalog`'s `TRYON_READY_CATEGORIES`, not restated, so the storefront and the engine cannot
disagree about which categories offer a button.

---

## Calibration

`core/calibration.ts`. Four controls, all persisted per browser under
`shringaar.tryon.calibration.v1` and loaded in a lazy initialiser so the first painted frame is
already calibrated. Corrupt stored JSON falls back to defaults instead of throwing.

```ts
NEUTRAL_CALIBRATION = { size: 1, outward: 0, drop: 0, tilt: 0 }
CALIBRATION_BOUNDS = {
  size:    { min: 0.4,  max: 2.5 },
  outward: { min: -0.8, max: 0.8 },
  drop:    { min: -0.8, max: 0.8 },
  tilt:    { min: -0.6, max: 0.6 },
}
```

`drop` is a **differential** drop — positive lowers one side and raises the other, which is how a face
whose ears sit at different heights is corrected with a single control. The bounds are chosen so every
extreme is still a recognisable earring: a slider that can be dragged to a state where nothing is on
screen is a slider the customer cannot drag back.

**Calibration is separate from the tracking algorithm.** It corrects an estimate; it does not train
anything. The MediaPipe model is pretrained and is not trained on any user's face.

---

## Swing — the piece is not welded to the ear

`core/swing.ts` — pure, DOM-free, and the only animated thing in the engine.

An earring fixed rigidly to the lobe is the strongest tell that a try-on is a sticker. A hanging piece
lags a moving head, overshoots and rings down, and modelling that costs one rotation per frame.

It is a **damped, driven pendulum**, integrated per frame. `a` is the pivot's **horizontal
acceleration** — acceleration, not velocity, is what deflects a pendulum in the pivot's own frame.

```
θ'' = −k·sin θ − c·θ' − d·a
```

The decisions that are load-bearing:

| Decision | Why |
| --- | --- |
| Acceleration is a *second* difference of the landmark position, taken from an already-**smoothed** velocity (a low-pass reusing `smoothingAlpha` from `core/smoothing.ts`, cutoff 5 Hz) and then **clamped** (`maxDriveAccel` 400) | Differencing position twice amplifies mesh noise far more than the position does; unclamped, one bad landmark frame flings the piece |
| **Semi-implicit Euler** — velocity first, then position from the *new* velocity | Explicit Euler pumps energy in, so amplitude grows every frame until it hits the clamp and stays there |
| Normalised by the piece's **drawn width** | Otherwise the same head motion swings the piece twice as far in a window twice the size — behaviour would be a property of the display, not the piece |
| Guard rail `maxAngle` 0.30 rad (≈17°): on contact the angle is clamped **and the velocity zeroed** | Leaving the velocity would let it accumulate against the limit, so the piece pins to the guard rail and snaps when the drive eases |

`DEFAULT_SWING` — **tuned to look like weight, not measured from any piece**:

```ts
{ stiffness: 100, damping: 5, velocityCutoff: 5, drive: 0.05, maxDriveAccel: 400, maxAngle: 0.30 }
```

- `stiffness` 100 → ω ≈ 10 rad/s ≈ **1.6 Hz**, deliberately slower than a real ~3 Hz jhumka: at 3 Hz
  on a 640 px canvas it reads as jitter rather than as a piece with mass.
- `damping` 5 against that → **ζ ≈ 0.25**, underdamped on purpose. Two or three shrinking overshoots
  is what swinging looks like; settling in a single motion looks glued.

**Where it runs:** `hooks/useEarringRender.ts`, in `draw()`, immediately after the targets are decided
and **before** the renderer is called. It is timed off `performance.now()` (wall clock), **not
`frame.at`** — during a `holding` replay the detection timestamp does not advance, and the piece must
go on settling while it is held. `dt` is clamped to `MAX_SWING_DT` (0.05 s) so a backgrounded tab
cannot resume with a two-second step and fling the piece.

The swing is folded into `target.rotation` (which already carried head roll), so both the Canvas 2D
renderer (`context.rotate(target.rotation)`) and the Three.js renderer (`modelTransform.ts` maps it to
`rotationZ`) get it from one place and cannot disagree — `renderers/canvas2d.ts` was **not** changed.
State lives in a `SwingBank` (`Map<EarSide, SwingState>`) held in a lazy `useState`, mirroring how
`TargetSmoother` is held; the bank is cleared when nothing is drawn, so a piece that fades back in
starts at rest rather than resuming mid-swing.

**What it is not.** The pivot is the **mean of the drawn targets** — the head's own translation — so
both pieces swing together. A **rotating** head would drive the two sides differently and this
deliberately does not model that; that is a stated limit, not an oversight. And nothing here measured a
real earring's mass, centre of mass, or drop length: the honest description of the result is **"it
swings believably", never "it is a simulation of this piece"**. The constants are a considered guess.

---

## Renderers

`renderers/select.ts` — `chooseRenderer(asset, validation)`, **pure and tested**. It takes two
arguments on purpose: the asset (what the seller declared) and the validation (what the client
measured). A `.glb` reaches Three.js only when both agree, and `unchecked` does **not** count as
agreement.

| Asset | Validation | Renderer |
| --- | --- | --- |
| non-earring category | — | `none` — "Try-on is not available for this category yet." |
| anchor conflicting with category | — | `none` — names the required anchor |
| `image` | — | `canvas2d` |
| `glb` | `valid` | `three` |
| `glb` | `invalid` | `none` — "…could not be used (reason)." |
| `glb` | `unchecked` | `none` — "…has not been verified yet…" |
| `usdz` | — | `none` — "USDZ models are not supported by this viewer yet." |

- `canvas2d` draws the asset with `drawImage`. The overlay never reads pixels back, so a tainted
  canvas is harmless and **`crossOrigin` is deliberately unset** (see `decisions.md`).
- `three` is reached only through `await import('three')` — its own chunk, never in the entry bundle.
- `/tryon/lab` exposes the engine with diagnostics: landmark dots and their indices, fps, detection
  time, frames skipped, the face-frame readout, a calibration panel and a local file picker
  (in-memory only, never uploaded).

---

## Known limitations — state them, do not hide them

1. **No earlobe landmark exists.** The anchor sits on the cheek/jaw contour, so there is a small
   systematic offset. The drop is no longer a fixed proportion — it follows the subject's own
   **nose base**, which is real anatomy the mesh does have — but `lobeFromNoseBase` is a
   **proportion canon, not a measurement**, and neither it nor `outward` has ever been checked against
   a human face. The calibration sliders exist to correct both per face.
2. **No occlusion.** There is no face mesh in the scene, so hair over an ear cannot be detected and the
   earring draws on top of it.
3. **Accuracy degrades with large head yaw.** Handled by fading the far side out, not by guessing.
4. **Low light degrades landmark confidence before it degrades the video.**
5. **Placement accuracy on a real human face is unmeasured.** See `current-state.md`.
6. **The swing is a believable animation, not a simulation of the piece.** The pendulum constants were
   tuned to look like weight — nothing measured a real earring's mass, centre of mass, or drop length —
   and a **rotating** head is not modelled: only the head's translation drives the swing, so both
   pieces move together.
7. **This is a placement preview** — not a fitment guide, not photorealistic, and not a 3D model when
   the asset is a flat image.
8. MediaPipe posts small rate-limited telemetry beacons (`odml.pa.googleapis.com`, protobuf, no image
   data). The WASM and model are downloaded on first use. *"No photo or video leaves your device"* is
   accurate; *"everything runs in your browser"*, read as *no network calls at all*, is not.

---

## Tests

`try-on/tests/` — 15 files, pure and DOM-free (`environment: 'node'`): `coordinates`, `framing`,
`geometry`, `smoothing`, `targetSmoother`, `swing`, `trackingState`, `calibration`, `earring`,
`anchors`, `glb`, `rendererSelect`, `modelTransform`, `canvas2d`, `landmarkOverlay`.

Repo-wide, `npm run check` reports **17 test files / 304 tests** and **`npx tsc --noEmit` is clean**.
(Before `swing.test.ts` it was 275; `swing` contributed 25, the anatomical anchor 4.)

`tests/helpers/syntheticFace.ts` is the **only** synthetic face in the repository — two builders,
deliberately separate: `syntheticFaceFrame` (constructs the frame the solver consumes, for testing the
solver's arithmetic in isolation) and `syntheticLandmarks` (for the framing/overlay path). It is a
test fixture. It is not on any route.

Its options are the handles the anatomy tests need: `noseBaseY` (a long face vs a short one),
`jawY` (flatten the jaw direction), `withoutNoseBase` (the solver's fallback path), plus `interocular`,
`centre`, `roll`, `yaw`. Its one anatomical claim is `NOSE_BASE_Y = 0.5` — the canonical eye-line →
subnasale distance — and at that value the anatomical and fixed drops agree within ~1 px, which is the
property the fixture was chosen to demonstrate.

### Test quality was established by mutation, not by reading

Every guard above was mutated and the mutation run. Two findings worth carrying forward:

- **A vacuous test is easy to write and looks identical to a good one.** The first flat-jaw test used
  `jawY` *exactly* at the cluster height, where the quotient is `±Infinity` and the `isFinite` branch
  catches it one line earlier — so removing the jaw guard changed nothing and the test still passed.
  It now uses a *nearly* flat jaw, where the quotient is finite and huge, and the mutant dies.
- The reverted-anchor mutant (nose base ignored) fails on `295.3569` — the fixed-proportion answer —
  confirming the arithmetic independently of the test's own expectation.
