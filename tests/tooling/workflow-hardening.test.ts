// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('yaml')

const WORKFLOWS = ['ci.yml', 'release.yml', 'chrome-auth.yml']
const read = (name: string) => fs.readFileSync(`.github/workflows/${name}`, 'utf8')
const SETUP_ACTION = '.github/actions/setup-project/action.yml'
const PINNED_USES = /uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+#\s+v\d+\.\d+\.\d+\s*$/
const LOCAL_USES = /uses:\s*\.\/\.github\/actions\/[\w-]+\s*$/

type Step = { name?: string; run?: string; uses?: string; if?: string }
type Job = {
  name?: string
  needs?: string[]
  if?: string
  permissions?: Record<string, string>
  steps: Step[]
}
const stepRuns = (job: Job) => job.steps.map(step => step.run)

describe('workflow supply-chain hardening', () => {
  it.each(WORKFLOWS)('%s pins every action to a full commit SHA with a version comment', name => {
    const uses = read(name)
      .split('\n')
      .filter(line => /^\s*(-\s*)?uses:/.test(line))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) {
      expect(line).toSatisfy((value: string) => PINNED_USES.test(value) || LOCAL_USES.test(value))
    }
  })

  it('pins every action used by the local composite setup action', () => {
    const uses = fs
      .readFileSync(SETUP_ACTION, 'utf8')
      .split('\n')
      .filter(line => /^\s*(-\s*)?uses:/.test(line))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) expect(line).toMatch(PINNED_USES)
  })

  it.each(WORKFLOWS)('%s defaults to read-only contents permission', name => {
    expect(yaml.parse(read(name)).permissions).toEqual({ contents: 'read' })
  })

  it('grants contents: write only to the release job', () => {
    for (const name of WORKFLOWS) {
      const jobs = yaml.parse(read(name)).jobs as Record<string, Job>
      for (const [jobName, job] of Object.entries(jobs)) {
        const writes = job.permissions?.contents === 'write'
        expect(writes).toBe(name === 'release.yml' && jobName === 'build-and-release')
      }
    }
  })

  it('cancels superseded CI runs but never cancels an in-flight release', () => {
    const ci = yaml.parse(read('ci.yml'))
    expect(ci.concurrency['cancel-in-progress']).toBe(true)
    expect(ci.concurrency.group).toContain('github.ref')
    expect(yaml.parse(read('release.yml')).concurrency['cancel-in-progress']).toBe(false)
  })

  it('lints the Firefox package right after the build in CI and release', () => {
    const jobs: [string, string][] = [
      ['ci.yml', 'package'],
      ['release.yml', 'build-and-release']
    ]
    for (const [name, job] of jobs) {
      const steps = yaml.parse(read(name)).jobs[job].steps as { run?: string }[]
      const build = steps.findIndex(step => step.run === 'npm run build')
      expect(build).toBeGreaterThan(-1)
      expect(steps[build + 1].run).toBe('npm run lint:firefox')
    }
  })
})

describe('CI job layout', () => {
  const jobs = () => yaml.parse(read('ci.yml')).jobs as Record<string, Job>

  it('runs the independent check groups as parallel jobs with no inter-job needs', () => {
    const { unit, static: staticJob, package: pkg } = jobs()
    for (const job of [unit, staticJob, pkg]) expect(job.needs).toBeUndefined()
  })

  it('runs the unit suite once, through the coverage gate, and uploads the report', () => {
    const { unit } = jobs()
    const runs = stepRuns(unit)
    expect(runs).toContain('npm run test:coverage')
    expect(runs).not.toContain('npm test')
    expect(unit.steps.some(step => step.uses?.startsWith('actions/upload-artifact@'))).toBe(true)
  })

  it('keeps every static check, the services tests and the audit', () => {
    const runs = stepRuns(jobs().static)
    expect(runs).toEqual([
      undefined,
      undefined,
      'npm run lint',
      'npm run test:services',
      'npm audit --omit=dev --audit-level=high'
    ])
  })

  it('builds before the Firefox lint and browser smoke in the package job', () => {
    const runs = stepRuns(jobs().package)
    const build = runs.indexOf('npm run build')
    expect(runs.indexOf('npm run lint:firefox')).toBe(build + 1)
    expect(runs.indexOf('npm run test:browser:parallel')).toBeGreaterThan(build)
    expect(
      runs.some(run => run?.includes('poppler-utils') && run.includes('--no-install-recommends'))
    ).toBe(true)
  })

  it('keeps the original check name as an aggregate that fails unless every job succeeds', () => {
    const { verify } = jobs()
    expect(verify.name).toBe('Test, lint, and build')
    expect([...(verify.needs ?? [])].sort()).toEqual(['package', 'static', 'unit'])
    expect(verify.if).toBe('always()')
    expect(verify.steps[0].run).toContain('!= "success"')
  })

  it('caches node_modules by OS, Node version and lockfile, falling back to npm ci', () => {
    const setup = yaml.parse(fs.readFileSync(SETUP_ACTION, 'utf8')).runs.steps as (Step & {
      with?: { key?: string; path?: string }
    })[]
    const cache = setup.find(step => step.uses?.startsWith('actions/cache@'))
    expect(cache?.with?.path).toBe('node_modules')
    expect(cache?.with?.key).toContain('runner.os')
    expect(cache?.with?.key).toContain('steps.node.outputs.version')
    expect(cache?.with?.key).toContain("hashFiles('package-lock.json', 'patches/**')")
    expect(setup.find(step => step.run === 'npm ci')?.if).toContain("!= 'true'")
    expect(setup.find(step => step.run === 'npx wxt prepare')?.if).toContain("== 'true'")
  })

  it('does not cache executables in the publishing release job', () => {
    expect(read('release.yml')).not.toContain('actions/cache@')
  })
})
