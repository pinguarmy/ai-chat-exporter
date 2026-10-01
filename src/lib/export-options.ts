import { mergeExtensionSettings, type ExportFormat, type ExportOptions, type ExtensionSettings } from './types'

/** One settings-to-renderer mapping for interactive exports and preview. */
export function buildExportOptions(format: ExportFormat, settings?: Partial<ExtensionSettings>): ExportOptions {
  const resolved = mergeExtensionSettings(settings)
  return {
    format,
    archiveBundle: resolved.archiveBundle,
    includeToolTrace: resolved.includeToolTrace,
    includeRawPayload: resolved.includeRawPayload,
    safeShare: resolved.safeShare,
    includeMetadata: resolved.includeMetadata,
    includeCodeBlocks: resolved.includeCodeBlocks,
    includeImages: resolved.includeImages,
    exportArtifacts: resolved.exportArtifacts,
    includeUploadedFiles: resolved.includeUploadedFiles,
    referenceExportMode: resolved.referenceExportMode,
    filenamePattern: resolved.filenamePattern,
    pdfStyle: resolved.pdfStyle,
    pdfTextLayer: resolved.pdfTextLayer,
    assistantDisplayName: resolved.assistantDisplayName,
    showMessageTimestamps: resolved.showMessageTimestamps,
    locale: resolved.locale,
  }
}
