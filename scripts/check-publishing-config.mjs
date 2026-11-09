import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const publishingEnvNames = {
  chrome: ['PLASMO_CHROME_ID', 'PLASMO_CHROME_CLIENT_ID', 'PLASMO_CHROME_CLIENT_SECRET', 'PLASMO_CHROME_REFRESH_TOKEN'],
  firefox: ['PLASMO_FIREFOX_ISSUER', 'PLASMO_FIREFOX_SECRET'],
  edge: ['PLASMO_EDGE_CLIENT_ID', 'PLASMO_EDGE_API_KEY', 'PLASMO_EDGE_PRODUCT_ID']
};

export function parsePublishingArgs(args, { allowModes = false } = {}) {
  let platforms = Object.keys(publishingEnvNames);
  let selected = false;
  const publisherArgs = [];
  const usage = allowModes
    ? 'Use --only=chrome,firefox,edge, --dry-run or --upload-only.'
    : 'Use --only=chrome,firefox,edge.';
  for (const arg of args) {
    if (arg.startsWith('--only=')) {
      const names = arg.slice('--only='.length).split(',');
      if (selected || names.some(name => !Object.hasOwn(publishingEnvNames, name))) {
        throw new Error(`Invalid platform selection. ${usage}`);
      }
      selected = true;
      platforms = platforms.filter(name => names.includes(name));
    } else if (allowModes && (arg === '--dry-run' || arg === '--upload-only')) {
      publisherArgs.push(arg);
    } else {
      // Do not echo arguments: a mistaken argument could contain a credential.
      throw new Error(`Unsupported publishing argument. ${usage}`);
    }
  }
  return {
    platforms,
    publisherArgs,
    dryRun: publisherArgs.includes('--dry-run'),
    uploadOnly: publisherArgs.includes('--upload-only')
  };
}

export function checkPublishingConfig({
  rootDir = projectRoot,
  env = process.env,
  fsImpl = fs,
  platforms = Object.keys(publishingEnvNames)
} = {}) {
  const values = { ...env };
  const errors = [];
  const envPath = path.join(rootDir, '.env.local');
  if (fsImpl.existsSync(envPath)) {
    try {
      // Match the child publishers: process environment wins, empty values fall back.
      for (const line of fsImpl.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
        if (!match || values[match[1]]) continue;
        values[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
      }
    } catch {
      errors.push('Could not read .env.local.');
    }
  }
  const missing = platforms.flatMap(name => publishingEnvNames[name])
    .filter(name => !values[name]?.trim());
  if (missing.length) errors.push(`Missing publishing configuration: ${missing.join(', ')}.`);

  let version;
  try {
    version = JSON.parse(fsImpl.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;
    if (typeof version !== 'string' || !version.trim()) throw new Error();
  } catch {
    errors.push('Could not read version from package.json.');
  }
  if (version && !fsImpl.existsSync(path.join(rootDir, 'docs', 'releases', `${version}.md`))) {
    errors.push(`Missing release notes: docs/releases/${version}.md.`);
  }
  return { ok: errors.length === 0, errors };
}

export function runConfigCheck(args = process.argv.slice(2), {
  log = console.log,
  error = console.error,
  ...dependencies
} = {}) {
  let platforms;
  try {
    ({ platforms } = parsePublishingArgs(args));
  } catch (failure) {
    error(failure.message);
    return 1;
  }
  const result = checkPublishingConfig({ ...dependencies, platforms });
  if (!result.ok) {
    for (const message of result.errors) error(message);
    return 1;
  }
  log(`Local publishing configuration checks passed for ${platforms.join(', ')}. No store API requests were made.`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runConfigCheck();
}
