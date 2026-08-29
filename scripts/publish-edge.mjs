import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.resolve(rootDir, '.env.local');

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

const clientId = process.env.PLASMO_EDGE_CLIENT_ID;
const apiKey = process.env.PLASMO_EDGE_API_KEY;
const productId = process.env.PLASMO_EDGE_PRODUCT_ID;
const zipPath = path.resolve(rootDir, 'ai-chat-exporter.zip');

const args = process.argv.slice(2);
const uploadOnly = args.includes('--upload-only') || args.includes('--dry-run');

const apiBase = 'https://api.addons.microsoftedge.microsoft.com';

function getHeaders(contentType = 'application/json') {
  const headers = {
    'Authorization': `ApiKey ${apiKey}`,
    'X-ClientID': clientId
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function extractOperationId(locationHeader) {
  if (!locationHeader) return '';
  const clean = locationHeader.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  const parts = clean.split('/');
  return parts[parts.length - 1] || '';
}

async function pollOperation(url, label) {
  let status = 'InProgress';
  let details = null;
  let attempts = 0;
  const maxAttempts = 60;
  while (status === 'InProgress') {
    if (++attempts > maxAttempts) {
      console.error(`\n❌ ${label}超时`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 3000));
    const opRes = await fetch(url, {
      method: 'GET',
      headers: getHeaders()
    });
    if (!opRes.ok) {
      const errText = await opRes.text();
      console.error(`❌ 查询${label}失败:`, errText);
      process.exit(1);
    }
    details = await opRes.json();
    status = details.status;
    if (status === 'InProgress') process.stdout.write('.');
  }
  return { status, details };
}

async function main() {
  console.log('=== Microsoft Edge Add-ons Auto-Publisher ===\n');

  if (!clientId || !apiKey || !productId) {
    console.error('❌ 缺失必要的 Microsoft Edge 凭证。请检查 .env.local 或环境变量:');
    console.error(`  - PLASMO_EDGE_CLIENT_ID: ${clientId ? '✅ 已配置' : '❌ 未配置'}`);
    console.error(`  - PLASMO_EDGE_API_KEY: ${apiKey ? '✅ 已配置' : '❌ 未配置'}`);
    console.error(`  - PLASMO_EDGE_PRODUCT_ID: ${productId ? '✅ 已配置' : '❌ 未配置'}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf8'));
  console.log(`📦 插件名称: ${pkg.displayName || pkg.name} (v${pkg.version})`);
  console.log(`🆔 Product ID: ${productId}`);
  console.log(`📁 ZIP 文件: ${zipPath} (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`);

  if (!fs.existsSync(zipPath)) {
    console.error(`❌ 找不到待上传的 ZIP 包: ${zipPath}`);
    console.error('请先运行 `npm run build` 生成安装包。');
    process.exit(1);
  }

  // Step 1: Upload package to draft
  console.log('\n[1/3] 正在上传 ZIP 包到 Microsoft Edge Draft...');
  const zipBuffer = fs.readFileSync(zipPath);
  const uploadRes = await fetch(`${apiBase}/v1/products/${productId}/submissions/draft/package`, {
    method: 'POST',
    headers: getHeaders('application/zip'),
    body: zipBuffer
  });

  if (uploadRes.status !== 202) {
    const errText = await uploadRes.text();
    console.error(`❌ 上传失败 (HTTP ${uploadRes.status}):`, errText);
    process.exit(1);
  }

  const location = uploadRes.headers.get('location') || '';
  const uploadOpId = extractOperationId(location);
  if (!uploadOpId) {
    console.error('❌ 未能从 Edge 响应中解析上传 Operation ID');
    process.exit(1);
  }
  console.log(`✅ 上传已受理 (Operation ID: ${uploadOpId})，等待 Edge 校验处理...`);

  const { status: uploadStatus, details: uploadDetails } = await pollOperation(
    `${apiBase}/v1/products/${productId}/submissions/draft/package/operations/${uploadOpId}`,
    '上传校验'
  );

  if (uploadStatus !== 'Succeeded') {
    console.error(`\n❌ 安装包校验未通过 (状态: ${uploadStatus}):`, JSON.stringify(uploadDetails, null, 2));
    process.exit(1);
  }
  console.log('\n✅ 安装包校验通过！');

  // Step 2: Publish submission
  if (uploadOnly) {
    console.log('\n[2/3] 模式为 --upload-only，已跳过提交审核。');
    console.log('💡 你可以前往 Edge Partner Center 查看草稿并手动提审。');
    return;
  }

  console.log('\n[2/3] 正在向 Microsoft Edge 提交审核 (Publish submission)...');
  const publishRes = await fetch(`${apiBase}/v1/products/${productId}/submissions`, {
    method: 'POST',
    headers: getHeaders('application/json'),
    body: JSON.stringify({ notes: `Automated release v${pkg.version}` })
  });

  if (publishRes.status !== 202) {
    const errText = await publishRes.text();
    console.error(`❌ 提交审核失败 (HTTP ${publishRes.status}):`, errText);
    process.exit(1);
  }

  const pubLocation = publishRes.headers.get('location') || '';
  const pubOpId = extractOperationId(pubLocation);
  if (!pubOpId) {
    console.error('❌ 未能从 Edge 响应中解析提审 Operation ID');
    process.exit(1);
  }
  console.log(`✅ 提交审核已受理 (Operation ID: ${pubOpId})，等待 Edge 确认...`);

  const { status: pubStatus, details: pubDetails } = await pollOperation(
    `${apiBase}/v1/products/${productId}/submissions/operations/${pubOpId}`,
    '提审确认'
  );

  if (pubStatus !== 'Succeeded') {
    console.error(`\n❌ 提审未成功完成 (状态: ${pubStatus}):`, JSON.stringify(pubDetails, null, 2));
    process.exit(1);
  }

  console.log('\n✅ 提交审核成功！');
  console.log('\n🎉 Microsoft Edge 发布流程全部完成！审核通过后将自动推送到 Edge Add-ons 商店。');
}

main().catch((err) => {
  console.error('\n❌ 脚本执行异常:', err);
  process.exit(1);
});
