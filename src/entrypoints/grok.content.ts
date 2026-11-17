import { defineContentScript } from 'wxt/utils/define-content-script'

export default defineContentScript({
  matches: ['https://grok.com/*', 'https://www.grok.com/*'],
  // See chatgpt.content.ts: the parser module starts itself when evaluated.
  async main() {
    await import('../contents/grok-parser')
  }
})
