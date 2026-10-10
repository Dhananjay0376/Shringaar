/**
 * The fit controls: four sliders and a reset.
 *
 * Presentational on purpose. It takes a calibration and reports changes; it does not read or write
 * storage, and it does not know whether the piece is an earring. Persistence belongs to the page that
 * owns the session, because that is the layer that can also decide when a write is worth doing.
 *
 * The copy here is load-bearing. These sliders exist because the anchor is *estimated* from the face
 * outline — the mesh has no ear landmark at all — so the honest framing is "nudge this until it looks
 * right for your face", not "set your size". A customer who believes the default is calibrated will
 * read a placement error as a broken product instead of reaching for the control that fixes it.
 */

import { useId } from 'react'

import { CALIBRATION_BOUNDS, NEUTRAL_CALIBRATION, clampCalibration, type Calibration } from '../core/calibration'

interface SliderSpec {
  readonly key: keyof Calibration
  readonly label: string
  readonly hint: string
  readonly format: (value: number) => string
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

/* Ordered as a customer would reach for them: size first, because a piece that is obviously the
   wrong size is the one thing you notice before any offset. */
const SLIDERS: readonly SliderSpec[] = [
  { key: 'size', label: 'Size', hint: 'How large the piece is drawn.', format: (value) => `×${value.toFixed(2)}` },
  { key: 'outward', label: 'Outward', hint: 'Moves both pieces away from your face.', format: signed },
  { key: 'drop', label: 'Drop', hint: 'Moves both pieces down.', format: signed },
  { key: 'tilt', label: 'Tilt', hint: 'Lowers one side and raises the other.', format: signed },
]

export interface TryOnControlsProps {
  readonly calibration: Calibration
  readonly onChange: (next: Calibration) => void
  readonly onReset: () => void
}

export function TryOnControls({ calibration, onChange, onReset }: TryOnControlsProps): JSX.Element {
  /* `useId` rather than a literal id: two of these can be on one page — the lab renders one beside a
     preview — and duplicate ids would make every label point at the first slider. */
  const groupId = useId()
  const adjusted = !isNeutral(calibration)

  /* An explicit switch rather than `{ ...calibration, [key]: value }`. A computed key of a union type
     is the kind of expression whose inferred type depends on the TypeScript version, and this is not
     worth discovering on a compiler upgrade. The clamp is belt-and-braces — the range input already
     cannot exceed its own bounds — but it is what makes the value safe to store, so it happens here
     rather than at the storage call. */
  const setField = (key: keyof Calibration, value: number): void => {
    const next: Calibration =
      key === 'size'
        ? { ...calibration, size: value }
        : key === 'outward'
          ? { ...calibration, outward: value }
          : key === 'drop'
            ? { ...calibration, drop: value }
            : { ...calibration, tilt: value }
    onChange(clampCalibration(next))
  }

  return (
    <details className="try-fit">
      <summary className="try-fit__summary">
        Adjust the fit
        {adjusted ? <span className="try-fit__flag">adjusted</span> : null}
      </summary>

      <p className="try-note">
        The ear position is estimated from your face outline, because the tracker has no ear
        landmarks. On some faces the default sits slightly off. These nudge it — they correct
        placement, and they do not measure fit.
      </p>

      <div className="try-fit__grid">
        {SLIDERS.map((slider) => {
          const bounds = CALIBRATION_BOUNDS[slider.key]
          const value = calibration[slider.key]
          const inputId = `${groupId}-${slider.key}`
          return (
            <div className="try-fit__field" key={slider.key}>
              <label className="try-fit__label" htmlFor={inputId}>
                {slider.label}
              </label>
              <input
                id={inputId}
                className="try-fit__range"
                type="range"
                min={bounds.min}
                max={bounds.max}
                step={0.01}
                value={value}
                /* `Number(...)`, because a range input's `value` is a string and `+''` is 0 — which
                   would snap the slider to a bound whenever the event carried an empty value. */
                onChange={(event) => setField(slider.key, Number(event.target.value))}
                aria-describedby={`${inputId}-value`}
              />
              {/* `aria-describedby` on the input points here rather than an `aria-label`, so the
                  current value is announced with the control instead of only the field's name. */}
              <output className="try-fit__value" id={`${inputId}-value`} htmlFor={inputId}>
                {slider.format(value)}
              </output>
              <p className="try-fit__hint">{slider.hint}</p>
            </div>
          )
        })}
      </div>

      <button type="button" className="try-link-button" onClick={onReset} disabled={!adjusted}>
        Reset to default
      </button>
    </details>
  )
}

/**
 * Whether anything has been moved off neutral.
 *
 * Used to mark the collapsed summary, which is the only thing visible once the panel is shut — and a
 * forgotten calibration is a very plausible explanation for an earring that sits oddly. Without the
 * mark the customer has no way to tell "this is how it always looks" from "I moved this last week".
 */
function isNeutral(calibration: Calibration): boolean {
  return (
    calibration.size === NEUTRAL_CALIBRATION.size &&
    calibration.outward === NEUTRAL_CALIBRATION.outward &&
    calibration.drop === NEUTRAL_CALIBRATION.drop &&
    calibration.tilt === NEUTRAL_CALIBRATION.tilt
  )
}
