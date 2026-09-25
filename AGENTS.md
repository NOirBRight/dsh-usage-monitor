# DSH 两套平面

3080 / `~/.dsh` 是 production，只读发布面。不要为了预览去改、刷新、重启 3080。
3082 / `~/.dsh-lab` 是唯一试验面。改插件只动 Workstation checkout，验收只看 3082。
完整约定：`/home/noirbright/Workstation/AGENTS.md`

## Core 边界

本项目只维护插件：官方 DeepSeek Harness 及其本地 checkout 是只读依赖。实现与兼容处理留在本项目；禁止修改、携带或重放 DSH core patch。缺少公开 seam 时记录上游提案，并让插件在干净的官方 tag 上降级或关闭该能力。

## 发布门禁

- `pnpm run check:parity`：干净临时目录 `pnpm run build`，逐文件比对跟踪的 `lib/`，陈旧/缺失/手改即失败；不在比对前重写工作区。`PARITY_CHECK_HEAD=1` 额外校验已提交 `lib/`（v0.2.5 漂移防护）。
- `pnpm run pack:check`：真实 `npm pack` 生成 tarball，校验插件 `exports`/`main`/`types` 目标与归档路径，拒绝 `src/tests/scripts/.env` 等，校验仓库自有 `fixtures/rc1-0.1.7` tarballs/manifest（0.1.7-rc.1 平面）的 tag、commit、registry integrity、版本化父子依赖边（包含重复版本），在全新 pnpm consumer 中仅用本地 tarballs、无效 registry、offline、ignore-scripts、audit/fund disabled、空 `NODE_PATH` 和按父包作用域的 overrides 安装，并执行 Host Fetch RPC 与前端 `window.__ModuleLoader__` 冒烟；不使用动态项目 `node_modules`、`--legacy-peer-deps` 或 omit/force 绕过，任何安装/导入失败直接失败。
- `pnpm run check` = `test && typecheck && check:parity && build && pack:check`；`test` 为纯源码单测（`tests/release-gate.spec.ts` 覆盖缺失 export、陈旧 bundle、fixture digest/文件/版本/版本化边否定）。`check:strict` 使用相同顺序，并为 `check:parity` 设置 `PARITY_CHECK_HEAD=1`.
- 导航图标：`src/client/nav-icon.ts` 经 `ctx.effect` 安装，返回的 disposer 断开 `MutationObserver` 并取消 `requestAnimationFrame`；Observer 监听 `document.body`，依赖 alpha.1 的 `nav button` DOM，已接受该兼容风险，见该文件注释。

## DSH 版本兼容

- 官方 DSH Host 包（`@deepseek-ai/dsh` 及 `@deepseek-ai/dsh-*`）在 `package.json` 的 `dependencies`、`optionalDependencies`、`devDependencies`、`peerDependencies` 中使用无上界的下限范围 `>=最低已验证兼容版本`；不得用精确版本或带上界的范围限制后续版本。锁文件、构建输入和安装/发布工件选择器可固定实际验证的版本。
- 对有明确公开 API 或协议兼容承诺的 DSH 插件 peer，也使用无上界的下限范围 `>=最低已验证兼容版本`。未定义兼容承诺的插件协议应先定义并验证；不要仅凭包名放宽版本。插件 peer 新版本通过互操作测试和构建后，再声明兼容。
- 声明兼容新 DSH release 前，审查其公开 API 变化与插件实际调用，运行相关测试和 `pnpm run build`，并在 3082（`DSH_HOME=~/.dsh-lab`）验证；全部通过后再宣称兼容。
