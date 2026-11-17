import type { ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * Mounts an extension page component into the page's `#root` element once the
 * DOM is ready. Each HTML entry (popup, options, tabs/*) calls this from its
 * own tiny `main.tsx`; the page components stay plain default-exported React
 * components so tests can render them directly.
 */
export function mountPage(Page: ComponentType): void {
  let mounted = false
  document.addEventListener('DOMContentLoaded', () => {
    if (mounted) return
    mounted = true
    const container = document.getElementById('root')
    if (!container) throw new Error('Extension page is missing its #root element')
    createRoot(container).render(<Page />)
  })
}
