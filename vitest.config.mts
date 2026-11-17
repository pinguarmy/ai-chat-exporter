import { defineConfig } from 'vitest/config'

// Core contract modules carry the export-integrity invariants and keep a
// stricter per-file gate. A lower global floor over all of src/ prevents broad
// decline without inviting low-value tests. Measured 2026-11: statements 81.9%,
// branches 75.3%, functions 83.8%, lines 84.6%; floors sit a few points below.
const CORE_CONTRACT_PATTERNS = [
  'src/core/conversation-integrity.ts',
  'src/core/message-references.ts',
  'src/core/scheduled-export.ts',
  'src/platform/download-completion.ts'
]

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['tests/setup/i18n-source.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        statements: 77,
        branches: 70,
        functions: 79,
        lines: 80,
        ...Object.fromEntries(
          CORE_CONTRACT_PATTERNS.map(pattern => [pattern, { lines: 80, branches: 70 }])
        )
      }
    }
  }
})
