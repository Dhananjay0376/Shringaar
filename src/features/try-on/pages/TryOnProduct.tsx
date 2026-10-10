/**
 * `/tryon/:productId` — the customer's try-on.
 *
 * This is the route `tryOnUrl()` in `@/lib/catalog` has always built and the product page has always
 * linked to; until now nothing served it, and the product page said as much. It is the same engine as
 * `/tryon/lab` and a deliberately different page: no landmark dots, no fps counter, no file picker, no
 * index tables. A shopper gets the camera, the piece, and a way to correct the fit.
 *
 * ### What it claims, and what it does not
 *
 * Every sentence below is chosen to be true of what this actually does. It places a flat image of a
 * piece at an estimated ear position in live video, on the customer's own device, uploading nothing.
 * It does not model the piece in 3D, it does not know where the earlobe is, and it cannot tell that
 * hair is covering an ear. Saying so costs a little polish and buys the customer an accurate
 * expectation — which is the trade the client spec asks for explicitly.
 *
 * ### Why the renderer choice is not a guess
 *
 * `chooseRenderer` is given a measured `AssetValidation`, never an assumption from the URL's
 * extension. A `.glb` is fetched and inspected before 3D is even considered, and when this build has
 * no renderer for it the page says that plainly rather than falling back to something that cannot
 * draw the asset.
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { paths } from '@/routes/paths'
import { validateGlbUrl } from '../assets/load'
import { TryOnControls } from '../components/TryOnControls'
import { TryOnStage } from '../components/TryOnStage'
import {
  browserCalibrationStore,
  loadCalibration,
  neutralCalibration,
  saveCalibration,
  type Calibration,
} from '../core/calibration'
import { useArProduct } from '../hooks/useArProduct'
import { renderAssetFor, useEarringRender } from '../hooks/useEarringRender'
import { useTryOnSession } from '../hooks/useTryOnSession'
import { chooseRenderer } from '../renderers/select'
import { arAssetFor, UNCHECKED_ASSET, type ArAsset, type AssetValidation } from '../types/asset'
import type { TrackerFrame, TrackingStatus } from '../types/frame'

const STATUS_LABEL: Record<TrackingStatus, string> = {
  idle: 'Camera off',
  acquiring: 'Looking for your face…',
  tracking: 'Tracking',
  holding: 'Hold still…',
  lost: 'Face not visible',
}

export function TryOnProduct() {
  const { productId } = useParams<{ productId: string }>()
  const product = useArProduct(productId)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [mirror, setMirror] = useState(true)
  const [showFit, setShowFit] = useState(false)

  const [calibration, setCalibration] = useState<Calibration>(() => loadCalibration(browserCalibrationStore()))

  const view = product.data
  const asset = arAssetFor(view?.product ?? null)

  /* The validation the renderer choice depends on. Starts `unchecked` — which is *not* a synonym for
     success — and is replaced by a measurement only when there is a model to measure. An image needs
     no validation: there is no format to be wrong, and a broken URL fails at load with its own error. */
  const [validation, setValidation] = useState<AssetValidation>(UNCHECKED_ASSET)

  useEffect(() => {
    if (!asset || asset.kind !== 'glb') {
      setValidation(UNCHECKED_ASSET)
      return
    }

    let active = true
    setValidation(UNCHECKED_ASSET)
    void validateGlbUrl(asset.url).then((result) => {
      if (active) setValidation(result)
    })

    return () => {
      active = false
    }
  }, [asset?.url, asset?.kind])

  const choice = asset ? chooseRenderer(asset, validation) : null

  /* Every other page in this app declares its own tab title, and this one is reached by an in-app
     `<Link>` from the product page — so without this the tab keeps saying whatever the previous page
     said. The title follows the same fallback chain the heading does. */
  useDocumentTitle(view ? `Try on ${view.product.name}` : 'Try it on')

  return (
    <div className="try-page">
      <PageHeader
        title={view ? view.product.name : 'Try it on'}
        subtitle={view ? view.store.name : undefined}
      />

      {product.loading ? (
        <Card>
          <CardBody>
            <Skeleton />
          </CardBody>
        </Card>
      ) : product.error ? (
        <Notice title="This product could not be loaded">
          <p className="try-note try-note--warn">{product.error}</p>
          <Button onClick={product.reload}>Try again</Button>
        </Notice>
      ) : !view || !asset ? (
        <Notice title="No try-on for this piece">
          <p className="try-note">
            This product has no try-on asset, or its category does not have a try-on experience yet.
            Only earrings can be tried on today.
          </p>
          {view ? <BackToProduct storeSlug={view.store.slug} productId={view.product.id} /> : null}
        </Notice>
      ) : choice && choice.renderer === 'none' ? (
        <Notice title="Try-on is not available for this piece">
          {/* The reason comes from `chooseRenderer`, so the page and the console agree on why. */}
          <p className="try-note">{choice.reason}</p>
          <BackToProduct storeSlug={view.store.slug} productId={view.product.id} />
        </Notice>
      ) : (
        /* The two drawable paths — `canvas2d` and `three` — differ in what they draw, not in how the
           page is wired: both take the camera, both get the same solved targets, and the choice between
           them was made by `chooseRenderer`. `asset` is non-null here: the branches above have taken
           every case where it could be absent, including a model that failed validation. */
        <TryOnRun
          asset={asset}
          canvasRef={canvasRef}
          mirror={mirror}
          onMirrorChange={setMirror}
          calibration={calibration}
          onCalibration={setCalibration}
          showFit={showFit}
          onShowFitChange={setShowFit}
          footer={<BackToProduct storeSlug={view.store.slug} productId={view.product.id} />}
        />
      )}

      {product.dataSource === 'demo' ? (
        <p className="try-note">
          This store is showing sample data, so the piece pictured is not a real listing.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The working experience, split out so the camera only ever exists on the branch that draws.
 *
 * Mounting `useTryOnSession` higher up would start a camera prompt for products whose try-on cannot
 * run at all — asking a shopper for camera access and then telling them the piece is unavailable is
 * a worse answer than never asking.
 */
function TryOnRun({
  asset,
  canvasRef,
  mirror,
  onMirrorChange,
  calibration,
  onCalibration,
  showFit,
  onShowFitChange,
  footer,
}: {
  asset: ArAsset
  canvasRef: RefObject<HTMLCanvasElement>
  mirror: boolean
  onMirrorChange: (next: boolean) => void
  calibration: Calibration
  onCalibration: (next: Calibration) => void
  showFit: boolean
  onShowFitChange: (next: boolean) => void
  footer: ReactNode
}) {
  /* The session first, then the renderer, then the ref that joins them — the same ordering the lab
     uses and for the same reason: the renderer needs the session's `<video>` to read the camera's
     frame size from, while the session's frame callback needs the renderer's `draw`. */
  const drawRef = useRef<(frame: TrackerFrame | null, status: TrackingStatus) => void>(() => {})

  /* `usdz` cannot reach here — `chooseRenderer` refuses it — so "not an image" means a model. Derived
     rather than passed so the copy and the renderer cannot be told different things about the same
     asset. */
  const isModel = asset.kind !== 'image'

  const session = useTryOnSession({
    onFrame: (frame, status) => drawRef.current(frame, status),
  })

  const render = useEarringRender({
    canvasRef,
    videoRef: session.videoRef,
    asset: renderAssetFor(asset),
    mirror,
    calibration,
    /* Neither is passed, so both default to off. The dots and their numbers are how the engine is
       debugged, not what a customer came for — and "off" has to mean the dots are not drawn, not just
       that they are unlabelled. */
  })

  useEffect(() => {
    drawRef.current = render.draw
  }, [render.draw])

  const handleCalibration = (next: Calibration) => {
    onCalibration(next)
    /* Written on every step, and the result is not surfaced here: a customer does not need to know
       that a private window refused a write, and the slider visibly does the right thing either way. */
    saveCalibration(browserCalibrationStore(), next)
  }

  return (
    <div className="try-customer">
      <TryOnStage
        videoRef={session.videoRef}
        canvasRef={canvasRef}
        status={session.status}
        error={session.error}
        onStart={() => void session.start()}
        isSupported={session.isSupported}
        mirror={mirror}
        badge={
          <span className={`try-chip try-chip--${session.trackingStatus}`}>
            {STATUS_LABEL[session.trackingStatus]}
          </span>
        }
      >
        {session.status === 'running' ? (
          <button type="button" className="try-link-button" onClick={session.stop}>
            Stop camera
          </button>
        ) : null}
        {session.status === 'running' && session.cameras.length > 1 ? (
          <label className="try-select">
            Camera
            <select onChange={(event) => void session.selectCamera(event.target.value)} value="" disabled={session.status !== 'running'}>
              <option value="" disabled>
                Switch camera…
              </option>
              {session.cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </TryOnStage>

      {render.assetStatus === 'error' && render.assetError ? (
        <p className="try-note try-note--warn">{render.assetError}</p>
      ) : null}

      {/* Folded away by default: most customers want the piece on their ears, not four sliders. It is
          here, and one tap away, because the anchor cannot be right for every face — that is a stated
          limitation of the engine, not an inconvenience to hide. */}
      <Card>
        <CardHeader
          title="Fit"
          actions={
            <button
              type="button"
              className="try-link-button"
              aria-expanded={showFit}
              onClick={() => onShowFitChange(!showFit)}
            >
              {showFit ? 'Hide' : 'Adjust if it sits wrong'}
            </button>
          }
        />
        <CardBody>
          {showFit ? (
            <TryOnControls
              calibration={calibration}
              onChange={handleCalibration}
              onReset={() => handleCalibration(neutralCalibration())}
            />
          ) : (
            <p className="try-note">
              The piece is placed from an estimate of where your ear is. If it sits slightly off,
              you can nudge it.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="How this works" />
        <CardBody>
          <ul className="try-truths">
            <li>Everything runs in your browser. No photo or video leaves your device.</li>
            <li>
              {isModel
                ? 'This is the seller’s 3D model of the piece, placed at an estimated position. It is not a fitment guide.'
                : 'This places a flat image of the piece on your ears — it is not a 3D model, and it is not a fitment guide.'}
            </li>
            <li>
              The position is estimated from face points near your ear, not from your earlobe, so a
              small offset is normal.
            </li>
            <li>Hair over your ear cannot be detected, so the piece may draw on top of it.</li>
            {isModel ? (
              /* Specific to the 3D path, and deliberately not softened: there is no face mesh in the
                 scene, so nothing can occlude the piece. A customer who expects the earring to
                 disappear behind their hair will read its absence as a bug. */
              <li>
                The model is drawn over the video with no depth test, so nothing in the picture can
                hide it.
              </li>
            ) : null}
            <li>Placement is least accurate when your head is turned far to one side.</li>
          </ul>
        </CardBody>
      </Card>

      <label className="try-toggle">
        <input type="checkbox" checked={mirror} onChange={(event) => onMirrorChange(event.target.checked)} />
        Mirror the preview
      </label>

      {footer}
    </div>
  )
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>{children}</CardBody>
    </Card>
  )
}

/** A way back to the product, using the canonical store-scoped URL rather than the bare id. */
function BackToProduct({ storeSlug, productId }: { storeSlug: string; productId: string }) {
  return (
    <p className="try-note">
      <Link to={paths.public.product(storeSlug, productId)}>Back to the product</Link>
    </p>
  )
}
