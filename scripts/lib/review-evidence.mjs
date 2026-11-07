import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const provenanceName = 'build-provenance.json'
const evidenceName = 'evidence.json'
const sourcePaths = ['.', ':(exclude)build/**', ':(exclude)ai-chat-exporter/**']

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function sourceIdentity(root) {
  return {
    sourceCommit: git(root, ['rev-parse', 'HEAD']),
    sourceTree: git(root, ['rev-parse', 'HEAD^{tree}']),
    sourceDirty: Boolean(git(root, ['status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths])),
  }
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function buildFiles(root) {
  const files = []
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name
      if (relative === provenanceName) continue
      const file = path.join(dir, name)
      const stat = lstatSync(file)
      if (stat.isDirectory()) walk(file, relative)
      else if (stat.isFile()) files.push({ path: relative, sha256: digest(file) })
      else throw new Error(`Unsupported build entry: ${relative}`)
    }
  }
  walk(root)
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  renameSync(temporary, file)
}

export function recordBuildProvenance(repoRoot, buildDir) {
  const provenance = { schema: 1, ...sourceIdentity(repoRoot), files: buildFiles(buildDir) }
  atomicJson(path.join(buildDir, provenanceName), provenance)
  return provenance
}

export function assertBuildProvenance(repoRoot, buildDir) {
  const provenance = JSON.parse(readFileSync(path.join(buildDir, provenanceName), 'utf8'))
  if (provenance.schema !== 1 || !Array.isArray(provenance.files)) throw new Error('Invalid build provenance schema')
  const current = sourceIdentity(repoRoot)
  if (provenance.sourceCommit !== current.sourceCommit || provenance.sourceTree !== current.sourceTree) throw new Error('Build source commit or tree mismatch')
  if (provenance.sourceDirty !== false || current.sourceDirty) throw new Error('Build source is dirty')
  const expected = new Map(provenance.files.map(file => [file.path, file.sha256]))
  if (expected.size !== provenance.files.length) throw new Error('Duplicate build provenance file')
  const actual = buildFiles(buildDir)
  for (const file of actual) {
    if (!expected.has(file.path)) throw new Error(`Extra build file: ${file.path}`)
    if (expected.get(file.path) !== file.sha256) throw new Error(`Build file hash mismatch: ${file.path}`)
    expected.delete(file.path)
  }
  if (expected.size) throw new Error(`Missing build file: ${expected.keys().next().value}`)
  return provenance
}

function artifactFiles(proofDir, artifacts) {
  const root = realpathSync(proofDir)
  const entries = artifacts.map(artifact => {
    const absolute = realpathSync(path.resolve(root, artifact))
    const relative = path.relative(root, absolute)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Artifact is outside proof directory')
    if (relative === evidenceName || !lstatSync(absolute).isFile()) throw new Error('Invalid evidence artifact')
    return { path: relative.split(path.sep).join('/'), sha256: digest(absolute) }
  })
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if (new Set(entries.map(entry => entry.path)).size !== entries.length) throw new Error('Duplicate evidence artifact')
  return entries
}

export function createEvidenceRun(proofDir, metadata) {
  const dir = path.resolve(proofDir)
  mkdirSync(dir, { recursive: true })
  if (readdirSync(dir).length) throw new Error('Evidence directory must be empty; existing evidence cannot be reused')
  const run = { proofDir: dir, metadata }
  // Publish a complete running record without replacing an existing run.
  const temporary = path.join(dir, `.evidence-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify({ schema: 1, status: 'running', metadata }, null, 2)}\n`, { flag: 'wx' })
    linkSync(temporary, path.join(dir, evidenceName))
  } finally {
    unlinkSync(temporary)
  }
  return run
}

export function finishEvidenceRun(run, result, artifacts) {
  const previous = JSON.parse(readFileSync(path.join(run.proofDir, evidenceName), 'utf8'))
  if (previous.status !== 'running') throw new Error('Evidence run is not running')
  const evidence = { schema: 1, status: 'success', metadata: run.metadata, result, artifacts: artifactFiles(run.proofDir, artifacts) }
  atomicJson(path.join(run.proofDir, evidenceName), evidence)
  return evidence
}

export function failEvidenceRun(run, error) {
  // Callers may attach a fixed, non-sensitive identifier; never serialize messages.
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : undefined
  const evidence = { schema: 1, status: 'failed', metadata: run.metadata, error: { name: error instanceof Error ? error.name : 'Error', ...(code ? { code } : {}) } }
  atomicJson(path.join(run.proofDir, evidenceName), evidence)
  return evidence
}

export function assertEvidenceRun(proofDir) {
  const evidence = JSON.parse(readFileSync(path.join(proofDir, evidenceName), 'utf8'))
  if (evidence.schema !== 1 || evidence.status !== 'success' || !Array.isArray(evidence.artifacts)) throw new Error('Evidence is not a valid success record')
  const actual = artifactFiles(proofDir, evidence.artifacts.map(entry => entry.path))
  for (let i = 0; i < actual.length; i++) {
    if (actual[i].path !== evidence.artifacts[i].path || actual[i].sha256 !== evidence.artifacts[i].sha256) throw new Error(`Evidence artifact hash mismatch: ${actual[i].path}`)
  }
  return evidence
}
