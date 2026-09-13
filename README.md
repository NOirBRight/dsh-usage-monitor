# dsh-usage-monitor

English | [中文](README.zh.md)

Usage dashboard for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It folds provider-reported token usage out of session logs and charts it in Settings.

## Compatibility

Host `@deepseek-ai/dsh-*` packages are not version-locked: peers are `*` and optional. `devDependencies` pin the compile target (`0.1.5-rc.1`). Cordis stays `>=4.0.2 <5.0.0`.

Verified Hosts in `package.json#dsh.compatibility.dshReleases` are evidence, not an allowlist. Unknown newer Hosts warn once and keep the normal mount path. Only a reproduced failure is blocklisted.

## What it shows

- Tokens, requests, output tokens, and cache-hit rate
- Stacked chart with Metric (token / request), By (provider / model / workspace), Group (day / week)
- Week, month, and custom ranges
- A responsive overview with a full-width token summary, compact secondary metrics, a stacked chart, and token-share cards that follow the current By grouping
- On narrow screens, the cards collapse to one column and the chart legend scrolls horizontally

Subscription quotas are not fetched.

## Installation

Host DSH packages are not version-locked; see Compatibility. Install from GitHub:

```sh
dsh plugin --profile web add --force https://github.com/NOirBRight/dsh-usage-monitor/releases/latest/download/dsh-usage-monitor-0.2.14.tgz
dsh web
```

The repository tracks release-ready lib artifacts, so GitHub installation needs no build-script allowlist. A source checkout can use a link installation after running `pnpm run build`.

Then open **Settings → Usage**.

## Data

Reads `ctx.sessionQuery` (live + persisted sessions). Cold folds prefer the JSONL backend's `resolveCurrentLog` artifact as raw JSONL so Host-unknown event types still contribute usage; the plugin does not invent session directory layout and does not read leftover community cache files. A session that cannot be read at all is omitted from the snapshot; the page still shows the remaining complete rows.

## Release

`pnpm run check` runs the full gate in order: unit tests, TypeScript typecheck, deterministic build-parity (clean temp build vs tracked `lib/`), package build, and a real `npm pack` + immutable `fixtures/rc1` validation + offline install + Host/client import smoke. The pack check reads only the repository-owned 0.1.5-rc.1 manifest/tarballs, verifies the official 0.1.5-rc.1 tag/commit and registry integrity, preserves versioned parent edges, and uses a fresh pnpm consumer with an invalid registry, offline/no-scripts/no-audit/no-fund settings, empty `NODE_PATH`, and scoped local-tarball overrides; it uses neither `--legacy-peer-deps` nor omit/force bypasses. The owner archive is written only below the prefixed temporary directory. It does not rewrite `lib/` before comparison, so a stale, missing or hand-edited artifact fails.

For a tag, run `pnpm run check:strict` (the same test, typecheck, parity, build, and pack order with `PARITY_CHECK_HEAD=1`; it fails if the committed `lib/` still differs from the source — the v0.2.5 drift guard). Keep `src` as the source of truth and commit the rebuilt `lib/`.

The Settings → Usage nav icon is a DOM patch via `ctx.effect` + `MutationObserver` on `document.body`; see `src/client/nav-icon.ts` for the `ctx.effect` disposer and the accepted Alpha.4 DOM risk.

## Release installation (Latest)

Session-log usage dashboard with responsive metric cards, charting, and provider shares. The published pack contains built Host/Client files only; it has no sibling-repository source, workstation path, link:, or workspace: dependency. Pack-check fixtures and compile-target `devDependencies` are 0.1.5-rc.1.

Latest installation (the URL never contains a version):

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-usage-monitor/releases/latest/download/dsh-usage-monitor-0.2.14.tgz
~~~

Fixed-version installation:

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-usage-monitor/releases/download/v0.2.14/dsh-usage-monitor-0.2.14.tgz
~~~

Update, uninstall, and verify:

~~~sh
# Update to the latest Release
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-usage-monitor/releases/latest/download/dsh-usage-monitor-0.2.14.tgz
# Verify the loaded version
dsh plugin --profile web list
dsh plugin --profile web doctor
# Uninstall only this plugin
dsh plugin --profile web remove dsh-usage-monitor
~~~

Configuration: use the plugin section in Settings for Web UI plugins, or the profile dsh.profile.bundles entry for Host-only plugins. Start with this README's minimal YAML/JSON example and provide credentials/backend addresses explicitly.

Rollback: rerun the fixed v0.2.14 command, verify the profile list, then restart the Web service once. Inspect journalctl --user -u dsh-web.service and dsh plugin --profile web doctor; never put a source checkout in the production profile.

Release and integrity: [v0.2.14](https://github.com/NOirBRight/dsh-usage-monitor/releases/tag/v0.2.14) · [SHA256SUMS](https://github.com/NOirBRight/dsh-usage-monitor/releases/download/v0.2.14/SHA256SUMS).
