import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.resolve(rootDir, '.env.local');

// 1. Load .env.local if present
function loadEnv() {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const extensionId = process.env.PLASMO_CHROME_ID;
const clientId = process.env.PLASMO_CHROME_CLIENT_ID;
const clientSecret = process.env.PLASMO_CHROME_CLIENT_SECRET;
const refreshToken = process.env.PLASMO_CHROME_REFRESH_TOKEN;
const zipPath = path.resolve(rootDir, 'ai-chat-exporter.zip');

const args = process.argv.slice(2);
const uploadOnly = args.includes('--upload-only') || args.includes('--dry-run');

async function main() {
  console.log('=== Chrome Web Store Auto-Publisher ===\n');

  if (!extensionId || !clientId || !clientSecret || !refreshToken) {
    console.error('❌ 缺失必要的 Chrome Web Store 凭证。请检查 .env.local 或环境变量:');
    console.error(`  - PLASMO_CHROME_ID: ${extensionId ? '✅ 已配置' : '❌ 未配置'}`);
    console.error(`  - PLASMO_CHROME_CLIENT_ID: ${clientId ? '✅ 已配置' : '❌ 未配置'}`);
    console.error(`  - PLASMO_CHROME_CLIENT_SECRET: ${clientSecret ? '✅ 已配置' : '❌ 未配置'}`);
    console.error(`  - PLASMO_CHROME_REFRESH_TOKEN: ${refreshToken ? '✅ 已配置' : '❌ 未配置'}`);
    process.exit(1);
  }

  if (!fs.existsSync(zipPath)) {
    console.error(`❌ 找不到待上传的 ZIP 包: ${zipPath}`);
    console.error('请先运行 `npm run build` 生成安装包。');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf8'));
  console.log(`📦 准备发布插件: ${pkg.displayName || pkg.name} (v${pkg.version})`);
  console.log(`🆔 Extension ID: ${extensionId}`);
  console.log(`📁 ZIP 文件: ${zipPath} (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`);

  // Step 1: Fetch Access Token
  console.log('\n[1/3] 正在通过 OAuth2 获取临时 Access Token...');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    console.error('❌ 获取 Access Token 失败:', tokenData);
    process.exit(1);
  }
  const accessToken = tokenData.access_token;
  console.log('✅ Access Token 获取成功');

  // Step 2: Upload ZIP package
  console.log('\n[2/3] 正在上传 ZIP 包到 Chrome Web Store...');
  const zipBuffer = fs.readFileSync(zipPath);
  const uploadRes = await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'x-goog-api-version': '2'
    },
    body: zipBuffer
  });

  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || uploadData.uploadState !== 'SUCCESS') {
    console.error('❌ 上传失败:', JSON.stringify(uploadData, null, 2));
    process.exit(1);
  }
  if (Array.isArray(uploadData.itemError) && uploadData.itemError.length > 0) {
    console.error('❌ 上传校验失败:', JSON.stringify(uploadData, null, 2));
    process.exit(1);
  }
  console.log('✅ 上传成功！状态:', uploadData.uploadState);

  // Step 3: Publish for Review
  if (uploadOnly) {
    console.log('\n[3/3] 模式为 --upload-only，已跳过提交审核。');
    console.log('💡 你可以前往 Chrome Web Store 开发者后台查看草稿并手动提审。');
    return;
  }

  console.log('\n[3/3] 正在提交审核 (Publish for review)...');
  const publishRes = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'x-goog-api-version': '2'
    }
  });

  const publishData = await publishRes.json();
  const publishStatuses = Array.isArray(publishData.status) ? publishData.status : [];
  const publishSucceeded = publishRes.ok && (
    publishStatuses.includes('OK') ||
    publishStatuses.includes('ITEM_PENDING_REVIEW')
  );
  if (!publishSucceeded) {
    console.error('❌ 提交审核失败:', JSON.stringify(publishData, null, 2));
    process.exit(1);
  }

  console.log('✅ 提交审核成功！');
  console.log('📋 发布响应:', publishData);
  console.log('\n🎉 发布流程全部完成！Chrome 审核通过后将自动上线。');
}

main().catch((err) => {
  console.error('\n❌ 脚本执行异常:', err);
  process.exit(1);
});
