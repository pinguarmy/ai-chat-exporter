# Extension 三平台发布指南

这是 AI Chat Exporter 发布到 Chrome Web Store、Firefox AMO、Microsoft Edge Add-ons 和 GitHub Release 的统一入口。新会话先读本文；Chrome 授权故障再读 [Chrome 授权说明](chrome-publishing-auth.md)。不要依赖旧对话记忆判断版本、凭证或上线状态。

## 1. 找到项目，确定这次要做什么

- 仓库：<https://github.com/pinguarmy/ai-chat-exporter>
- 本机主目录：`/Users/peterhao/Projects/ai-chat-exporter`
- 本机别名：`/Users/peterhao/Documents/AI Chat Exporter`，当前为指向主目录的符号链接。
- 发布规则：[AGENTS.md](../AGENTS.md)。验证后的改动要提交并同步 `main`；用户要求发布时可以执行发布，不必重复索要已经给过的授权。

先检查实际状态，不要直接运行上传命令：

```sh
git status --short --branch
git remote -v
git fetch origin --tags
gh release list --limit 5
node -p "require('./package.json').version"
gh secret list --json name
```

保护未提交改动，并核对其他 worktree 是否正在使用 `main`。干净主工作区可以执行 `git pull --ff-only origin main`。发布前，本地与远端 `main` 应指向同一提交。

区分两种任务：

- **新版本**：选择高于三个商店现有版本的新版本号，执行第 3、4 节。
- **补交已有版本**：保留已发布 tag 和 ZIP，只向尚未成功的平台提交，执行第 5 节。不要为了补交而改写旧 tag，或从新的 `main` 重新打同版本的包。

截至 2026-09-15，GitHub 已发布 `v1.3.0`，而 `main` 后续还有发布工具改进。这是历史背景；每次任务都要重新核实。不能在当前 `main` 上直接重新派发 `1.3.0` 发布，否则会触发已有 tag 指向不同提交的保护。

## 2. 选择发布环境，检查凭证

| 平台 | 本地命令 | 必需环境变量 / GitHub Secrets | 安装包 |
| --- | --- | --- | --- |
| Chrome | `npm run publish:cws` | `PLASMO_CHROME_ID`、`PLASMO_CHROME_CLIENT_ID`、`PLASMO_CHROME_CLIENT_SECRET`、`PLASMO_CHROME_REFRESH_TOKEN` | `ai-chat-exporter.zip` |
| Firefox | `npm run publish:firefox` | `PLASMO_FIREFOX_ISSUER`、`PLASMO_FIREFOX_SECRET` | `ai-chat-exporter-firefox.zip`，另需 `ai-chat-exporter-source.zip` |
| Edge | `npm run publish:edge` | `PLASMO_EDGE_CLIENT_ID`、`PLASMO_EDGE_API_KEY`、`PLASMO_EDGE_PRODUCT_ID` | `ai-chat-exporter.zip` |

本地脚本优先读取进程环境变量，然后读取项目根目录被 Git 忽略的 `.env.local`。GitHub Actions 只读取仓库 Secrets，不会读取本机文件。不要将凭证明文写入文档、提交、聊天、日志或 shell 命令参数；上传 GitHub Secrets 时使用标准输入。

**已核实的配置，2026-09-15：**本机三家凭证均已配置；GitHub Secrets 只有 Chrome 的四项。Firefox 和 Edge 的本地提交已成功过，但这不证明 GitHub 也已配置它们。后续可能变化，以 `gh secret list --json name` 和实际验证为准。

- 全部 Secrets 齐备时，可以走 GitHub 的三平台发布流程。
- 按当前配置，GitHub 流程提交 Chrome 并创建 GitHub Release；Firefox、Edge 会跳过，随后用同一批 Release ZIP 在本地补交。
- 不要把 GitHub workflow 的绿色状态当作三家都已提交；逐个检查商店步骤是否被跳过。

本地预检：

```sh
npm run publish:all -- --dry-run
npm run check:cws
```

`--dry-run` 只检查本地配置和文件，不联系商店验证凭证。其汇总文案可能写“成功”，也不代表上传或提审。`check:cws` 才会交换 access token 并读取 Chrome 草稿，它不会上传。

Chrome 的 OAuth 应用位于 GCP 项目 `chrome-extension-publish` / `rugged-matrix-507004-h6`，应保持 **In production**。Testing 会使本项目所用 scope 的 refresh token 七天过期。`gcloud` 登录不等于 Chrome 商店授权。遇到 `invalid_grant`，按顺序执行：

```sh
npm run auth:cws
npm run check:cws
npm run sync:cws
```

最后一条只同步 Chrome 的四项 Secrets。可用 `gh workflow run chrome-auth.yml --ref main` 验证 GitHub 上的授权。正式模式也不能阻止主动撤销、六个月未使用等导致的失效，详见 [授权说明](chrome-publishing-auth.md)。Firefox、Edge 凭证失效时，通过各自开发者后台恢复对应密钥；不要反复重试上传，也不要自动启用无关 GCP API 或更改 IAM 权限。

## 3. 准备新版本和更新说明

1. 核对三家商店当前版本及是否已有待审版本，再选择严格递增的版本号。
2. 用 `npm version <新版本号> --no-git-tag-version` 同步更新 `package.json` 和 `package-lock.json`。
3. 新建 `docs/releases/<新版本号>.md`，参考 [1.3.0 更新说明](releases/1.3.0.md)。写明中英用户可见改动、修复和限制。缺少这个文件会阻止 Release 流程完成。
4. 运行检查，提交版本与文档并同步 `main`。不要提交 ZIP、构建目录、依赖、临时截图或私有配置。

完整验证顺序：

```sh
npm ci
npm test
npm run test:coverage
npm run lint
npm audit --omit=dev
# 上述检查通过后，将本次源文件、版本和文档提交并推送 main。
# 以下发布构建必须在干净、已提交的工作区运行。
npm run build
npx playwright install chromium
npm run test:browser
```

检查三份 ZIP 的完整性、两个 manifest 的版本、源码包内 `package.json` 的版本，以及它们所属的提交。构建脚本已执行包校验；需要复核时可用 `unzip -t <文件>` 和 `unzip -p <安装包> manifest.json`。

`npm run build` 要求干净工作区，否则源码 ZIP 与浏览器 ZIP 可能不属于同一提交。`ALLOW_DIRTY_BUILD=1` 仅供开发，会跳过源码归档，不能用于发布。源码包由 `git archive` 创建，根目录为 `ai-chat-exporter-<版本>-source/`；构建会拒绝 `.git`、依赖、生成物、嵌套 ZIP、缓存和 `.env` 等不应发布的内容。源码包用于 AMO 审核，不能安装。

自动测试与 Chromium 合成对话下载不能证明五个平台的真实登录态导出正常。涉及解析或导出行为时，应核验用户授权范围内的真实对话、分页、消息顺序、引用和附件提示，并明确记录未验证的平台和浏览器。

## 4. 发布新版本，默认通过 GitHub 构建

确认版本、更新说明、CI 和凭证覆盖范围后，执行一次：

```sh
gh workflow run release.yml --ref main
gh run list --workflow release.yml --limit 3
```

从输出中选中对应提交和本次触发的 run，然后执行 `gh run watch <run-id> --exit-status`。不要只看最近一条而误认其他任务的结果。

流程会重新安装依赖、测试、检查覆盖率、类型、安全审计、构建与扩展冒烟。手动派发路径在验证后创建对应 tag；随后读取版本更新说明，依次提交已配置的商店，创建 GitHub Release 并上传三个 ZIP。也支持推送 `v*` tag 触发，但不要同时手动派发和推 tag。

**现有流程的限制：**缺凭证的平台会跳过；某个平台提交失败会阻止后续步骤，包括 GitHub Release。不要盲目重跑整个流程，它可能重复提交已成功的平台。先查失败步骤和商店状态，再按下一节恢复。

更新说明的去向也要分别确认：

- GitHub：自动读取 `docs/releases/<版本>.md` 作为 Release 正文。
- Firefox：当前上传脚本不自动写用户更新说明。版本创建后，通过 AMO 后台补写；API 路径为 `/api/v5/addons/addon/ai-chat-exporter%40pinguarmy.github.io/versions/<version-id>/`，PATCH `release_notes` 必须是语言对象，例如 `{"en-US":"英文说明","zh-CN":"中文说明"}`。使用既有 AMO JWT 授权，先核对版本 ID，写后 GET 回读；AMO 可能将 Markdown 转为 HTML。
- Edge：脚本提交的 `Automated release v<版本>` 是提审 notes，不能当作用户可见更新日志。若用户要求商店展示更新，进入对应 listing 编辑并确认。
- Chrome：当前 API 脚本只上传包和提审，不修改商店介绍。若需在 listing 展示变化，需在开发者后台单独更新并确认。

## 5. 本地提交与部分失败恢复

全新一轮、三个平台都尚未提交时，且已检查并准备同一提交的完整发布包，可以使用 `npm run publish:all`。它依次尝试三家商店，结束时只汇总失败数；必须保留各平台单独结果。

**GitHub Release 已有目标版本时**，优先下载原始产物。先在一个新建的空目录下载，避免覆盖已有待核验文件：

```sh
gh release download v<目标版本> --dir <空目录>
```

确认 tag、源码版本、ZIP 内 manifest 和三个资产完整性后，将需要的包放到仓库根目录。然后只执行尚未成功的平台命令，例如 Chrome 已提审而另两家未提交时：

```sh
npm run publish:firefox
npm run publish:edge
```

只有确认目标平台尚未创建该版本时才重试。`--upload-only` 仍会向商店上传文件，只是不进行后续提审或创建版本，不能当作只读预检。

**GitHub Release 尚未创建时**，若前面的商店步骤已部分成功，先从本次工作流的可用 artifacts 或对应已验证提交取得包。没有可下载 artifacts 时，在该提交的独立工作区重新运行发布检查和构建，不能拿当前新 `main` 的包替代。逐个平台恢复后，再为同一个 tag 创建 GitHub Release，附上版本日志及三个 ZIP。不要改变已发布 tag，也不要用 `--clobber` 替换已经确认的发布资产。

浏览器后台仅作为 API 失败时的备用路径。登录应使用拥有该扩展发布权的账号。一个浏览器里可能有多个 Google 账号；Google Cloud 控制台能打开，不代表当前账号能管理这个项目或 Chrome 扩展。

## 6. 如何确认发布完成

| 渠道 | 已上传 / 已提交的证据 | 已公开上线的证据 |
| --- | --- | --- |
| GitHub | 工作流成功还不够，要确认 Release 非 draft 且三个资产齐全 | `gh release view v<版本> --json url,isDraft,isPrerelease,assets`，下载核对版本 |
| Chrome | 上传 `SUCCESS`，提审返回 `OK` 或 `ITEM_PENDING_REVIEW` | 开发者后台或公开 listing 显示目标版本 |
| Firefox | 上传校验通过、创建版本成功，记录 version ID 与版本号 | 公开 API 的 `current_version.version` 为目标版本且文件状态为 `public` |
| Edge | 上传操作、提审操作分别为 `Succeeded`，记录 operation ID | Partner Center 或公开 listing 显示目标版本 |

公开入口：

- [Chrome Web Store](https://chromewebstore.google.com/detail/ai-chat-exporter/kdafdajkiljhghecdkeogldafhjgmgpk)
- [Firefox AMO](https://addons.mozilla.org/en-US/firefox/addon/pinguarmy-ai-chat-exporter/)
- [Firefox 公开状态 API](https://addons.mozilla.org/api/v5/addons/addon/ai-chat-exporter%40pinguarmy.github.io/)
- [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ai-chat-exporter/ndjcmigocoflghenpchbldpkaccechpg)
- [GitHub Releases](https://github.com/pinguarmy/ai-chat-exporter/releases)

最终交付逐家写“已上线 / 已提审 / 未提交及原因”，附版本、tag/提交、工作流链接、包校验结果及更新说明去向。审核等待期间不能声称用户已收到更新。结束时检查工作区干净、`main` 已同步。维护工具改动可在 `main` 继续提交，但不得因此改写已发布版本。

本机项目知识入口在 Obsidian 的 `02-项目/ACTIVE/AI-Chat-Exporter/README.md`。在那里记录本次发布结论并链接本文；操作步骤以仓库本文为准，避免多份指南漂移。
