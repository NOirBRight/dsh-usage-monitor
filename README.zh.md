# dsh-usage-monitor

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的用量看板。从会话日志里折出供应商上报的 token usage，在设置页画图。

![设置 → 用量：汇总格、堆叠图、供应商表](docs/screenshots/settings-usage.png)

## 展示

- Tokens、请求数、输出 token、缓存命中率
- 堆叠图：指标（Token / 请求）× 分组（供应商 / 模型 / 工作区）× 粒度（日 / 周）
- 近一周、近一月、自定义范围
- 底表跟随当前 By 分组

不查询订阅额度。

## 安装

需要 DeepSeek Harness 0.1.0-rc.6 或更新。从 GitHub 安装：

```sh
dsh plugin --profile web add github:NOirBRight/dsh-usage-monitor#v0.2.4
dsh web
```

仓库跟踪已构建的 lib 产物，GitHub 安装不需要允许构建脚本。源码检出可在 `pnpm run build` 后用 link 安装。

然后打开 **设置 → 用量**。

## 数据

走 `ctx.sessionQuery`（含进行中和已落盘会话）。不直接读 `session.jsonl.zstd`，也不读社区插件留下的缓存。

Host 启动时只打开插件自有的 SQLite sidecar，不列举或读取会话历史；第一次查询用量时才开始投影。每次查询返回前，会核对所有可能相关且缺失或已变更的会话；相关源日志或数据库出错时查询失败，不返回陈旧或不完整数据。原始 JSONL 按行即时折叠；后续批次中断时，已经提交的投影批次仍然保留。

Sidecar 使用 WAL、`synchronous=NORMAL` 和有界 busy timeout。源日志读取和 SQLite 事务默认分别限制为 1 个和 8 个会话。经过校验的插件配置提供 `projectionWarmup: on-demand`、`projectionReadConcurrency` 和 `projectionTransactionBatchSize`，默认值分别为 `on-demand`、`1`、`8`。Loader 条目可省略 `config` 以采用这些默认值；显式非法配置会在插件加载时失败。

运行 `pnpm run benchmark:projection` 可执行 1,346 个合成会话、83,883 个合成 step 的负载，输出冷/热查询耗时、堆内存变化、源读取次数和读取并发峰值，不读取生产数据。保证与预期指标见[投影决策](docs/decisions/0001-bounded-on-demand-projection.md)。
