import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

const issuer = process.env.PLASMO_FIREFOX_ISSUER;
const secret = process.env.PLASMO_FIREFOX_SECRET;
const args = process.argv.slice(2);
const uploadOnly = args.includes('--upload-only') || args.includes('--dry-run');
const addonId = 'ai-chat-exporter@pinguarmy.github.io';
const firefoxZipPath = path.resolve(rootDir, 'ai-chat-exporter-firefox.zip');
const sourceZipPath = path.resolve(rootDir, 'ai-chat-exporter-source.zip');

function createJwt(issuer, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    jti: crypto.randomBytes(16).toString('hex'),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

async function main() {
  console.log('=== Firefox AMO Auto-Publisher ===\n');

  if (!issuer || !secret) {
    console.error('❌ 缺失必要的 Firefox AMO 凭证。请检查 .env.local 或环境变量:');
    console.error(`  - PLASMO_FIREFOX_ISSUER: ${issuer ? '✅ 已配置' : '❌ 未配置'}`);
    console.error(`  - PLASMO_FIREFOX_SECRET: ${secret ? '✅ 已配置' : '❌ 未配置'}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf8'));
  console.log(`📦 插件名称: ${pkg.displayName || pkg.name} (v${pkg.version})`);
  console.log(`🆔 Gecko ID: ${addonId}`);

  // Test API Auth
  console.log('\n[1/3] 正在验证 Mozilla AMO API 身份...');
  const jwt = createJwt(issuer, secret);
  const addonRes = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(addonId)}/`, {
    headers: {
      'Authorization': `JWT ${jwt}`
    }
  });

  if (addonRes.status === 404) {
    console.warn('⚠️ AMO 尚未找到已发布的插件条目（如果首次尚未过审属于正常现象）。');
  } else if (!addonRes.ok) {
    const errorText = await addonRes.text();
    console.error(`❌ AMO 鉴权或请求失败 (HTTP ${addonRes.status}):`, errorText);
    process.exit(1);
  } else {
    const addonData = await addonRes.json();
    console.log(`✅ 成功连接 Mozilla AMO！当前线上名称: "${addonData.name?.['en-US'] || addonData.name}", 状态: ${addonData.status}`);
  }

  if (!fs.existsSync(firefoxZipPath)) {
    console.error(`❌ 找不到待上传的 Firefox ZIP 包: ${firefoxZipPath}`);
    console.error('请先运行 `npm run build` 生成安装包。');
    process.exit(1);
  }

  // Step 2: Upload file
  console.log(`\n[2/3] 正在上传 Firefox 安装包 (${(fs.statSync(firefoxZipPath).size / 1024).toFixed(1)} KB)...`);
  const formData = new FormData();
  const fileBytes = fs.readFileSync(firefoxZipPath);
  const fileBlob = new Blob([fileBytes], { type: 'application/zip' });
  formData.append('upload', fileBlob, path.basename(firefoxZipPath));
  formData.append('channel', 'listed');

  const uploadRes = await fetch('https://addons.mozilla.org/api/v5/addons/upload/', {
    method: 'POST',
    headers: {
      'Authorization': `JWT ${createJwt(issuer, secret)}`
    },
    body: formData
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error('❌ 上传失败:', errText);
    process.exit(1);
  }

  const uploadData = await uploadRes.json();
  const uploadUuid = uploadData.uuid;
  console.log(`✅ 上传接收成功，UUID: ${uploadUuid}。等待 AMO 自动校验...`);

  // Poll validation
  let processed = uploadData.processed;
  let validationResult = uploadData;
  let attempts = 0;
  const maxAttempts = 60;
  while (!processed) {
    if (++attempts > maxAttempts) {
      console.error('\n❌ 等待 AMO 安装包校验超时');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`https://addons.mozilla.org/api/v5/addons/upload/${uploadUuid}/`, {
      headers: {
        'Authorization': `JWT ${createJwt(issuer, secret)}`
      }
    });
    if (!pollRes.ok) {
      console.error(`\n❌ 查询校验进度失败 (HTTP ${pollRes.status}):`, await pollRes.text());
      process.exit(1);
    }
    validationResult = await pollRes.json();
    processed = validationResult.processed;
    if (processed) break;
    process.stdout.write('.');
  }

  if (!validationResult.valid) {
    console.error('\n❌ 安装包校验未通过:', JSON.stringify(validationResult.validation, null, 2));
    process.exit(1);
  }
  console.log('\n✅ 安装包校验通过！');

  if (uploadOnly) {
    console.log('\n[3/3] 模式为 --upload-only，已跳过向 AMO 提交版本。');
    return;
  }

  // Step 3: Create Version
  console.log('\n[3/3] 正在向 AMO 提交新版本及源码审核包...');
  const versionForm = new FormData();
  versionForm.append('upload', uploadUuid);
  if (!fs.existsSync(sourceZipPath)) {
    console.error(`❌ 找不到 Firefox 审核源码包: ${sourceZipPath}`);
    console.error('Mozilla AMO 审核要求必须附带源码包。请运行完整构建脚本生成源码包。');
    process.exit(1);
  }
  const srcBytes = fs.readFileSync(sourceZipPath);
  const srcBlob = new Blob([srcBytes], { type: 'application/zip' });
  versionForm.append('source', srcBlob, path.basename(sourceZipPath));
  console.log(`📎 已附加 Firefox 审核源码包: ${path.basename(sourceZipPath)} (${(fs.statSync(sourceZipPath).size / 1024).toFixed(1)} KB)`);

  const createVersionRes = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(addonId)}/versions/`, {
    method: 'POST',
    headers: {
      'Authorization': `JWT ${createJwt(issuer, secret)}`
    },
    body: versionForm
  });

  if (!createVersionRes.ok) {
    const errText = await createVersionRes.text();
    console.error('❌ 提交版本失败:', errText);
    process.exit(1);
  }

  const versionData = await createVersionRes.json();
  console.log(`✅ Firefox 版本提交成功！Version ID: ${versionData.id}, 版本号: ${versionData.version}`);
  console.log('\n🎉 Firefox AMO 发布流程完成！审核通过后将自动推送给 Firefox 用户。');
}

main().catch((err) => {
  console.error('\n❌ 脚本执行异常:', err);
  process.exit(1);
});
