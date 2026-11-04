import type { Conversation, ExportOptions } from '../lib/types'
import { exportCoverage } from '../lib/export-coverage'
import { t, type Locale } from '../lib/i18n'

/** Export coverage is separate from provider transcript-structure verification. */
export function ExportCoverage({ conversation, options, locale }: { conversation: Conversation; options: ExportOptions; locale: Locale }) {
  const coverage = exportCoverage(conversation, options)
  return <details className="export-diagnostics export-coverage">
    <summary>{t('What this export includes', locale)}</summary>
    <p className="text-xs">{t('{0} messages · {1} source references · {2} attachment labels · {3} artifact bodies', locale,
      coverage.messages, coverage.references, coverage.attachmentLabels, coverage.artifactBodies)}</p>
    {coverage.artifactLinks > 0 && <p className="text-xs">{t('{0} artifacts have no captured body. Only their available labels or links are included.', locale, coverage.artifactLinks)}</p>}
    {coverage.unavailableImages > 0 && <p className="text-xs">{t('{0} images have no available URL. Their labels remain in the export.', locale, coverage.unavailableImages)}</p>}
    <p className="text-xs text-muted">{t('External files are not downloaded. Remote images may expire. Interactive apps, Canvas documents and artifact versions are not guaranteed to be captured.', locale)}</p>
    {options.format === 'markdown' && options.archiveBundle && <p className="text-xs text-muted">{t('The ZIP preserves captured inline artifact text. It does not replay interactive apps or include their server data.', locale)}</p>}
  </details>
}
