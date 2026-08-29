import { defineConfig } from 'vitest/config'

// Core contract modules carry the export-integrity invariants; coverage is
// gated only for these so the threshold targets behavior that matters rather
// than a global percentage that invites low-value tests.
const CORE_CONTRACT_PATTERNS = [
  'src/lib/conversation-integrity.ts',
  'src/lib/message-references.ts',
  'src/lib/scheduled-export.ts',
  'src/lib/download-completion.ts'
]

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Keep collection aligned with the per-file gate below. Collecting every
      // TSX entry point makes Vitest's uncovered-file remapper emit parse
      // errors, then silently excludes those files while the core gate passes.
      include: CORE_CONTRACT_PATTERNS,
      thresholds: Object.fromEntries(
        CORE_CONTRACT_PATTERNS.map((pattern) => [
          pattern,
          { lines: 80, branches: 70 }
        ])
      )
    }
  }
})
