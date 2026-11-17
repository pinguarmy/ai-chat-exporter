import { useEffect } from 'react'
import type { ExtensionSettings } from '../core/types'

/**
 * Keep the root `data-theme` attribute in sync with the configured theme.
 * Falls back to the OS color scheme while no theme has been loaded.
 */
export function useThemeSync(theme?: ExtensionSettings['theme']) {
  useEffect(() => {
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme)
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    }
  }, [theme])
}
