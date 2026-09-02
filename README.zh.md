# dsh-usage-monitor

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的用量看板。从会话日志里折出供应商上报的 token usage，在设置页画图。

![设置 → 用量：汇总格、堆叠图、供应商卡片](docs/screenshots/settings-usage.png)

## 展示

- Tokens、请求数、输出 token、缓存命中率
- 堆叠图：指标（Token / 请求）× 分组（供应商 / 模型 / 工作区）× 粒度（日 / 周）
- 近一周、近一月、自定义范围
- 响应式总览统一使用全宽 Token 汇总、紧凑次要指标、堆叠图和跟随当前 By 分组的 Token 占比卡片
- 窄屏下卡片收为单列，图例可横向滚动

不查询订阅额度。

## 安装

需要 DeepSeek Harness 0.1.0-rc.6 或更新。从 GitHub 安装：

```sh
dsh plugin --profile web add github:NOirBRight/dsh-usage-monitor#v0.2.10
dsh web
```

仓库跟踪已构建的 lib 产物，GitHub 安装不需要允许构建脚本。源码检出可在 `pnpm run build` 后用 link 安装。

然后打开 **设置 → 用量**。

## 数据

走 `ctx.sessionQuery`（含进行中和已落盘会话）。不直接读 `session.jsonl.zstd`，也不读社区插件留下的缓存。

## 发布

`pnpm run check` 按以下顺序运行完整门禁：单测、TypeScript 类型检查、确定性构建一致性校验（干净临时目录构建 vs 跟踪的 `lib/`）、构建，以及真实 `npm pack` + 不可变 Alpha.4 固件校验 + 离线安装 + Host/前端 bundle 导入冒烟。打包校验只读取仓库自有的 Alpha.4 manifest/tarballs，验证官方 Alpha.4 tag/commit 与 registry 完整性，保留按版本区分的父边；隔离的全新 pnpm consumer 使用无效 registry、offline/no-scripts/no-audit/no-fund、空 `NODE_PATH` 和按父包作用域的本地 tarball 覆盖，不使用 `--legacy-peer-deps` 或 omit/force 绕过。Owner archive 只写入带前缀的临时目录。校验不会在比对前重写工作区 `lib/`，陈旧、缺失或手改的产物都会失败。

打 tag 前跑 `pnpm run check:strict`（顺序同样是单测、类型检查、构建一致性校验、构建、打包，并设置 `PARITY_CHECK_HEAD=1`；若已提交的 `lib/` 与源码构建不一致则失败——即 v0.2.5 漂移防护）。以 `src` 为准，提交重建后的 `lib/`。

设置 → 用量的导航图标是 `ctx.effect` + `MutationObserver` 的 DOM 补丁；`ctx.effect` 释放与接受的 Alpha.4 DOM 风险见 `src/client/nav-icon.ts`。


## 正式版安装（Latest）

Session-log usage dashboard with responsive metric cards, charting, and provider shares. 正式成品只支持 DeepSeek Harness 0.1.2-alpha.4；发布包只包含构建后的 Host/Client 产物，不包含兄弟仓库源码、本机路径或 link:/workspace: 依赖。

Latest 安装命令（永久不含版本号）：

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-usage-monitor/releases/latest/download/dsh-usage-monitor.tgz
~~~

固定版本安装命令：

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-usage-monitor/releases/download/v0.2.10/dsh-usage-monitor.tgz
~~~

更新、卸载与验证：

~~~sh
# 更新到最新 Release
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-usage-monitor/releases/latest/download/dsh-usage-monitor.tgz
# 验证加载与版本
dsh plugin --profile web list
dsh plugin --profile web doctor
# 只卸载本插件
dsh plugin --profile web remove dsh-usage-monitor
~~~

配置入口：Web 使用「设置」中的本插件页面；Host-only 插件使用 profile 的 dsh.profile.bundles 配置。先复制本 README 的最小 YAML/JSON 示例，再填写凭据或后端地址。

回滚：重新执行固定版本 v0.2.10 命令，确认插件列表后只重启一次 Web 服务。失败时查看 journalctl --user -u dsh-web.service 与 dsh plugin --profile web doctor，不要把源码 checkout 写入 production profile。

Release 与完整性：[v0.2.10](https://github.com/NOirBRight/dsh-usage-monitor/releases/tag/v0.2.10) · [SHA256SUMS](https://github.com/NOirBRight/dsh-usage-monitor/releases/download/v0.2.10/SHA256SUMS)。
