import React from 'react'
import { InfoTooltip } from './InfoTooltip'

interface SectionProps {
  title: string
  hint?: string
  children: React.ReactNode
  className?: string
}

/**
 * A labelled group of related controls, separated by a hairline rule.
 * An optional `hint` hides secondary explanation behind an ⓘ tooltip.
 */
export function Section({ title, hint, children, className = '' }: SectionProps) {
  return (
    <div className={`section ${className}`}>
      <h3 className="section-label">
        {title}
        {hint && <InfoTooltip text={hint} />}
      </h3>
      <div className="section-body">{children}</div>
    </div>
  )
}
