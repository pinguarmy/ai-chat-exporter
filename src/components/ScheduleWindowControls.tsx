import type { ScheduledExportSettings } from '../lib/types'
import { localeTag, t, type Locale } from '../lib/i18n'
import { getScheduleWindowError } from '../lib/scheduled-export-window'
import { Toggle } from './Toggle'

export function ScheduleWindowControls({ settings, locale, onChange }: {
  settings: ScheduledExportSettings
  locale: Locale
  onChange: (settings: ScheduledExportSettings) => void
}) {
  const T = (key: string) => t(key, locale)
  const error = getScheduleWindowError(settings)
  const weekday = new Intl.DateTimeFormat(localeTag(locale), { weekday: 'long' })
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <fieldset className="schedule-window">
      <legend className="section-label">{T('Automatic export days & hours')}</legend>
      <p className="schedule-note">{t('Device local time zone: {0}', locale, timezone)}</p>
      <Toggle
        label={T('Limit to selected weekdays')}
        checked={settings.allowedDays != null}
        onChange={enabled => onChange({ ...settings, allowedDays: enabled ? [0, 1, 2, 3, 4, 5, 6] : null })}
      />
      {settings.allowedDays != null && (
        <>
          <div className="schedule-weekdays">
            {[1, 2, 3, 4, 5, 6, 0].map(day => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={settings.allowedDays!.includes(day)}
                  onChange={event => onChange({
                    ...settings,
                    allowedDays: event.target.checked
                      ? [...settings.allowedDays!, day]
                      : settings.allowedDays!.filter(value => value !== day),
                  })}
                />
                {weekday.format(new Date(2024, 0, 7 + day))}
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-outline btn-compact"
            onClick={() => onChange({ ...settings, allowedDays: [1, 2, 3, 4, 5] })}>
            {T('Weekdays (Mon–Fri)')}
          </button>
          <p className="schedule-note">{T('Weekdays means Monday–Friday; public holidays are not excluded.')}</p>
        </>
      )}
      <Toggle
        label={T('Limit to a daily time window')}
        checked={settings.dailyWindow != null}
        onChange={enabled => onChange({ ...settings, dailyWindow: enabled ? { start: '', end: '' } : null })}
      />
      {settings.dailyWindow != null && (
        <div className="platform-row-controls">
          {(['start', 'end'] as const).map(boundary => (
            <label className="platform-field" key={boundary}>
              <span>{T(boundary === 'start' ? 'Window start (inclusive)' : 'Window end (inclusive minute)')}</span>
              <input type="time" className="input schedule-control schedule-time-control"
                value={settings.dailyWindow![boundary]}
                aria-invalid={error === 'time'}
                onChange={event => onChange({
                  ...settings,
                  dailyWindow: { ...settings.dailyWindow!, [boundary]: event.target.value },
                })}
              />
            </label>
          ))}
        </div>
      )}
      {error && <p className="schedule-note status-bad" role="alert">
        {T(error === 'days'
          ? 'No weekdays selected — automatic exports are paused.'
          : 'Choose valid, different start and end times — automatic exports are paused.')}
      </p>}
      {settings.dailyWindow != null && (
        <p className="schedule-note">{T('Interval schedules follow window start + N × interval, not save time or last run. Only the latest due slot runs after a late wake. Explicit daily/weekly times take priority.')}</p>
      )}
      {(settings.allowedDays != null || settings.dailyWindow != null) && (
        <p className="schedule-note">{T('With days/hours restrictions, the browser checks once per minute. Platform export frequencies stay unchanged.')}</p>
      )}
      <p className="schedule-note">{T('An overnight window belongs to its starting weekday. Active downloads can finish; queued work waits. Run now bypasses these restrictions.')}</p>
    </fieldset>
  )
}
