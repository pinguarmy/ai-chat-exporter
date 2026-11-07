#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function verifyReviewPacket(directory) {
  const root = realpathSync(directory)
  const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8'))
  const files = new Map()
  for (const item of index.evidence) {
    if (files.has(item.id)) throw new Error(`Duplicate evidence ID: ${item.id}`)
    const actual = realpathSync(path.resolve(root, item.path))
    if (!actual.startsWith(root + path.sep)) throw new Error('Evidence path escaped packet')
    const digest = createHash('sha256').update(readFileSync(actual)).digest('hex')
    if (digest !== item.sha256) throw new Error(`Evidence hash mismatch: ${item.id}`)
    files.set(item.id, item)
  }
  for (const [dimension, ids] of Object.entries(index.requiredEvidence)) {
    if (!Array.isArray(ids) || !ids.length) throw new Error(`No mandatory evidence: ${dimension}`)
    for (const id of ids) if (!files.has(id)) throw new Error(`Required evidence missing: ${id}`)
  }
  const protocol = files.get('protocol')
  if (protocol?.sha256 !== index.protocolHash) throw new Error('Protocol hash mismatch')
  return { candidate: index.candidate, protocolHash: index.protocolHash, artifactsVerified: files.size }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(verifyReviewPacket(process.argv[2]), null, 2))
}
