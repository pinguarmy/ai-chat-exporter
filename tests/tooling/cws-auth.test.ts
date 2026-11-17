import { it, expect } from 'vitest'
import { mkdtemp, mkdir, copyFile, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'

it('rejects unrelated callbacks and saves an offline token privately without losing other settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exporter-oauth-test-'))
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, 'localhost', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  await mkdir(join(root, 'scripts'))
  const script = join(root, 'scripts/get-cws-token.mjs')
  await copyFile(join(process.cwd(), 'scripts/get-cws-token.mjs'), script)
  const envFile = join(root, '.env.local')
  await writeFile(envFile, 'OTHER_SETTING=keep\nPLASMO_CHROME_REFRESH_TOKEN=old-test-token\n')
  const shim = join(root, 'fake-google.mjs')
  await writeFile(shim, `
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://oauth2.googleapis.com/token' || options.body.get('code') !== 'test-code') {
        throw new Error('Unexpected OAuth request');
      }
      return { ok: true, json: async () => ({ refresh_token: 'new-test-token', access_token: 'test-access' }) };
    };
  `)
  const child = spawn(process.execPath, ['--import', pathToFileURL(shim).href, script], {
    env: { ...process.env, CWS_AUTH_PORT: String(port), PLASMO_CHROME_CLIENT_ID: 'test-client', PLASMO_CHROME_CLIENT_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const exited = new Promise<number | null>(resolve => child.on('exit', resolve))
  try {
    await expect.poll(() => output.includes('等待浏览器回调授权'), { timeout: 5000 }).toBe(true)
    const authUrl = new URL(output.match(/https:\/\/accounts\.google\.com\/\S+/)![0])
    expect(authUrl.searchParams.get('access_type')).toBe('offline')
    const callback = new URL(`http://localhost:${port}`)
    callback.searchParams.set('code', 'test-code')
    callback.searchParams.set('state', 'unrelated-state')
    const rejected = await fetch(callback)
    expect(rejected.status).toBe(400)
    expect(await readFile(envFile, 'utf8')).toContain('old-test-token')
    callback.searchParams.set('state', authUrl.searchParams.get('state')!)
    const accepted = await fetch(callback)
    expect(accepted.status).toBe(200)
    expect(await accepted.text()).not.toContain('new-test-token')
    expect(await exited).toBe(0)
    expect(await readFile(envFile, 'utf8')).toBe('OTHER_SETTING=keep\nPLASMO_CHROME_REFRESH_TOKEN=new-test-token\n')
    expect((await stat(envFile)).mode & 0o777).toBe(0o600)
    expect(output).not.toContain('new-test-token')
    expect(output).not.toContain('test-access')
    expect(output).not.toContain('test-secret')
  } finally {
    child.kill()
    await exited
    await rm(root, { recursive: true, force: true })
  }
}, 10000)
