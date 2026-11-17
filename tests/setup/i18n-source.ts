import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setLocaleSource } from '../../src/core/i18n'

// The product fetches locale catalogues from extension assets; unit tests read
// the same generated files from disk instead.
setLocaleSource(async locale =>
  JSON.parse(
    await readFile(resolve(__dirname, '../../src/core/i18n/generated', `${locale}.catalog`), 'utf8')
  )
)
