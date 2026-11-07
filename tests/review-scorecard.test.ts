import { describe, expect, it } from 'vitest'
// @ts-expect-error Standalone Node.js reviewer tool has no TS declaration.
import { summarizeReview, PRODUCT_WEIGHTS, METHOD_WEIGHTS } from '../scripts/review-scorecard.mjs'

function fixture() {
  const ids = [...Object.keys(PRODUCT_WEIGHTS), ...Object.keys(METHOD_WEIGHTS)]
  const index = { candidate: 'candidate-a', protocolHash: 'protocol-a', evidence: ids.map(id => ({ id })), requiredEvidence: Object.fromEntries(ids.map(id => [id, [id]])) }
  const report = { candidate: index.candidate, protocolHash: index.protocolHash, reviewer: 'test', inspectedEvidence: ids, findings: [], product: Object.fromEntries(Object.keys(PRODUCT_WEIGHTS).map(id => [id, { status: 'scored', score: 9.4, evidence: [id] }])), method: Object.fromEntries(Object.keys(METHOD_WEIGHTS).map(id => [id, { status: 'scored', score: 9.5, evidence: [id] }])) }
  return { index, report }
}

describe('review score arithmetic and evidence discipline', () => {
  it('retains below-target scores without rounding them up', () => {
    const { report, index } = fixture()
    expect(summarizeReview(report, index).sections.product.weighted).toBe(9.4)
  })
  it('does not compute an overall score with an uninspected required item', () => {
    const { report, index } = fixture()
    report.inspectedEvidence = report.inspectedEvidence.filter(id => id !== 'P3')
    const summary = summarizeReview(report, index)
    expect(summary.sections.product.weighted).toBeNull()
    expect(summary.sections.product.missing[0].dimension).toBe('P3')
  })
  it('retains a reviewer insufficient-evidence result', () => {
    const { report, index } = fixture()
    report.product.P6 = { status: 'insufficient', score: 0, evidence: [] }
    expect(summarizeReview(report, index).sections.product.weighted).toBeNull()
  })
  it('rejects scores assigned to a different candidate or protocol', () => {
    const { report, index } = fixture()
    expect(() => summarizeReview({ ...report, candidate: 'other' }, index)).toThrow(/candidate\/protocol/)
    expect(() => summarizeReview({ ...report, protocolHash: 'other' }, index)).toThrow(/candidate\/protocol/)
  })
  it('rejects invented evidence and more precise numeric judgments', () => {
    const { report, index } = fixture()
    expect(() => summarizeReview({ ...report, inspectedEvidence: ['invented'] }, index)).toThrow(/Unknown evidence/)
    report.product.P1.score = 9.49
    expect(() => summarizeReview(report, index)).toThrow(/Invalid dimension score/)
  })
  it('preserves hard failures independently of averages', () => {
    const { report, index } = fixture()
    const finding = { severity: 'high', issue: 'False complete archive' }
    const summary = summarizeReview({ ...report, findings: [finding] }, index)
    expect(summary.hardFailures).toEqual([finding])
    expect(summary.sections.method.weighted).toBe(9.5)
  })
})
