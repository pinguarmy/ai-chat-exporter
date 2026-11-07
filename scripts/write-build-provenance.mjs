#!/usr/bin/env node
import path from 'node:path'
import { recordBuildProvenance } from './lib/review-evidence.mjs'

if (process.argv.length !== 4) {
  console.error('Usage: node scripts/write-build-provenance.mjs <repo-root> <build-dir>')
  process.exitCode = 2
} else {
  const provenance = recordBuildProvenance(path.resolve(process.argv[2]), path.resolve(process.argv[3]))
  if (provenance.sourceDirty && !process.env.ALLOW_DIRTY_BUILD) {
    console.error('Refusing provenance for dirty source without ALLOW_DIRTY_BUILD')
    process.exitCode = 1
  }
}
