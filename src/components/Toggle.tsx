import { InfoTooltip } from './InfoTooltip'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  id?: string
  /** Extra class on the row wrapper (layout adjustments by the caller). */
  className?: string
  /** Overrides the accessible name when the visible label is not enough. */
  ariaLabel?: string
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
  className = '',
  ariaLabel
}: ToggleProps) {
  const toggleId = id || `toggle-${label.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div
      className={`options-row flex items-center justify-between py-2 ${disabled ? 'opacity-50' : ''} ${className}`}
    >
      <div className="flex-col pr-4 flex-1">
        <span>
          <label htmlFor={toggleId} className="option-label text-sm font-medium cursor-pointer">
            {label}
          </label>
          {description && <InfoTooltip text={description} />}
        </span>
      </div>
      <input
        type="checkbox"
        id={toggleId}
        className="toggle"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
      />
    </div>
  )
}
