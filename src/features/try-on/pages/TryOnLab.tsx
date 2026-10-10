/**
 * `/tryon/lab` — the developer's view of the tracking engine.
 *
 * This route exists to answer questions with evidence rather than assumption. First: **are the
 * landmark indices in `core/landmarks.ts` actually where the solver thinks they are?** The earring
 * solver derives an ear position from six face-oval points, and the only honest way to choose those
 * six is to draw them on a real face and look. Second, now: **does the solved position land on the
 * ear?** That is a different question from the first, and it needs the earring drawn, not just the
 * dots — an anchor can be exactly where it was asked to be and still be in the wrong place.
 *
 * So it draws both, together: the earrings underneath, the landmark dots on top. Turning the dots off
 * is how you check the effect; leaving them on is how you check the cause.
 *
 * It is deliberately not the customer view. That is Stage 3, and it will be a separate route with
 * separate copy, no diagnostics and no file picker.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'

import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { readImageFile, validateImageFile } from '@/lib/files'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { paths } from '@/routes/paths'
import { TryOnControls } from '../components/TryOnControls'
import { TryOnStage } from '../components/TryOnStage'
import {
  browserCalibrationStore,
  loadCalibration,
  neutralCalibration,
  saveCalibration,
  type Calibration,
} from '../core/calibration'
import { buildFaceFrame } from '../core/framing'
import { FACE_LANDMARKS } from '../core/landmarks'
import { devEarringDataUrl } from '../assets/devPlaceholder'
import { useEarringRender, type RenderAsset } from '../hooks/useEarringRender'
import { useTryOnSession } from '../hooks/useTryOnSession'
import { DEFAULT_TRACKING_CONFIG, type TrackerFrame, type TrackingStatus } from '../types/frame'

/** A short, plain description of each state, for the status chip. */
const STATUS_LABEL: Record<TrackingStatus, string> = {
  idle: 'Idle',
  acquiring: 'Looking for a face…',
  tracking: 'Tracking',
  holding: 'Holding last position',
  lost: 'Face lost',
}

const PLACEHOLDER_LABEL = 'Dev placeholder'

export function TryOnLab() {
  /* The lab is a dev route but a normal page as far as the tab is concerned; without this it inherits
     whichever title the previous screen left. */
  useDocumentTitle('Try-on lab')

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [showLabels, setShowLabels] = useState(false)
  const [mirror, setMirror] = useState(true)

  /* Loaded once, at mount. Reading storage in a lazy initialiser rather than an effect means the first
     frame the customer sees is already calibrated — an effect would render one frame at neutral and
     then snap, which on a slider-driven correction is a visible jump. */
  const [calibration, setCalibration] = useState<Calibration>(() => loadCalibration(browserCalibrationStore()))
  const [calibrationSaved, setCalibrationSaved] = useState(true)

  const [asset, setAsset] = useState<RenderAsset>(() => ({ kind: 'image', url: devEarringDataUrl() }))
  const [assetLabel, setAssetLabel] = useState(PLACEHOLDER_LABEL)
  const [pickError, setPickError] = useState<string | null>(null)

  /* The object URL a picked model is served from, so it can be revoked when it is replaced or when the
     page goes away. Without this the browser holds the whole file alive for the lifetime of the
     document — a 45 MB leak per file tried, invisible until the tab is measured. */
  const modelUrlRef = useRef<string | null>(null)

  const releaseModelUrl = useCallback(() => {
    if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current)
    modelUrlRef.current = null
  }, [])

  useEffect(() => releaseModelUrl, [releaseModelUrl])

  /* The session has to come first, because the renderer needs the session's `<video>` element to read
     the camera's frame size off it. But the session's frame callback needs the renderer. The cycle is
     broken with a ref: the session always calls whatever `draw` is current, and the ref is filled by an
     effect — which is guaranteed to have run before the first frame, because frames only begin once the
     customer presses Start. Passing the session a ref of its own creation instead would be the bug
     this avoids: a fresh ref every render is never attached to the `<video>`, so `videoWidth` would
     read 0 forever and nothing would ever be drawn. */
  const drawRef = useRef<(frame: TrackerFrame | null, status: TrackingStatus) => void>(() => {})

  const session = useTryOnSession({
    /* Every frame goes to the renderer, including the `null` ones. A null frame while `holding` is what
       replays the last good placement, and a null frame with any other status is what clears the canvas
       after Stop. */
    onFrame: (frame, status) => drawRef.current(frame, status),
  })

  const render = useEarringRender({
    canvasRef,
    videoRef: session.videoRef,
    asset,
    mirror,
    calibration,
    /* The lab is where the dots belong, so they are on by default here and the checkbox adds the
       numbers. The product page passes neither — see `useEarringRender`.
       Note that a *model* asset has no dots at all, whatever this says: the dots are drawn on a 2D
       context and a model canvas is a WebGL one. The card below says so rather than leaving it to be
       discovered. */
    showDiagnostics: true,
    showLabels,
  })

  useEffect(() => {
    drawRef.current = render.draw
  }, [render.draw])

  const handleCalibration = useCallback((next: Calibration) => {
    setCalibration(next)
    /* Written on every slider step. That is ~60 writes a second of a 60-byte string while the customer
       drags — cheap enough not to need a debounce, and a debounce would add a timer whose cleanup has
       to be right for no measurable gain. The boolean is surfaced, because a private window silently
       refuses the write and "your correction will not be remembered" is worth knowing. */
    setCalibrationSaved(saveCalibration(browserCalibrationStore(), next))
  }, [])

  const handleResetCalibration = useCallback(() => {
    const neutral = neutralCalibration()
    setCalibration(neutral)
    setCalibrationSaved(saveCalibration(browserCalibrationStore(), neutral))
  }, [])

  const handlePickFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    /* Cleared before the await so picking the same file a second time still fires `change`, and so a
       slow read cannot be raced by a fast second pick. */
    event.target.value = ''
    if (!file) return

    const problem = validateImageFile(file)
    if (problem) {
      setPickError(problem)
      return
    }

    try {
      const result = await readImageFile(file)
      setPickError(null)
      releaseModelUrl()
      setAsset({ kind: 'image', url: result.dataUrl })
      setAssetLabel(result.fileName)
    } catch {
      setPickError('That file could not be read.')
    }
  }, [releaseModelUrl])

  /**
   * Loads a `.glb` from this device into the real 3D path.
   *
   * The file is handed to the renderer as an object URL and read back through the same `fetch` the
   * product page uses, rather than being parsed from a `File` directly. That is deliberate: it means
   * the lab exercises `chooseRenderer`'s model branch — fetch, inspect the bytes, parse, place — with
   * no branch of its own to drift from the customer path. A local shortcut here would verify the
   * shortcut.
   *
   * Nothing is validated before the hand-off. The hook fetches the bytes, inspects the container and
   * reports a precise reason through `render.assetError`, so a second copy of that check in this file
   * would be a second place for the two messages to disagree.
   */
  const handlePickModel = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      setPickError(null)
      releaseModelUrl()
      const url = URL.createObjectURL(file)
      modelUrlRef.current = url
      setAssetLabel(file.name)
      setAsset({ kind: 'model', url })
    },
    [releaseModelUrl],
  )

  const usePlaceholder = useCallback(() => {
    setPickError(null)
    releaseModelUrl()
    setAssetLabel(PLACEHOLDER_LABEL)
    setAsset({ kind: 'image', url: devEarringDataUrl() })
  }, [releaseModelUrl])

  /* Derived per render from the ref, for the readouts below. Not state, for the same reason the frame
     is not: this is a lab readout, and it is read once per render rather than driving one. */
  const frame = session.frameRef.current
  const faceFrame = (() => {
    const video = session.videoRef.current
    const box = canvasRef.current
    if (!frame || !video || !box) return null
    return buildFaceFrame(
      frame.landmarks,
      { width: video.videoWidth, height: video.videoHeight },
      { width: box.clientWidth, height: box.clientHeight },
      mirror,
    )
  })()

  return (
    <div className="try-page">
      <PageHeader
        title="Try-on lab"
        subtitle="Developer diagnostics for the AR tracking engine. Not the customer experience."
      />

      <div className="try-lab">
        <TryOnStage
          videoRef={session.videoRef}
          canvasRef={canvasRef}
          /* A fresh canvas when the asset kind changes — a canvas that has been asked for a 2D context
             can never hand out a WebGL one. See `TryOnStage`. */
          canvasKey={asset.kind}
          status={session.status}
          error={session.error}
          onStart={() => void session.start()}
          isSupported={session.isSupported}
          /* The same `mirror` the overlay, the earring solver and the face frame are given. One flag,
             four consumers — see the note at the top of `TryOnStage` for why they must not diverge. */
          mirror={mirror}
          badge={
            <span className={`try-chip try-chip--${session.trackingStatus}`}>
              {STATUS_LABEL[session.trackingStatus]}
            </span>
          }
        >
          <label className="try-toggle">
            <input type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} />
            Mirror preview
          </label>
          <label className="try-toggle">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(event) => setShowLabels(event.target.checked)}
            />
            Show landmark indices
          </label>
          {session.cameras.length > 1 ? (
            <label className="try-select">
              Camera
              <select
                onChange={(event) => void session.selectCamera(event.target.value)}
                value=""
                disabled={session.status !== 'running'}
              >
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
          <button type="button" className="try-link-button" onClick={session.stop} disabled={session.status === 'idle'}>
            Stop camera
          </button>
        </TryOnStage>

        <div className="try-lab__panels">
          <Card>
            <CardHeader title="Tracking" />
            <CardBody>
              <dl className="try-readout">
                <div>
                  <dt>Status</dt>
                  <dd>{STATUS_LABEL[session.trackingStatus]}</dd>
                </div>
                <div>
                  <dt>Frames per second</dt>
                  {/* Reported as measured. A low number here is the honest signal that the device is
                      struggling, which is exactly what this panel is for. */}
                  <dd>{session.stats.fps > 0 ? session.stats.fps.toFixed(1) : '—'}</dd>
                </div>
                <div>
                  <dt>Detection time</dt>
                  <dd>{session.stats.lastDetectMs > 0 ? `${session.stats.lastDetectMs.toFixed(1)} ms` : '—'}</dd>
                </div>
                <div>
                  <dt>Frames skipped</dt>
                  <dd>{session.stats.skipped}</dd>
                </div>
                <div>
                  <dt>Landmarks</dt>
                  <dd>{frame ? frame.landmarks.length : '—'}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{frame ? frame.confidence.toFixed(2) : '—'}</dd>
                </div>
                <div>
                  <dt>Acquire / hold</dt>
                  <dd>
                    {DEFAULT_TRACKING_CONFIG.acquireFrames} / {DEFAULT_TRACKING_CONFIG.holdFrames} frames
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Face frame" />
            <CardBody>
              {/* These are the numbers the earring solver consumes. If the interocular distance does
                  not look right here, no amount of calibration downstream will fix placement. */}
              <dl className="try-readout">
                <div>
                  <dt>Interocular</dt>
                  <dd>{faceFrame ? `${faceFrame.interocular.toFixed(1)} px` : '—'}</dd>
                </div>
                <div>
                  <dt>Roll</dt>
                  <dd>{faceFrame ? `${((faceFrame.roll * 180) / Math.PI).toFixed(1)}°` : '—'}</dd>
                </div>
                <div>
                  <dt>Yaw</dt>
                  <dd>{faceFrame ? `${((faceFrame.yaw * 180) / Math.PI).toFixed(1)}°` : '—'}</dd>
                </div>
              </dl>
              <p className="try-note">
                Yaw is inferred from depth between the two cheek clusters. It is a relative indicator
                used to fade and squash — not a head pose measurement.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Fit" />
            <CardBody>
              <dl className="try-readout">
                <div>
                  <dt>Size</dt>
                  <dd>×{calibration.size.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Outward</dt>
                  <dd>{calibration.outward.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Drop</dt>
                  <dd>{calibration.drop.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Tilt</dt>
                  <dd>{calibration.tilt.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Remembered</dt>
                  <dd>{calibrationSaved ? 'Yes, in this browser' : 'No — will reset'}</dd>
                </div>
              </dl>
              <TryOnControls
                calibration={calibration}
                onChange={handleCalibration}
                onReset={handleResetCalibration}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Try-on asset" />
            <CardBody>
              <dl className="try-readout">
                <div>
                  <dt>Piece</dt>
                  <dd>{render.assetStatus === 'ready' ? assetLabel : '—'}</dd>
                </div>
                <div>
                  <dt>Kind</dt>
                  <dd>{asset.kind === 'model' ? '3D model' : 'flat image'}</dd>
                </div>
                <div>
                  <dt>State</dt>
                  <dd>{render.assetStatus}</dd>
                </div>
              </dl>

              <p className="try-note">
                The default is a generated placeholder, not a photograph of real jewellery — it is
                drawn only to judge where the anchor lands. A file you pick stays in this browser
                tab; it is never uploaded or stored.
              </p>

              {render.assetError || pickError ? (
                <p className="try-note try-note--warn">{render.assetError ?? pickError}</p>
              ) : null}

              {asset.kind === 'model' ? (
                <p className="try-note">
                  Landmark dots are not drawn over a model: they need a 2D canvas and this one is
                  WebGL. The solver is the same one the flat path uses, so the dots are checked with an
                  image asset and the 3D placement is judged on its own.
                </p>
              ) : null}

              <div className="try-asset__actions">
                <label className="try-asset__pick">
                  Use your own image
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void handlePickFile(event)} />
                </label>
                <label className="try-asset__pick">
                  Use a 3D model (.glb)
                  <input type="file" accept=".glb,model/gltf-binary" onChange={handlePickModel} />
                </label>
                <button
                  type="button"
                  className="try-link-button"
                  onClick={usePlaceholder}
                  disabled={assetLabel === PLACEHOLDER_LABEL}
                >
                  Use the placeholder
                </button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Indices the solver reads" />
            <CardBody>
              <p className="try-note">
                These are the face-oval points nearest the ears, not earlobes. The mesh has no earlobe
                landmark, so the solver extrapolates outward from their average.
              </p>
              <dl className="try-readout">
                <div>
                  <dt>Ruler (scale)</dt>
                  <dd>
                    {FACE_LANDMARKS.rulerA} / {FACE_LANDMARKS.rulerB}
                  </dd>
                </div>
                <div>
                  <dt>Cluster A</dt>
                  <dd>{FACE_LANDMARKS.clusterA.join(', ')}</dd>
                </div>
                <div>
                  <dt>Cluster B</dt>
                  <dd>{FACE_LANDMARKS.clusterB.join(', ')}</dd>
                </div>
                <div>
                  <dt>Jaw A</dt>
                  <dd>{FACE_LANDMARKS.jawA.join(', ')}</dd>
                </div>
                <div>
                  <dt>Jaw B</dt>
                  <dd>{FACE_LANDMARKS.jawB.join(', ')}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      <p className="try-note">
        Back to the <Link to={paths.marketing.landing}>home page</Link>.
      </p>
    </div>
  )
}

/**
 * A dev-only route in production too, deliberately.
 *
 * It is harmless — it renders no seller data and needs no session — and gating it behind
 * `import.meta.env.DEV` would make it untestable in a production build, which is exactly where a
 * camera or permission regression is most expensive to discover.
 */
