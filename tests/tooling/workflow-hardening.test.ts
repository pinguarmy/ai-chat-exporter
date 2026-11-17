// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('yaml')

const WORKFLOWS = ['ci.yml', 'release.yml', 'chrome-auth.yml']
const read = (name: string) => fs.readFileSync(`.github/workflows/${name}`, 'utf8')

type Job = { permissions?: Record<string, string> }

describe('workflow supply-chain hardening', () => {
  it.each(WORKFLOWS)('%s pins every action to a full commit SHA with a version comment', name => {
    const uses = read(name)
      .split('\n')
      .filter(line => /^\s*(-\s*)?uses:/.test(line))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) {
      expect(line).toMatch(/uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+#\s+v\d+\.\d+\.\d+\s*$/)
    }
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
})
