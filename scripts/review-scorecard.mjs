#!/usr/bin/env node
// Validate review arithmetic and evidence references; never manufacture a score.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const PRODUCT_WEIGHTS = { P1: 20, P2: 20, P3: 20, P4: 15, P5: 15, P6: 10 }
export const METHOD_WEIGHTS = { M1: 20, M2: 20, M3: 20, M4: 20, M5: 20 }

export function summarizeReview(report, index) {
  if (report.candidate !== index.candidate || report.protocolHash !== index.protocolHash) throw new Error('Review candidate/protocol does not match evidence')
  if (!Array.isArray(report.inspectedEvidence)) throw new Error('Inspected evidence IDs are required')
  const known = new Set(index.evidence.map(item => item.id))
  const inspected = new Set(report.inspectedEvidence)
  for (const id of inspected) if (!known.has(id)) throw new Error(`Unknown evidence ID: ${id}`)
  const sections = {}
  for (const [section, weights] of Object.entries({ product: PRODUCT_WEIGHTS, method: METHOD_WEIGHTS })) {
    let weighted = 0
    const missing = []
    for (const [dimension, weight] of Object.entries(weights)) {
      const row = report[section]?.[dimension]
      const required = index.requiredEvidence?.[dimension]
      if (!Array.isArray(required) || !required.length) throw new Error(`Required evidence mapping missing: ${dimension}`)
      for (const id of required) if (!known.has(id)) throw new Error(`Required evidence ID is unknown: ${id}`)
      const uninspected = required.filter(id => !inspected.has(id))
      if (!row || row.status === 'insufficient' || uninspected.length) {
        missing.push({ dimension, uninspected, reason: row?.reason || 'Required evidence not inspected' })
        continue
      }
      if (row.status !== 'scored' || !Number.isFinite(row.score) || row.score < 0 || row.score > 10 || Math.abs(row.score * 10 - Math.round(row.score * 10)) > 1e-8) throw new Error(`Invalid dimension score: ${dimension}`)
      if (!Array.isArray(row.evidence) || !row.evidence.length || row.evidence.some(id => !inspected.has(id))) throw new Error(`Dimension must cite inspected evidence: ${dimension}`)
      weighted += row.score * weight
    }
    sections[section] = { weighted: missing.length ? null : Number((weighted / 100).toFixed(3)), missing }
  }
  if (!Array.isArray(report.findings)) throw new Error('Findings array is required')
  return { candidate: report.candidate, reviewer: report.reviewer, sections, hardFailures: report.findings.filter(item => item.severity === 'critical' || item.severity === 'high') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [reportPath, indexPath] = process.argv.slice(2)
  if (!reportPath || !indexPath) throw new Error('Usage: node scripts/review-scorecard.mjs report.json evidence-index.json')
  console.log(JSON.stringify(summarizeReview(JSON.parse(readFileSync(reportPath, 'utf8')), JSON.parse(readFileSync(indexPath, 'utf8'))), null, 2))
}
