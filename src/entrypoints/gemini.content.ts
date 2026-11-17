import { defineContentScript } from 'wxt/utils/define-content-script'

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  // Capture the page's very first batchexecute request. At document_idle that
  // request is usually already over, leaving the bulk UI with no credential
  // and forcing it into the virtualized sidebar fallback.
  runAt: 'document_start',
  // See chatgpt.content.ts: the parser module starts itself when evaluated.
  async main() {
    await import('../contents/gemini-parser')
  }
})
