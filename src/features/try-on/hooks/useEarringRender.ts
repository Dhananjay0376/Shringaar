/**
 * Solve, smooth, draw — the whole per-frame pipeline behind one call.
 *
 * `useTryOnSession` deliberately stops at "here is a detection": it owns the camera and the model, and
 * it knows nothing about earrings. This hook is the layer above it that turns a detection into pixels.
 * Splitting them is what lets the lab and the product page share the drawing path while wiring up
 * their own camera, their own copy and their own asset — and it is what keeps `useTryOnSession`
 * honest about being category-agnostic.
 *
 * ## Why it holds on to the last good frame
 *
 * The tracking state machine already distinguishes `holding` from `lost` precisely so a single missed
 * detection does not tear the earring off the screen. That intent is not satisfiable from the current
 * frame alone, because on a missed detection there is no current frame. So the last drawable frame and
 * its solved targets are kept, and replayed while the status says `holding`. Without this the machine's
 * hold window would be decorative: the status would stay `tracking`-ish while the canvas went blank,
 * which is exactly the flicker `holdFrames` exists to prevent.
 *
 * The replay is bounded by `holdFrames` upstream, so a customer who walks out of frame still loses the
 * earring within a sixth of a second. This hook does not decide how long to hold — it only obeys.
 *
 * ## Why the asset is a union rather than a URL
 *
 * An image and a model need different renderers, and the renderer has to be chosen *before* the canvas
 * is touched: a canvas has exactly one context, so asking a canvas for `2d` and later for WebGL returns
 * `null` for the second request and the piece never appears. Encoding the kind in the asset rather than
 * inferring it from a file extension means the two effects below can be told apart by the type system
 * instead of by a string suffix.
 *
 * ## What a model asset costs
 *
 * One real loss, stated rather than hidden: **the landmark overlay cannot be drawn over a model.** The
 * dots need a 2D context, and the canvas showing a model is a WebGL one. So diagnostics are a feature
 * of the flat path only. That is acceptable because the two paths share the same ear solver — the dots
 * answer a question about the solver, and the solver can be inspected in 2D — but a lab session with a
 * model loaded will show no dots, and this is why.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { solveEarrings } from '../anchors/earring'
import { drawOverlay } from '../components/LandmarkOverlay'
import { inspectGlb, loadModelBytes, drawableFromImage, loadImageAsset } from '../assets/load'
import type { Calibration } from '../core/calibration'
import { buildFaceFrame } from '../core/framing'
import { createTargetSmoother, type TargetSmoother } from '../core/targetSmoother'
import { applySwing, createSwingBank, MAX_SWING_DT, type SwingBank } from '../core/swing'
import { createCanvas2DRenderer, type Canvas2DRenderer } from '../renderers/canvas2d'
import { createThreeRenderer, type ThreeRenderer } from '../renderers/three'
import type { DrawableAsset, RendererFrame } from '../renderers/types'
import type { PlacementTarget, TrackerFrame, TrackingStatus } from '../types/frame'
import type { ArAsset } from '../types/asset'

export type AssetStatus = 'empty' | 'loading' | 'ready' | 'error'

/**
 * The piece to draw, and which kind of thing it is.
 *
 * `'model'` covers both `.glb` and `.usdz` from the seller's vocabulary, because from this hook's point
 * of view they are one case: bytes that are not an image. `chooseRenderer` is where the two are told
 * apart, and it refuses USDZ before anything reaches here.
 */
export type RenderAsset =
  | { readonly kind: 'image'; readonly url: string }
  | { readonly kind: 'model'; readonly url: string }

/** Projects a resolved `ArAsset` onto the renderer's own vocabulary. */
export function renderAssetFor(asset: ArAsset): RenderAsset {
  return asset.kind === 'image'
    ? { kind: 'image', url: asset.url }
    : { kind: 'model', url: asset.url }
}

/** Said when the browser gives us no WebGL, rather than leaving a blank stage with no explanation. */
export const WEBGL_UNAVAILABLE =
  'This browser cannot display a 3D model, so this piece cannot be tried on here.'

export interface EarringRenderOptions {
  readonly canvasRef: RefObject<HTMLCanvasElement>
  readonly videoRef: RefObject<HTMLVideoElement>
  /** `null` draws nothing and is a normal state — the asset has not been chosen yet. */
  readonly asset: RenderAsset | null
  readonly mirror: boolean
  readonly calibration: Calibration
  /**
   * Draws the landmark dots over the piece.
   *
   * A diagnostic, and off by default. The dots exist to answer the lab's question — *where did the
   * solver's indices actually land on this face* — and a customer has no such question: dots on their
   * own face read as a broken renderer, not as evidence. It is named for the dots rather than for the
   * labels because the dots are what it switches; the labels are `showLabels` below.
   *
   * Ignored when the asset is a model, for the reason in this file's header.
   */
  readonly showDiagnostics?: boolean
  /** Adds each point's numeric index beside its dot. Only has an effect while `showDiagnostics` is on. */
  readonly showLabels?: boolean
}

export interface EarringRender {
  /**
   * Draws one frame. Must be called for **every** frame the session reports, including the `null`
   * ones — a `null` frame while `holding` is what replays the last good position, and a `null` frame
   * with any other status is what clears the canvas.
   */
  draw(frame: TrackerFrame | null, status: TrackingStatus): void
  readonly assetStatus: AssetStatus
  /** A message for the customer when `assetStatus` is `'error'`. */
  readonly assetError: string | null
}

export function useEarringRender(options: EarringRenderOptions): EarringRender {
  const { canvasRef, videoRef, asset, mirror, calibration, showDiagnostics = false, showLabels = false } = options

  const assetKind = asset?.kind ?? 'image'

  const canvas2dRef = useRef<Canvas2DRenderer | null>(null)
  const threeRef = useRef<ThreeRenderer | null>(null)
  /* The *promise* of a 3D renderer, not the renderer. `createThreeRenderer` is async because Three.js
     is imported lazily, and the asset effect below has to be able to wait for it without racing it —
     without this, a small model can finish loading before the renderer exists and be handed to
     `null`. */
  const threeReadyRef = useRef<Promise<ThreeRenderer | null> | null>(null)

  /* The loaded image lives in a ref as well as in the renderer, so the two effects below do not have
     to run in a particular order. They are declared renderer-first, but relying on that would be
     relying on declaration order staying that way after someone reorders the file. */
  const assetRef = useRef<DrawableAsset | null>(null)
  const [assetStatus, setAssetStatus] = useState<AssetStatus>('empty')
  const [assetError, setAssetError] = useState<string | null>(null)

  /* A lazy `useState`, not `useRef(createTargetSmoother())`: the argument to `useRef` is evaluated on
     every render even though only the first result is kept, which would allocate a fresh filter bank
     sixty times a second and throw it away. */
  const [smoother] = useState<TargetSmoother>(() => createTargetSmoother())

  /* Same lazy-`useState` reason as the smoother above: `useRef(createSwingBank())` would build a fresh
     Map on every render and keep only the first. */
  const [swingBank] = useState<SwingBank>(() => createSwingBank())

  /* Wall-clock, not the detection timestamp — see where the swing is applied in `draw`. */
  const lastDrawAtRef = useRef<number | null>(null)

  /* What the last drawable frame produced, for the `holding` replay. */
  const heldRef = useRef<{ frame: TrackerFrame; targets: readonly PlacementTarget[] } | null>(null)

  /* Read through a ref so `draw` never needs rebuilding. An inline options object is a new identity on
     every render, and a `draw` that depended on it would be recreated — and so would any effect that
     captured it. */
  const settingsRef = useRef({ assetKind, mirror, calibration, showDiagnostics, showLabels })
  useEffect(() => {
    settingsRef.current = { assetKind, mirror, calibration, showDiagnostics, showLabels }
  }, [assetKind, mirror, calibration, showDiagnostics, showLabels])

  /* The renderer, for whichever kind of asset is loaded.
   *
   * Keyed on `assetKind` rather than on the asset itself: switching between two models should not throw
   * away a WebGL context, and switching between an image and a model *must* re-create the renderer,
   * because the canvas's context type is fixed by the first `getContext` call on it. The caller is
   * responsible for giving a new kind a new canvas — see `TryOnStage`'s `canvasKey`. */
  useEffect(() => {
    const canvas = canvasRef.current
    threeReadyRef.current = null
    if (!canvas) return

    if (assetKind === 'model') {
      let cancelled = false
      let created: ThreeRenderer | null = null

      const ready = createThreeRenderer(canvas).then((renderer) => {
        if (cancelled) {
          /* The effect was cleaned up while Three was loading. Disposing here rather than dropping the
             reference matters: `WebGLRenderer` holds a GPU context, and browsers cap how many a page
             may have. */
          renderer?.dispose()
          return null
        }
        created = renderer
        threeRef.current = renderer
        if (!renderer) {
          setAssetStatus('error')
          setAssetError(WEBGL_UNAVAILABLE)
        }
        return renderer
      })

      threeReadyRef.current = ready

      return () => {
        cancelled = true
        threeReadyRef.current = null
        threeRef.current = null
        created?.dispose()
      }
    }

    const renderer = createCanvas2DRenderer(canvas)
    if (!renderer) return
    canvas2dRef.current = renderer
    renderer.setAsset(assetRef.current)

    return () => {
      canvas2dRef.current = null
      renderer.setAsset(null)
    }
  }, [canvasRef, assetKind])

  useEffect(() => {
    if (!asset) {
      assetRef.current = null
      canvas2dRef.current?.setAsset(null)
      threeRef.current?.clearModel()
      setAssetStatus('empty')
      setAssetError(null)
      return
    }

    /* `cancelled` covers the case the load resolves after the asset changed again — picking a second
       file while the first is still decoding. Without it the slower load wins and the canvas shows an
       asset the customer has already replaced. */
    let cancelled = false
    setAssetStatus('loading')
    setAssetError(null)

    if (asset.kind === 'model') {
      void (async () => {
        const renderer = await threeReadyRef.current
        if (cancelled) return
        if (!renderer) {
          /* Either WebGL is unavailable — already reported by the renderer effect — or the cleanup ran.
             Both leave nothing to load into. */
          return
        }

        const loaded = await loadModelBytes(asset.url)
        if (cancelled) return
        if (!loaded.ok) {
          setAssetStatus('error')
          setAssetError(`This piece's 3D model could not be loaded — ${loaded.reason}.`)
          return
        }

        /* Measured here as well as on the product page. The page validates to decide *whether* to render
           this at all; this inspection is what stands between a `.glb` that passed the container check
           and a parse failure inside Three.js, and it is cheap because the bytes are already in hand. */
        const validation = inspectGlb(loaded.bytes)
        if (validation.status === 'invalid') {
          setAssetStatus('error')
          setAssetError(`This piece's 3D model could not be used (${validation.reason}).`)
          return
        }

        const result = await renderer.setModel(loaded.bytes)
        if (cancelled) return
        if (!result.ok) {
          setAssetStatus('error')
          setAssetError(result.reason)
          return
        }
        setAssetStatus('ready')
      })()
    } else {
      loadImageAsset(asset.url)
        .then((image) => {
          if (cancelled) return
          const drawable = drawableFromImage(image)
          if (!drawable) {
            /* Distinct from a load failure on purpose: the bytes arrived and decoded, they just carry no
               usable size. The likely cause is an SVG with no `width`/`height`, and saying so is the
               difference between a fixable report and "it doesn't work". */
            setAssetStatus('error')
            setAssetError('That image has no dimensions the viewer can use. Try a JPEG or PNG export.')
            return
          }
          assetRef.current = drawable
          canvas2dRef.current?.setAsset(drawable)
          setAssetStatus('ready')
        })
        .catch(() => {
          if (cancelled) return
          setAssetStatus('error')
          setAssetError('The try-on image could not be loaded.')
        })
    }

    return () => {
      cancelled = true
    }
  }, [asset])

  const draw = useCallback(
    (frame: TrackerFrame | null, status: TrackingStatus): void => {
      const canvas = canvasRef.current
      if (!canvas) return

      const width = canvas.clientWidth
      const height = canvas.clientHeight
      /* Zero while the stage is hidden or before layout. Dividing by it would give `Infinity`, and an
         infinite scale on a canvas context is not recoverable by the next `setTransform` in every
         engine — the surface can stay blank for the rest of the session. Bailing is the safe answer. */
      if (width <= 0 || height <= 0) return
      const pixelRatio = canvas.width > 0 ? canvas.width / width : 1

      const video = videoRef.current
      const media = { width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0 }
      const box = { width, height }
      const settings = settingsRef.current
      const isModel = settings.assetKind === 'model'

      /* Asked for once, and only when the canvas is not owned by WebGL. A canvas has one context for its
         lifetime: requesting `2d` here on a model canvas would poison it, and every later frame would
         draw nothing with no error anywhere. */
      const context = isModel ? null : canvas.getContext('2d')
      if (!isModel && !context) return

      const detectable = frame !== null && frame.landmarks.length > 0 && media.width > 0 && media.height > 0

      let targets: readonly PlacementTarget[] = []
      let overlay: TrackerFrame | null = null

      if (detectable && frame) {
        /* Handed to the overlay whatever the frame turns out to be — including an unsolvable one, where
           the mesh is tracking but the face is too small to scale from. In the lab that state is worth
           seeing, and it is indistinguishable from "no tracking" if neither draws. With diagnostics off
           this value is simply never read. */
        overlay = frame

        const faceFrame = buildFaceFrame(frame.landmarks, media, box, settings.mirror)
        if (faceFrame) {
          targets = smoother.smooth(solveEarrings(faceFrame, settings.calibration), frame.at)
          heldRef.current = { frame, targets }
        } else {
          /* Landmarks present, but no usable scale — the face is too small or the mesh is degenerate.
             Nothing is drawn, and nothing is held: holding this frame would hold emptiness for the
             whole window. */
          smoother.reset()
          heldRef.current = null
        }
      } else if (status === 'holding' && heldRef.current) {
        /* The last position, unchanged. Not re-solved and not re-smoothed: there is no new evidence, so
           feeding the filter a repeated sample would just add lag to a value that is already the best
           estimate available. */
        targets = heldRef.current.targets
        overlay = heldRef.current.frame
      } else {
        smoother.reset()
        heldRef.current = null
      }

      /* Swing, applied here rather than in the solver, and timed off the wall clock rather than
         `frame.at`. The solver answers "where is the ear this frame" — a question about the detection.
         A swing is an animation of the piece's own mass, and it has to keep running when no new
         detection arrives: during a `holding` replay `frame.at` does not advance at all, and the piece
         would freeze mid-arc exactly when it was being held to avoid a freeze.

         It lands on `targets` rather than inside a renderer, so the flat and 3D paths cannot end up
         with two different answers to "does this piece swing" — both read `target.rotation`, the 3D
         path through `modelTransform.ts`.

         The clamp is what keeps a backgrounded tab from resuming with a 2-second step and flinging the
         piece to its limit: past `MAX_SWING_DT` the animation runs slow rather than exploding. */
      const now = performance.now()
      const previousDrawAt = lastDrawAtRef.current
      lastDrawAtRef.current = now
      const swingDt = previousDrawAt === null ? 0 : Math.min((now - previousDrawAt) / 1000, MAX_SWING_DT)
      targets = applySwing(targets, swingBank, swingDt)

      const surface: RendererFrame = { width, height, pixelRatio }
      const three = threeRef.current
      const flat = canvas2dRef.current

      if (three) {
        /* Clears its own canvas, so an unrenderable frame is a blank frame rather than a stale one. */
        three.draw(targets, surface)
        return
      }

      if (flat) {
        flat.draw(targets, surface)
      } else if (context) {
        /* No renderer at all — the canvas is unusable. Clearing is still attempted so a stale frame from
           a previous context does not linger behind the curtain. */
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
        context.clearRect(0, 0, width, height)
      }

      /* The dots need a 2D context, which a model canvas does not have; see this file's header. */
      if (!context) return

      /* Set again rather than relying on the renderer having left it in place. They happen to agree,
         and that is the point: the overlay draws in CSS px, so whoever calls it has to say so.

         Called unconditionally, with the gate passed down rather than applied here. Gating at this call
         site is what shipped a bug: `showLabels: false` was read as "no diagnostics" when it only ever
         meant "no numbers", and `drawOverlay` went on drawing its rings and leader lines over the
         customer's face. The gate now lives in the function that draws, where it can be — and is —
         tested; see `tests/landmarkOverlay.test.ts`. */
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      drawOverlay(context, overlay, {
        video: media,
        box,
        mirror: settings.mirror,
        showDiagnostics: settings.showDiagnostics,
        showLabels: settings.showLabels,
      })
    },
    [canvasRef, videoRef, smoother],
  )

  return { draw, assetStatus, assetError }
}
