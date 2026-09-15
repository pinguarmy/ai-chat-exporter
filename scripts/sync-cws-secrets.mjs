import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Keep credentials in process memory and send them to gh through stdin.
const envPath = new URL('../.env.local', import.meta.url);
const values = { ...process.env };
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    if (!values[match[1]]) values[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
}
const names = [
  'PLASMO_CHROME_ID', 'PLASMO_CHROME_CLIENT_ID',
  'PLASMO_CHROME_CLIENT_SECRET', 'PLASMO_CHROME_REFRESH_TOKEN'
];
const missing = names.filter(name => !values[name]);
if (missing.length) {
  console.error(`Missing configuration: ${missing.join(', ')}`);
  process.exit(1);
}
for (const name of names) {
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', 'pinguarmy/ai-chat-exporter'], {
    input: values[name], encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    console.error(`Could not save ${name}. Check gh authentication and repository permissions, then rerun.`);
    process.exit(1);
  }
  console.log(`Saved GitHub Actions secret: ${name}`);
}
