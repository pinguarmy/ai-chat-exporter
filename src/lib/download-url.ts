/**
 * Build a download URL that is safe to create inside an MV3 service worker.
 * Blob URLs are unavailable in service workers, so scheduled text exports use
 * a data URL instead.
 */
export function textToDataUrl(text: string, mimeType = 'text/plain'): string {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`
}
