/**
 * Page-world hook that lets the content script learn Gemini's batchexecute
 * credentials. Content scripts live in an isolated world and cannot see the
 * page's own requests, so a tiny script is injected into the page to observe
 * `at` / `f.sid` and relay them back through window.postMessage. The content
 * script validates every message before storing it (see credentials.ts).
 */
/**
 * Hook script code that runs in the PAGE world (not the content script isolated world).
 * Monkey-patches window.fetch and XMLHttpRequest to intercept Gemini batchexecute requests
 * and extract auth tokens (at) and session IDs (f.sid).
 */
const HOOK_SCRIPT_CODE = `(() => {
  const result = {}

  const originalFetch = window.fetch
  window.fetch = async function (...args) {
    try {
      processRequest(args[0], args[1]?.body?.toString?.())
    } catch (e) {}
    return originalFetch.apply(this, args)
  }

  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__url = url
    return originalOpen.apply(this, arguments)
  }

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__url && this.__url.includes("batchexecute")) {
      try {
        processRequest(this.__url, body && body.toString ? body.toString() : null)
      } catch (e) {}
    }
    return originalSend.apply(this, arguments)
  }

  function getAccountSlot() {
    try {
      var matched = window.location.pathname.match(/\\/u\\/(\\d+)(?:\\/|$)/)
      if (matched && matched[1]) return "u" + matched[1]
    } catch (e) {}
    return "default"
  }

  function processRequest(url, body) {
    try {
      var atMatch = body ? body.match(/at=([a-zA-Z0-9%:\\-_]+)/) : null
      var sidMatch = url ? url.match(/f\\.sid=([+-]?[0-9]+)/) : null

      if (atMatch || sidMatch) {
        result.at = atMatch ? decodeURIComponent(atMatch[1]) : result.at
        result.sid = sidMatch ? sidMatch[1] : result.sid
        result.accountSlot = getAccountSlot()
        result.lastUsed = Date.now()

        window.postMessage(
          { type: "GEMINI_CREDENTIALS", payload: { at: result.at, sid: result.sid, accountSlot: result.accountSlot, lastUsed: result.lastUsed } },
          window.location.origin
        )
      }
    } catch (e) {}
  }
})()`

/**
 * Inject the hook script into the page world.
 * The hook patches fetch/XHR and sends credentials back via postMessage.
 */
export function injectGeminiHookScript() {
  // Avoid injecting twice
  if (document.querySelector('script[data-gemini-hook="true"]')) return

  const root = document.documentElement
  // document_start normally has an <html> element already, but keep the
  // credential bridge safe on the rare earliest lifecycle boundary.
  if (!root) {
    document.addEventListener('DOMContentLoaded', injectGeminiHookScript, { once: true })
    return
  }

  const script = document.createElement('script')
  script.textContent = HOOK_SCRIPT_CODE
  script.setAttribute('data-gemini-hook', 'true')
  script.type = 'text/javascript'
  script.async = false
  root.appendChild(script)
  script.remove()
}
