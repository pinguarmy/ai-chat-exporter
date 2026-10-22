import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ScheduleWindowControls } from '../src/components/ScheduleWindowControls'
import { getDefaultScheduledExportSettings } from '../src/lib/scheduled-export'

afterEach(cleanup)

function Editor() {
  const [settings, setSettings] = useState(getDefaultScheduledExportSettings())
  return <><ScheduleWindowControls settings={settings} locale="en" onChange={setSettings} />
    <output data-testid="settings">{JSON.stringify(settings)}</output></>
}

describe('schedule window controls', () => {
  it('starts unrestricted, offers weekday shortcut and independent day selection, and can disable restrictions', () => {
    render(<Editor />)
    const days = screen.getByRole('switch', { name: 'Limit to selected weekdays' })
    expect((days as HTMLInputElement).checked).toBe(false)
    fireEvent.click(days)
    fireEvent.click(screen.getByRole('button', { name: 'Weekdays (Mon–Fri)' }))
    expect(JSON.parse(screen.getByTestId('settings').textContent!).allowedDays).toEqual([1, 2, 3, 4, 5])
    expect((screen.getByRole('checkbox', { name: 'Saturday' }) as HTMLInputElement).checked).toBe(false)
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) fireEvent.click(screen.getByRole('checkbox', { name: day }))
    expect(screen.getByRole('alert').textContent).toContain('No weekdays selected')
    fireEvent.click(days)
    expect(JSON.parse(screen.getByTestId('settings').textContent!).allowedDays).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('requires distinct times and displays local timezone, overnight and manual-bypass semantics', () => {
    render(<Editor />)
    fireEvent.click(screen.getByRole('switch', { name: 'Limit to a daily time window' }))
    expect(screen.getByRole('alert').textContent).toContain('automatic exports are paused')
    const start = screen.getByLabelText('Window start (inclusive)')
    const end = screen.getByLabelText('Window end (inclusive minute)')
    fireEvent.change(start, { target: { value: '22:00' } })
    fireEvent.change(end, { target: { value: '22:00' } })
    expect(screen.getByRole('alert').textContent).toContain('different start and end')
    fireEvent.change(end, { target: { value: '06:00' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(JSON.parse(screen.getByTestId('settings').textContent!).dailyWindow).toEqual({ start: '22:00', end: '06:00' })
    expect(screen.getByText(/Device local time zone:/).textContent).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(screen.getByText(/An overnight window/).textContent).toContain('Run now bypasses these restrictions')
    fireEvent.click(screen.getByRole('switch', { name: 'Limit to a daily time window' }))
    expect(JSON.parse(screen.getByTestId('settings').textContent!).dailyWindow).toBeNull()
  })
})
