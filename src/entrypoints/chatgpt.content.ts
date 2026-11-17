import { defineContentScript } from 'wxt/utils/define-content-script'

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  // The parser module registers its message handler and starts itself when it
  // is evaluated, so it is loaded here rather than at the top level: WXT also
  // evaluates this file in Node to read the options above.
  async main() {
    await import('../contents/chatgpt-parser')
  }
})
