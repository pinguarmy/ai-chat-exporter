import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordBuildProvenance, assertBuildProvenance, createEvidenceRun, finishEvidenceRun, failEvidenceRun, assertEvidenceRun } from '../scripts/lib/review-evidence.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'review-evidence-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim()
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
  writeFileSync(join(root, 'source.txt'), 'source')
  git('add', 'source.txt'); git('commit', '-qm', 'first')
  const build = join(root, 'build'); mkdirSync(build)
  writeFileSync(join(build, 'manifest.json'), '{}'); writeFileSync(join(build, 'bundle.js'), 'bundle')
  return { root, build, git, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

describe('candidate-bound evidence', () => {
  it('rejects stale HEAD and changed, missing or extra build files', () => {
    const f = fixture()
    try {
      const provenance = recordBuildProvenance(f.root, f.build)
      expect(provenance.files.map((file: { path: string }) => file.path)).toEqual(['bundle.js', 'manifest.json'])
      expect(assertBuildProvenance(f.root, f.build).sourceCommit).toBe(f.git('rev-parse', 'HEAD'))
      writeFileSync(join(f.build, 'bundle.js'), 'altered')
      expect(() => assertBuildProvenance(f.root, f.build)).toThrow(/hash/i)
      writeFileSync(join(f.build, 'bundle.js'), 'bundle')
      unlinkSync(join(f.build, 'bundle.js'))
      expect(() => assertBuildProvenance(f.root, f.build)).toThrow(/missing/i)
      writeFileSync(join(f.build, 'bundle.js'), 'bundle'); writeFileSync(join(f.build, 'extra'), 'x')
      expect(() => assertBuildProvenance(f.root, f.build)).toThrow(/extra/i)
      unlinkSync(join(f.build, 'extra'))
      writeFileSync(join(f.root, 'source.txt'), 'new'); f.git('add', 'source.txt'); f.git('commit', '-qm', 'second')
      expect(() => assertBuildProvenance(f.root, f.build)).toThrow(/commit/i)
    } finally { f.cleanup() }
  })
  it('records dirty tracked source but rejects it for formal assertions', () => {
    const f = fixture()
    try {
      writeFileSync(join(f.root, 'source.txt'), 'dirty')
      expect(recordBuildProvenance(f.root, f.build).sourceDirty).toBe(true)
      expect(() => assertBuildProvenance(f.root, f.build)).toThrow(/dirty/i)
    } finally { f.cleanup() }
  })
  it('marks untracked source dirty while ignoring generated build output', () => {
    const f = fixture()
    try {
      expect(recordBuildProvenance(f.root, f.build).sourceDirty).toBe(false)
      mkdirSync(join(f.root, 'src'))
      writeFileSync(join(f.root, 'src', 'new.ts'), 'new source')
      expect(() => assertBuildProvenance(f.root, f.build)).toThrow(/dirty/i)
      expect(recordBuildProvenance(f.root, f.build).sourceDirty).toBe(true)
    } finally { f.cleanup() }
  })
  it('records a safe caller-provided failure code without the message', () => {
    const f = fixture()
    try {
      const run = createEvidenceRun(join(f.root, 'proof'), {})
      const error = Object.assign(new Error('private content'), { code: 'SCENARIO_ASSERTION_FAILED' })
      expect(failEvidenceRun(run, error).error).toEqual({ name: 'Error', code: 'SCENARIO_ASSERTION_FAILED' })
      expect(readFileSync(join(run.proofDir, 'evidence.json'), 'utf8')).not.toContain('private content')
    } finally { f.cleanup() }
  })
  it('records failure, forbids reuse, and detects artifact tampering', () => {
    const f = fixture()
    try {
      const proof = join(f.root, 'proof')
      const run = createEvidenceRun(proof, { version: '1' })
      writeFileSync(join(proof, 'shot.png'), 'image')
      finishEvidenceRun(run, { passed: true }, ['shot.png'])
      expect(assertEvidenceRun(proof).status).toBe('success')
      writeFileSync(join(proof, 'shot.png'), 'tampered')
      expect(() => assertEvidenceRun(proof)).toThrow(/hash/i)
      expect(() => createEvidenceRun(proof, {})).toThrow(/exist|empty/i)
      const failureDir = join(f.root, 'failed')
      const failed = createEvidenceRun(failureDir, {})
      failEvidenceRun(failed, new Error('secret must not be written'))
      const record = JSON.parse(readFileSync(join(failureDir, 'evidence.json'), 'utf8'))
      expect(record.status).toBe('failed')
      expect(() => finishEvidenceRun(failed, {}, [])).toThrow(/not running/i)
      expect(JSON.stringify(record)).not.toContain('secret')
      expect(() => assertEvidenceRun(failureDir)).toThrow(/success/i)
    } finally { f.cleanup() }
  })
  it('rejects artifacts outside the proof directory', () => {
    const f = fixture()
    try {
      const run = createEvidenceRun(join(f.root, 'proof'), {})
      expect(() => finishEvidenceRun(run, {}, [join(f.root, 'source.txt')])).toThrow(/outside/i)
    } finally { f.cleanup() }
  })
})
