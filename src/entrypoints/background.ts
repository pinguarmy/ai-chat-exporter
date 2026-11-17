import { defineBackground } from 'wxt/utils/define-background'
import { startBackground } from '../background/start'

// `main` runs synchronously at the worker's top level, so every MV3 event
// listener registered by startBackground() is in place before the first event.
export default defineBackground(() => {
  startBackground()
})
