# dsh-usage-monitor

English | [中文](README.zh.md)

Usage dashboard for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It folds provider-reported token usage out of session logs and charts it in Settings.

![Settings → Usage: tiles, stacked chart, and provider table](docs/screenshots/settings-usage.png)

## What it shows

- Tokens, requests, output tokens, and cache-hit rate
- Stacked chart with Metric (token / request), By (provider / model / workspace), Group (day / week)
- Week, month, and custom ranges
- A breakdown table that follows the current By grouping

Subscription quotas are not fetched.

## Installation

DeepSeek Harness 0.1.0-rc.6 or later is required. Install directly from GitHub:

```sh
dsh plugin --profile web add github:NOirBRight/dsh-usage-monitor#v0.1.0
dsh web
```

The repository tracks release-ready lib artifacts, so GitHub installation needs no build-script allowlist. A source checkout can use a link installation after running `pnpm run build`.

Then open **Settings → Usage**.

## Data

Reads `ctx.sessionQuery` (live + persisted sessions). Does not scan `session.jsonl.zstd` itself and does not read leftover community cache files.
