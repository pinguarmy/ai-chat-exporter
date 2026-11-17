import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(__dirname, '..', '..')

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) return listSourceFiles(full)
      return /\.(ts|tsx)$/.test(name) ? [full] : []
    })
}

/**
 * Source text of a UI entry point plus every module extracted from it.
 * `popup.tsx` and `options.tsx` are thin shells; their markup, hooks and
 * constants live under `src/components/<entry>/`. Source-contract tests read
 * the whole surface so they keep asserting on behavior rather than file layout.
 */
export function readEntrySource(entry: 'popup' | 'options'): string {
  const files = [
    join(repoRoot, 'src', `${entry}.tsx`),
    ...listSourceFiles(join(repoRoot, 'src', 'components', entry)),
  ]
  return files.map((file) => readFileSync(file, 'utf8')).join('\n')
}
