import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Icon } from './Icon'

/**
 * Form field primitives.
 *
 * `Field` owns the label / hint / error wiring so every control gets `aria-describedby` and
 * `aria-invalid` set correctly without each screen remembering to do it — see design.md §8.
 */

export interface FieldProps {
  label: ReactNode
  /** Overrides the id the label points at. Derived from `useId` when omitted. */
  id?: string
  required?: boolean
  /** Marks the field as optional in the label, for forms where most fields are required. */
  optional?: boolean
  hint?: ReactNode
  error?: string
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

export function Field({ label, id, required, optional, hint, error, children }: FieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const hintId = hint ? `${fieldId}-hint` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
        {required ? (
          <span className="field__req" aria-hidden="true">
            *
          </span>
        ) : null}
        {optional ? <span className="field__optional">Optional</span> : null}
      </label>

      {children({ id: fieldId, describedBy, invalid: Boolean(error) })}

      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {error ? (
        <p className="field__error" id={errorId} role="alert">
          <Icon name="alert" size={13} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

/* ── Controls ────────────────────────────────────────────────────────────── */

/**
 * `prefix` is omitted from the inherited attributes because the HTML `prefix` attribute is a string
 * and this one is decoration — a currency symbol or a `/s/` path stub.
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  invalid?: boolean
  /** Static text before the value, e.g. a currency symbol. */
  prefix?: ReactNode
  suffix?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, prefix, suffix, className, ...rest },
  ref,
) {
  const control = (
    <input
      ref={ref}
      className={['input', className ?? ''].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  )

  if (!prefix && !suffix) return control

  return (
    <span className={['input-affix', suffix ? 'input-affix--suffix' : ''].filter(Boolean).join(' ')}>
      {prefix ? <span className="input-affix__prefix">{prefix}</span> : null}
      {control}
      {suffix ? <span className="input-affix__suffix">{suffix}</span> : null}
    </span>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={['textarea', className ?? ''].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  )
})

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
  options: readonly SelectOption[]
  /** Rendered as a disabled placeholder when the value is empty. */
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, options, placeholder, className, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={['select', className ?? ''].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
})
