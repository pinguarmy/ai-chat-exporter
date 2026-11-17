/**
 * Options page entry point (thin shell).
 * Redesigned settings page featuring visually distinct card layouts,
 * theme configuration, auto-save feedback, and rate-limiting scheduled exports.
 * State and effects live in `components/options/hooks`, the cards in
 * `components/options`.
 */

import './styles/popup.css'
import './styles/options.css'
import { AboutCard, SaveNotification, SupportCard } from './components/options/AboutCards'
import { ContentCard } from './components/options/ContentCard'
import { GeneralCard } from './components/options/GeneralCard'
import { OptionsHero } from './components/options/OptionsHero'
import { ScheduleCard } from './components/options/ScheduleCard'
import { useOptionsSettings } from './components/options/hooks/useOptionsSettings'
import { useScheduledExportStatus } from './components/options/hooks/useScheduledExportStatus'
import { buildFilenamePreview } from './components/options/options-preview'
import { t, type Locale, type MessageKey } from './lib/i18n'
import { useFullPageScroll } from './lib/use-full-page-scroll'
import { useThemeSync } from './lib/use-theme-sync'
import { useLocaleSync } from './lib/use-locale-sync'

/**
 * Options page component
 */
export default function Options() {
  useFullPageScroll()

  const {
    settings, saved, scheduleSettings, scheduleExpanded, setScheduleExpanded,
    updateSetting, saveScheduleSettings,
  } = useOptionsSettings()

  const locale: Locale = settings.locale ?? 'en'
  const T = (key: MessageKey) => t(key, locale)

  // Synchronize HTML data-theme attribute with theme setting
  useThemeSync(settings.theme)
  useLocaleSync(locale)

  const {
    scheduleStatus, nextRunAt, stoppingScheduledExport,
    triggerScheduledExport, stopScheduledExport, clearExportHistory,
  } = useScheduledExportStatus(scheduleSettings)

  const { previewFolder, previewPath } = buildFilenamePreview(settings)

  return (
    <div className="options-container">
      <OptionsHero
        theme={settings.theme}
        T={T}
        onToggleTheme={() => updateSetting('theme', settings.theme === 'dark' ? 'light' : 'dark')}
      />

      {/* CARD 1: General & Appearance */}
      <GeneralCard settings={settings} locale={locale} T={T} previewPath={previewPath} updateSetting={updateSetting} />

      {/* CARD 2: Export Content Configuration */}
      <ContentCard settings={settings} T={T} updateSetting={updateSetting} />

      {/* CARD 3: Scheduled Auto-Export — rail states the contract, ledger holds the detail */}
      <ScheduleCard
        scheduleSettings={scheduleSettings}
        scheduleExpanded={scheduleExpanded}
        setScheduleExpanded={setScheduleExpanded}
        scheduleStatus={scheduleStatus}
        nextRunAt={nextRunAt}
        stoppingScheduledExport={stoppingScheduledExport}
        locale={locale}
        T={T}
        previewFolder={previewFolder}
        saveScheduleSettings={saveScheduleSettings}
        triggerScheduledExport={triggerScheduledExport}
        stopScheduledExport={stopScheduledExport}
        clearExportHistory={clearExportHistory}
      />

      <SupportCard locale={locale} />

      {/* CARD 4: About & License */}
      <AboutCard locale={locale} T={T} />

      {saved && <SaveNotification T={T} />}
    </div>
  )
}
