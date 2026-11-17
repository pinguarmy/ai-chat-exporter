import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(__dirname, '..', '..')

function findFile(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      const nested = findFile(full, name)
      if (nested) return nested
    } else if (entry === name) {
      return full
    }
  }
  return null
}

/**
 * Read a stylesheet by file name (for example `options.css`). The conventional
 * `src/styles/` location is tried first, then any other place under `src/`, so
 * contract tests keep working if stylesheets are regrouped. CSS is a public
 * contract of the extension pages, so asserting on its text is intentional.
 */
export function readCss(name: string): string {
  const conventional = join(repoRoot, 'src', 'styles', name)
  const path = existsSync(conventional) ? conventional : findFile(join(repoRoot, 'src'), name)
  if (!path) throw new Error(`Stylesheet not found under src/: ${name}`)
  return readFileSync(path, 'utf8')
}
