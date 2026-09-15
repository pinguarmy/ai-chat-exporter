import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');

function loadEnv() {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const key = match[1];
    let val = match[2] || '';
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const clientId = process.env.PLASMO_CHROME_CLIENT_ID;
const clientSecret = process.env.PLASMO_CHROME_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Missing PLASMO_CHROME_CLIENT_ID / PLASMO_CHROME_CLIENT_SECRET in .env.local');
  process.exit(1);
}
const PORT = Number(process.env.CWS_AUTH_PORT || 8989);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('CWS_AUTH_PORT must be a valid localhost port.');
  process.exit(1);
}
const redirectUri = `http://localhost:${PORT}`;
const state = crypto.randomBytes(32).toString('hex');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/chromewebstore',
  access_type: 'offline',
  prompt: 'consent',
  state
}).toString();

console.log('\n======================================================');
console.log('请在浏览器中打开以下链接完成 Google 账号授权：\n');
console.log(authUrl);
console.log('\n======================================================\n');

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const code = reqUrl.searchParams.get('code');
  const error = reqUrl.searchParams.get('error');
  if ((code || error) && reqUrl.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid OAuth state. Restart authorization from the printed URL.');
    return;
  }

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>授权未完成</h1><p>请重新运行授权命令。</p>');
    console.error('\nGoogle authorization was not completed.');
    server.close();
    process.exit(1);
    return;
  }

  if (code) {
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      });

      const data = await tokenRes.json();
      if (!tokenRes.ok || !data.refresh_token) {
        throw new Error('Google did not return an offline refresh token.');
      }

      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      if (!envContent.includes('PLASMO_CHROME_REFRESH_TOKEN')) {
        envContent += `\nPLASMO_CHROME_REFRESH_TOKEN=${data.refresh_token}\n`;
      } else {
        envContent = envContent.replace(
          /PLASMO_CHROME_REFRESH_TOKEN=.*/,
          () => `PLASMO_CHROME_REFRESH_TOKEN=${data.refresh_token}`
        );
      }
      const temporaryPath = `${envPath}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporaryPath, envContent.trim() + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.renameSync(temporaryPath, envPath);
      } finally {
        fs.rmSync(temporaryPath, { force: true });
      }
      console.log('\n✅ 已取得并保存 Refresh Token（不会打印明文）。');
      console.log(`已将凭据自动保存到 ${envPath}`);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>授权成功！</h1><p>已成功获取 Refresh Token 并保存到本地环境。你可以关闭此页面了。</p>');
    } catch (err) {
      console.error('\n获取 Refresh Token 失败，未修改已保存的授权。请重新运行授权命令。');
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>交换 Token 失败</h1><p>请重新运行授权命令。</p>');
      setTimeout(() => {
        server.close();
        process.exit(1);
      }, 1000);
      return;
    }
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 1000);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, 'localhost', () => {
  console.log(`等待浏览器回调授权 (监听端口 ${PORT})...`);
});
setTimeout(() => {
  console.error('Authorization timed out after 10 minutes. Run the command again.');
  server.close();
  process.exit(1);
}, 10 * 60 * 1000).unref();
