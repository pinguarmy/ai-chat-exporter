import { describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(__dirname, '..')

describe('unpacked extension delivery', () => {
  it('refreshes and verifies the directory that can be loaded directly in Chrome', () => {
    const buildScript = readFileSync(resolve(repoRoot, 'scripts/build-all.sh'), 'utf8')
    const verifyScript = readFileSync(resolve(repoRoot, 'scripts/verify-build.js'), 'utf8')

    expect(buildScript).toContain('rsync -a --delete build/chrome-mv3-prod/ ai-chat-exporter/')
    expect(buildScript).toContain('node scripts/verify-build.js unpacked')
    expect(verifyScript).toContain("'unpacked'")
    expect(verifyScript).toContain('Unpacked extension differs')
    expect(verifyScript).toContain('verifyRoleLabelUnicode()')
    expect(verifyScript).toContain('Built role labels contain a truncated emoji surrogate')
  })

  it('disables Plasmo version checks during deterministic release builds', () => {
    const buildScript = readFileSync(resolve(repoRoot, 'scripts/build-all.sh'), 'utf8')
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
    const patchScript = readFileSync(resolve(repoRoot, 'scripts/patch-plasmo-update-check.js'), 'utf8')

    expect(buildScript).toContain('PLASMO_NO_UPDATE_CHECK=1 npx plasmo build')
    expect(buildScript).toContain('echo "Source:      ${SOURCE_OUTPUT}"')
    expect(packageJson.scripts.postinstall).toContain('node scripts/patch-plasmo-update-check.js')
    expect(patchScript).toContain('process.env.PLASMO_NO_UPDATE_CHECK||kt()')
    expect(patchScript).toContain('replaceAll')
  })

  it('creates a versioned source archive from tracked Git content', () => {
    const buildScript = readFileSync(resolve(repoRoot, 'scripts/build-all.sh'), 'utf8')

    const firefoxArchiveEnd = buildScript.indexOf("echo \"Firefox: $(ls -lh ../../ai-chat-exporter-firefox.zip")
    const sourceArchiveStart = buildScript.indexOf('=== Creating source archive from tracked Git content ===')

    expect(buildScript).toContain('git archive')
    expect(buildScript).toContain('SOURCE_ARCHIVE_REF="${SOURCE_ARCHIVE_REF:-HEAD}"')
    expect(buildScript).toContain('git show "${SOURCE_ARCHIVE_REF}:package.json"')
    expect(buildScript).toContain("JSON.parse(require('fs').readFileSync(0, 'utf8')).version")
    expect(buildScript).toContain('ai-chat-exporter-${PACKAGE_VERSION}-source/')
    expect(buildScript).toContain('ai-chat-exporter-source.zip')
    expect(buildScript).toContain('git rev-parse --is-inside-work-tree')
    expect(buildScript).toContain('bash scripts/verify-source-archive.sh')
    expect(buildScript).toContain('Refusing release build from a dirty Git worktree')
    expect(buildScript.indexOf('cd ../..', firefoxArchiveEnd)).toBeLessThan(sourceArchiveStart)

    const sourceVerifier = readFileSync(resolve(repoRoot, 'scripts/verify-source-archive.sh'), 'utf8')
    expect(sourceVerifier).toContain('unzip -t')
    expect(sourceVerifier).toContain('zipinfo -1')
    expect(sourceVerifier).toContain('package.json')
    expect(sourceVerifier).toContain('Forbidden path in source archive')
    expect(sourceVerifier).toContain('src/lib/conversation-integrity.ts')
    expect(sourceVerifier).toContain('src/lib/download-completion.ts')
  })

  it('validates a source ZIP created with the current export-ignore rules', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-chat-exporter-source-'))
    const archivePath = join(tempDir, 'source.zip')
    const temporaryIndex = join(tempDir, 'index')
    const gitPath = spawnSync('git', ['rev-parse', '--git-path', 'index'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    try {
      expect(gitPath.status).toBe(0)
      copyFileSync(resolve(repoRoot, gitPath.stdout.trim()), temporaryIndex)

      const gitEnv = { ...process.env, GIT_INDEX_FILE: temporaryIndex }
      const addAttributes = spawnSync('git', ['add', '--', '.gitattributes'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: gitEnv,
      })
      expect(addAttributes.status, addAttributes.stderr).toBe(0)

      // The test intentionally builds a temporary index from the current
      // checkout. Include newly added source modules so the archive verifier
      // exercises the same required-path contract before a commit is made.
      const addIntegritySources = spawnSync('git', ['add', '--', 'src/lib/conversation-integrity.ts', 'src/lib/download-completion.ts'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: gitEnv,
      })
      expect(addIntegritySources.status, addIntegritySources.stderr).toBe(0)

      const tree = spawnSync('git', ['write-tree'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: gitEnv,
      })
      expect(tree.status, tree.stderr).toBe(0)

      const version = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version
      const root = `ai-chat-exporter-${version}-source/`
      const archive = spawnSync('git', [
        'archive',
        '--format=zip',
        `--prefix=${root}`,
        tree.stdout.trim(),
        '-o',
        archivePath,
      ], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
      expect(archive.status, archive.stderr).toBe(0)

      const validation = spawnSync('bash', [
        'scripts/verify-source-archive.sh',
        archivePath,
        version,
        root,
      ], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
      expect(validation.status, validation.stderr).toBe(0)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('defines recursive git archive exclusions for generated and private output', () => {
    const attributes = readFileSync(resolve(repoRoot, '.gitattributes'), 'utf8')

    expect(attributes).toContain('node_modules/** export-ignore')
    expect(attributes).toContain('build/** export-ignore')
    expect(attributes).toContain('.plasmo/** export-ignore')
    expect(attributes).toContain('ai-chat-exporter/** export-ignore')
    expect(attributes).toContain('*.zip export-ignore')
    expect(attributes).toContain('*.tsbuildinfo export-ignore')
    expect(attributes).toContain('.env export-ignore')
    expect(attributes).toContain('.env.* export-ignore')
  })

  it('publishes the source archive with both browser packages', () => {
    const releaseWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8')

    expect(releaseWorkflow).toContain('ai-chat-exporter-source.zip')
    expect(releaseWorkflow).toContain('ai-chat-exporter.zip ai-chat-exporter-firefox.zip ai-chat-exporter-source.zip')
    expect(releaseWorkflow).toContain('source archive for Firefox AMO source review (not installable)')
  })
})
