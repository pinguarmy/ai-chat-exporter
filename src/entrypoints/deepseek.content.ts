import { defineContentScript } from 'wxt/utils/define-content-script'

export default defineContentScript({
  matches: ['https://deepseek.com/*', 'https://chat.deepseek.com/*'],
  // See chatgpt.content.ts: the parser module starts itself when evaluated.
  async main() {
    await import('../contents/deepseek-parser')
  }
})
