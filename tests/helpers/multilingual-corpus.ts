import corpusJson from '../fixtures/multilingual/corpus.json'
import type { Conversation, ExportOptions } from '../../src/core/types'

/** One synthetic conversation written in a single language or script family. */
export interface MultilingualEntry {
  id: string
  label: string
  script: string
  title: string
  user: string
  assistant: string
  /** Substrings that must survive every export format exactly. */
  needles: string[]
  /** Substrings expected in a PDF text layer when they differ from `needles`. */
  pdfNeedles?: string[]
  rtl?: boolean
  /** Text is intentionally in NFD; exporters must not normalize it. */
  nfd?: boolean
}

export const multilingualEntries: MultilingualEntry[] = corpusJson.entries

export function multilingualConversation(entry: MultilingualEntry): Conversation {
  const at = Date.UTC(2026, 0, 2, 3, 4, 5)
  return {
    id: `ml-${entry.id}`,
    title: entry.title,
    url: `https://example.invalid/c/${entry.id}`,
    platform: 'chatgpt',
    createdAt: at,
    artifacts: [{ type: 'document', title: entry.title, content: entry.assistant }],
    messages: [
      { id: 'u', role: 'user', content: entry.user, timestamp: at },
      { id: 'a', role: 'assistant', content: entry.assistant, timestamp: at + 4000 }
    ]
  }
}

export const markdownOptions: ExportOptions = {
  format: 'markdown',
  includeMetadata: true,
  includeCodeBlocks: true,
  includeImages: true
}
