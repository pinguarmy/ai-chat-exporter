import { defineContentScript } from 'wxt/utils/define-content-script'

export default defineContentScript({
  matches: ['https://claude.ai/*'],
  // See chatgpt.content.ts: the parser module starts itself when evaluated.
  async main() {
    await import('../contents/claude-parser')
  }
})
