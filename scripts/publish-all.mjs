import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userArgs = process.argv.slice(2);

console.log('🚀 开始全平台自动发布流程...\n');

console.log('==================================================');
console.log('>>> [1/3] 发布到 Chrome Web Store');
console.log('==================================================');
const chromeRes = spawnSync('node', [path.resolve(__dirname, 'publish-cws.mjs'), ...userArgs], {
  stdio: 'inherit'
});

console.log('\n==================================================');
console.log('>>> [2/3] 发布到 Firefox Add-ons (AMO)');
console.log('==================================================');
const firefoxRes = spawnSync('node', [path.resolve(__dirname, 'publish-firefox.mjs'), ...userArgs], {
  stdio: 'inherit'
});

console.log('\n==================================================');
console.log('>>> [3/3] 发布到 Microsoft Edge Add-ons');
console.log('==================================================');
const edgeRes = spawnSync('node', [path.resolve(__dirname, 'publish-edge.mjs'), ...userArgs], {
  stdio: 'inherit'
});

const failed = (chromeRes.status !== 0 ? 1 : 0) + (firefoxRes.status !== 0 ? 1 : 0) + (edgeRes.status !== 0 ? 1 : 0);
if (failed > 0) {
  console.error(`\n⚠️ 发布结束，有 ${failed} 个平台未完成。请查看上方日志。`);
  process.exit(1);
} else {
  console.log('\n🎉 所有三大商店（Chrome、Firefox、Edge）发布与提审全部成功！');
}
