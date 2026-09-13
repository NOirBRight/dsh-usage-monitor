# dsh-usage-monitor

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的用量看板。从会话日志里折出供应商上报的 token usage，在设置页画图。

## 兼容性

宿主 `@deepseek-ai/dsh-*` 不锁定发行号：peer 为 `*` 且 optional。`devDependencies` 钉编译目标（`0.1.5-rc.1`）。Cordis 保持 `>=4.0.2 <5.0.0`。

`package.json#dsh.compatibility.dshReleases` 里的已验证宿主是证据，不是允许列表。未知的新宿主告警一次后仍按正常路径挂载。只有复现过的故障才会加入 blocklist。

## 展示

- Tokens、请求数、输出 token、缓存命中率
- 堆叠图：指标（Token / 请求）× 分组（供应商 / 模型 / 工作区）× 粒度（日 / 周）
- 近一周、近一月、自定义范围
- 响应式总览统一使用全宽 Token 汇总、紧凑次要指标、堆叠图和跟随当前 By 分组的 Token 占比卡片
- 窄屏下卡片收为单列，图例可横向滚动

不查询订阅额度。

## 安装

宿主 DSH 包不锁定发行号，见兼容性。从 GitHub 安装：

```sh
dsh plugin --profile web add --force https://github.com/NOirBRight/dsh-usage-monitor/releases/latest/download/dsh-usage-monitor-0.2.14.tgz
dsh web
```

仓库跟踪已构建的 lib 产物，GitHub 安装不需要允许构建脚本。源码检出可在 `pnpm run build` 后用 link 安装。

然后打开 **设置 → 用量**。

## 数据

走 `ctx.sessionQuery`（含进行中和已落盘会话）。冷读优先用 JSONL 后端 `resolveCurrentLog` 给出的产物当 raw JSONL 折算，宿主不认识的事件类型仍计入用量；插件不自行拼会话目录，也不读社区插件留下的缓存。完全读不到的会话会从快照中省略，页面仍展示其余已完成的行。

## 发布

`pnpm run check` 按以下顺序运行完整门禁：单测、TypeScript 类型检查、确定性构建一致性校验（干净临时目录构建 vs 跟踪的 `lib/`）、构建，以及真实 `npm pack` + 不可变 `fixtures/rc1` 校验 + 离线安装 + Host/前端 bundle 导入冒烟。打包校验只读取仓库自有的 0.1.5-rc.1 manifest/tarballs，验证官方 0.1.5-rc.1 tag/commit 与 registry 完整性，保留按版本区分的父边；隔离的全新 pnpm consumer 使用无效 registry、offline/no-scripts/no-audit/no-fund、空 `NODE_PATH` 和按父包作用域的本地 tarball 覆盖，不使用 `--legacy-peer-deps` 或 omit/force 绕过。Owner archive 只写入带前缀的临时目录。校验不会在比对前重写工作区 `lib/`，陈旧、缺失或手改的产物都会失败。

打 tag 前跑 `pnpm run check:strict`（顺序同样是单测、类型检查、构建一致性校验、构建、打包，并设置 `PARITY_CHECK_HEAD=1`；若已提交的 `lib/` 与源码构建不一致则失败——即 v0.2.5 漂移防护）。以 `src` 为准，提交重建后的 `lib/`。

设置 → 用量的导航图标是 `ctx.effect` + `MutationObserver` 的 DOM 补丁；`ctx.effect` 释放与接受的 Alpha.4 DOM 风险见 `src/client/nav-icon.ts`。

## 正式版安装（Latest）

Session-log usage dashboard with responsive metric cards, charting, and provider shares. 发布包只包含构建后的 Host/Client 产物，不含兄弟仓库源码、本机路径或 link:/workspace: 依赖。打包夹具与编译目标 `devDependencies` 为 0.1.5-rc.1。

Latest 安装命令（永久不含版本号）：

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-usage-monitor/releases/latest/download/dsh-usage-monitor-0.2.14.tgz
~~~

固定版本安装命令：

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-usage-monitor/releases/download/v0.2.14/dsh-usage-monitor-0.2.14.tgz
~~~

更新、卸载与验证：

~~~sh
# 更新到最新 Release
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-usage-monitor/releases/latest/download/dsh-usage-monitor-0.2.14.tgz
# 验证加载与版本
dsh plugin --profile web list
dsh plugin --profile web doctor
# 只卸载本插件
dsh plugin --profile web remove dsh-usage-monitor
~~~

配置入口：Web 使用「设置」中的本插件页面；Host-only 插件使用 profile 的 dsh.profile.bundles 配置。先复制本 README 的最小 YAML/JSON 示例，再填写凭据或后端地址。

回滚：重新执行固定版本 v0.2.14 命令，确认插件列表后只重启一次 Web 服务。失败时查看 journalctl --user -u dsh-web.service 与 dsh plugin --profile web doctor，不要把源码 checkout 写入 production profile。

Release 与完整性：[v0.2.14](https://github.com/NOirBRight/dsh-usage-monitor/releases/tag/v0.2.14) · [SHA256SUMS](https://github.com/NOirBRight/dsh-usage-monitor/releases/download/v0.2.14/SHA256SUMS)。
