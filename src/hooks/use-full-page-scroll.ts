import { useEffect } from 'react'

/**
 * Popup styles intentionally lock the extension popup viewport. Full-page
 * extension surfaces import the shared design tokens from that stylesheet, so
 * they also need a runtime guard against stale cached CSS keeping overflow
 * locked in already-open Chrome extension tabs.
 */
export function useFullPageScroll() {
  useEffect(() => {
    const html = document.documentElement
    const body = document.body

    const previous = {
      htmlOverflowX: html.style.getPropertyValue('overflow-x'),
      htmlOverflowXPriority: html.style.getPropertyPriority('overflow-x'),
      htmlOverflowY: html.style.getPropertyValue('overflow-y'),
      htmlOverflowYPriority: html.style.getPropertyPriority('overflow-y'),
      bodyOverflowX: body.style.getPropertyValue('overflow-x'),
      bodyOverflowXPriority: body.style.getPropertyPriority('overflow-x'),
      bodyOverflowY: body.style.getPropertyValue('overflow-y'),
      bodyOverflowYPriority: body.style.getPropertyPriority('overflow-y'),
      htmlHeight: html.style.getPropertyValue('height'),
      htmlHeightPriority: html.style.getPropertyPriority('height'),
      bodyHeight: body.style.getPropertyValue('height'),
      bodyHeightPriority: body.style.getPropertyPriority('height'),
      bodyWidth: body.style.getPropertyValue('width'),
      bodyWidthPriority: body.style.getPropertyPriority('width'),
      bodyMinWidth: body.style.getPropertyValue('min-width'),
      bodyMinWidthPriority: body.style.getPropertyPriority('min-width'),
    }

    html.style.setProperty('overflow-x', 'hidden', 'important')
    html.style.setProperty('overflow-y', 'auto', 'important')
    body.style.setProperty('overflow-x', 'hidden', 'important')
    body.style.setProperty('overflow-y', 'auto', 'important')
    html.style.setProperty('height', 'auto', 'important')
    body.style.setProperty('height', 'auto', 'important')
    body.style.setProperty('width', 'auto', 'important')
    body.style.setProperty('min-width', '0', 'important')

    const root = document.getElementById('__plasmo')
    const rootPrevious = root ? {
      width: root.style.getPropertyValue('width'),
      widthPriority: root.style.getPropertyPriority('width'),
      minHeight: root.style.getPropertyValue('min-height'),
      minHeightPriority: root.style.getPropertyPriority('min-height'),
      overflow: root.style.getPropertyValue('overflow'),
      overflowPriority: root.style.getPropertyPriority('overflow'),
    } : null

    if (root) {
      root.style.setProperty('width', '100%', 'important')
      root.style.setProperty('min-height', '100vh', 'important')
      root.style.setProperty('overflow', 'visible', 'important')
    }

    return () => {
      html.style.setProperty('overflow-x', previous.htmlOverflowX, previous.htmlOverflowXPriority)
      html.style.setProperty('overflow-y', previous.htmlOverflowY, previous.htmlOverflowYPriority)
      body.style.setProperty('overflow-x', previous.bodyOverflowX, previous.bodyOverflowXPriority)
      body.style.setProperty('overflow-y', previous.bodyOverflowY, previous.bodyOverflowYPriority)
      html.style.setProperty('height', previous.htmlHeight, previous.htmlHeightPriority)
      body.style.setProperty('height', previous.bodyHeight, previous.bodyHeightPriority)
      body.style.setProperty('width', previous.bodyWidth, previous.bodyWidthPriority)
      body.style.setProperty('min-width', previous.bodyMinWidth, previous.bodyMinWidthPriority)
      if (root && rootPrevious) {
        root.style.setProperty('width', rootPrevious.width, rootPrevious.widthPriority)
        root.style.setProperty('min-height', rootPrevious.minHeight, rootPrevious.minHeightPriority)
        root.style.setProperty('overflow', rootPrevious.overflow, rootPrevious.overflowPriority)
      }
    }
  }, [])
}
