/**
 * The Three.js renderer — the 3D half of the hybrid engine.
 *
 * ### Why this is a separate file and not a branch in `canvas2d.ts`
 *
 * Because the two draw fundamentally different things. The flat renderer places a rectangle; this one
 * places a scene graph through a camera. Sharing a file would mean sharing a transform stack that only
 * one of them owns, and the `canvas2d` renderer's whole design — "set the transform from scratch every
 * frame, because a saved one can accumulate" — is a statement about a 2D context that has no meaning
 * here.
 *
 * ### Why it is loaded lazily
 *
 * `await import('three')` inside the factory, never at module scope. Three is the single largest
 * dependency in this project, and a shopper looking at a necklace has no reason to download it. It
 * becomes its own chunk, and a build whose assets are all 2D never fetches it.
 *
 * ### Why a canvas cannot be both
 *
 * A canvas has exactly one context. Calling `getContext('2d')` on a canvas and then asking for WebGL on
 * the same element returns `null` — so a single canvas can never host both renderers, and the hook that
 * owns the canvas must decide which one it is *before* it touches a context. That is why the asset kind
 * is part of the hook's renderer effect rather than something swapped later.
 *
 * ### What this does not do
 *
 * - **No occlusion.** There is no face mesh in the scene, so hair, a hand or the far side of the head
 *   cannot hide the piece. The model draws on top of whatever is behind it in the video.
 * - **No animation.** No `AnimationMixer` is run, so a rigged or animated `.glb` shows its rest pose.
 * - **No real lighting solution.** Three lights, chosen to make an unlit PBR material visible rather
 *   than black. Whether a given piece looks *good* under them is a question this build does not answer
 *   and does not claim to.
 * - **No skinned-mesh support.** The scene is duplicated for the two ears with `Object3D.clone`, which
 *   shares geometry but does not rebind skeletons. See `duplicate` below.
 */

import type { Material, Mesh, Object3D, WebGLRenderer } from 'three'
import type { GLTFLoader as GLTFLoaderClass } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { isDrawableTarget, type EarSide, type PlacementTarget } from '../types/frame'
import { modelTransformFor, type ModelBounds } from './modelTransform'
import type { RendererFrame, TryOnRenderer } from './types'

/** What came back from a model load. A failure is data, not an exception — see `setModel`. */
export type ModelLoadResult =
  | { readonly ok: true; readonly bounds: ModelBounds }
  | { readonly ok: false; readonly reason: string }

export interface ThreeRenderer extends TryOnRenderer {
  /**
   * Parses a `.glb` and prepares it for drawing.
   *
   * Resolves with a failure rather than rejecting. The caller already holds a validation result and
   * will show *its* reason to the customer; a second, thrown error path here would be a second message
   * for the same problem, and the two would drift. It also keeps the hook's promise chains free of a
   * `catch` that exists only to translate an exception into the object it should have returned.
   */
  setModel(bytes: ArrayBuffer): Promise<ModelLoadResult>
  /** Drops the model and its GPU resources. The canvas keeps being cleared. */
  clearModel(): void
  readonly hasModel: boolean
  /** Releases the WebGL context and every geometry and material it holds. */
  dispose(): void
}

interface Slot {
  readonly group: Object3D
  readonly materials: Material[]
}

/**
 * Builds the renderer, or returns `null` when this browser cannot provide one.
 *
 * `null` on failure rather than a thrown error, matching `createCanvas2DRenderer`: the caller's next
 * move is the same either way — say the piece cannot be shown — and a rejected promise would surface as
 * a page-level error rather than as that sentence.
 */
export async function createThreeRenderer(canvas: HTMLCanvasElement): Promise<ThreeRenderer | null> {
  let THREE: typeof import('three')
  let GLTFLoader: typeof GLTFLoaderClass

  try {
    THREE = await import('three')
    ;({ GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js'))
  } catch {
    /* The chunk could not be fetched — offline, or a blocked CDN. `chooseRenderer` never reaches here
       without a validated model, so this is a delivery failure rather than a bad asset, and the caller's
       message says the piece cannot be shown. */
    return null
  }

  let renderer: WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  } catch {
    /* No WebGL context available: an old device, a blocklisted GPU, or a browser with it disabled.
       Three throws here rather than returning null, so the catch is the whole difference between a
       stated reason and a blank page. */
    return null
  }

  renderer.setClearAlpha(0)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
  /* Straight down the −z axis from in front. Any tilt here would make the placement a function of the
     camera as well as the target, and the flat renderer would then disagree with this one. */
  camera.position.set(0, 0, 10)

  /* Chosen to make an unlit PBR material visible rather than to look like a studio. Documented as
     untuned in the module comment, because a lighting rig presented as finished is a claim this does
     not earn. The hemisphere light keeps the underside of a piece from going fully black. */
  scene.add(new THREE.AmbientLight(0xffffff, 1.6))
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(0.5, 1, 1)
  scene.add(key)

  const loader = new GLTFLoader()

  /** The normalised template: bounding-box top-centre at the origin, unit width. */
  let template: Object3D | null = null
  let bounds: ModelBounds | null = null
  const slots = new Map<EarSide, Slot>()
  const owned = { geometries: new Set<{ dispose(): void }>(), materials: new Set<Material>() }

  let lastWidth = 0
  let lastHeight = 0
  let lastPixelRatio = 0

  function resize(frame: RendererFrame): void {
    if (frame.width === lastWidth && frame.height === lastHeight && frame.pixelRatio === lastPixelRatio) {
      return
    }
    lastWidth = frame.width
    lastHeight = frame.height
    lastPixelRatio = frame.pixelRatio
    renderer.setPixelRatio(frame.pixelRatio)
    /* `false` — do not write CSS width/height. The element is laid out by the stage's own styles, and
       letting the renderer set inline sizes would fight that layout and, on a resize, do it a frame
       late. */
    renderer.setSize(frame.width, frame.height, false)
    /* The frustum spans the box, centred on the origin, matching `modelTransformFor`'s convention. */
    camera.left = -frame.width / 2
    camera.right = frame.width / 2
    camera.top = frame.height / 2
    camera.bottom = -frame.height / 2
    camera.updateProjectionMatrix()
  }

  function collectMaterials(root: Object3D): Material[] {
    const materials: Material[] = []
    root.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh || !mesh.material) return
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const cloned = list.map((material) => {
        const copy = material.clone()
        owned.materials.add(copy)
        return copy
      })
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!
      materials.push(...cloned)
    })
    return materials
  }

  function duplicate(source: Object3D): Slot {
    /* `clone(true)` copies the subtree and shares geometry — the right trade for a static model: the
       vertices are uploaded once. Materials must NOT be shared, because opacity is per ear and a shared
       material would make both sides fade together. `SkeletonUtils.clone` is what a rigged model would
       need; nothing here runs an animation, so a skinned model shows its rest pose. */
    const copy = source.clone(true)
    /* Added to the scene here, by the function that creates it, rather than by the caller.
       A `Slot` that is not in the scene is invisible in the worst way: `draw` sets `visible`,
       `position`, `rotation` and `scale` on it and the renderer skips the entire subtree, so the piece
       never appears, no error is raised, and `renderer.info.render.calls` stays at zero — which is
       exactly what an unloaded model looks like. Measured, not imagined: with the `scene.add` missing,
       a validated 1 × 1.5 model produced zero draw calls and zero lit pixels. Keeping the add beside
       the clone makes `slots` and `scene` unable to disagree. `clearModel` is the matching removal. */
    scene.add(copy)
    return { group: copy, materials: collectMaterials(copy) }
  }

  function clearModel(): void {
    for (const slot of slots.values()) scene.remove(slot.group)
    slots.clear()
    template = null
    bounds = null
    for (const material of owned.materials) material.dispose()
    for (const geometry of owned.geometries) geometry.dispose()
    owned.materials.clear()
    owned.geometries.clear()
  }

  return {
    kind: 'three',

    get hasModel(): boolean {
      return template !== null
    },

    setModel(bytes: ArrayBuffer): Promise<ModelLoadResult> {
      clearModel()

      return new Promise<ModelLoadResult>((resolve) => {
        loader.parse(
          bytes,
          '',
          (gltf) => {
            const box = new THREE.Box3().setFromObject(gltf.scene)
            const size = box.getSize(new THREE.Vector3())
            const centre = box.getCenter(new THREE.Vector3())

            /* A model can be valid glTF — meshes present, JSON parseable — and still measure zero: a
               mesh with no positions, or one whose vertices are all at the origin. Its scale would be
               a division by zero turned into `Infinity`, and an infinite matrix puts the piece
               nowhere while reporting success. Refusing is the only answer that can be acted on. */
            if (!Number.isFinite(size.x) || size.x <= 0) {
              resolve({ ok: false, reason: 'The model has no measurable width, so there is nothing to size it by.' })
              return
            }

            /* Normalisation, in three moves: centre the bounding box on the origin, lift it so its
               *top* sits on the origin, then scale the whole pivot to unit width. Afterwards the
               pivot's origin is the model's bounding-box top-centre — the same anchor
               `PlacementTarget.x`/`y` names for the flat renderer. */
            gltf.scene.position.set(-centre.x, -box.max.y, -centre.z)

            const pivot = new THREE.Group()
            pivot.add(gltf.scene)
            pivot.scale.setScalar(1 / size.x)

            /* Collected once, here, because `clearModel` must be able to release them and a traverse per
               frame to find them would be work with no purpose. */
            gltf.scene.traverse((node) => {
              const mesh = node as Mesh
              if (mesh.isMesh && mesh.geometry) owned.geometries.add(mesh.geometry)
            })

            template = pivot
            bounds = { width: 1, height: size.y / size.x, depth: size.z / size.x }

            /* One subtree per ear. Two targets cannot share one `Object3D`: a node has a single
               position, so the second assignment would move the first piece rather than place a
               second — the classic "only one earring shows" bug. */
            slots.set('left', duplicate(pivot))
            slots.set('right', duplicate(pivot))

            resolve({ ok: true, bounds: bounds })
          },
          () => {
            /* The container passed `inspectGlbBytes`, so this is the model's own contents failing to
               parse — a Draco-compressed or otherwise extension-dependent file is the usual cause. The
               message names the consequence rather than the exception, which is not useful to a
               shopper. */
            resolve({ ok: false, reason: 'The model could not be read by the 3D viewer.' })
          },
        )
      })
    },

    clearModel,

    draw(targets: readonly PlacementTarget[], frame: RendererFrame): void {
      resize(frame)
      /* The clear is the renderer's, and it happens whether or not there is a model — a frame with no
         targets is a frame that must show nothing, not a frame that keeps the last one. */
      renderer.clear()

      if (!bounds) {
        renderer.render(scene, camera)
        return
      }

      for (const slot of slots.values()) slot.group.visible = false
      if (!slots.has('left') || !slots.has('right')) {
        /* Not yet populated. Rendering the empty scene is the correct frame — the model is still being
           prepared, and leaving the previous frame on the canvas would show a stale position. */
        renderer.render(scene, camera)
        return
      }

      for (const target of targets) {
        if (!isDrawableTarget(target)) continue
        const slot = slots.get(target.side)
        if (!slot) continue

        const transform = modelTransformFor(target, frame, bounds)
        if (!transform) continue

        slot.group.visible = true
        slot.group.position.set(transform.x, transform.y, transform.z)
        slot.group.rotation.z = transform.rotationZ
        /* Scale is set rather than multiplied: the previous frame's value is still there, and
           `multiplyScalar` on it would compound every frame into a model that grows without bound. */
        slot.group.scale.set(transform.scale * transform.squash, transform.scale, transform.scale)

        for (const material of slot.materials) {
          material.opacity = transform.opacity
          material.transparent = transform.opacity < 1
          material.needsUpdate = true
        }
      }

      renderer.render(scene, camera)
    },

    dispose(): void {
      clearModel()
      renderer.dispose()
    },
  }
}
