import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const edgeNames = ['PLASMO_EDGE_API_KEY', 'PLASMO_EDGE_CLIENT_ID'];

export function readValues(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return values;
}

export function replaceEdgeValues(text, updates) {
  for (const name of edgeNames) {
    if (!updates[name]?.trim() || /[\r\n\0]/.test(updates[name])) {
      throw new Error('Use a single non-empty value for each publishing field.');
    }
  }
  const seen = new Set();
  const lines = text.split(/\r?\n/).filter((line) => {
    const match = line.match(/^\s*(PLASMO_EDGE_API_KEY|PLASMO_EDGE_CLIENT_ID)\s*=/);
    if (!match) return true;
    if (seen.has(match[1])) return false;
    seen.add(match[1]);
    return true;
  }).map((line) => {
    const match = line.match(/^\s*(PLASMO_EDGE_API_KEY|PLASMO_EDGE_CLIENT_ID)\s*=/);
    return match ? `${match[1]}=${updates[match[1]].trim()}` : line;
  });
  for (const name of edgeNames) if (!seen.has(name)) lines.push(`${name}=${updates[name].trim()}`);
  return lines.join('\n').replace(/\n*$/, '\n');
}

function privateWrite(target, content) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Refusing a linked credential file.');
  const temp = `${target}.new-${process.pid}`;
  fs.writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
  try {
    fs.renameSync(temp, target);
    fs.chmodSync(target, 0o600);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function saveCredentials(repoFile, backupFile, updates) {
  // Never overwrite a different backup silently. Resolve divergence before renewal.
  const original = fs.readFileSync(repoFile, 'utf8');
  const backup = fs.existsSync(backupFile) ? fs.readFileSync(backupFile, 'utf8') : null;
  if (backup !== null && backup !== original) throw new Error('Publishing copies differ. Resolve them before saving.');
  const next = replaceEdgeValues(original, updates);
  fs.mkdirSync(path.dirname(backupFile), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(backupFile), 0o700);
  const previousFile = `${backupFile}.previous`;
  privateWrite(previousFile, original);
  privateWrite(repoFile, next);
  try {
    privateWrite(backupFile, next);
  } catch (error) {
    privateWrite(repoFile, original);
    throw error;
  }
  if (fs.readFileSync(repoFile, 'utf8') !== fs.readFileSync(backupFile, 'utf8')) {
    throw new Error('Saved copies do not match. The previous copy is retained.');
  }
  return { repoFile, backupFile, previousFile };
}

function dialog(message, { secret = false, initial = '', save = false } = {}) {
  const quote = value => JSON.stringify(value);
  const script = `set resultDialog to display dialog ${quote(message)} default answer ${quote(initial)} with title "AI Chat Exporter · Microsoft 发布凭据" ${secret ? 'with hidden answer' : ''} buttons {"取消", ${quote(save ? '保存到 Pro' : '下一步')}} default button 2 cancel button 1\nreturn text returned of resultDialog`;
  // osascript stdout is captured in memory, never inherited by the terminal or logs.
  const result = spawnSync('/usr/bin/osascript', ['-'], { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) return null;
  return result.stdout.replace(/\r?\n$/, '');
}

export function main() {
  if (process.platform !== 'darwin') throw new Error('This local input window requires macOS.');
  const repoFile = path.join(root, '.env.local');
  const backupFile = path.join(os.homedir(), '.config/ai-chat-exporter-publishing/credentials.env');
  const current = readValues(fs.readFileSync(repoFile, 'utf8'));
  const apiKey = dialog('粘贴续新后的 Microsoft Edge API key。\n\n输入会隐藏，不进入聊天或命令历史。只更新 Pro，不上传、不提审，也不同步到 Air。', { secret: true });
  if (apiKey === null) return false;
  const clientId = dialog('确认 Publish API 页面上的 Client ID。\n\n若没有变化，保留下面的现值即可。\n保存后请回到聊天告诉我“已保存”。', { initial: current.PLASMO_EDGE_CLIENT_ID || '', save: true });
  if (clientId === null) return false;
  const saved = saveCredentials(repoFile, backupFile, { PLASMO_EDGE_API_KEY: apiKey, PLASMO_EDGE_CLIENT_ID: clientId });
  fs.writeFileSync(path.join(path.dirname(backupFile), 'last-input.json'), JSON.stringify({ savedAt: new Date().toISOString(), machine: 'MacBook Pro', keys: edgeNames, repoFile: saved.repoFile, backupFile: saved.backupFile, noUpload: true }, null, 2) + '\n', { mode: 0o600 });
  console.log('Microsoft publishing credentials saved on Pro. Both copies are mode0600; no upload or publish was attempted.');
  spawnSync('/usr/bin/osascript', ['-'], { input: 'display dialog "已安全保存到 Pro。没有上传或提审。回到聊天告诉我：已保存。" with title "AI Chat Exporter" buttons {"好"} default button 1', stdio: ['pipe', 'ignore', 'ignore'] });
  return true;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (!main()) console.log('Credential entry cancelled; files unchanged.');
  } catch {
    console.error('Could not save publishing credentials. No secret values were printed. Check file permissions and whether the two copies differ.');
    process.exitCode = 1;
  }
}
