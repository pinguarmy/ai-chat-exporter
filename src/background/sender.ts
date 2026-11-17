/** True when the sender is one of this extension's own pages (popup, options, tabs), not a content script. */
export function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''))
}
