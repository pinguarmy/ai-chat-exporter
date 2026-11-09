import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkPublishingConfig, parsePublishingArgs } from './check-publishing-config.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publisherScripts = {
  chrome: 'publish-cws.mjs',
  firefox: 'publish-firefox.mjs',
  edge: 'publish-edge.mjs'
};

export function runPublishAll(args = process.argv.slice(2), {
  rootDir = projectRoot,
  env = process.env,
  fsImpl = fs,
  spawn = spawnSync,
  log = console.log,
  error = console.error
} = {}) {
  let options;
  try {
    options = parsePublishingArgs(args, { allowModes: true });
  } catch (failure) {
    error(failure.message);
    return 1;
  }
  const { platforms, publisherArgs, dryRun, uploadOnly } = options;
  const preflight = checkPublishingConfig({ rootDir, env, fsImpl, platforms });
  const requiredFiles = new Set();
  for (const platform of platforms) {
    requiredFiles.add(platform === 'firefox' ? 'ai-chat-exporter-firefox.zip' : 'ai-chat-exporter.zip');
    if (platform === 'firefox' && !uploadOnly) requiredFiles.add('ai-chat-exporter-source.zip');
  }
  for (const filename of requiredFiles) {
    if (!fsImpl.existsSync(path.join(rootDir, filename))) {
      preflight.errors.push(`Missing publishing file: ${filename}. Run npm run build first.`);
    }
  }
  if (preflight.errors.length) {
    for (const message of preflight.errors) error(message);
    error('Preflight failed; no platform publisher was started.');
    return 1;
  }

  const results = [];
  for (const platform of platforms) {
    log(`\n=== ${platform} ===`);
    let succeeded = false;
    try {
      const result = spawn(process.execPath, [path.join(rootDir, 'scripts', publisherScripts[platform]), ...publisherArgs], {
        cwd: rootDir,
        env,
        stdio: 'inherit'
      });
      succeeded = result.status === 0 && !result.error;
    } catch {
      // Never print thrown objects, which can include the child environment.
      error(`Could not start ${platform} publisher.`);
    }
    results.push({ platform, succeeded });
  }

  log('\nPublishing summary:');
  const successStatus = dryRun ? 'local checks passed' : uploadOnly ? 'uploaded' : 'submitted for review';
  for (const { platform, succeeded } of results) {
    log(`${platform}: ${succeeded ? successStatus : 'failed; check platform logs and store state before retrying'}.`);
  }
  if (dryRun) {
    log('Dry run only; no store API requests were made.');
  } else if (!uploadOnly) {
    log('Store approval and availability must be checked separately.');
  }
  return results.some(result => !result.succeeded) ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runPublishAll();
}
