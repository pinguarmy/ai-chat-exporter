#!/usr/bin/env node
// Closed synthetic cases for grader calibration, not product/browser evidence.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function createCalibration(directory) {
  if (existsSync(directory)) throw new Error('Calibration directory must be new')
  mkdirSync(directory, { recursive: true })
  const sentinel = 'SYNTHETIC_PRIVATE_KEY_DO_NOT_SHARE_8426'
  const good = '> Partial export: 1 of 3 messages. This is not a complete conversation archive.\n\nSelected answer [REDACTED]\n'
  const cases = [
    { id: 'birch', content: good, receipt: 'selected-answer.md', filename: 'selected-answer.md', recordedHistory: [], omit: false },
    { id: 'copper', content: good.replace('[REDACTED]', sentinel), receipt: 'selected-answer.md', filename: 'selected-answer.md', recordedHistory: [], omit: false },
    { id: 'delta', content: good, receipt: 'selected-answer.md', filename: 'different-file.md', recordedHistory: [], omit: false },
    { id: 'ember', content: good, receipt: 'selected-answer.md', filename: 'selected-answer.md', recordedHistory: ['source-8426'], omit: false },
    { id: 'fennel', content: good, receipt: 'selected-answer.md', filename: 'selected-answer.md', recordedHistory: [], omit: true },
    { id: 'granite', content: good.replace('[REDACTED]', sentinel), receipt: 'selected-answer.md', filename: 'selected-answer.md', recordedHistory: [], omit: false },
  ]
  const records = []
  for (const item of cases) {
    const dir = path.join(directory, item.id)
    mkdirSync(dir)
    const artifact = `output.md`
    if (!item.omit) writeFileSync(path.join(dir, artifact), item.content)
    const record = {
      id: item.id,
      evidenceKind: 'closed synthetic calibration fixture, not browser execution',
      requiredContract: {
        selectedIndexes: [1], originalCount: 3,
        selectedContent: 'Selected answer', excludedContent: ['Unselected question', 'Unselected final turn'],
        safeShare: true, forbiddenSentinel: sentinel,
        mandatoryPartialNotice: true, completeArchiveHistoryMustStayEmpty: true,
        savedReceiptMustMatchActualFilename: true,
      },
      observed: { receipt: item.receipt, browserFilename: item.filename, recordedHistory: item.recordedHistory },
      artifact,
      sha256: item.omit ? null : createHash('sha256').update(item.content).digest('hex'),
    }
    writeFileSync(path.join(dir, 'record.json'), JSON.stringify(record, null, 2))
    records.push({ id: item.id, record: `${item.id}/record.json` })
  }
  const index = { scope: 'Only assess the stated closed fixture contract, not product readiness. Inspect each record and its artifact. Missing output is insufficient evidence, not proof of a product bug. Return one verdict per ID: no-observed-defect, defect, or insufficient-evidence, plus observed issue and severity. Do not inspect generator source, other reports or hidden answer key.', cases: records }
  writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index, null, 2))
  return index
}

export function checkCalibration(report) {
  const expected = { birch: 'no-observed-defect', copper: 'defect', delta: 'defect', ember: 'defect', fennel: 'insufficient-evidence', granite: 'defect' }
  const rows = new Map((report.cases || []).map(row => [row.id, row]))
  const outcomes = Object.entries(expected).map(([id, verdict]) => {
    const row = rows.get(id)
    const inspectedArtifact = row?.inspected?.some(file => file.endsWith(`/${id}/output.md`)) === true
    return { id, expected: verdict, actual: row?.verdict ?? 'missing', inspectedArtifact, matches: row?.verdict === verdict && (id === 'fennel' || inspectedArtifact) }
  })
  const repeated = [rows.get('copper'), rows.get('granite')]
  const repeatStable = repeated.every(Boolean) && repeated[0].verdict === repeated[1].verdict && repeated[0].severity === repeated[1].severity
  return { outcomes, repeatStable, provisional: outcomes.some(row => !row.matches) || !repeatStable, note: 'Six closed fixtures do not establish statistical reliability or user validity.' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, target] = process.argv.slice(2)
  if (mode === 'create' && target) console.log(JSON.stringify(createCalibration(path.resolve(target)), null, 2))
  else if (mode === 'check' && target) console.log(JSON.stringify(checkCalibration(JSON.parse(readFileSync(target, 'utf8'))), null, 2))
  else throw new Error('Usage: review-calibration.mjs create NEW_DIRECTORY | check REPORT.json')
}
