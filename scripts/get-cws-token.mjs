import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
const PORT = 8989;
const redirectUri = `http://localhost:${PORT}`;

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/chromewebstore',
  access_type: 'offline',
  prompt: 'consent'
}).toString();

console.log('\n======================================================');
console.log('请在浏览器中打开以下链接完成 Google 账号授权：\n');
console.log(authUrl);
console.log('\n======================================================\n');
console.log(`等待浏览器回调授权 (监听端口 ${PORT})...`);

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const code = reqUrl.searchParams.get('code');
  const error = reqUrl.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>授权失败: ${error}</h1><p>请返回终端查看详情。</p>`);
    console.error(`\n授权失败: ${error}`);
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
        throw new Error(JSON.stringify(data));
      }

      console.log('\n✅ 成功获取 Refresh Token 并已写入 .env.local（不会打印明文）。');

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
      fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
      console.log(`已将凭据自动保存到 ${envPath}`);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>授权成功！</h1><p>已成功获取 Refresh Token 并保存到本地环境。你可以关闭此页面了。</p>');
    } catch (err) {
      console.error('\n获取 Refresh Token 失败:', err);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>交换 Token 失败</h1><pre>${err.message}</pre>`);
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

server.listen(PORT);
