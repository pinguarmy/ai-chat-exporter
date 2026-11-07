#!/usr/bin/env node
// Assemble the same candidate-bound artifacts for every independent grader.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { assertEvidenceRun } from './lib/review-evidence.mjs'

const [uxDir, exportDir, outputDir, calibrationFile, challengeDir] = process.argv.slice(2)
if (!uxDir || !exportDir || !outputDir || !calibrationFile || !challengeDir) throw new Error('Usage: create-review-packet UX EXPORT OUTPUT CALIBRATION_REPORTS CHALLENGE_DIRECTORY')
const evidence = assertEvidenceRun(uxDir)
const root = process.cwd()
const candidate = evidence.result.sourceCommit
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== candidate) throw new Error('Packet candidate differs from HEAD')
mkdirSync(outputDir, { recursive: true })
if (readdirSync(outputDir).length) throw new Error('Review packet directory must be empty')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const entries = []
function copy(id, input, output, kind) {
  const bytes = readFileSync(input)
  mkdirSync(path.dirname(path.join(outputDir, output)), { recursive: true })
  copyFileSync(input, path.join(outputDir, output))
  entries.push({ id, path: output, kind, sha256: hash(bytes) })
}
const protocol = execFileSync('git', ['show', `${candidate}:docs/quality-review-protocol.md`])
writeFileSync(path.join(outputDir, 'protocol.md'), protocol)
entries.push({ id: 'protocol', path: 'protocol.md', kind: 'frozen scoring protocol', sha256: hash(protocol) })
for (const artifact of evidence.artifacts) copy(`ux:${artifact.path}`, path.join(uxDir, artifact.path), `ux/${artifact.path}`, 'actual built Chromium artifact or observation')
copy('ux:run', path.join(uxDir, 'evidence.json'), 'ux/evidence.json', 'immutable build-bound run metadata')
for (const name of ['browser.log', 'share-review.zip', 'share-review-preview.png', 'partial-selection.md', 'partial-selection.pdf', 'partial-selection.txt', 'partial-selection-narrow.png', 'chatgpt-static-cards.pdf']) {
  copy(`export:${name}`, path.join(exportDir, name), `export/${name}`, 'actual export file or command log')
}
const zipEntries = execFileSync(process.execPath, ['--input-type=module', '-e', `import {readFileSync} from 'node:fs'; import {unzipSync} from 'fflate'; const rows=unzipSync(readFileSync(process.argv[1])); for(const [name,bytes] of Object.entries(rows)) console.log(JSON.stringify({name,text:new TextDecoder().decode(bytes)}));`, path.resolve(exportDir, 'share-review.zip')], { cwd: root, encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line))
for (const row of zipEntries) {
  const output = `export/share-entries/${row.name}`
  const target = path.resolve(outputDir, output)
  if (!target.startsWith(path.resolve(outputDir, 'export/share-entries') + path.sep)) throw new Error('Archive path escaped packet')
  mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, row.text)
  entries.push({ id: `zip:${row.name}`, path: output, kind: 'decoded actual ZIP entry; compare with original ZIP hashes', sha256: hash(Buffer.from(row.text)) })
}
copy('calibration', calibrationFile, 'method/calibration-reports.json', 'original and revised closed-fixture grader reports; no product scores')
copy('build', path.join(root, 'ai-chat-exporter/build-provenance.json'), 'build-provenance.json', 'loaded bundle provenance')
const build = JSON.parse(readFileSync(path.join(root, 'ai-chat-exporter/build-provenance.json'), 'utf8'))
if (build.sourceCommit !== candidate) throw new Error('Build commit differs from packet candidate')
for (const file of build.files) {
  const bytes = readFileSync(path.join(root, 'ai-chat-exporter', file.path))
  if (hash(bytes) !== file.sha256) throw new Error(`Built artifact changed: ${file.path}`)
  copy(`bundle:${file.path}`, path.join(root, 'ai-chat-exporter', file.path), `built/${file.path}`, 'actual loaded extension bytes')
}
for (const stage of ['draft2', 'revision3']) {
  const directory = path.join(root, 'tests/fixtures/review-calibration', stage)
  for (const id of ['birch', 'copper', 'delta', 'ember', 'fennel', 'granite']) {
    for (const name of ['record.json', ...(id === 'fennel' ? [] : ['output.md'])]) copy(`calibration:${stage}:${id}:${name}`, path.join(directory, id, name), `method/${stage}/${id}/${name}`, 'closed synthetic calibration fixture, not a product output')
  }
}
copy('export:run', path.join(exportDir, 'evidence.json'), 'export/evidence.json', 'version-bound full export run record')
const exportedRun = assertEvidenceRun(exportDir)
if (exportedRun.result.sourceCommit !== candidate) throw new Error('Full export evidence candidate mismatch')
for (const name of readdirSync(challengeDir)) if (statSync(path.join(challengeDir, name)).isFile() && !name.endsWith('.pem')) copy(`challenge:${name}`, path.join(challengeDir, name), `challenge/${name}`, 'independent synthetic challenge record or actual output; inspect validity/status')
const sourceFiles = ['src/lib/conversation-title.ts', 'src/lib/download-completion.ts', 'src/lib/export-download.ts', 'src/lib/snapshot-download.ts', 'src/lib/manual-export-job.ts', 'src/lib/export-options.ts', 'src/lib/workspace-session.ts', 'scripts/lib/review-evidence.mjs', 'tests/popup-workflow.test.tsx', 'tests/download-actual-filename.test.ts', 'tests/review-evidence.test.ts', 'tests/review-scorecard.test.ts']
for (const file of sourceFiles) {
  const bytes = execFileSync('git', ['show', `${candidate}:${file}`])
  const output = `source/${file}`
  mkdirSync(path.dirname(path.join(outputDir, output)), { recursive: true }); writeFileSync(path.join(outputDir, output), bytes)
  entries.push({ id: `source:${file}`, path: output, kind: 'candidate source/test, not runtime proof', sha256: hash(bytes) })
}
const available = new Set(entries.map(item => item.id))
const challenges = entries.filter(item => item.id.startsWith('challenge:')).map(item => item.id)
const calibrationFixtures = entries.filter(item => item.id.startsWith('calibration:')).map(item => item.id)
const bundles = entries.filter(item => item.id.startsWith('bundle:')).map(item => item.id)
const requiredEvidence = {
  P1: ['ux:scenarios.json', 'ux:unsupported.png', 'ux:homepage.png', 'ux:current.png'],
  P2: ['ux:scenarios.json', 'ux:first-export.md', 'ux:repeated-export.md', 'export:partial-selection.pdf', 'export:share-review.zip', 'source:tests/popup-workflow.test.tsx', ...challenges],
  P3: ['ux:unverified.png', 'export:partial-selection.md', 'export:partial-selection.txt', 'export:share-review.zip', 'export:share-review-preview.png', ...challenges],
  P4: ['ux:scenarios.json', 'export:run', 'export:browser.log', 'source:tests/popup-workflow.test.tsx', 'source:src/lib/manual-export-job.ts', ...challenges],
  P5: ['ux:scenarios.json', 'ux:current-dark.png', 'ux:current-de.png', 'ux:current-ja.png', 'ux:current-ko.png', 'export:partial-selection-narrow.png'],
  P6: ['build', 'ux:run', 'export:run', 'source:src/lib/conversation-title.ts', 'source:src/lib/export-download.ts', 'source:src/lib/workspace-session.ts', 'source:scripts/lib/review-evidence.mjs', ...challenges],
  M1: ['protocol', 'ux:run', ...challenges], M2: ['calibration', ...calibrationFixtures], M3: ['calibration', 'protocol'], M4: ['build', 'ux:run', 'export:run', 'source:tests/review-evidence.test.ts', 'source:scripts/lib/review-evidence.mjs', ...bundles], M5: ['protocol', 'ux:scenarios.json', ...challenges],
}
for (const ids of Object.values(requiredEvidence)) for (const id of ids) if (!available.has(id)) throw new Error(`Required evidence not present: ${id}`)
const index = { candidate, protocolHash: hash(protocol), context: 'Isolated Chromium. No logged-in provider, Firefox/Edge runtime or real participant. Expert scores do not pass those gates. Test source is not runtime proof; challenge status/validity must be inspected.', evidence: entries, requiredEvidence }
writeFileSync(path.join(outputDir, 'index.json'), JSON.stringify(index, null, 2))
console.log(`Review packet: ${outputDir}; candidate ${candidate}; ${entries.length} artifacts`)
